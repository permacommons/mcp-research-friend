import path from "node:path";
import { chromium } from "playwright";

async function isCaptchaDetected(page) {
	try {
		const url = page.url();
		if (
			url.includes("google.com/sorry") ||
			url.includes("ipv4.google.com/sorry")
		)
			return true;

		// Fast check for common keywords in the visible text
		const bodyText = await page
			.evaluate(() => document.body.innerText)
			.catch(() => "");

		if (
			bodyText.includes("systems have detected unusual traffic") ||
			(bodyText.includes("recaptcha") && url.includes("google")) ||
			bodyText.includes("Enter the characters you see below") ||
			bodyText.includes("confirm this search was made by a human") ||
			bodyText.includes("Select all squares containing a duck") ||
			bodyText.includes("Please solve the challenge below to continue") ||
			bodyText.includes("Verify you are human") ||
			bodyText.includes("Checking your browser before accessing")
		) {
			return true;
		}

		// Check for specific elements
		if (await page.$('iframe[src*="recaptcha"]').catch(() => null)) return true;
		if (
			await page.$('iframe[src*="challenges.cloudflare.com"]').catch(() => null)
		)
			return true;
		if (await page.$("#captcha-form").catch(() => null)) return true;
		if (await page.$(".anomaly-modal__modal").catch(() => null)) return true;
		if (await page.$("#turnstile-widget").catch(() => null)) return true;
		if (await page.$(".captcha").catch(() => null)) return true;
	} catch {
		// If checking fails, assume no captcha or let downstream fail
	}
	return false;
}

