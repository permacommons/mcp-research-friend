import fs from "node:fs/promises";
import path from "node:path";
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
		if (!_server) {
			throw new Error("Server instance required for 'ask' mode");
		}

		const result = await _server.server.createMessage(
			{
				messages: [
					{
						role: "user",
						content: {
							type: "text",
							text: `Here is a document:\n\n---\n\n${fullText}\n\n---\n\nInstruction: ${ask}`,
						},
					},
				],
				systemPrompt:
					"You are a helpful assistant processing a document. Follow the user's instruction precisely. Be concise and accurate. Base your response only on the document content.",
				maxTokens: 4096,
				_meta: {
					"research-friend/timeoutMs": askTimeout,
				},
			},
			{ timeout: askTimeout },
		);

		// Extract text from response
		const responseContent = result.content;
		const answer =
			typeof responseContent === "string"
				? responseContent
				: Array.isArray(responseContent)
					? responseContent
							.filter((block) => block.type === "text")
							.map((block) => block.text)
							.join("\n")
					: responseContent.type === "text"
						? responseContent.text
						: JSON.stringify(responseContent);

		return {
			id: doc.id,
			filename: doc.filename,
			fileType: doc.file_type,
			summary: doc.summary,
			totalChars: fullText.length,
			ask,
			answer,
			model: result.model,
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
