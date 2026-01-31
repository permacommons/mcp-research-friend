import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { PDFParse } from "pdf-parse";
import { chromium } from "playwright";
import TurndownService from "turndown";

const turndown = new TurndownService({
	headingStyle: "atx",
	codeBlockStyle: "fenced",
});

// Cache for extracted content (25 MB limit, evict oldest first)
const MAX_CACHE_BYTES = 25 * 1024 * 1024;
const cache = new Map(); // url -> { text, metadata, contentType, size, fetchedAt }

function getCacheSize() {
	let total = 0;
	for (const entry of cache.values()) {
		total += entry.size;
	}
	return total;
}

function evictOldest() {
	// Map preserves insertion order, so first key is oldest
	const oldestKey = cache.keys().next().value;
	if (oldestKey) {
		cache.delete(oldestKey);
	}
}

function addToCache(url, text, metadata, contentType) {
	const size = text.length * 2; // approximate bytes (JS strings are UTF-16)

	// Evict until we have room
	while (cache.size > 0 && getCacheSize() + size > MAX_CACHE_BYTES) {
		evictOldest();
	}

	// Don't cache if single entry exceeds limit
	if (size > MAX_CACHE_BYTES) {
		return;
	}

	cache.set(url, {
		text,
		metadata,
		contentType,
		size,
		fetchedAt: new Date().toISOString(),
	});
}

function getFromCache(url) {
	const entry = cache.get(url);
	if (entry) {
		// Move to end (most recently used)
		cache.delete(url);
		cache.set(url, entry);
	}
	return entry;
}

// Exported for testing
export function clearCache() {
	cache.clear();
}

export function getCacheStats() {
	return { size: cache.size, bytes: getCacheSize() };
}

const truncate = (value, maxChars) => {
	if (value.length <= maxChars) {
		return { value, truncated: false };
	}
	return { value: value.slice(0, maxChars), truncated: true };
};

function searchText(text, query, contextChars = 200) {
	const matches = [];
	const lowerText = text.toLowerCase();
	const lowerQuery = query.toLowerCase();
	let pos = lowerText.indexOf(lowerQuery, 0);

	while (pos !== -1) {
		const start = Math.max(0, pos - contextChars);
		const end = Math.min(text.length, pos + query.length + contextChars);
		matches.push({
			position: pos,
			context: text.slice(start, end),
			prefix: start > 0 ? "..." : "",
			suffix: end < text.length ? "..." : "",
		});
		pos = lowerText.indexOf(lowerQuery, pos + query.length);
	}

	return matches;
}

/**
 * Detect content type from URL by making a HEAD request
 */
async function detectContentType(url) {
	try {
		const response = await fetch(url, { method: "HEAD" });
		const contentType = response.headers.get("content-type") || "";
		return contentType.toLowerCase();
	} catch {
		// If HEAD fails, try to infer from URL
		if (url.toLowerCase().endsWith(".pdf")) {
			return "application/pdf";
		}
		return "text/html";
	}
}

/**
 * Fetch and extract text from a PDF
 */
async function fetchPdfContent(url, _PDFParse = PDFParse) {
	const parser = new _PDFParse({ url });
	try {
		const [textResult, infoResult] = await Promise.all([
			parser.getText(),
			parser.getInfo(),
		]);
		const text = textResult.text;
		const info = { ...infoResult.info, pageCount: textResult.total };
		return {
			text,
			metadata: {
				title: info?.Title || null,
				author: info?.Author || null,
				creationDate: info?.CreationDate || null,
				pageCount: info?.pageCount,
			},
		};
	} finally {
		await parser.destroy();
	}
}

/**
 * Fetch and extract text from a web page
 */
