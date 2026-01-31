import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { sampleTextForClassification } from "../../src/stash/classify.js";
import { StashDatabase } from "../../src/stash/db.js";
import { processInbox } from "../../src/stash/process-inbox.js";

describe("processInbox", () => {
	let tempDir;
	let db;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "inbox-test-"));
		db = new StashDatabase(tempDir);
	});

	afterEach(async () => {
		db.close();
		await fs.rm(tempDir, { recursive: true });
	});

	function createMockServer(classification) {
		return {
			server: {
				createMessage: async () => ({
					content: {
						type: "text",
						text: JSON.stringify(classification),
					},
				}),
			},
		};
	}

	function mockExtractText(_filePath, _fileType) {
		return "This is the extracted text content for testing purposes.";
	}

	it("should process files in the inbox", async () => {
		const inboxPath = path.join(tempDir, "inbox");
		await fs.mkdir(inboxPath, { recursive: true });
		await fs.writeFile(path.join(inboxPath, "test.md"), "# Test Document");

		const mockServer = createMockServer({
			summary: "A test document",
			primaryTopic: "testing",
			secondaryTopics: [],
			newTopics: [{ name: "testing", description: "Test documents" }],
		});

		const result = await processInbox({
			_server: mockServer,
			_db: db,
			_extractText: mockExtractText,
			_fs: fs,
			_stashRoot: tempDir,
		});

		assert.strictEqual(result.processed.length, 1);
		assert.strictEqual(result.processed[0], "test.md");
		assert.strictEqual(result.errors.length, 0);
		assert.strictEqual(result.documents.length, 1);
		assert.strictEqual(result.documents[0].filename, "test.md");
	});

	it("should skip unsupported file types", async () => {
		const inboxPath = path.join(tempDir, "inbox");
		await fs.mkdir(inboxPath, { recursive: true });
		await fs.writeFile(path.join(inboxPath, "image.png"), "fake image");

		const mockServer = createMockServer({
			summary: "Test",
			primaryTopic: "test",
			secondaryTopics: [],
			newTopics: [],
		});

		const result = await processInbox({
			_server: mockServer,
			_db: db,
			_extractText: mockExtractText,
			_fs: fs,
			_stashRoot: tempDir,
		});

		assert.strictEqual(result.processed.length, 0);
		assert.strictEqual(result.errors.length, 1);
		assert.strictEqual(result.errors[0].filename, "image.png");
	});

	it("should move files to store directory", async () => {
		const inboxPath = path.join(tempDir, "inbox");
		await fs.mkdir(inboxPath, { recursive: true });
		await fs.writeFile(path.join(inboxPath, "doc.md"), "# Document");

		const mockServer = createMockServer({
			summary: "A document",
			primaryTopic: "docs",
			secondaryTopics: [],
			newTopics: [],
		});

		await processInbox({
			_server: mockServer,
			_db: db,
			_extractText: mockExtractText,
			_fs: fs,
			_stashRoot: tempDir,
		});

		// Check file was moved
		const inboxFiles = await fs.readdir(inboxPath);
		assert.strictEqual(inboxFiles.length, 0);

		// Check file is in store - markdown files don't get .txt extraction
		const storeDir = path.join(tempDir, "store", "docs");
		const originalPath = path.join(storeDir, "doc.md");

		assert.ok(
			await fs
				.stat(originalPath)
				.then(() => true)
				.catch(() => false),
		);

		// Markdown files should NOT have a .txt copy
		const textPath = path.join(storeDir, "doc.md.txt");
		assert.ok(
			await fs
				.stat(textPath)
				.then(() => false)
				.catch(() => true),
			"Markdown files should not have .txt extraction",
		);
	});

	it("should handle multiple files", async () => {
		const inboxPath = path.join(tempDir, "inbox");
		await fs.mkdir(inboxPath, { recursive: true });
		await fs.writeFile(path.join(inboxPath, "doc1.md"), "# Doc 1");
		await fs.writeFile(path.join(inboxPath, "doc2.md"), "# Doc 2");

		let callCount = 0;
		const mockServer = {
			server: {
				createMessage: async () => {
					callCount++;
					return {
						content: {
							type: "text",
							text: JSON.stringify({
								summary: `Document ${callCount}`,
								primaryTopic: "docs",
								secondaryTopics: [],
								newTopics: [],
							}),
						},
					};
				},
			},
		};

		const result = await processInbox({
			_server: mockServer,
			_db: db,
			_extractText: mockExtractText,
			_fs: fs,
			_stashRoot: tempDir,
		});

		assert.strictEqual(result.processed.length, 2);
		assert.strictEqual(result.documents.length, 2);
	});

	it("should continue processing after errors", async () => {
		const inboxPath = path.join(tempDir, "inbox");
		await fs.mkdir(inboxPath, { recursive: true });
		await fs.writeFile(path.join(inboxPath, "bad.md"), "# Bad");
		await fs.writeFile(path.join(inboxPath, "good.md"), "# Good");

		let callCount = 0;
		const mockServer = {
			server: {
				createMessage: async () => {
					callCount++;
					if (callCount === 1) {
						throw new Error("Classification failed");
					}
					return {
						content: {
							type: "text",
							text: JSON.stringify({
								summary: "Good document",
								primaryTopic: "docs",
								secondaryTopics: [],
								newTopics: [],
							}),
						},
					};
				},
			},
		};

		const result = await processInbox({
			_server: mockServer,
			_db: db,
			_extractText: mockExtractText,
			_fs: fs,
			_stashRoot: tempDir,
		});

		assert.strictEqual(result.processed.length, 1);
		assert.strictEqual(result.errors.length, 1);
	});

	it("should use existing topics when available", async () => {
		// Create an existing topic
		db.getOrCreateTopic({
			name: "existing-topic",
			description: "Already exists",
		});

		const inboxPath = path.join(tempDir, "inbox");
		await fs.mkdir(inboxPath, { recursive: true });
		await fs.writeFile(path.join(inboxPath, "doc.md"), "# Doc");

		const mockServer = createMockServer({
			summary: "A document",
			primaryTopic: "existing-topic",
			secondaryTopics: [],
			newTopics: [],
		});

		await processInbox({
			_server: mockServer,
			_db: db,
			_extractText: mockExtractText,
			_fs: fs,
			_stashRoot: tempDir,
		});

		const topics = db.getTopics();
		assert.strictEqual(topics.length, 1);
	});

	it("should return full text for short documents", () => {
		const text = "Short document text.";
		const sampled = sampleTextForClassification(text);
		assert.strictEqual(sampled, text);
	});

	it("should sample from start, middle, and end for long documents", () => {
		const text =
			"STARTTOKEN\n" +
			"a".repeat(9800) +
			"MIDTOKEN\n" +
			"b".repeat(9800) +
			"ENDTOKEN";

		const sampled = sampleTextForClassification(text, { rng: () => 0.42 });

		assert.ok(sampled.includes("STARTTOKEN"));
		assert.ok(sampled.includes("MIDTOKEN"));
		assert.ok(sampled.includes("ENDTOKEN"));
	});
});
