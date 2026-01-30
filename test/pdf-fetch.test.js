import assert from "node:assert";
import { beforeEach, describe, it } from "node:test";
import { clearCache, fetchPdf, getCacheStats } from "../src/pdf-fetch.js";

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

describe("PDF Fetch", () => {
	let MockPDFParse;

	beforeEach(() => {
		clearCache();
		MockPDFParse = createMockPDFParse();
	});

	it("should fetch and return PDF content", async () => {
		const result = await fetchPdf({
			url: "http://example.com/test.pdf",
			_PDFParse: MockPDFParse,
		});

		assert.strictEqual(result.url, "http://example.com/test.pdf");
		assert.strictEqual(result.title, "Test PDF");
		assert.strictEqual(result.author, "Test Author");
		assert.strictEqual(result.pageCount, 5);
		assert.ok(result.content.includes("sample PDF content"));
		assert.strictEqual(result.truncated, false);
		assert.strictEqual(MockPDFParse.getCallCount(), 1);
	});

	it("should truncate content when maxChars is exceeded", async () => {
		const result = await fetchPdf({
			url: "http://example.com/test.pdf",
			maxChars: 20,
			_PDFParse: MockPDFParse,
		});

		assert.strictEqual(result.content.length, 20);
		assert.strictEqual(result.truncated, true);
	});

	it("should support offset for pagination", async () => {
		const result = await fetchPdf({
			url: "http://example.com/test.pdf",
			offset: 8,
			maxChars: 10,
			_PDFParse: MockPDFParse,
		});

		assert.strictEqual(result.content, "sample PDF");
		assert.strictEqual(result.offset, 8);
		assert.strictEqual(result.truncated, true);
	});

	it("should search and return matches with context", async () => {
		const result = await fetchPdf({
			url: "http://example.com/test.pdf",
			search: "blockchain",
			contextChars: 10,
			_PDFParse: MockPDFParse,
		});

		assert.strictEqual(result.search, "blockchain");
		assert.strictEqual(result.matchCount, 1);
		assert.strictEqual(result.matches.length, 1);
		assert.ok(result.matches[0].context.includes("blockchain"));
	});

	it("should be case-insensitive when searching", async () => {
		const result = await fetchPdf({
			url: "http://example.com/test.pdf",
			search: "BLOCKCHAIN",
			_PDFParse: MockPDFParse,
		});

		assert.strictEqual(result.matchCount, 1);
	});

	it("should cache PDF content", async () => {
		// First fetch
		await fetchPdf({
			url: "http://example.com/cached.pdf",
			_PDFParse: MockPDFParse,
		});
		assert.strictEqual(MockPDFParse.getCallCount(), 1);

		// Second fetch should use cache
		await fetchPdf({
			url: "http://example.com/cached.pdf",
			_PDFParse: MockPDFParse,
		});
		assert.strictEqual(MockPDFParse.getCallCount(), 1); // Still 1

		const stats = getCacheStats();
		assert.strictEqual(stats.size, 1);
	});

	it("should allow different operations on cached PDF", async () => {
		const url = "http://example.com/multi.pdf";

		// Fetch full content
		await fetchPdf({ url, _PDFParse: MockPDFParse });
		assert.strictEqual(MockPDFParse.getCallCount(), 1);

		// Search same PDF (should use cache)
		const r2 = await fetchPdf({
			url,
			search: "blockchain",
			_PDFParse: MockPDFParse,
		});
		assert.strictEqual(MockPDFParse.getCallCount(), 1);
		assert.strictEqual(r2.matchCount, 1);

		// Paginate same PDF (should use cache)
		await fetchPdf({ url, offset: 10, _PDFParse: MockPDFParse });
		assert.strictEqual(MockPDFParse.getCallCount(), 1);
	});

	it("should clear cache", async () => {
		await fetchPdf({
			url: "http://example.com/clear.pdf",
			_PDFParse: MockPDFParse,
		});
		assert.strictEqual(MockPDFParse.getCallCount(), 1);

		clearCache();
		assert.strictEqual(getCacheStats().size, 0);

		// Should fetch again after clear
		await fetchPdf({
			url: "http://example.com/clear.pdf",
			_PDFParse: MockPDFParse,
		});
		assert.strictEqual(MockPDFParse.getCallCount(), 2);
	});

	it("should process instructions using ask mode", async () => {
		const mockServer = {
			server: {
				createMessage: async ({ messages, systemPrompt, maxTokens }) => {
					// Verify the request structure
					assert.ok(messages[0].content.text.includes("blockchain"));
					assert.ok(messages[0].content.text.includes("Summarize"));
					assert.ok(systemPrompt.includes("helpful assistant"));
					assert.strictEqual(maxTokens, 4096); // default askMaxOutputTokens

					return {
						content: {
							type: "text",
							text: "This document covers blockchain technology and machine learning.",
						},
						model: "test-model",
					};
				},
			},
		};

		const result = await fetchPdf({
			url: "http://example.com/ask.pdf",
			ask: "Summarize this document in one sentence.",
			_PDFParse: MockPDFParse,
			_server: mockServer,
		});

		assert.strictEqual(result.ask, "Summarize this document in one sentence.");
		assert.strictEqual(
			result.answer,
			"This document covers blockchain technology and machine learning.",
		);
		assert.strictEqual(result.model, "test-model");
		assert.ok(result.totalChars > 0);
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

		await fetchPdf({
			url: "http://example.com/tokens.pdf",
			ask: "Summarize",
			askMaxOutputTokens: 8192,
			_PDFParse: MockPDFParse,
			_server: mockServer,
		});

		assert.strictEqual(capturedMaxTokens, 8192);
	});

	it("should reject documents exceeding askMaxInputTokens with hint about splitAndSynthesize", async () => {
		// Create a mock that returns a large document
		function LargePDFParse() {}
		LargePDFParse.prototype.getText = async () => ({
			// 100,000 chars = ~25,000 tokens
			text: "x".repeat(100000),
			total: 100,
		});
		LargePDFParse.prototype.getInfo = async () => ({ info: {} });
		LargePDFParse.prototype.destroy = async () => {};

		const mockServer = {
			server: {
				createMessage: async () => {
					throw new Error("Should not be called");
				},
			},
		};

		// With a very low limit, the document should be rejected
		await assert.rejects(
			async () => {
				await fetchPdf({
					url: "http://example.com/large.pdf",
					ask: "Summarize",
					askMaxInputTokens: 10000, // ~40k chars, but doc is 100k chars (~25k tokens)
					_PDFParse: LargePDFParse,
					_server: mockServer,
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
		// Create a mock that returns a document requiring 2 chunks
		function LargePDFParse() {}
		LargePDFParse.prototype.getText = async () => ({
			text: "A".repeat(50000) + "B".repeat(50000), // 100k chars
			total: 50,
		});
		LargePDFParse.prototype.getInfo = async () => ({ info: {} });
		LargePDFParse.prototype.destroy = async () => {};

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
							content: {
								type: "text",
								text: "Combined summary of parts 1 and 2",
							},
							model: "test-model",
						};
					}
					throw new Error("Unexpected call");
				},
			},
		};

		const result = await fetchPdf({
			url: "http://example.com/large.pdf",
			ask: "Summarize",
			askMaxInputTokens: 20000, // Force splitting
			askSplitAndSynthesize: true,
			_PDFParse: LargePDFParse,
			_server: mockServer,
		});

		assert.strictEqual(result.chunksProcessed, 2);
		assert.strictEqual(result.answer, "Combined summary of parts 1 and 2");
		assert.strictEqual(calls.length, 3); // 2 chunks + 1 synthesis
	});

	it("should reject documents exceeding 20 MB hard limit even with splitAndSynthesize", async () => {
		// Create a mock that returns a huge document
		function HugePDFParse() {}
		HugePDFParse.prototype.getText = async () => ({
			text: "x".repeat(21 * 1024 * 1024), // 21 MB
			total: 1000,
		});
		HugePDFParse.prototype.getInfo = async () => ({ info: {} });
		HugePDFParse.prototype.destroy = async () => {};

		const mockServer = {
			server: {
				createMessage: async () => {
					throw new Error("Should not be called");
				},
			},
		};

		await assert.rejects(
			async () => {
				await fetchPdf({
					url: "http://example.com/huge.pdf",
					ask: "Summarize",
					askSplitAndSynthesize: true,
					_PDFParse: HugePDFParse,
					_server: mockServer,
				});
			},
			(err) => {
				assert.ok(err.message.includes("20 MB"));
				return true;
			},
		);
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

		// Test default timeout
		await fetchPdf({
			url: "http://example.com/timeout1.pdf",
			ask: "Summarize",
			_PDFParse: MockPDFParse,
			_server: mockServer,
		});
		assert.strictEqual(capturedOptions.timeout, 300000); // 5 minutes default

		// Test custom timeout
		await fetchPdf({
			url: "http://example.com/timeout2.pdf",
			ask: "Summarize",
			askTimeout: 60000,
			_PDFParse: MockPDFParse,
			_server: mockServer,
		});
		assert.strictEqual(capturedOptions.timeout, 60000);
	});

	it("should throw error if ask mode used without server", async () => {
		await assert.rejects(
			async () => {
				await fetchPdf({
					url: "http://example.com/ask.pdf",
					ask: "What is this about?",
					_PDFParse: MockPDFParse,
				});
			},
			{ message: "Server instance required for 'ask' mode" },
		);
	});
});
