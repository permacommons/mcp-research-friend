import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { StashDatabase } from "../../src/stash/db.js";
import { extractFromStash } from "../../src/stash/extract.js";

describe("extractFromStash", () => {
	let tempDir;
	let db;
	let docId;

	const textContent =
		"This is the full text content of the document. It contains important information about machine learning and blockchain technology. The document discusses various applications.";

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "extract-test-"));
		db = new StashDatabase(tempDir);

		// Create store directory and text file (new layout: {filename}.txt)
		const storeDir = path.join(tempDir, "store", "ml");
		await fs.mkdir(storeDir, { recursive: true });
		await fs.writeFile(path.join(storeDir, "doc.pdf.txt"), textContent);

		// Insert document
		docId = db.insertDocument({
			filename: "doc.pdf",
			fileType: "pdf",
			summary: "A test document",
			storePath: "store/ml/doc.pdf",
			charCount: textContent.length,
			primaryTopic: "ml",
			secondaryTopics: [],
		});
	});

	afterEach(async () => {
		db.close();
		await fs.rm(tempDir, { recursive: true });
	});

	it("should extract full content by default", async () => {
		const result = await extractFromStash({
			id: docId,
			_db: db,
			_stashRoot: tempDir,
		});

		assert.strictEqual(result.id, docId);
		assert.strictEqual(result.filename, "doc.pdf");
		assert.strictEqual(result.content, textContent);
		assert.strictEqual(result.truncated, false);
	});

	it("should respect maxChars limit", async () => {
		const result = await extractFromStash({
			id: docId,
			maxChars: 50,
			_db: db,
			_stashRoot: tempDir,
		});

		assert.strictEqual(result.content.length, 50);
		assert.strictEqual(result.truncated, true);
	});

	it("should support offset for pagination", async () => {
		const result = await extractFromStash({
			id: docId,
			offset: 8,
			maxChars: 20,
			_db: db,
			_stashRoot: tempDir,
		});

		assert.strictEqual(result.offset, 8);
		assert.strictEqual(result.content, "the full text conten");
		assert.strictEqual(result.truncated, true);
	});

	it("should search within document", async () => {
		const result = await extractFromStash({
			id: docId,
			search: "machine learning",
			_db: db,
			_stashRoot: tempDir,
		});

		assert.strictEqual(result.search, "machine learning");
		assert.strictEqual(result.matchCount, 1);
		assert.ok(result.matches[0].context.includes("machine learning"));
	});

	it("should be case-insensitive when searching", async () => {
		const result = await extractFromStash({
			id: docId,
			search: "MACHINE LEARNING",
			_db: db,
			_stashRoot: tempDir,
		});

		assert.strictEqual(result.matchCount, 1);
	});

	it("should use ask mode with MCP sampling", async () => {
		const mockServer = {
			server: {
				createMessage: async ({ messages, systemPrompt, maxTokens }) => {
					assert.ok(messages[0].content.text.includes(textContent));
					assert.ok(messages[0].content.text.includes("Summarize"));
					assert.ok(systemPrompt.includes("helpful assistant"));
					assert.strictEqual(maxTokens, 4096); // default askMaxOutputTokens

					return {
						content: {
							type: "text",
							text: "This document discusses ML and blockchain.",
						},
						model: "test-model",
					};
				},
			},
		};

		const result = await extractFromStash({
			id: docId,
			ask: "Summarize this document.",
			_db: db,
			_server: mockServer,
			_stashRoot: tempDir,
		});

		assert.strictEqual(result.ask, "Summarize this document.");
		assert.strictEqual(
			result.answer,
			"This document discusses ML and blockchain.",
		);
		assert.strictEqual(result.model, "test-model");
	});

	it("should respect askMaxOutputTokens parameter", async () => {
		let capturedMaxTokens;
		const mockServer = {
			server: {
				createMessage: async ({ maxTokens }) => {
					capturedMaxTokens = maxTokens;
					return {
						content: { type: "text", text: "Response" },
						model: "test-model",
					};
				},
			},
		};

		await extractFromStash({
			id: docId,
			ask: "Summarize",
			askMaxOutputTokens: 8192,
			_db: db,
			_server: mockServer,
			_stashRoot: tempDir,
		});

		assert.strictEqual(capturedMaxTokens, 8192);
	});

	it("should reject documents exceeding askMaxInputTokens with hint about splitAndSynthesize", async () => {
		// Create a mock fs that returns a large document
		const largeContent = "x".repeat(100000); // 100k chars = ~25k tokens
		const mockFs = {
			readFile: async () => largeContent,
		};

		const mockServer = {
			server: {
				createMessage: async () => {
					throw new Error("Should not be called");
				},
			},
		};

		await assert.rejects(
			async () => {
				await extractFromStash({
					id: docId,
					ask: "Summarize",
					askMaxInputTokens: 10000, // ~40k chars, but doc is 100k chars (~25k tokens)
					_db: db,
					_server: mockServer,
					_fs: mockFs,
					_stashRoot: tempDir,
				});
			},
			(err) => {
				assert.ok(err.message.includes("too large for ask mode"));
				assert.ok(err.message.includes("25,000 tokens"));
				assert.ok(err.message.includes("10,000"));
				assert.ok(err.message.includes("askSplitAndSynthesize"));
				return true;
			},
		);
	});

	it("should split and synthesize large documents when askSplitAndSynthesize is true", async () => {
		// Create a mock fs that returns a document requiring 2 chunks
		const largeContent = "A".repeat(50000) + "B".repeat(50000); // 100k chars
		const mockFs = {
			readFile: async () => largeContent,
		};

		const calls = [];
		const mockServer = {
			server: {
				createMessage: async ({ messages }) => {
					const text = messages[0].content.text;
					calls.push(text);

					if (text.includes("part 1 of")) {
						return {
							content: { type: "text", text: "Summary of part 1" },
							model: "test-model",
						};
					} else if (text.includes("part 2 of")) {
						return {
							content: { type: "text", text: "Summary of part 2" },
							model: "test-model",
						};
					} else if (text.includes("synthesize")) {
						return {
							content: { type: "text", text: "Combined summary" },
							model: "test-model",
						};
					}
					throw new Error("Unexpected call");
				},
			},
		};

		const result = await extractFromStash({
			id: docId,
			ask: "Summarize",
			askMaxInputTokens: 20000, // Force splitting
			askSplitAndSynthesize: true,
			_db: db,
			_server: mockServer,
			_fs: mockFs,
			_stashRoot: tempDir,
		});

		assert.strictEqual(result.chunksProcessed, 2);
		assert.strictEqual(result.answer, "Combined summary");
		assert.strictEqual(calls.length, 3); // 2 chunks + 1 synthesis
	});

	it("should reject documents exceeding 20 MB hard limit even with splitAndSynthesize", async () => {
		const hugeContent = "x".repeat(21 * 1024 * 1024); // 21 MB
		const mockFs = {
			readFile: async () => hugeContent,
		};

		const mockServer = {
			server: {
				createMessage: async () => {
					throw new Error("Should not be called");
				},
			},
		};

		await assert.rejects(
			async () => {
				await extractFromStash({
					id: docId,
					ask: "Summarize",
					askSplitAndSynthesize: true,
					_db: db,
					_server: mockServer,
					_fs: mockFs,
					_stashRoot: tempDir,
				});
			},
			(err) => {
				assert.ok(err.message.includes("20 MB"));
				return true;
			},
		);
	});

	it("should throw error if ask mode used without server", async () => {
		await assert.rejects(
			async () => {
				await extractFromStash({
					id: docId,
					ask: "Summarize",
					_db: db,
					_stashRoot: tempDir,
				});
			},
			{ message: "Server instance required for 'ask' mode" },
		);
	});

	it("should throw error for non-existent document", async () => {
		await assert.rejects(
			async () => {
				await extractFromStash({
					id: 999,
					_db: db,
					_stashRoot: tempDir,
				});
			},
			{ message: "Document not found: 999" },
		);
	});

	it("should respect contextChars in search mode", async () => {
		const result = await extractFromStash({
			id: docId,
			search: "machine learning",
			contextChars: 10,
			_db: db,
			_stashRoot: tempDir,
		});

		// Context should be smaller
		assert.ok(result.matches[0].context.length < 100);
	});

	it("should pass timeout to createMessage in ask mode", async () => {
		let capturedOptions;
		const mockServer = {
			server: {
				createMessage: async (_params, options) => {
					capturedOptions = options;
					return {
						content: { type: "text", text: "Response" },
						model: "test-model",
					};
				},
			},
		};

		await extractFromStash({
			id: docId,
			ask: "Summarize",
			askTimeout: 60000,
			_db: db,
			_server: mockServer,
			_stashRoot: tempDir,
		});

		assert.strictEqual(capturedOptions.timeout, 60000);
	});
});
