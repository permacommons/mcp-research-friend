import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { StashDatabase } from "../../src/stash/db.js";
import { parseSearchQuery, searchStash } from "../../src/stash/search.js";

describe("parseSearchQuery", () => {
	it("should split unquoted words into separate terms", () => {
		const terms = parseSearchQuery("hello world foo");
		assert.deepStrictEqual(terms, ["hello", "world", "foo"]);
	});

	it("should keep double-quoted phrases as single terms", () => {
		const terms = parseSearchQuery('hello "world foo" bar');
		assert.deepStrictEqual(terms, ["hello", "world foo", "bar"]);
	});

	it("should keep single-quoted phrases as single terms", () => {
		const terms = parseSearchQuery("hello 'world foo' bar");
		assert.deepStrictEqual(terms, ["hello", "world foo", "bar"]);
	});

	it("should handle mixed quotes and words", () => {
		const terms = parseSearchQuery(`"exact phrase" word 'another phrase'`);
		assert.deepStrictEqual(terms, ["exact phrase", "word", "another phrase"]);
	});

	it("should return empty array for empty query", () => {
		const terms = parseSearchQuery("");
		assert.deepStrictEqual(terms, []);
	});

	it("should handle only whitespace", () => {
		const terms = parseSearchQuery("   ");
		assert.deepStrictEqual(terms, []);
	});
});

describe("searchStash", () => {
	let tempDir;
	let db;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "search-test-"));
		db = new StashDatabase(tempDir);

		// Create store directory and text files
		const mlDir = path.join(tempDir, "store", "ml");
		const cryptoDir = path.join(tempDir, "store", "crypto");
		fs.mkdirSync(mlDir, { recursive: true });
		fs.mkdirSync(cryptoDir, { recursive: true });

		// Add test documents to DB and filesystem
		db.insertDocument({
			filename: "blockchain.pdf",
			fileType: "pdf",
			summary: "Research on blockchain technology",
			storePath: "store/crypto/blockchain.pdf",
			charCount: 100,
			primaryTopic: "crypto",
			secondaryTopics: [],
		});
		fs.writeFileSync(
			path.join(cryptoDir, "blockchain.pdf.txt"),
			"This paper explores blockchain technology and its applications in finance.",
		);

		db.insertDocument({
			filename: "machine-learning.pdf",
			fileType: "pdf",
			summary: "Introduction to machine learning",
			storePath: "store/ml/machine-learning.pdf",
			charCount: 100,
			primaryTopic: "ml",
			secondaryTopics: [],
		});
		fs.writeFileSync(
			path.join(mlDir, "machine-learning.pdf.txt"),
			"Machine learning algorithms for data analysis and pattern recognition.",
		);

		db.insertDocument({
			filename: "crypto-ml.pdf",
			fileType: "pdf",
			summary: "ML for cryptocurrency",
			storePath: "store/crypto/crypto-ml.pdf",
			charCount: 100,
			primaryTopic: "crypto",
			secondaryTopics: ["ml"],
		});
		fs.writeFileSync(
			path.join(cryptoDir, "crypto-ml.pdf.txt"),
			"Using machine learning to predict cryptocurrency prices and blockchain analysis.",
		);
	});

	afterEach(() => {
		db.close();
		fs.rmSync(tempDir, { recursive: true });
	});

	it("should find documents by query", async () => {
		const result = await searchStash({
			query: "blockchain",
			_db: db,
			_stashRoot: tempDir,
		});

		assert.strictEqual(result.query, "blockchain");
		assert.ok(result.totalMatches >= 1);
		assert.ok(result.results.some((r) => r.filename === "blockchain.pdf"));
	});

	it("should filter by topic", async () => {
		const result = await searchStash({
			query: "machine learning",
			topic: "ml",
			_db: db,
			_stashRoot: tempDir,
		});

		assert.strictEqual(result.topic, "ml");
		// Should only find docs in ml topic directory
		for (const doc of result.results) {
			assert.strictEqual(doc.filename, "machine-learning.pdf");
		}
	});

	it("should respect limit parameter", async () => {
		const result = await searchStash({
			query: "machine",
			limit: 1,
			_db: db,
			_stashRoot: tempDir,
		});
		assert.ok(result.results.length <= 1);
	});

	it("should include snippets in results", async () => {
		const result = await searchStash({
			query: "blockchain",
			_db: db,
			_stashRoot: tempDir,
		});

		assert.ok(result.results.length > 0);
		assert.ok(result.results[0].snippet);
		assert.ok(result.results[0].snippet.toLowerCase().includes("blockchain"));
	});

	it("should return document metadata", async () => {
		const result = await searchStash({
			query: "blockchain",
			_db: db,
			_stashRoot: tempDir,
		});

		const doc = result.results.find((r) => r.filename === "blockchain.pdf");
		assert.ok(doc);
		assert.strictEqual(doc.fileType, "pdf");
		assert.ok(doc.summary);
		assert.ok(doc.createdAt);
		assert.ok(doc.matchType);
	});

	it("should handle no matches gracefully", async () => {
		const result = await searchStash({
			query: "xyznonexistent",
			_db: db,
			_stashRoot: tempDir,
		});

		assert.strictEqual(result.totalMatches, 0);
		assert.strictEqual(result.results.length, 0);
	});

	it("should find documents by filename", async () => {
		const result = await searchStash({
			query: "crypto-ml",
			_db: db,
			_stashRoot: tempDir,
		});

		assert.ok(result.totalMatches >= 1);
		const doc = result.results.find((r) => r.filename === "crypto-ml.pdf");
		assert.ok(doc);
		assert.strictEqual(doc.matchType, "filename");
	});

	it("should prioritize filename matches over content matches", async () => {
		// "blockchain" appears in filename "blockchain.pdf" AND in content
		const result = await searchStash({
			query: "blockchain",
			_db: db,
			_stashRoot: tempDir,
		});

		// blockchain.pdf should be first (filename match)
		const firstResult = result.results[0];
		assert.strictEqual(firstResult.filename, "blockchain.pdf");
		assert.strictEqual(firstResult.matchType, "filename");
	});

	it("should not duplicate results when filename and content both match", async () => {
		const result = await searchStash({
			query: "blockchain",
			_db: db,
			_stashRoot: tempDir,
		});

		// blockchain.pdf matches both filename and content - should appear only once
		const blockchainResults = result.results.filter(
			(r) => r.filename === "blockchain.pdf",
		);
		assert.strictEqual(blockchainResults.length, 1);
	});

	it("should filter filename search by topic", async () => {
		const result = await searchStash({
			query: "machine",
			topic: "ml",
			_db: db,
			_stashRoot: tempDir,
		});

		// Should find machine-learning.pdf in ml topic
		assert.ok(
			result.results.some((r) => r.filename === "machine-learning.pdf"),
		);
		// Should NOT find crypto-ml.pdf (it's in crypto topic, not ml)
		const cryptoMl = result.results.find((r) => r.filename === "crypto-ml.pdf");
		assert.strictEqual(cryptoMl, undefined);
	});
});