async function fetchWebContent(
	url,
	{ waitMs = 0, timeoutMs = 15000, headless = true, _chromium = chromium },
) {
	const browser = await _chromium.launch({ headless });
	const page = await browser.newPage();

	try {
		const response = await page.goto(url, {
			waitUntil: "domcontentloaded",
			timeout: timeoutMs,
		});
		if (!response) {
			throw new Error(`No response received for ${url}`);
		}
		const finalUrlValue = page.url();
		const finalUrlParsed = new URL(finalUrlValue);
		if (!["http:", "https:"].includes(finalUrlParsed.protocol)) {
			throw new Error("Only http/https URLs are allowed");
		}

		if (waitMs > 0) {
			await page.waitForTimeout(waitMs);
		}

		const title = await page.title();
		const rawHtml = await page.content();
		const finalUrl = finalUrlValue;

		// Use Readability to extract main content, then convert to plain text
		const dom = new JSDOM(rawHtml, { url: finalUrl });
		const reader = new Readability(dom.window.document);
		const article = reader.parse();

		let text;
		if (article?.content) {
			// Convert HTML to markdown, then extract plain text
			const markdown = turndown.turndown(article.content);
			text = markdown;
		} else {
			// Fallback to body text
			text = dom.window.document.body?.textContent || "";
		}

		return {
			text,
			metadata: {
				title: title || null,
				finalUrl,
			},
		};
	} finally {
		await page.close();
		await browser.close();
	}
}

/**
 * Extract content from a URL (auto-detects PDF vs web page)
 *
 * @param {Object} options
 * @param {string} options.url - URL to fetch
 * @param {number} [options.maxChars=40000] - Max characters to return
 * @param {number} [options.offset=0] - Character offset to start from
 * @param {string} [options.search] - Search for phrase, return matches with context
 * @param {number} [options.contextChars=200] - Context around search matches
 * @param {number} [options.waitMs=0] - Extra wait after page load (web only)
 * @param {number} [options.timeoutMs=15000] - Max page load time (web only)
 * @param {boolean} [options.headless=true] - Run browser without UI (web only)
 */
export async function extractFromUrl({
	url,
	maxChars = 40000,
	offset = 0,
	search = null,
	contextChars = 200,
	// Web-specific options
	waitMs = 0,
	timeoutMs = 15000,
	headless = true,
	// Dependency injection for testing
	_PDFParse = PDFParse,
	_chromium = chromium,
	_detectContentType = detectContentType,
}) {
	const parsedUrl = new URL(url);
	if (!["http:", "https:"].includes(parsedUrl.protocol)) {
		throw new Error("Only http/https URLs are allowed");
	}
	// Check cache first
	const cached = getFromCache(url);
	let fullText, metadata, contentType;

	if (cached) {
		fullText = cached.text;
		metadata = cached.metadata;
		contentType = cached.contentType;
	} else {
		// Detect content type
		const detectedType = await _detectContentType(url);
		const isPdf = detectedType.includes("application/pdf");
		contentType = isPdf ? "pdf" : "html";

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

		addToCache(url, fullText, metadata, contentType);
	}

	// If search is provided, return matches instead of full content
	if (search) {
		const matches = searchText(fullText, search, contextChars);
		const baseResult = {
			url,
			contentType,
			totalChars: fullText.length,
			search,
			matchCount: matches.length,
			matches,
			fetchedAt: new Date().toISOString(),
		};

		if (contentType === "pdf") {
			return {
				...baseResult,
				title: metadata.title,
				author: metadata.author,
				pageCount: metadata.pageCount,
			};
		} else {
			return {
				...baseResult,
				title: metadata.title,
			};
		}
	}

	// Otherwise return paginated content
	const sliced = fullText.slice(offset);
	const { value: content, truncated } = truncate(sliced, maxChars);

	const baseResult = {
		url,
		contentType,
		totalChars: fullText.length,
		offset,
		content,
		truncated,
		fetchedAt: new Date().toISOString(),
	};

	if (contentType === "pdf") {
		return {
			...baseResult,
			title: metadata.title,
			author: metadata.author,
			creationDate: metadata.creationDate,
			pageCount: metadata.pageCount,
		};
	} else {
		return {
			...baseResult,
			title: metadata.title,
		};
	}
}

// Export internal functions for use by web-ask.js
export { fetchPdfContent, fetchWebContent, detectContentType };
