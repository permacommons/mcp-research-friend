import fs from "node:fs/promises";
import path from "node:path";
import { processAsk } from "../ask-processor.js";
import { PLAINTEXT_TYPES } from "./extractors.js";

function searchText(text, query, contextChars = 200) {
	const matches = [];
	const lowerText = text.toLowerCase();
	const lowerQuery = query.toLowerCase();
	let pos = lowerText.indexOf(lowerQuery, 0);

	while (pos !== -1) {
		const start = Math.max(0, pos - contextChars);
		const end = Math.min(text.length, pos + query.length + contextChars);
		matches.push({
			position: pos,
			context: text.slice(start, end),
			prefix: start > 0 ? "..." : "",
			suffix: end < text.length ? "..." : "",
		});
		pos = lowerText.indexOf(lowerQuery, pos + query.length);
	}

	return matches;
}

const truncate = (value, maxChars) => {
	if (value.length <= maxChars) {
		return { value, truncated: false };
	}
	return { value: value.slice(0, maxChars), truncated: true };
};

export async function extractFromStash({
	id,
	maxChars = 40000,
	offset = 0,
	search = null,
	ask = null,
	askTimeout = 300000,
	askMaxInputTokens = 150000,
	askMaxOutputTokens = 4096,
	askSplitAndSynthesize = false,
	contextChars = 200,
	_db,
	_server = null,
	_fs = fs,
	_stashRoot,
}) {
	const doc = _db.getDocument(id);
	if (!doc) {
		throw new Error(`Document not found: ${id}`);
	}

	// Read the text content from the store
	// Plaintext files are read directly, others have .txt extraction
	const textPath = PLAINTEXT_TYPES.has(doc.file_type)
		? path.join(_stashRoot, doc.store_path)
		: path.join(_stashRoot, `${doc.store_path}.txt`);
	const fullText = await _fs.readFile(textPath, "utf-8");

	// If ask is provided, use sampling to answer the question
	if (ask) {
		const result = await processAsk({
			fullText,
			ask,
			askMaxInputTokens,
			askMaxOutputTokens,
			askTimeout,
			askSplitAndSynthesize,
			documentType: "document",
			_server,
		});

		return {
			id: doc.id,
			filename: doc.filename,
			fileType: doc.file_type,
			summary: doc.summary,
			totalChars: fullText.length,
			ask,
			answer: result.answer,
			model: result.model,
			chunksProcessed: result.chunksProcessed,
		};
	}

	// If search is provided, return matches instead of full content
	if (search) {
		const matches = searchText(fullText, search, contextChars);
		return {
			id: doc.id,
			filename: doc.filename,
			fileType: doc.file_type,
			summary: doc.summary,
			totalChars: fullText.length,
			search,
			matchCount: matches.length,
			matches,
		};
	}

	// Otherwise return paginated content
	const sliced = fullText.slice(offset);
	const { value: content, truncated } = truncate(sliced, maxChars);

	return {
		id: doc.id,
		filename: doc.filename,
		fileType: doc.file_type,
		summary: doc.summary,
		totalChars: fullText.length,
		offset,
		content,
		truncated,
	};
}
