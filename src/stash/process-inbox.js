import fs from "node:fs/promises";
import path from "node:path";
import { classifyDocument } from "./classify.js";
import { detectFileType, extractText, PLAINTEXT_TYPES } from "./extractors.js";

export async function processInbox({
	_server,
	_db,
	_extractText = extractText,
	_fs = fs,
	_stashRoot,
}) {
	const inboxPath = path.join(_stashRoot, "inbox");
	const storePath = path.join(_stashRoot, "store");

	// Ensure directories exist
	await _fs.mkdir(inboxPath, { recursive: true });
	await _fs.mkdir(storePath, { recursive: true });

	// Get files in inbox
	const files = await _fs.readdir(inboxPath);
	const processed = [];
	const errors = [];
	const documents = [];

	for (const filename of files) {
		const filePath = path.join(inboxPath, filename);

		// Skip directories
		const stat = await _fs.stat(filePath);
		if (stat.isDirectory()) {
			continue;
		}

		// Detect file type
		const fileType = detectFileType(filename);
		if (!fileType) {
			errors.push({ filename, error: `Unsupported file type` });
			continue;
		}

		try {
			// Extract text
			const text = await _extractText(filePath, fileType);
			const charCount = text.length;

			// Get existing topics for classification context
			const existingTopics = _db.getTopicsWithCounts();

			// Classify document via MCP sampling
			const classification = await classifyDocument(
				filename,
				text,
				existingTopics,
				_server,
			);

			// Create new topics if needed
			for (const newTopic of classification.newTopics || []) {
				_db.getOrCreateTopic({
					name: newTopic.name,
					description: newTopic.description,
				});
			}

			// Create topic directory: store/{primaryTopic}/
			const topicDir = path.join(storePath, classification.primaryTopic);
			await _fs.mkdir(topicDir, { recursive: true });

			// Move original file to store/{topic}/{filename}
			const destPath = path.join(topicDir, filename);
			await _fs.rename(filePath, destPath);

			// Write extracted text to .txt file (skip for plaintext formats - they're already searchable)
			if (!PLAINTEXT_TYPES.has(fileType)) {
				const textPath = path.join(topicDir, `${filename}.txt`);
				await _fs.writeFile(textPath, text, "utf-8");
			}

			// Insert into database
			const relativeStorePath = path.join(
				"store",
				classification.primaryTopic,
				filename,
			);
			const docId = _db.insertDocument({
				filename,
				fileType,
				summary: classification.summary,
				storePath: relativeStorePath,
				charCount,
				primaryTopic: classification.primaryTopic,
				secondaryTopics: classification.secondaryTopics || [],
			});

			const doc = _db.getDocument(docId);
			processed.push(filename);
			documents.push(doc);
		} catch (error) {
			errors.push({
				filename,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return { processed, errors, documents };
}
