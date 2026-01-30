const CHARS_PER_TOKEN = 4;
const HARD_LIMIT_CHARS = 20 * 1024 * 1024; // 20 MB

function extractResponseText(result) {
	const content = result.content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.filter((block) => block.type === "text")
			.map((block) => block.text)
			.join("\n");
	}
	if (content.type === "text") return content.text;
	return JSON.stringify(content);
}

async function processSingleChunk({
	text,
	ask,
	askMaxOutputTokens,
	askTimeout,
	documentType,
	chunkInfo,
	_server,
}) {
	let userPrompt;
	let systemPrompt;

	if (chunkInfo) {
		// Processing a chunk of a larger document
		systemPrompt =
			`You are processing part of a larger ${documentType} that has been split due to size. ` +
			`You are viewing part ${chunkInfo.current} of ${chunkInfo.total}. ` +
			`The user's request below applies to the entire document, but you can only see this portion. ` +
			`Respond based on what is visible in this part. If this part doesn't contain relevant information ` +
			`for the request, say so briefly. Your response will be combined with responses from other parts.`;

		userPrompt =
			`Here is part ${chunkInfo.current} of ${chunkInfo.total} of the ${documentType}:\n\n` +
			`---\n\n${text}\n\n---\n\n` +
			`User's request (for the full document): ${ask}`;
	} else {
		// Processing the complete document
		systemPrompt =
			`You are a helpful assistant processing a ${documentType}. ` +
			`Follow the user's request precisely. Be concise and accurate. ` +
			`Base your response only on the document content.`;

		userPrompt =
			`Here is the ${documentType}:\n\n` +
			`---\n\n${text}\n\n---\n\n` +
			`Request: ${ask}`;
	}

	const result = await _server.server.createMessage(
		{
			messages: [
				{
					role: "user",
					content: {
						type: "text",
						text: userPrompt,
					},
				},
			],
			systemPrompt,
			maxTokens: askMaxOutputTokens,
			_meta: {
				"research-friend/timeoutMs": askTimeout,
			},
		},
		{ timeout: askTimeout },
	);

	return {
		text: extractResponseText(result),
		model: result.model,
	};
}

async function synthesizeResults({
	chunkResults,
	ask,
	askMaxOutputTokens,
	askTimeout,
	documentType,
	_server,
}) {
	const synthesisPrompt =
		`A ${documentType} was too large to process at once, so it was split into ${chunkResults.length} parts. ` +
		`Each part was processed separately with the same user request. Here are the responses from each part:\n\n` +
		`${chunkResults.map((r, i) => `## Response from Part ${i + 1}\n${r}`).join("\n\n")}\n\n` +
		`---\n\n` +
		`The user's original request was: "${ask}"\n\n` +
		`Please synthesize the above partial responses into a single, coherent answer to the user's request. ` +
		`Combine relevant information, eliminate redundancy, and resolve any apparent contradictions. ` +
		`If some parts indicated they lacked relevant information, focus on the parts that did contain it. ` +
		`Respond in the same language as the user's request, regardless of the document's language, unless otherwise specified.`;

	const result = await _server.server.createMessage(
		{
			messages: [
				{
					role: "user",
					content: {
						type: "text",
						text: synthesisPrompt,
					},
				},
			],
			systemPrompt:
				"You are combining partial responses from a chunked document analysis into one unified answer. " +
				"The user made a request about a large document that was processed in parts. " +
				"Your job is to synthesize the partial responses into a complete, coherent answer.",
			maxTokens: askMaxOutputTokens,
			_meta: {
				"research-friend/timeoutMs": askTimeout,
			},
		},
		{ timeout: askTimeout },
	);

	return {
		text: extractResponseText(result),
		model: result.model,
	};
}

