import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { StashDatabase } from "../../src/stash/db.js";
import { listStash } from "../../src/stash/list.js";

describe("listStash", () => {
	let tempDir;
	let db;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "list-test-"));
		db = new StashDatabase(tempDir);
	});

	afterEach(() => {
		db.close();
		fs.rmSync(tempDir, { recursive: true });
	});

	describe("listing all documents", () => {
		it("should list all documents when topic is null", () => {
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
				storePath: "store/crypto/doc2.pdf",
				charCount: 100,
				primaryTopic: "crypto",
				secondaryTopics: ["ml"],
			});

			const result = listStash({ topic: null, _db: db });

			assert.strictEqual(result.type, "all");
			assert.strictEqual(result.documents.length, 2);
			assert.strictEqual(result.totalDocuments, 2);

			// Should also include topics summary
			assert.strictEqual(result.topics.length, 2);
			const mlTopic = result.topics.find((t) => t.name === "ml");
			assert.ok(mlTopic);
			assert.strictEqual(mlTopic.docCount, 2); // doc1 primary, doc2 secondary
		});

		it("should return empty list when no documents exist", () => {
			const result = listStash({ topic: null, _db: db });

			assert.strictEqual(result.type, "all");
			assert.strictEqual(result.documents.length, 0);
			assert.strictEqual(result.topics.length, 0);
		});

		it("should order topics by document count", () => {
			for (let i = 0; i < 3; i++) {
				db.insertDocument({
					filename: `ml${i}.pdf`,
					fileType: "pdf",
					summary: `ML Doc ${i}`,
					storePath: `store/ml/ml${i}.pdf`,
					charCount: 100,
					primaryTopic: "ml",
					secondaryTopics: [],
				});
			}

			db.insertDocument({
				filename: "crypto.pdf",
				fileType: "pdf",
				summary: "Crypto Doc",
				storePath: "store/crypto/crypto.pdf",
				charCount: 100,
				primaryTopic: "crypto",
				secondaryTopics: [],
			});

			const result = listStash({ topic: null, _db: db });

			assert.strictEqual(result.topics[0].name, "ml");
			assert.strictEqual(result.topics[0].docCount, 3);
			assert.strictEqual(result.documents.length, 4);
		});

		it("should support pagination for all documents", () => {
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

			const page1 = listStash({ topic: null, limit: 2, offset: 0, _db: db });
			assert.strictEqual(page1.documents.length, 2);
			assert.strictEqual(page1.totalDocuments, 5);

			const page2 = listStash({ topic: null, limit: 2, offset: 2, _db: db });
			assert.strictEqual(page2.documents.length, 2);
		});
	});

	describe("listing documents by topic", () => {
		it("should list documents for a specific topic", () => {
			db.insertDocument({
				filename: "doc1.pdf",
				fileType: "pdf",
				summary: "ML Document 1",
				storePath: "store/ml/doc1.pdf",
				charCount: 1000,
				primaryTopic: "ml",
				secondaryTopics: [],
			});

			db.insertDocument({
				filename: "doc2.pdf",
				fileType: "pdf",
				summary: "Crypto Document",
				storePath: "store/crypto/doc2.pdf",
				charCount: 2000,
				primaryTopic: "crypto",
				secondaryTopics: [],
			});

			const result = listStash({ topic: "ml", _db: db });

			assert.strictEqual(result.type, "documents");
			assert.strictEqual(result.topic, "ml");
			assert.strictEqual(result.documents.length, 1);
			assert.strictEqual(result.documents[0].filename, "doc1.pdf");
		});

		it("should include documents where topic is secondary", () => {
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
				storePath: "store/crypto/doc2.pdf",
				charCount: 100,
				primaryTopic: "crypto",
				secondaryTopics: ["ml"],
			});

			const result = listStash({ topic: "ml", _db: db });

			assert.strictEqual(result.documents.length, 2);
		});

		it("should indicate if topic is primary", () => {
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
				storePath: "store/crypto/doc2.pdf",
				charCount: 100,
				primaryTopic: "crypto",
				secondaryTopics: ["ml"],
			});

			const result = listStash({ topic: "ml", _db: db });

			const doc1 = result.documents.find((d) => d.filename === "doc1.pdf");
			const doc2 = result.documents.find((d) => d.filename === "doc2.pdf");

			assert.strictEqual(doc1.isPrimary, true);
			assert.strictEqual(doc2.isPrimary, false);
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

			const page1 = listStash({ topic: "ml", limit: 2, offset: 0, _db: db });
			assert.strictEqual(page1.documents.length, 2);
			assert.strictEqual(page1.offset, 0);
			assert.strictEqual(page1.limit, 2);

			const page2 = listStash({ topic: "ml", limit: 2, offset: 2, _db: db });
			assert.strictEqual(page2.documents.length, 2);
			assert.strictEqual(page2.offset, 2);
		});

		it("should return document metadata", () => {
			db.insertDocument({
				filename: "doc.pdf",
				fileType: "pdf",
				summary: "Test document",
				storePath: "store/ml/doc.pdf",
				charCount: 5000,
				primaryTopic: "ml",
				secondaryTopics: [],
			});

			const result = listStash({ topic: "ml", _db: db });
			const doc = result.documents[0];

			assert.ok(doc.id);
			assert.strictEqual(doc.filename, "doc.pdf");
			assert.strictEqual(doc.fileType, "pdf");
			assert.strictEqual(doc.summary, "Test document");
			assert.strictEqual(doc.charCount, 5000);
			assert.ok(doc.createdAt);
		});
	});
});
