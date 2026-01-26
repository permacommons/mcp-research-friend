import { chromium } from "playwright";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import { JSDOM } from "jsdom";

const turndown = new TurndownService({
	headingStyle: "atx",
	codeBlockStyle: "fenced",
});

const truncate = (value, maxChars) => {
	if (value.length <= maxChars) {
		return { value, truncated: false };
	}
	return { value: value.slice(0, maxChars), truncated: true };
};

export async function fetchWebPage({
	url,
	waitMs = 0,
	timeoutMs = 15000,
	maxChars = 40000,
	includeHtml = false,
	headless = true,
	slowMoMs,
	holdOpenMs = 0,
	outputFormat = "markdown",
	// Dependency injection for testing
	_chromium = chromium,
}) {
	const browser = await _chromium.launch({
		headless,
		slowMo: slowMoMs,
	});
	const page = await browser.newPage();

	try {
		const response = await page.goto(url, {
			waitUntil: "domcontentloaded",
			timeout: timeoutMs,
		});
		if (!response) {
			throw new Error(`No response received for ${url}`);
		}

		if (waitMs > 0) {
			await page.waitForTimeout(waitMs);
		}
		if (holdOpenMs > 0) {
			await page.waitForTimeout(holdOpenMs);
		}

		const metadata = await page.evaluate(`
      (() => {
        const meta = {};
        const get = (selector) => {
          const element = document.querySelector(selector);
          if (!element) return '';
          return element.getAttribute('content') || element.getAttribute('href') || '';
        };
        const setIf = (key, value) => {
          if (value) meta[key] = value;
        };
        setIf('description', get('meta[name="description"]'));
        setIf('author', get('meta[name="author"]'));
        setIf('publishedTime', get('meta[property="article:published_time"]'));
        setIf('siteName', get('meta[property="og:site_name"]'));
        setIf('canonical', get('link[rel="canonical"]'));
        setIf('ogTitle', get('meta[property="og:title"]'));
        setIf('ogUrl', get('meta[property="og:url"]'));
        return meta;
      })()
    `);

		const title = await page.title();
		const rawHtml = await page.content();

		let content;
		let contentTruncated = false;

		if (outputFormat === "markdown") {
			// Use Readability to extract main content, then convert to markdown
			const dom = new JSDOM(rawHtml, { url: page.url() });
			const reader = new Readability(dom.window.document);
			const article = reader.parse();

			if (article?.content) {
				const markdown = turndown.turndown(article.content);
				const result = truncate(markdown, maxChars);
				content = result.value;
				contentTruncated = result.truncated;
			} else {
				// Fallback to converting full body if Readability fails
				const markdown = turndown.turndown(rawHtml);
				const result = truncate(markdown, maxChars);
				content = result.value;
				contentTruncated = result.truncated;
			}
		} else if (outputFormat === "text") {
			const rawText = await page.evaluate(
				`(() => document.body?.innerText || '')()`,
			);
			const result = truncate(rawText, maxChars);
			content = result.value;
			contentTruncated = result.truncated;
		} else {
			// html
			const result = truncate(rawHtml, maxChars);
			content = result.value;
			contentTruncated = result.truncated;
		}

		const html = includeHtml ? truncate(rawHtml, maxChars).value : undefined;

		return {
			url,
			finalUrl: page.url(),
			title: title || null,
			content,
			html,
			meta: metadata,
			fetchedAt: new Date().toISOString(),
			truncated: contentTruncated || (includeHtml && rawHtml.length > maxChars),
		};
	} finally {
		await page.close();
		await browser.close();
	}
}
