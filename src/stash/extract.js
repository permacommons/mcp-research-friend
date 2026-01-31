import fs from "node:fs/promises";
import path from "node:path";
import { processAsk } from "../ask-processor.js";
import { PLAINTEXT_TYPES } from "./extractors.js";

const truncate = (value, maxChars) => {
	if (value.length <= maxChars) {
		return { value, truncated: false };
	}
	return { value: value.slice(0, maxChars), truncated: true };
};

/**
 * Get the text file path for a document
 */
function getTextPath(doc, stashRoot) {
	return PLAINTEXT_TYPES.has(doc.file_type)
		? path.join(stashRoot, doc.store_path)
		: path.join(stashRoot, `${doc.store_path}.txt`);
}

/**
 * Convert a 1-based line number to a character offset
 */
function lineToOffset(text, lineNumber) {
	if (lineNumber <= 1) return 0;

	let offset = 0;
	let currentLine = 1;

	for (let i = 0; i < text.length; i++) {
		if (currentLine >= lineNumber) {
			return offset;
		}
		if (text[i] === "\n") {
			currentLine++;
		}
		offset++;
	}

	// Line number exceeds total lines - return end of text
	return text.length;
}

/**
 * Extract content from a stashed document
 */
export async function extractFromStash({
	id,
	maxChars = 40000,
	offset,
	line,
	_db,
	_fs = fs,
	_stashRoot,
}) {
	if (offset && line !== undefined) {
		throw new Error("Cannot specify both 'offset' and 'line'");
	}

	const doc = _db.getDocument(id);
	if (!doc) {
		throw new Error(`Document not found: ${id}`);
	}

	// Read the text content from the store
	const textPath = getTextPath(doc, _stashRoot);
	const fullText = await _fs.readFile(textPath, "utf-8");

	// Calculate starting position
	let startOffset = 0;
	if (line !== undefined) {
		startOffset = lineToOffset(fullText, line);
	} else if (offset !== undefined) {
		startOffset = offset;
	}

	// Return paginated content
	const sliced = fullText.slice(startOffset);
	const { value: content, truncated } = truncate(sliced, maxChars);

	const result = {
		id: doc.id,
		filename: doc.filename,
		fileType: doc.file_type,
		summary: doc.summary,
		totalChars: fullText.length,
		content,
		truncated,
	};

	// Include whichever positioning was used
	if (line !== undefined) {
		result.line = line;
		result.offset = startOffset; // Also include computed offset for reference
	} else {
		result.offset = startOffset;
	}

	return result;
}

/**
 * Ask a question about a stashed document using LLM
 */
export async function askStashDocument({
	id,
	ask,
	askTimeout = 300000,
	askMaxInputTokens = 150000,
	askMaxOutputTokens = 4096,
	askSplitAndSynthesize = false,
	_db,
	_server = null,
	_fs = fs,
	_stashRoot,
}) {
	if (!_server) {
		throw new Error("Server instance required for ask mode");
	}

	const doc = _db.getDocument(id);
	if (!doc) {
		throw new Error(`Document not found: ${id}`);
	}

	// Read the text content from the store
	const textPath = getTextPath(doc, _stashRoot);
	const fullText = await _fs.readFile(textPath, "utf-8");

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
