import fs from "node:fs/promises";
import path from "node:path";
import {
	classifyDocument,
	ensureTopics,
	normalizeClassification,
} from "./classify.js";
import { getTextPath } from "./extract.js";
import { extractText, PLAINTEXT_TYPES } from "./extractors.js";
import { buildStorePath, getAbsoluteStorePath } from "./paths.js";

async function pathExists(filePath, _fs) {
	try {
		await _fs.stat(filePath);
		return true;
	} catch {
		return false;
	}
}

export async function reindexStash({
	ids,
	_server,
	_db,
	_extractText = extractText,
	_fs = fs,
	_stashRoot,
}) {
	const targetIds =
		Array.isArray(ids) && ids.length > 0
			? ids
			: _db.getAllDocuments().map((doc) => doc.id);

	const reindexed = [];
	const errors = [];
	const documents = [];

	for (const id of targetIds) {
		try {
			const doc = _db.getDocument(id);
			if (!doc) {
				throw new Error(`Document not found: ${id}`);
			}

			const existingTopics = _db.getTopicsWithCounts();
			const textPath = getTextPath(doc, _stashRoot);
			let fullText;
			let regeneratedText = false;

			try {
				fullText = await _fs.readFile(textPath, "utf-8");
			} catch (error) {
				if (PLAINTEXT_TYPES.has(doc.file_type)) {
					throw error;
				}
				const originalPath = path.join(_stashRoot, doc.store_path);
				fullText = await _extractText(originalPath, doc.file_type);
				regeneratedText = true;
			}

			const classification = await classifyDocument(
				doc.filename,
				fullText,
				existingTopics,
				_server,
			);
			const normalized = normalizeClassification(classification);

			ensureTopics(_db, normalized.newTopics);

			const newRelativePath = buildStorePath(
				normalized.primaryTopic,
				doc.filename,
			);
			const oldPath = getAbsoluteStorePath(_stashRoot, doc.store_path);
			const newPath = getAbsoluteStorePath(_stashRoot, newRelativePath);
			const newDir = path.dirname(newPath);

			await _fs.mkdir(newDir, { recursive: true });

			if (oldPath !== newPath && (await pathExists(oldPath, _fs))) {
				await _fs.rename(oldPath, newPath);
			}

			if (!PLAINTEXT_TYPES.has(doc.file_type)) {
				const oldTextPath = getAbsoluteStorePath(
					_stashRoot,
					`${doc.store_path}.txt`,
				);
				const newTextPath = getAbsoluteStorePath(
					_stashRoot,
					`${newRelativePath}.txt`,
				);
				if (
					oldTextPath !== newTextPath &&
					(await pathExists(oldTextPath, _fs))
				) {
					await _fs.rename(oldTextPath, newTextPath);
				} else if (regeneratedText || !(await pathExists(newTextPath, _fs))) {
					await _fs.writeFile(newTextPath, fullText, "utf-8");
				}
			}

			_db.updateDocument({
				id,
				summary: normalized.summary,
				storePath: newRelativePath,
				charCount: fullText.length,
				primaryTopic: normalized.primaryTopic,
				secondaryTopics: normalized.secondaryTopics,
			});

			reindexed.push(id);
			documents.push(_db.getDocument(id));
		} catch (error) {
			errors.push({
				id,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return { reindexed, errors, documents };
}
