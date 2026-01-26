import assert from "node:assert";
import { describe, it, beforeEach, mock } from "node:test";

// Mock PDFParse
const mockDestroy = mock.fn(async () => {});
const mockGetText = mock.fn(async () => ({
	text: "This is sample PDF content with some keywords like blockchain and AI.",
	total: 5,
}));
const mockGetInfo = mock.fn(async () => ({
	info: { Title: "Test PDF", Author: "Test Author", CreationDate: "2025-01-01" },
}));

const MockPDFParse = mock.fn(function () {
	return {
		getText: mockGetText,
		getInfo: mockGetInfo,
		destroy: mockDestroy,
	};
});

mock.module("pdf-parse", {
	namedExports: {
		PDFParse: MockPDFParse,
	},
});

const { fetchPdf, clearCache, getCacheStats } = await import(
	"../src/pdf-fetch.js"
);

describe("PDF Fetch", () => {
	beforeEach(() => {
		clearCache();
		MockPDFParse.mock.resetCalls();
		mockGetText.mock.resetCalls();
		mockGetInfo.mock.resetCalls();
		mockDestroy.mock.resetCalls();
	});

	it("should fetch and return PDF content", async () => {
		const callsBefore = MockPDFParse.mock.callCount();
		const result = await fetchPdf({ url: "http://example.com/test.pdf" });

		assert.strictEqual(result.url, "http://example.com/test.pdf");
		assert.strictEqual(result.title, "Test PDF");
		assert.strictEqual(result.author, "Test Author");
		assert.strictEqual(result.pageCount, 5);
		assert.strictEqual(
			result.content,
			"This is sample PDF content with some keywords like blockchain and AI.",
		);
		assert.strictEqual(result.truncated, false);
		assert.strictEqual(MockPDFParse.mock.callCount(), callsBefore + 1);
	});

	it("should truncate content when maxChars is exceeded", async () => {
		const result = await fetchPdf({
			url: "http://example.com/test2.pdf",
			maxChars: 20,
		});

		assert.strictEqual(result.content, "This is sample PDF c");
		assert.strictEqual(result.truncated, true);
		assert.strictEqual(result.totalChars, 69);
	});

	it("should support offset for pagination", async () => {
		const result = await fetchPdf({
			url: "http://example.com/test3.pdf",
			offset: 8,
			maxChars: 10,
		});

		assert.strictEqual(result.content, "sample PDF");
		assert.strictEqual(result.offset, 8);
		assert.strictEqual(result.truncated, true);
	});

	it("should search and return matches with context", async () => {
		const result = await fetchPdf({
			url: "http://example.com/test4.pdf",
			search: "blockchain",
			contextChars: 10,
		});

		assert.strictEqual(result.search, "blockchain");
		assert.strictEqual(result.matchCount, 1);
		assert.strictEqual(result.matches.length, 1);
		assert.ok(result.matches[0].context.includes("blockchain"));
		assert.strictEqual(result.matches[0].position, 51);
	});

	it("should be case-insensitive when searching", async () => {
		const result = await fetchPdf({
			url: "http://example.com/test5.pdf",
			search: "BLOCKCHAIN",
		});

		assert.strictEqual(result.matchCount, 1);
	});

	it("should cache PDF content", async () => {
		const callsBefore = MockPDFParse.mock.callCount();

		// First fetch
		await fetchPdf({ url: "http://example.com/cached.pdf" });
		assert.strictEqual(MockPDFParse.mock.callCount(), callsBefore + 1);

		// Second fetch should use cache
		await fetchPdf({ url: "http://example.com/cached.pdf" });
		assert.strictEqual(MockPDFParse.mock.callCount(), callsBefore + 1); // Still same

		const stats = getCacheStats();
		assert.ok(stats.size >= 1);
	});

	it("should allow different operations on cached PDF", async () => {
		// Use unique URL for this test
		const url = "http://example.com/multi-ops-" + Date.now() + ".pdf";

		// Fetch full content - this should populate cache
		const r1 = await fetchPdf({ url });
		const callsAfterFirst = MockPDFParse.mock.callCount();

		// Search same PDF (should use cache, no new PDFParse calls)
		const r2 = await fetchPdf({ url, search: "blockchain" });
		assert.strictEqual(MockPDFParse.mock.callCount(), callsAfterFirst);
		assert.strictEqual(r2.matchCount, 1);

		// Paginate same PDF (should use cache)
		const r3 = await fetchPdf({ url, offset: 10 });
		assert.strictEqual(MockPDFParse.mock.callCount(), callsAfterFirst);
	});

	it("should clear cache", async () => {
		const callsBefore = MockPDFParse.mock.callCount();

		await fetchPdf({ url: "http://example.com/clear.pdf" });
		assert.strictEqual(MockPDFParse.mock.callCount(), callsBefore + 1);

		clearCache();
		assert.strictEqual(getCacheStats().size, 0);

		// Should fetch again after clear
		await fetchPdf({ url: "http://example.com/clear.pdf" });
		assert.strictEqual(MockPDFParse.mock.callCount(), callsBefore + 2);
	});
});
