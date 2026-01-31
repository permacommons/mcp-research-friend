import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { StashDatabase } from "../../src/stash/db.js";
import { askStashDocument } from "../../src/stash/extract.js";

describe("askStashDocument", () => {
	let tempDir;
	let db;
	let docId;

	const textContent =
		"This is the full text content of the document. It contains important information about machine learning and blockchain technology. The document discusses various applications.";

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ask-stash-test-"));
		db = new StashDatabase(tempDir);

		// Create store directory and text file
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

	it("should ask questions using MCP sampling", async () => {
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

		const result = await askStashDocument({
			id: docId,
			ask: "Summarize this document.",
			_db: db,
			_server: mockServer,
			_stashRoot: tempDir,
		});

		assert.strictEqual(result.id, docId);
		assert.strictEqual(result.filename, "doc.pdf");
		assert.strictEqual(result.fileType, "pdf");
		assert.strictEqual(result.ask, "Summarize this document.");
		assert.strictEqual(
			result.answer,
			"This document discusses ML and blockchain.",
		);
		assert.strictEqual(result.model, "test-model");
		assert.strictEqual(result.chunksProcessed, 1);
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

		await askStashDocument({
			id: docId,
			ask: "Summarize",
			askMaxOutputTokens: 8192,
			_db: db,
			_server: mockServer,
			_stashRoot: tempDir,
		});

		assert.strictEqual(capturedMaxTokens, 8192);
	});

	it("should pass timeout to createMessage", async () => {
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

		await askStashDocument({
			id: docId,
			ask: "Summarize",
			askTimeout: 60000,
			_db: db,
			_server: mockServer,
			_stashRoot: tempDir,
		});

		assert.strictEqual(capturedOptions.timeout, 60000);
	});

	it("should reject documents exceeding askMaxInputTokens with hint about splitAndSynthesize", async () => {
		const largeContent = "x".repeat(100000); // ~25k tokens
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
				await askStashDocument({
					id: docId,
					ask: "Summarize",
					askMaxInputTokens: 10000,
					_db: db,
					_server: mockServer,
					_fs: mockFs,
					_stashRoot: tempDir,
				});
			},
			(err) => {
				assert.ok(err.message.includes("too large for ask mode"));
				assert.ok(err.message.includes("25,000 tokens"));
				assert.ok(err.message.includes("askSplitAndSynthesize"));
				return true;
			},
		);
	});

	it("should split and synthesize large documents when enabled", async () => {
		const largeContent = "A".repeat(50000) + "B".repeat(50000);
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

		const result = await askStashDocument({
			id: docId,
			ask: "Summarize",
			askMaxInputTokens: 20000,
			askSplitAndSynthesize: true,
			_db: db,
			_server: mockServer,
			_fs: mockFs,
			_stashRoot: tempDir,
		});

		assert.strictEqual(result.chunksProcessed, 2);
		assert.strictEqual(result.answer, "Combined summary");
	});

	it("should reject documents exceeding 20 MB hard limit", async () => {
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
				await askStashDocument({
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

	it("should throw error if server is not provided", async () => {
		await assert.rejects(
			async () => {
				await askStashDocument({
					id: docId,
					ask: "Summarize",
					_db: db,
					_stashRoot: tempDir,
				});
			},
			{ message: "Server instance required for ask mode" },
		);
	});

	it("should throw error for non-existent document", async () => {
		const mockServer = {
			server: {
				createMessage: async () => {
					throw new Error("Should not be called");
				},
			},
		};

		await assert.rejects(
			async () => {
				await askStashDocument({
					id: 999,
					ask: "Summarize",
					_db: db,
					_server: mockServer,
					_stashRoot: tempDir,
				});
			},
			{ message: "Document not found: 999" },
		);
	});
});
