import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { StashDatabase } from "../../src/stash/db.js";

describe("StashDatabase", () => {
	let tempDir;
	let db;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "stash-test-"));
		db = new StashDatabase(tempDir);
	});

	afterEach(() => {
		db.close();
		fs.rmSync(tempDir, { recursive: true });
	});

	describe("getOrCreateTopic", () => {
		it("should create a new topic", () => {
			const id = db.getOrCreateTopic({
				name: "machine-learning",
				description: "ML research papers",
			});
			assert.ok(id > 0);

			const topics = db.getTopics();
			assert.strictEqual(topics.length, 1);
			assert.strictEqual(topics[0].name, "machine-learning");
			assert.strictEqual(topics[0].description, "ML research papers");
		});

		it("should return existing topic id", () => {
			const id1 = db.getOrCreateTopic({ name: "economics" });
			const id2 = db.getOrCreateTopic({ name: "economics" });
			assert.strictEqual(id1, id2);
		});
	});

	describe("insertDocument", () => {
		it("should insert a document with topics", () => {
			const docId = db.insertDocument({
				filename: "paper.pdf",
				fileType: "pdf",
				summary: "A paper about ML",
				storePath: "store/machine-learning/paper.pdf",
				charCount: 5000,
				primaryTopic: "machine-learning",
				secondaryTopics: ["neural-networks"],
			});

			assert.ok(docId > 0);

			const doc = db.getDocument(docId);
			assert.strictEqual(doc.filename, "paper.pdf");
			assert.strictEqual(doc.file_type, "pdf");
			assert.strictEqual(doc.summary, "A paper about ML");
			assert.strictEqual(doc.topics.length, 2);

			const primaryTopic = doc.topics.find((t) => t.isPrimary);
			assert.strictEqual(primaryTopic.name, "machine-learning");
		});

		it("should create topics if they don't exist", () => {
			db.insertDocument({
				filename: "doc.md",
				fileType: "md",
				summary: "Test doc",
				storePath: "store/new-topic/doc.md",
				charCount: 100,
				primaryTopic: "new-topic",
				secondaryTopics: [],
			});

			const topics = db.getTopics();
			assert.strictEqual(topics.length, 1);
			assert.strictEqual(topics[0].name, "new-topic");
		});
	});

	describe("getDocument", () => {
		it("should return null for non-existent document", () => {
			const doc = db.getDocument(999);
			assert.strictEqual(doc, null);
		});
	});

	describe("getTopicsWithCounts", () => {
		it("should return topics with document counts", () => {
			db.insertDocument({
				filename: "doc1.pdf",
				fileType: "pdf",
				summary: "Doc 1",
				storePath: "store/ml/doc1.pdf",
				charCount: 100,
				primaryTopic: "ml",
				secondaryTopics: [],
			});

			db.insertDocument({
				filename: "doc2.pdf",
				fileType: "pdf",
				summary: "Doc 2",
				storePath: "store/ml/doc2.pdf",
				charCount: 100,
				primaryTopic: "ml",
				secondaryTopics: ["economics"],
			});

			const topics = db.getTopicsWithCounts();
			assert.strictEqual(topics.length, 2);

			const mlTopic = topics.find((t) => t.name === "ml");
			assert.strictEqual(mlTopic.doc_count, 2);

			const econTopic = topics.find((t) => t.name === "economics");
			assert.strictEqual(econTopic.doc_count, 1);
		});
	});

	describe("getDocumentsByTopic", () => {
		it("should return documents for a topic", () => {
			db.insertDocument({
				filename: "doc1.pdf",
				fileType: "pdf",
				summary: "Doc 1",
				storePath: "store/ml/doc1.pdf",
				charCount: 100,
				primaryTopic: "ml",
				secondaryTopics: [],
			});

			db.insertDocument({
				filename: "doc2.pdf",
				fileType: "pdf",
				summary: "Doc 2",
				storePath: "store/economics/doc2.pdf",
				charCount: 100,
				primaryTopic: "economics",
				secondaryTopics: ["ml"],
			});

			const docs = db.getDocumentsByTopic("ml");
			assert.strictEqual(docs.length, 2);
		});

		it("should support pagination", () => {
			for (let i = 0; i < 5; i++) {
				db.insertDocument({
					filename: `doc${i}.pdf`,
					fileType: "pdf",
					summary: `Doc ${i}`,
					storePath: `store/ml/doc${i}.pdf`,
					charCount: 100,
					primaryTopic: "ml",
					secondaryTopics: [],
				});
			}

			const page1 = db.getDocumentsByTopic("ml", 2, 0);
			assert.strictEqual(page1.length, 2);

			const page2 = db.getDocumentsByTopic("ml", 2, 2);
			assert.strictEqual(page2.length, 2);
		});
	});

	describe("getDocumentByStorePath", () => {
		it("should find document by store path", () => {
			db.insertDocument({
				filename: "doc.pdf",
				fileType: "pdf",
				summary: "Test doc",
				storePath: "store/ml/doc.pdf",
				charCount: 100,
				primaryTopic: "ml",
				secondaryTopics: [],
			});

			const doc = db.getDocumentByStorePath("store/ml/doc.pdf");
			assert.ok(doc);
			assert.strictEqual(doc.filename, "doc.pdf");
		});

		it("should return undefined for non-existent path", () => {
			const doc = db.getDocumentByStorePath("store/fake/path.pdf");
			assert.strictEqual(doc, undefined);
		});
	});

	describe("searchByFilename", () => {
		it("should find documents matching any term in array", () => {
			db.insertDocument({
				filename: "machine-learning-intro.pdf",
				fileType: "pdf",
				summary: "ML intro",
				storePath: "store/ml/machine-learning-intro.pdf",
				charCount: 100,
				primaryTopic: "ml",
				secondaryTopics: [],
			});

			db.insertDocument({
				filename: "deep-learning-paper.pdf",
				fileType: "pdf",
				summary: "DL paper",
				storePath: "store/ml/deep-learning-paper.pdf",
				charCount: 100,
				primaryTopic: "ml",
				secondaryTopics: [],
			});

			// Multiple terms should match if ANY term matches
			const results = db.searchByFilename(["machine", "deep"]);
			assert.strictEqual(results.length, 2);
		});

		it("should be case-insensitive", () => {
			db.insertDocument({
				filename: "Encyclopedia-Article.md",
				fileType: "md",
				summary: "Article",
				storePath: "store/wiki/Encyclopedia-Article.md",
				charCount: 100,
				primaryTopic: "wiki",
				secondaryTopics: [],
			});

			const results = db.searchByFilename(["encyclopedia"]);
			assert.strictEqual(results.length, 1);
		});

		it("should match exact phrases as single terms", () => {
			db.insertDocument({
				filename: "machine-learning-intro.pdf",
				fileType: "pdf",
				summary: "ML intro",
				storePath: "store/ml/machine-learning-intro.pdf",
				charCount: 100,
				primaryTopic: "ml",
				secondaryTopics: [],
			});

			// Phrase "machine-learning" should match
			const results = db.searchByFilename(["machine-learning"]);
			assert.strictEqual(results.length, 1);

			// Phrase "machine learning" (with space) should NOT match
			const noResults = db.searchByFilename(["machine learning"]);
			assert.strictEqual(noResults.length, 0);
		});

		it("should filter by topic", () => {
			db.insertDocument({
				filename: "ml-notes.md",
				fileType: "md",
				summary: "Notes",
				storePath: "store/ml/ml-notes.md",
				charCount: 100,
				primaryTopic: "ml",
				secondaryTopics: [],
			});

			db.insertDocument({
				filename: "crypto-notes.md",
				fileType: "md",
				summary: "Notes",
				storePath: "store/crypto/crypto-notes.md",
				charCount: 100,
				primaryTopic: "crypto",
				secondaryTopics: [],
			});

			const results = db.searchByFilename(["notes"], "ml");
			assert.strictEqual(results.length, 1);
			assert.strictEqual(results[0].filename, "ml-notes.md");
		});
	});

	describe("migrations", () => {
		it("should set schema version on new database", () => {
			assert.strictEqual(db.getSchemaVersion(), 1);
		});

		it("should not re-run migrations on reopened database", () => {
			// Insert some data
			db.insertDocument({
				filename: "doc.pdf",
				fileType: "pdf",
				summary: "Test",
				storePath: "store/test/doc.pdf",
				charCount: 100,
				primaryTopic: "test",
				secondaryTopics: [],
			});
			db.close();

			// Reopen - migrations should not fail or duplicate data
			const db2 = new StashDatabase(tempDir);
			assert.strictEqual(db2.getSchemaVersion(), 1);

			const topics = db2.getTopics();
			assert.strictEqual(topics.length, 1);
			db2.close();

			// Reassign for afterEach cleanup
			db = new StashDatabase(tempDir);
		});
	});
});
