import assert from "node:assert";
import { beforeEach, describe, it } from "node:test";
import {
	clearCache,
	extractFromUrl,
	getCacheStats,
} from "../src/web-extract.js";

// Mock PDFParse class
function createMockPDFParse() {
	let callCount = 0;

	function MockPDFParse() {
		callCount++;
	}

	MockPDFParse.prototype.getText = async () => ({
		text: "This is sample PDF content with some keywords like blockchain and machine learning.",
		total: 5,
	});

	MockPDFParse.prototype.getInfo = async () => ({
		info: {
			Title: "Test PDF",
			Author: "Test Author",
			CreationDate: "2025-01-01",
		},
	});

	MockPDFParse.prototype.destroy = async () => {};

	MockPDFParse.getCallCount = () => callCount;
	MockPDFParse.resetCallCount = () => {
		callCount = 0;
	};

	return MockPDFParse;
}

// Mock chromium for web pages
function createMockChromium(
	pageContent = "<html><body><p>Test web content about technology and science.</p></body></html>",
) {
	return {
		launch: async () => ({
			newPage: async () => ({
				goto: async () => ({ ok: true }),
				title: async () => "Test Web Page",
				content: async () => pageContent,
				url: () => "http://example.com/page",
				waitForTimeout: async () => {},
				close: async () => {},
			}),
			close: async () => {},
		}),
	};
}

