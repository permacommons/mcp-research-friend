import assert from "node:assert";
import { describe, it } from "node:test";
import { fetchWebPage } from "../src/web-fetch.js";
import { searchWeb } from "../src/web-search.js";

// Create mock chromium for testing
function createMockChromium() {
	const mockPage = {
		goto: async () => ({}),
		waitForTimeout: async () => {},
		evaluate: async (script) => {
			if (typeof script === "string") {
				if (script.includes("document.body?.innerText"))
					return "Mock Body Text";
				if (script.includes("const meta = {};"))
					return { description: "Mock Description" };
			}
			return null;
		},
		title: async () => "Mock Title",
		content: async () => "<html><body>Mock Content</body></html>",
		url: () => "http://example.com/final",
		waitForSelector: async () => {},
		waitForFunction: async () => {},
		close: async () => {},
		$: async () => null,
	};

	const mockBrowser = {
		newPage: async () => mockPage,
		close: async () => {},
		pages: () => [],
	};

	return {
		launch: async () => mockBrowser,
		launchPersistentContext: async () => mockBrowser,
	};
}

// Create mock chromium that returns search results
function createSearchMockChromium() {
	const mockPage = {
		goto: async () => ({}),
		waitForSelector: async () => {},
		waitForFunction: async () => {},
		url: () => "https://duckduckgo.com/?q=test",
		title: async () => "test - DuckDuckGo",
		content: async () => "<html></html>",
		$: async () => null,
		close: async () => {},
		evaluate: async (fn) => {
			if (typeof fn === "function") {
				return [
					{ title: "Result 1", url: "http://r1.com", snippet: "Snippet 1" },
					{ title: "Result 2", url: "http://r2.com", snippet: "Snippet 2" },
				];
			}
			return "";
		},
	};

	const mockContext = {
		newPage: async () => mockPage,
		close: async () => {},
		pages: () => [],
	};

	return {
		launch: async () => mockContext,
		launchPersistentContext: async () => mockContext,
	};
}

describe("Research Friend Tools", () => {
	it("fetchWebPage should return page content", async () => {
		const mockChromium = createMockChromium();

		const result = await fetchWebPage({
			url: "http://example.com",
			outputFormat: "text",
			_chromium: mockChromium,
		});

		assert.strictEqual(result.url, "http://example.com");
		assert.strictEqual(result.finalUrl, "http://example.com/final");
		assert.strictEqual(result.title, "Mock Title");
		assert.strictEqual(result.content, "Mock Body Text");
		assert.strictEqual(result.meta.description, "Mock Description");
	});

	it("fetchWebPage should reject non-http(s) URLs", async () => {
		await assert.rejects(
			async () => {
				await fetchWebPage({
					url: "file:///etc/passwd",
					_chromium: createMockChromium(),
				});
			},
			{ message: "Only http/https URLs are allowed" },
		);
	});

	it("searchWeb should return search results", async () => {
		const mockChromium = createSearchMockChromium();

		const result = await searchWeb({
			query: "test query",
			_chromium: mockChromium,
		});

		assert.strictEqual(result.query, "test query");
		assert.strictEqual(result.engine, "duckduckgo");
		assert.strictEqual(result.results.length, 2);
		assert.strictEqual(result.results[0].title, "Result 1");
	});

	it("searchWeb should support google engine", async () => {
		const mockChromium = createSearchMockChromium();

		const result = await searchWeb({
			query: "test query",
			engine: "google",
			_chromium: mockChromium,
		});

		assert.strictEqual(result.engine, "google");
	});
});