async function performSearchDuckDuckGo(page, query, maxResults, timeoutMs) {
	const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&t=h_&ia=web`;
	await page.goto(searchUrl, {
		waitUntil: "domcontentloaded",
		timeout: timeoutMs,
	});

	// Wait for results to load
	await page
		.waitForSelector('[data-testid="result"]', { timeout: timeoutMs })
		.catch(() => {});

	// Extract search results
	const results = await page.evaluate(
		({ max }) => {
			// Helper function (needs to be defined inside evaluate context)
			function getCleanText(node) {
				if (!node) return "";
				if (node.nodeType === 3) return node.textContent?.trim() || "";
				if (node.nodeType === 1) {
					if (node.children.length > 0) {
						return Array.from(node.childNodes)
							.map((child) => getCleanText(child))
							.filter((t) => t.length > 0)
							.join(" ");
					}
					const t = "innerText" in node ? node.innerText : node.textContent;
					return t?.trim() || "";
				}
				return "";
			}

			const items = [];
			const resultElements = document.querySelectorAll(
				'[data-testid="result"]',
			);

			for (const el of resultElements) {
				if (items.length >= max) break;

				const titleEl = el.querySelector('[data-testid="result-title-a"]');

				if (titleEl) {
					let snippet = "";
					const officialSnippet = el.querySelector(
						'[data-testid="result-snippet"]',
					);
					if (officialSnippet) {
						snippet = getCleanText(officialSnippet);
					} else {
						const titleText = titleEl.innerText?.trim() || "";
						const urlText =
							el
								.querySelector('[data-testid="result-extras-url"]')
								?.innerText?.trim() ||
							el.querySelector('a[href^="http"]')?.innerText?.trim() ||
							"";

						const noisePhrases = [
							"Only include results for this site",
							"Redo search without this site",
							"Block this site from all results",
							"Share feedback about this site",
							"More results",
							"Ad",
						];
						let bestCandidate = "";
						const candidates = el.querySelectorAll("div, span, p");
						for (const cand of candidates) {
							let text = getCleanText(cand);
							if (text.length < 15 || text === titleText || text === urlText)
								continue;
							for (const phrase of noisePhrases)
								text = text.replace(phrase, "").trim();
							if (text.includes(titleText)) continue;
							if (text.length > bestCandidate.length) bestCandidate = text;
						}
						snippet = bestCandidate;
					}

					items.push({
						title: titleEl.textContent?.trim() || "",
						url: titleEl.getAttribute("href") || "",
						snippet: snippet.trim(),
					});
				}
			}
			return items;
		},
		{ max: maxResults, query },
	);

	return {
		results,
		html: results.length === 0 ? await page.content() : undefined,
	};
}

async function performSearchGoogle(page, query, maxResults, timeoutMs) {
	const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
	await page.goto(searchUrl, {
		waitUntil: "domcontentloaded",
		timeout: timeoutMs,
	});

	await page
		.waitForFunction(() => document.querySelectorAll("a > h3").length >= 3, {
			timeout: timeoutMs,
		})
		.catch(() => {});

	const results = await page.evaluate(
		({ max }) => {
			function getCleanText(node) {
				if (!node) return "";
				if (node.nodeType === 3) return node.textContent?.trim() || "";
				if (node.nodeType === 1) {
					if (node.children.length > 0) {
						return Array.from(node.childNodes)
							.map((child) => getCleanText(child))
							.filter((t) => t.length > 0)
							.join(" ");
					}
					const t = "innerText" in node ? node.innerText : node.textContent;
					return t?.trim() || "";
				}
				return "";
			}

			const items = [];
			const titleElements = document.querySelectorAll("a h3");

			for (const titleEl of titleElements) {
				if (items.length >= max) break;
				const linkEl = titleEl.closest("a");
				if (!linkEl) continue;
				const url = linkEl.getAttribute("href") || "";
				if (
					!url ||
					url.startsWith("/search") ||
					url.includes("google.com/search")
				)
					continue;
				const title = titleEl.innerText?.trim() || "";

				let snippet = "";
				let resultContainer = linkEl.parentElement;
				for (let i = 0; i < 5; i++) {
					if (
						resultContainer?.parentElement &&
						resultContainer.parentElement.tagName !== "BODY"
					)
						resultContainer = resultContainer.parentElement;
				}

				if (resultContainer) {
					const textBlocks = Array.from(
						resultContainer.querySelectorAll("div, span, p"),
					)
						.map((el) => getCleanText(el))
						.filter(
							(txt) =>
								txt &&
								txt.length > 30 &&
								txt !== title &&
								!txt.includes("›") &&
								!txt.includes("http"),
						);
					if (textBlocks.length > 0)
						snippet = textBlocks.reduce((a, b) =>
							a.length > b.length ? a : b,
						);
				}

				if (title && url) items.push({ title, url, snippet });
			}
			return items;
		},
		{ max: maxResults, query },
	);

	return {
		results,
		html: results.length === 0 ? await page.content() : undefined,
	};
}

export async function searchWeb({
	query,
	engine = "duckduckgo",
	maxResults = 10,
	timeoutMs = 15000,
	headless = true,
}) {
	const userDataDir = path.resolve(process.cwd(), ".browser-data");

	const runSearch = async (isHeadless) => {
		const context = await chromium.launchPersistentContext(userDataDir, {
			headless: isHeadless,
			args: ["--disable-blink-features=AutomationControlled"],
			viewport: { width: 1280, height: 720 },
		});

		const page = await context.newPage();

		try {
			const pages = context.pages();
			for (const p of pages) {
				if (p !== page) await p.close().catch(() => {});
			}

			let output;
			switch (engine) {
				case "duckduckgo":
					output = await performSearchDuckDuckGo(
						page,
						query,
						maxResults,
						timeoutMs,
					);
					break;
				case "google":
					output = await performSearchGoogle(
						page,
						query,
						maxResults,
						timeoutMs,
					);
					break;
				default:
					throw new Error(`Unknown search engine: ${engine}`);
			}

			if (!output.results || output.results.length === 0) {
				if (await isCaptchaDetected(page)) {
					throw new Error("CAPTCHA_DETECTED");
				}
			}

			const pageTitle = await page.title().catch(() => "");
			return { ...output, url: page.url(), page_title: pageTitle };
		} finally {
			await page.close();
			await context.close();
		}
	};

	try {
		const output = await runSearch(headless);

		return {
			query,
			engine,
			results: output.results,
			searchedAt: new Date().toISOString(),
			fallback_result_html: output.html,
			debug_info: {
				mode: "headless",
				captcha_detected: false,
				retried: false,
				final_url: output.url,
				page_title: output.page_title,
			},
		};
	} catch (error) {
		if (error.message === "CAPTCHA_DETECTED") {
			if (headless) {
				const output = await runSearch(false);

				return {
					query,
					engine,
					results: output.results,
					searchedAt: new Date().toISOString(),
					fallback_result_html: output.html,
					debug_info: {
						mode: "headed_fallback",
						captcha_detected: true,
						retried: true,
						final_url: output.url,
						page_title: output.page_title,
					},
				};
			} else {
				throw error;
			}
		}
		throw error;
	}
}
