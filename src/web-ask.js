import { PDFParse } from "pdf-parse";
import { chromium } from "playwright";
import { processAsk } from "./ask-processor.js";
import {
	detectContentType,
	fetchPdfContent,
	fetchWebContent,
} from "./web-extract.js";

/**
 * Fetch URL and have LLM answer questions about its content.
 * Auto-detects content type (PDF or web page).
 *
 * @param {Object} options
 * @param {string} options.url - URL to fetch (PDF or web page)
 * @param {string} options.ask - Question or instruction for the LLM
 * @param {number} [options.askTimeout=300000] - Timeout in ms for LLM processing
 * @param {number} [options.askMaxInputTokens=150000] - Max input tokens
 * @param {number} [options.askMaxOutputTokens=4096] - Max output tokens
 * @param {boolean} [options.askSplitAndSynthesize=false] - Enable chunked processing
 * @param {number} [options.waitMs=0] - Extra wait after page load (web only)
 * @param {number} [options.timeoutMs=15000] - Max page load time (web only)
 * @param {boolean} [options.headless=true] - Run browser without UI (web only)
 * @param {Object} options._server - MCP server instance (required)
 */
export async function askWeb({
	url,
	ask,
	askTimeout = 300000,
	askMaxInputTokens = 150000,
	askMaxOutputTokens = 4096,
	askSplitAndSynthesize = false,
	// Web-specific options
	waitMs = 0,
	timeoutMs = 15000,
	headless = true,
	// Dependency injection for testing
	_PDFParse = PDFParse,
	_chromium = chromium,
	_detectContentType = detectContentType,
	_server = null,
}) {
	if (!_server) {
		throw new Error("Server instance required for ask mode");
	}
	const parsedUrl = new URL(url);
	if (!["http:", "https:"].includes(parsedUrl.protocol)) {
		throw new Error("Only http/https URLs are allowed");
	}

	// Detect content type
	const detectedType = await _detectContentType(url);
	const isPdf = detectedType.includes("application/pdf");
	const contentType = isPdf ? "pdf" : "html";

	// Fetch content
	let fullText, metadata;

	if (isPdf) {
		const result = await fetchPdfContent(url, _PDFParse);
		fullText = result.text;
		metadata = result.metadata;
	} else {
		const result = await fetchWebContent(url, {
			waitMs,
			timeoutMs,
			headless,
			_chromium,
		});
		fullText = result.text;
		metadata = result.metadata;
	}

	// Process with LLM
	const documentType = isPdf ? "PDF document" : "web page";
	const result = await processAsk({
		fullText,
		ask,
		askMaxInputTokens,
		askMaxOutputTokens,
		askTimeout,
		askSplitAndSynthesize,
		documentType,
		_server,
	});

	return {
		url,
		contentType,
		title: metadata.title,
		totalChars: fullText.length,
		ask,
		answer: result.answer,
		model: result.model,
		chunksProcessed: result.chunksProcessed,
		fetchedAt: new Date().toISOString(),
	};
}