async function processChunked({
	fullText,
	ask,
	askMaxInputTokens,
	askMaxOutputTokens,
	askTimeout,
	documentType,
	_server,
}) {
	// Calculate chunk size (leave room for prompt overhead)
	const promptOverhead = 2000; // tokens for system prompt + instruction framing
	const usableInputTokens = askMaxInputTokens - promptOverhead;
	const chunkChars = usableInputTokens * CHARS_PER_TOKEN;
	const overlap = 500; // chars overlap to preserve context at boundaries

	// Split into chunks
	const chunks = [];
	for (let i = 0; i < fullText.length; i += chunkChars - overlap) {
		chunks.push(fullText.slice(i, Math.min(i + chunkChars, fullText.length)));
	}

	// Process each chunk
	const chunkResults = [];
	for (let i = 0; i < chunks.length; i++) {
		const result = await processSingleChunk({
			text: chunks[i],
			ask,
			askMaxOutputTokens,
			askTimeout,
			documentType,
			chunkInfo: { current: i + 1, total: chunks.length },
			_server,
		});
		chunkResults.push(result.text);
	}

	// Synthesize results
	const synthesis = await synthesizeResults({
		chunkResults,
		ask,
		askMaxOutputTokens,
		askTimeout,
		documentType,
		_server,
	});

	return {
		answer: synthesis.text,
		model: synthesis.model,
		chunksProcessed: chunks.length,
	};
}

/**
 * Process a document with an LLM instruction.
 *
 * @param {Object} options
 * @param {string} options.fullText - The full document text
 * @param {string} options.ask - The instruction to process
 * @param {number} [options.askMaxInputTokens=150000] - Max input tokens per call
 * @param {number} [options.askMaxOutputTokens=4096] - Max output tokens per call
 * @param {number} [options.askTimeout=300000] - Timeout in ms for each LLM call
 * @param {boolean} [options.askSplitAndSynthesize=false] - Enable chunked processing
 * @param {string} [options.documentType="document"] - Document type for prompts
 * @param {Object} options._server - MCP server instance
 * @returns {Promise<{answer: string, model: string, chunksProcessed: number}>}
 */
export async function processAsk({
	fullText,
	ask,
	askMaxInputTokens = 150000,
	askMaxOutputTokens = 4096,
	askTimeout = 300000,
	askSplitAndSynthesize = false,
	documentType = "document",
	_server,
}) {
	if (!_server) {
		throw new Error("Server instance required for 'ask' mode");
	}

	// Hard limit - 20 MB max regardless of settings
	if (fullText.length > HARD_LIMIT_CHARS) {
		throw new Error(
			`Document exceeds maximum size of 20 MB for ask mode. ` +
				`Use 'search' to find specific content, or pagination (offset/maxChars) to read in chunks.`,
		);
	}

	const estimatedTokens = Math.ceil(fullText.length / CHARS_PER_TOKEN);
	const headroom = 2000; // Reserve for system prompt, framing

	// Check if document fits in single call
	if (estimatedTokens > askMaxInputTokens - headroom) {
		if (!askSplitAndSynthesize) {
			throw new Error(
				`Document too large for ask mode (~${estimatedTokens.toLocaleString()} tokens, ` +
					`limit is ${askMaxInputTokens.toLocaleString()}). ` +
					`Use 'search' to find specific content, pagination (offset/maxChars) ` +
					`to read in chunks, or set 'askSplitAndSynthesize: true' for automatic ` +
					`chunked processing (warning: consumes many tokens).`,
			);
		}

		return await processChunked({
			fullText,
			ask,
			askMaxInputTokens,
			askMaxOutputTokens,
			askTimeout,
			documentType,
			_server,
		});
	}

	// Single call processing
	const result = await processSingleChunk({
		text: fullText,
		ask,
		askMaxOutputTokens,
		askTimeout,
		documentType,
		chunkInfo: null,
		_server,
	});

	return {
		answer: result.text,
		model: result.model,
		chunksProcessed: 1,
	};
}

// Export constants for testing
export { CHARS_PER_TOKEN, HARD_LIMIT_CHARS };
