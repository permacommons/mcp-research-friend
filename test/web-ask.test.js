import assert from "node:assert";
import { beforeEach, describe, it } from "node:test";
import { askWeb } from "../src/web-ask.js";
import { clearCache } from "../src/web-extract.js";

// Mock PDFParse class
function createMockPDFParse() {
	function MockPDFParse() {}

	MockPDFParse.prototype.getText = async () => ({
		text: "This is sample PDF content with some keywords like blockchain and machine learning.",
		total: 5,
	});

	MockPDFParse.prototype.getInfo = async () => ({
		info: {
			Title: "Test PDF",
			Author: "Test Author",
		},
	});

	MockPDFParse.prototype.destroy = async () => {};

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

describe("Web Ask", () => {
	beforeEach(() => {
		clearCache();
	});

	describe("PDF asking", () => {
		const pdfContentType = async () => "application/pdf";

		it("should ask questions about a PDF", async () => {
			const mockServer = {
				server: {
					createMessage: async ({ messages, systemPrompt, maxTokens }) => {
						assert.ok(messages[0].content.text.includes("blockchain"));
						assert.ok(messages[0].content.text.includes("Summarize"));
						assert.ok(systemPrompt.includes("PDF document"));
						assert.strictEqual(maxTokens, 4096); // default

						return {
							content: {
								type: "text",
								text: "This PDF covers blockchain and ML topics.",
							},
							model: "test-model",
						};
					},
				},
			};

			const result = await askWeb({
				url: "http://example.com/test.pdf",
				ask: "Summarize this document.",
				_PDFParse: createMockPDFParse(),
				_detectContentType: pdfContentType,
				_server: mockServer,
			});

			assert.strictEqual(result.url, "http://example.com/test.pdf");
			assert.strictEqual(result.contentType, "pdf");
			assert.strictEqual(result.title, "Test PDF");
			assert.strictEqual(result.ask, "Summarize this document.");
			assert.strictEqual(
				result.answer,
				"This PDF covers blockchain and ML topics.",
			);
			assert.strictEqual(result.model, "test-model");
			assert.strictEqual(result.chunksProcessed, 1);
			assert.ok(result.totalChars > 0);
			assert.ok(result.fetchedAt);
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

			await askWeb({
				url: "http://example.com/tokens.pdf",
				ask: "Summarize",
				askMaxOutputTokens: 8192,
				_PDFParse: createMockPDFParse(),
				_detectContentType: pdfContentType,
				_server: mockServer,
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

			await askWeb({
				url: "http://example.com/timeout.pdf",
				ask: "Summarize",
				askTimeout: 60000,
				_PDFParse: createMockPDFParse(),
				_detectContentType: pdfContentType,
				_server: mockServer,
			});

			assert.strictEqual(capturedOptions.timeout, 60000);
		});
	});

	describe("Web page asking", () => {
		const htmlContentType = async () => "text/html";

		it("should ask questions about a web page", async () => {
			const mockServer = {
				server: {
					createMessage: async ({ messages, systemPrompt }) => {
						assert.ok(messages[0].content.text.includes("technology"));
						assert.ok(systemPrompt.includes("web page"));

						return {
							content: {
								type: "text",
								text: "This page discusses technology and science.",
							},
							model: "test-model",
						};
					},
				},
			};

			const result = await askWeb({
				url: "http://example.com/page",
				ask: "What topics does this page cover?",
				_chromium: createMockChromium(),
				_detectContentType: htmlContentType,
				_server: mockServer,
			});

			assert.strictEqual(result.contentType, "html");
			assert.strictEqual(result.title, "Test Web Page");
			assert.strictEqual(
				result.answer,
				"This page discusses technology and science.",
			);
		});
	});

	describe("Error handling", () => {
		it("should throw error if server is not provided", async () => {
			await assert.rejects(
				async () => {
					await askWeb({
						url: "http://example.com/test.pdf",
						ask: "Summarize",
						_PDFParse: createMockPDFParse(),
						_detectContentType: async () => "application/pdf",
					});
				},
				{ message: "Server instance required for ask mode" },
			);
		});

		it("should reject documents exceeding askMaxInputTokens", async () => {
			// Create a mock that returns a large document
			function LargePDFParse() {}
			LargePDFParse.prototype.getText = async () => ({
				text: "x".repeat(100000), // ~25k tokens
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

			await assert.rejects(
				async () => {
					await askWeb({
						url: "http://example.com/large.pdf",
						ask: "Summarize",
						askMaxInputTokens: 10000,
						_PDFParse: LargePDFParse,
						_detectContentType: async () => "application/pdf",
						_server: mockServer,
					});
				},
				(err) => {
					assert.ok(err.message.includes("too large"));
					return true;
				},
			);
		});

		it("should split and synthesize when enabled", async () => {
			function LargePDFParse() {}
			LargePDFParse.prototype.getText = async () => ({
				text: "A".repeat(50000) + "B".repeat(50000),
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
								content: { type: "text", text: "Combined summary" },
								model: "test-model",
							};
						}
						throw new Error("Unexpected call");
					},
				},
			};

			const result = await askWeb({
				url: "http://example.com/large.pdf",
				ask: "Summarize",
				askMaxInputTokens: 20000,
				askSplitAndSynthesize: true,
				_PDFParse: LargePDFParse,
				_detectContentType: async () => "application/pdf",
				_server: mockServer,
			});

			assert.strictEqual(result.chunksProcessed, 2);
			assert.strictEqual(result.answer, "Combined summary");
		});
	});
});