describe("Web Extract", () => {
	let MockPDFParse;
	let mockChromium;

	beforeEach(() => {
		clearCache();
		MockPDFParse = createMockPDFParse();
		mockChromium = createMockChromium();
	});

	describe("PDF extraction", () => {
		const pdfContentType = async () => "application/pdf";

		it("should fetch and return PDF content", async () => {
			const result = await extractFromUrl({
				url: "http://example.com/test.pdf",
				_PDFParse: MockPDFParse,
				_detectContentType: pdfContentType,
			});

			assert.strictEqual(result.url, "http://example.com/test.pdf");
			assert.strictEqual(result.contentType, "pdf");
			assert.strictEqual(result.title, "Test PDF");
			assert.strictEqual(result.author, "Test Author");
			assert.strictEqual(result.pageCount, 5);
			assert.ok(result.content.includes("sample PDF content"));
			assert.strictEqual(result.truncated, false);
			assert.strictEqual(MockPDFParse.getCallCount(), 1);
		});

		it("should truncate content when maxChars is exceeded", async () => {
			const result = await extractFromUrl({
				url: "http://example.com/test.pdf",
				maxChars: 20,
				_PDFParse: MockPDFParse,
				_detectContentType: pdfContentType,
			});

			assert.strictEqual(result.content.length, 20);
			assert.strictEqual(result.truncated, true);
		});

		it("should support offset for pagination", async () => {
			const result = await extractFromUrl({
				url: "http://example.com/test.pdf",
				offset: 8,
				maxChars: 10,
				_PDFParse: MockPDFParse,
				_detectContentType: pdfContentType,
			});

			assert.strictEqual(result.content, "sample PDF");
			assert.strictEqual(result.offset, 8);
			assert.strictEqual(result.truncated, true);
		});

		it("should search and return matches with context", async () => {
			const result = await extractFromUrl({
				url: "http://example.com/test.pdf",
				search: "blockchain",
				contextChars: 10,
				_PDFParse: MockPDFParse,
				_detectContentType: pdfContentType,
			});

			assert.strictEqual(result.contentType, "pdf");
			assert.strictEqual(result.search, "blockchain");
			assert.strictEqual(result.matchCount, 1);
			assert.strictEqual(result.matches.length, 1);
			assert.ok(result.matches[0].context.includes("blockchain"));
		});

		it("should be case-insensitive when searching", async () => {
			const result = await extractFromUrl({
				url: "http://example.com/test.pdf",
				search: "BLOCKCHAIN",
				_PDFParse: MockPDFParse,
				_detectContentType: pdfContentType,
			});

			assert.strictEqual(result.matchCount, 1);
		});
	});

	describe("Web page extraction", () => {
		const htmlContentType = async () => "text/html";

		it("should fetch and return web page content", async () => {
			const result = await extractFromUrl({
				url: "http://example.com/page",
				_chromium: mockChromium,
				_detectContentType: htmlContentType,
			});

			assert.strictEqual(result.url, "http://example.com/page");
			assert.strictEqual(result.contentType, "html");
			assert.strictEqual(result.title, "Test Web Page");
			assert.ok(result.content.includes("technology"));
			assert.strictEqual(result.truncated, false);
		});

		it("should truncate web content when maxChars is exceeded", async () => {
			const result = await extractFromUrl({
				url: "http://example.com/page",
				maxChars: 10,
				_chromium: mockChromium,
				_detectContentType: htmlContentType,
			});

			assert.strictEqual(result.content.length, 10);
			assert.strictEqual(result.truncated, true);
		});

		it("should search within web page content", async () => {
			const result = await extractFromUrl({
				url: "http://example.com/page",
				search: "technology",
				contextChars: 5,
				_chromium: mockChromium,
				_detectContentType: htmlContentType,
			});

			assert.strictEqual(result.contentType, "html");
			assert.strictEqual(result.search, "technology");
			assert.strictEqual(result.matchCount, 1);
		});
	});

	describe("Caching", () => {
		const pdfContentType = async () => "application/pdf";

		it("should cache PDF content", async () => {
			// First fetch
			await extractFromUrl({
				url: "http://example.com/cached.pdf",
				_PDFParse: MockPDFParse,
				_detectContentType: pdfContentType,
			});
			assert.strictEqual(MockPDFParse.getCallCount(), 1);

			// Second fetch should use cache
			await extractFromUrl({
				url: "http://example.com/cached.pdf",
				_PDFParse: MockPDFParse,
				_detectContentType: pdfContentType,
			});
			assert.strictEqual(MockPDFParse.getCallCount(), 1); // Still 1

			const stats = getCacheStats();
			assert.strictEqual(stats.size, 1);
		});

		it("should allow different operations on cached content", async () => {
			const url = "http://example.com/multi.pdf";

			// Fetch full content
			await extractFromUrl({
				url,
				_PDFParse: MockPDFParse,
				_detectContentType: pdfContentType,
			});
			assert.strictEqual(MockPDFParse.getCallCount(), 1);

			// Search same URL (should use cache)
			const r2 = await extractFromUrl({
				url,
				search: "blockchain",
				_PDFParse: MockPDFParse,
				_detectContentType: pdfContentType,
			});
			assert.strictEqual(MockPDFParse.getCallCount(), 1);
			assert.strictEqual(r2.matchCount, 1);

			// Paginate same URL (should use cache)
			await extractFromUrl({
				url,
				offset: 10,
				_PDFParse: MockPDFParse,
				_detectContentType: pdfContentType,
			});
			assert.strictEqual(MockPDFParse.getCallCount(), 1);
		});

		it("should clear cache", async () => {
			await extractFromUrl({
				url: "http://example.com/clear.pdf",
				_PDFParse: MockPDFParse,
				_detectContentType: pdfContentType,
			});
			assert.strictEqual(MockPDFParse.getCallCount(), 1);

			clearCache();
			assert.strictEqual(getCacheStats().size, 0);

			// Should fetch again after clear
			await extractFromUrl({
				url: "http://example.com/clear.pdf",
				_PDFParse: MockPDFParse,
				_detectContentType: pdfContentType,
			});
			assert.strictEqual(MockPDFParse.getCallCount(), 2);
		});
	});

	describe("Content type detection", () => {
		it("should detect PDF from content-type header", async () => {
			const result = await extractFromUrl({
				url: "http://example.com/document",
				_PDFParse: MockPDFParse,
				_detectContentType: async () => "application/pdf; charset=utf-8",
			});

			assert.strictEqual(result.contentType, "pdf");
		});

		it("should detect HTML from content-type header", async () => {
			const result = await extractFromUrl({
				url: "http://example.com/page",
				_chromium: mockChromium,
				_detectContentType: async () => "text/html; charset=utf-8",
			});

			assert.strictEqual(result.contentType, "html");
		});

		it("should fall back to HTML for unknown content types", async () => {
			const result = await extractFromUrl({
				url: "http://example.com/page",
				_chromium: mockChromium,
				_detectContentType: async () => "text/plain",
			});

			assert.strictEqual(result.contentType, "html");
		});
	});
});
