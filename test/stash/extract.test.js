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

	it("should throw error when both offset and line are provided", async () => {
		await assert.rejects(
			async () => {
				await extractFromStash({
					id: docId,
					offset: 10,
					line: 2,
					_db: db,
					_stashRoot: tempDir,
				});
			},
			{ message: "Cannot specify both 'offset' and 'line'" },
		);
	});

	it("should allow offset=0 with line (offset=0 is ignored)", async () => {
		const result = await extractFromStash({
			id: docId,
			offset: 0,
			line: 1,
			_db: db,
			_stashRoot: tempDir,
		});

		// Should work - offset=0 is effectively "not set"
		assert.ok(result.content);
	});
});

describe("extractFromStash with line parameter", () => {
	let tempDir;
	let db;
	let docId;

	const multiLineContent = `Line 1: Introduction to the document.
Line 2: This contains important information.
Line 3: More details about the topic.
Line 4: Conclusion and summary.`;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "extract-line-test-"));
		db = new StashDatabase(tempDir);

		const storeDir = path.join(tempDir, "store", "docs");
		await fs.mkdir(storeDir, { recursive: true });
		await fs.writeFile(path.join(storeDir, "multiline.txt"), multiLineContent);

		docId = db.insertDocument({
			filename: "multiline.txt",
			fileType: "txt",
			summary: "A multi-line test document",
			storePath: "store/docs/multiline.txt",
			charCount: multiLineContent.length,
			primaryTopic: "docs",
			secondaryTopics: [],
		});
	});

	afterEach(async () => {
		db.close();
		await fs.rm(tempDir, { recursive: true });
	});

	it("should start from specified line number", async () => {
		const result = await extractFromStash({
			id: docId,
			line: 2,
			_db: db,
			_stashRoot: tempDir,
		});

		assert.strictEqual(result.line, 2);
		assert.ok(result.content.startsWith("Line 2:"));
		assert.ok(result.offset > 0); // Should include computed offset
	});

	it("should start from line 1 when line=1", async () => {
		const result = await extractFromStash({
			id: docId,
			line: 1,
			_db: db,
			_stashRoot: tempDir,
		});

		assert.strictEqual(result.line, 1);
		assert.strictEqual(result.offset, 0);
		assert.ok(result.content.startsWith("Line 1:"));
	});

	it("should handle line number beyond end of file", async () => {
		const result = await extractFromStash({
			id: docId,
			line: 100,
			_db: db,
			_stashRoot: tempDir,
		});

		assert.strictEqual(result.line, 100);
		assert.strictEqual(result.content, "");
		assert.strictEqual(result.truncated, false);
	});

	it("should respect maxChars when using line", async () => {
		const result = await extractFromStash({
			id: docId,
			line: 2,
			maxChars: 20,
			_db: db,
			_stashRoot: tempDir,
		});

		assert.strictEqual(result.content.length, 20);
		assert.strictEqual(result.truncated, true);
	});
});
