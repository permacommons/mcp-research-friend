import fs from "node:fs/promises";
import path from "node:path";
import { detectFileType, extractText, PLAINTEXT_TYPES } from "./extractors.js";

const CLASSIFICATION_PROMPT = `You are classifying a document into topics for a research stash.

## Existing Topics
{existingTopics}

## Rules
- Use existing topics when the document fits reasonably well
- Create new topics only when no existing topic is appropriate
- Topic names: lowercase-kebab-case, 1-3 words, descriptive
- Choose ONE primary topic and 0-3 secondary topics
- Primary topic = where you'd look for this document first

## Document
Filename: {filename}

Content (first 8000 chars):
---
{text}
---

Respond with JSON only:
{
  "summary": "1-2 sentence summary",
  "primaryTopic": "existing-or-new-topic",
  "secondaryTopics": ["optional", "additional"],
  "newTopics": [{"name": "new-topic", "description": "Brief description"}]
}`;

function formatExistingTopics(topics) {
	if (topics.length === 0) {
		return "(none yet)";
	}
	return topics
		.map(
			(t) =>
				`- ${t.name} (${t.doc_count} docs): ${t.description || "No description"}`,
		)
		.join("\n");
}

async function classifyDocument(filename, text, existingTopics, _server) {
	const prompt = CLASSIFICATION_PROMPT.replace(
		"{existingTopics}",
		formatExistingTopics(existingTopics),
	)
		.replace("{filename}", filename)
		.replace("{text}", text.slice(0, 8000));

	const result = await _server.server.createMessage(
		{
			messages: [
				{
					role: "user",
					content: { type: "text", text: prompt },
				},
			],
			systemPrompt: "You classify documents. Respond only with valid JSON.",
			maxTokens: 512,
		},
		{ timeout: 60000 },
	);

	// Extract text from response
	const responseContent = result.content;
	const responseText =
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

	// Parse JSON from response
	const jsonMatch = responseText.match(/\{[\s\S]*\}/);
	if (!jsonMatch) {
		throw new Error("No JSON found in classification response");
	}
	return JSON.parse(jsonMatch[0]);
}

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
