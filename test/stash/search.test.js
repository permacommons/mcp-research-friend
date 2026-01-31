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

	it("should include matches with line numbers in results", async () => {
		const result = await searchStash({
			query: "blockchain",
			_db: db,
			_stashRoot: tempDir,
		});

		assert.ok(result.results.length > 0);
		// Find a content match (not filename match)
		const contentMatch = result.results.find((r) => r.matchType === "content");
		assert.ok(contentMatch);
		assert.ok(Array.isArray(contentMatch.matches));
		assert.ok(contentMatch.matches.length > 0);
		assert.ok(typeof contentMatch.matches[0].line === "number");
		assert.ok(typeof contentMatch.matches[0].context === "string");
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
		assert.ok(Array.isArray(doc.matches));
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

	it("should prioritize filename matches and merge with content matches", async () => {
		// "blockchain" appears in filename "blockchain.pdf" AND in content
		const result = await searchStash({
			query: "blockchain",
			_db: db,
			_stashRoot: tempDir,
		});

		// blockchain.pdf should be first (has filename match)
		const firstResult = result.results[0];
		assert.strictEqual(firstResult.filename, "blockchain.pdf");
		// Should have both filename AND content matches merged
		assert.strictEqual(firstResult.matchType, "filename+content");
		assert.ok(firstResult.matches.length > 0); // Content matches included
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

	it("should filter by document IDs", async () => {
		// Get document IDs
		const allDocs = await searchStash({
			query: "machine",
			_db: db,
			_stashRoot: tempDir,
		});
		assert.ok(allDocs.totalMatches >= 2); // Should find at least 2 docs with "machine"

		// Pick just the first doc's ID
		const firstDocId = allDocs.results[0].id;
		const filtered = await searchStash({
			query: "machine",
			ids: [firstDocId],
			_db: db,
			_stashRoot: tempDir,
		});

		assert.strictEqual(filtered.totalMatches, 1);
		assert.strictEqual(filtered.results[0].id, firstDocId);
		assert.deepStrictEqual(filtered.ids, [firstDocId]);
	});

	it("should filter by multiple document IDs", async () => {
		// Get all blockchain-related docs
		const allDocs = await searchStash({
			query: "blockchain",
			_db: db,
			_stashRoot: tempDir,
		});
		const allIds = allDocs.results.map((r) => r.id);

		// Search with just a subset of IDs
		const subset = [allIds[0]];
		const filtered = await searchStash({
			query: "blockchain",
			ids: subset,
			_db: db,
			_stashRoot: tempDir,
		});

		assert.strictEqual(filtered.totalMatches, 1);
		assert.strictEqual(filtered.results[0].id, subset[0]);
	});

	it("should return empty results when IDs don't match any documents", async () => {
		const result = await searchStash({
			query: "blockchain",
			ids: [99999], // Non-existent ID
			_db: db,
			_stashRoot: tempDir,
		});

		assert.strictEqual(result.totalMatches, 0);
		assert.strictEqual(result.results.length, 0);
	});

	it("should treat empty ids array as no filter", async () => {
		const result = await searchStash({
			query: "blockchain",
			ids: [], // Empty array should not filter
			_db: db,
			_stashRoot: tempDir,
		});

		// Should find results, not be blocked by empty filter
		assert.ok(result.totalMatches >= 1);
	});

	it("should use AND logic - require all terms to be present", async () => {
		// "machine learning" appears in machine-learning.pdf and crypto-ml.pdf
		// "blockchain" only appears in blockchain.pdf and crypto-ml.pdf
		// So "machine blockchain" should only match crypto-ml.pdf (has both)
		const result = await searchStash({
			query: "machine blockchain",
			_db: db,
			_stashRoot: tempDir,
		});

		// Only crypto-ml.pdf has both terms
		assert.strictEqual(result.totalMatches, 1);
		assert.strictEqual(result.results[0].filename, "crypto-ml.pdf");
	});

	it("should not match when only some terms are present", async () => {
		// Search for terms where one exists and one doesn't
		const result = await searchStash({
			query: "blockchain xyznonexistent",
			_db: db,
			_stashRoot: tempDir,
		});

		// No document has both terms
		assert.strictEqual(result.totalMatches, 0);
	});

	it("should combine ids filter with topic filter", async () => {
		// First get a doc from crypto topic
		const cryptoDocs = await searchStash({
			query: "blockchain",
			topic: "crypto",
			_db: db,
			_stashRoot: tempDir,
		});
		const cryptoId = cryptoDocs.results[0].id;

		// Search with that ID but in ml topic - should find nothing
		const result = await searchStash({
			query: "blockchain",
			topic: "ml",
			ids: [cryptoId],
			_db: db,
			_stashRoot: tempDir,
		});

		assert.strictEqual(result.totalMatches, 0);
	});

	it("should return empty results for non-existent topic", async () => {
		const result = await searchStash({
			query: "blockchain",
			topic: "nonexistent-topic",
			_db: db,
			_stashRoot: tempDir,
		});

		assert.strictEqual(result.totalMatches, 0);
		assert.strictEqual(result.topic, "nonexistent-topic");
		assert.deepStrictEqual(result.results, []);
	});

	it("should reject path traversal in topic", async () => {
		const result = await searchStash({
			query: "blockchain",
			topic: "../../../etc",
			_db: db,
			_stashRoot: tempDir,
		});

		assert.strictEqual(result.totalMatches, 0);
		assert.deepStrictEqual(result.results, []);
	});

	it("should reject topics containing slashes", async () => {
		const result = await searchStash({
			query: "blockchain",
			topic: "foo/bar",
			_db: db,
			_stashRoot: tempDir,
		});

		assert.strictEqual(result.totalMatches, 0);
		assert.deepStrictEqual(result.results, []);
	});

	it("should handle search terms starting with dash", async () => {
		// This should not be interpreted as a ripgrep flag
		const result = await searchStash({
			query: "-v",
			_db: db,
			_stashRoot: tempDir,
		});

		// Should complete without error (no matches expected)
		assert.strictEqual(result.totalMatches, 0);
	});
});
