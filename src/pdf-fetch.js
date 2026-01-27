import { PDFParse } from "pdf-parse";

// Cache for extracted PDF text (25 MB limit, evict oldest first)
const MAX_CACHE_BYTES = 25 * 1024 * 1024;
const cache = new Map(); // url -> { text, info, size, fetchedAt }

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

function addToCache(url, text, info) {
	const size = text.length * 2; // approximate bytes (JS strings are UTF-16)

	// Evict until we have room
	while (cache.size > 0 && getCacheSize() + size > MAX_CACHE_BYTES) {
		evictOldest();
	}

	// Don't cache if single entry exceeds limit
	if (size > MAX_CACHE_BYTES) {
		return;
	}

	cache.set(url, { text, info, size, fetchedAt: new Date().toISOString() });
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

export async function fetchPdf({
	url,
	maxChars = 40000,
	offset = 0,
	search = null,
	ask = null,
	askTimeout = 300000, // 5 minutes default for LLM processing
	contextChars = 200,
	// Dependency injection for testing
	_PDFParse = PDFParse,
	_server = null,
}) {
	// Check cache first
	const cached = getFromCache(url);
	let fullText, info;

	if (cached) {
		fullText = cached.text;
		info = cached.info;
	} else {
		const parser = new _PDFParse({ url });
		try {
			const [textResult, infoResult] = await Promise.all([
				parser.getText(),
				parser.getInfo(),
			]);
			fullText = textResult.text;
			info = { ...infoResult.info, pageCount: textResult.total };
			addToCache(url, fullText, info);
		} finally {
			await parser.destroy();
		}
	}

	// If ask is provided, use sampling to answer the question
	if (ask) {
		if (!_server) {
			throw new Error("Server instance required for 'ask' mode");
		}

		const result = await _server.server.createMessage(
			{
				messages: [
					{
						role: "user",
						content: {
							type: "text",
							text: `Here is a PDF document:\n\n---\n\n${fullText}\n\n---\n\nInstruction: ${ask}`,
						},
					},
				],
				systemPrompt:
					"You are a helpful assistant processing a PDF document. Follow the user's instruction precisely. Be concise and accurate. Base your response only on the document content.",
				maxTokens: 4096,
				_meta: {
					"research-friend/timeoutMs": askTimeout,
				},
			},
			{ timeout: askTimeout },
		);

		// Extract text from response
		const responseContent = result.content;
		const answer =
			typeof responseContent === "string"
				? responseContent
				: Array.isArray(responseContent)
					? responseContent
							.filter((block) => block.type === "text")
							.map((block) => block.text)
							.join("\n")
					: responseContent.type === "text"
						? responseContent.text
						: JSON.stringify(responseContent);

		return {
			url,
			title: info?.Title || null,
			author: info?.Author || null,
			pageCount: info?.pageCount,
			totalChars: fullText.length,
			ask,
			answer,
			model: result.model,
			fetchedAt: new Date().toISOString(),
		};
	}

	// If search is provided, return matches instead of full content
	if (search) {
		const matches = searchText(fullText, search, contextChars);
		return {
			url,
			title: info?.Title || null,
			author: info?.Author || null,
			pageCount: info?.pageCount,
			totalChars: fullText.length,
			search,
			matchCount: matches.length,
			matches,
			fetchedAt: new Date().toISOString(),
		};
	}

	// Otherwise return paginated content
	const sliced = fullText.slice(offset);
	const { value: content, truncated } = truncate(sliced, maxChars);

	return {
		url,
		title: info?.Title || null,
		author: info?.Author || null,
		creationDate: info?.CreationDate || null,
		pageCount: info?.pageCount,
		totalChars: fullText.length,
		offset,
		content,
		fetchedAt: new Date().toISOString(),
		truncated,
	};
}
