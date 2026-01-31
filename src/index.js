import { spawn } from "node:child_process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
	askStashDocument,
	extractFromStash,
	getDatabase,
	getStashRoot,
	initializeStash,
	listStash,
	processInbox,
	reindexStash,
	searchStash,
} from "./stash/index.js";
import { getInboxPath } from "./stash/paths.js";
import { askWeb } from "./web-ask.js";
import { extractFromUrl } from "./web-extract.js";
import { fetchWebPage } from "./web-fetch.js";
import { searchWeb } from "./web-search.js";

const server = new McpServer({
	name: "research-friend",
	version: "0.1.0",
});

function openFolder(folderPath, { _spawn = spawn } = {}) {
	return new Promise((resolve, reject) => {
		let command = "xdg-open";
		let args = [folderPath];

		if (process.platform === "darwin") {
			command = "open";
		} else if (process.platform === "win32") {
			command = "cmd";
			args = ["/c", "start", "", folderPath];
		}

		const child = _spawn(command, args, { stdio: "ignore" });
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0 || code === null) {
				resolve({ command, args });
				return;
			}
			reject(new Error(`Failed to open folder (exit ${code})`));
		});
	});
}

// friendly_web_fetch - Fetch a web page and return its content
server.registerTool(
	"friendly_web_fetch",
	{
		title: "Fetch Web Page",
		description:
			"Fetch a web page and return its content as markdown (with links), plain text, or HTML. " +
			"Returns page metadata (og:tags, author, canonical URL). " +
			"For PDFs, pagination, or searching within content, use friendly_web_extract instead.",
		inputSchema: {
			url: z.string().url().describe("The URL to fetch"),
			outputFormat: z
				.enum(["markdown", "text", "html"])
				.optional()
				.describe("Output format (default: markdown)"),
			waitMs: z
				.number()
				.int()
				.nonnegative()
				.optional()
				.describe(
					"Extra milliseconds to wait after page load (for dynamic content)",
				),
			timeoutMs: z
				.number()
				.int()
				.positive()
				.optional()
				.describe("Maximum time to wait for page load (default: 15000)"),
			maxChars: z
				.number()
				.int()
				.positive()
				.optional()
				.describe("Maximum characters to return (default: 40000)"),
			includeHtml: z
				.boolean()
				.optional()
				.describe("Also return the raw HTML (default: false)"),
			headless: z
				.boolean()
				.optional()
				.describe("Run browser without UI (default: true)"),
		},
	},
	async (args) => {
		try {
			const result = await fetchWebPage(args);
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				content: [{ type: "text", text: `Error fetching page: ${message}` }],
				isError: true,
			};
		}
	},
);

// friendly_search - Search the web using a search engine
server.registerTool(
	"friendly_search",
	{
		title: "Search the Web",
		description:
			"Search the web using a search engine and get a list of results with titles, URLs, and snippets.",
		inputSchema: {
			query: z.string().min(1).describe("The search query"),
			engine: z
				.enum(["duckduckgo", "google"])
				.optional()
				.describe("Search engine to use (default: duckduckgo)"),
			maxResults: z
				.number()
				.int()
				.positive()
				.max(50)
				.optional()
				.describe("Maximum number of results to return (default: 10, max: 50)"),
			timeoutMs: z
				.number()
				.int()
				.positive()
				.optional()
				.describe("Maximum time to wait for results (default: 15000)"),
			headless: z
				.boolean()
				.optional()
				.describe("Run browser without UI (default: true)"),
		},
	},
	async (args) => {
		try {
			const result = await searchWeb({
				...args,
				engine: args.engine,
			});
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				content: [{ type: "text", text: `Error searching: ${message}` }],
				isError: true,
			};
		}
	},
);

// friendly_web_extract - Extract content from a URL (auto-detects PDF vs web page)
server.registerTool(
	"friendly_web_extract",
	{
		title: "Extract from URL",
		description:
			"Extract content from a URL (auto-detects PDF vs web page). " +
			"For PDFs, returns text with metadata like title, author, and page count. " +
			"For web pages, extracts main content using Readability.",
		inputSchema: {
			url: z.string().url().describe("The URL to fetch (PDF or web page)"),
			maxChars: z
				.number()
				.int()
				.positive()
				.optional()
				.describe("Maximum characters to return (default: 40000)"),
			offset: z
				.number()
				.int()
				.nonnegative()
				.optional()
				.describe("Character offset to start from (default: 0)"),
			search: z
				.string()
				.optional()
				.describe(
					"Search for a phrase and return matches with context instead of full content",
				),
			contextChars: z
				.number()
				.int()
				.positive()
				.optional()
				.describe(
					"Characters of context around each search match (default: 200)",
				),
			// Web-specific options (ignored for PDFs)
			waitMs: z
				.number()
				.int()
				.nonnegative()
				.optional()
				.describe(
					"Extra milliseconds to wait after page load for dynamic content (web only)",
				),
			timeoutMs: z
				.number()
				.int()
				.positive()
				.optional()
				.describe(
					"Maximum time to wait for page load (default: 15000, web only)",
				),
			headless: z
				.boolean()
				.optional()
				.describe("Run browser without UI (default: true, web only)"),
		},
	},
	async (args) => {
		try {
			const result = await extractFromUrl(args);
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				content: [
					{ type: "text", text: `Error extracting content: ${message}` },
				],
				isError: true,
			};
		}
	},
);

// friendly_web_ask - Ask questions about a URL (auto-detects PDF vs web page)
server.registerTool(
	"friendly_web_ask",
	{
		title: "Ask about URL",
		description:
			"Fetch a URL (PDF or web page) and have an LLM answer questions about it. " +
			"Auto-detects content type. Keeps document out of main context.",
		inputSchema: {
			url: z.string().url().describe("The URL to fetch (PDF or web page)"),
			ask: z
				.string()
				.describe(
					"Question or instruction for the LLM (e.g., summarize, extract key points, answer a question). " +
						"Write the request as if addressing the entire document, " +
						"even when using askSplitAndSynthesize - chunking is handled automatically.",
				),
			askTimeout: z
				.number()
				.int()
				.positive()
				.optional()
				.describe(
					"Timeout in milliseconds for LLM processing (default: 300000 = 5 minutes)",
				),
			askMaxInputTokens: z
				.number()
				.int()
				.positive()
				.optional()
				.describe(
					"Maximum estimated input tokens (document + prompt). " +
						"Default 150000. Reduce for smaller context models.",
				),
			askMaxOutputTokens: z
				.number()
				.int()
				.positive()
				.optional()
				.describe("Maximum output tokens (model response). Default 4096."),
			askSplitAndSynthesize: z
				.boolean()
				.optional()
				.describe(
					"For large documents exceeding askMaxInputTokens: split into chunks, " +
						"process each, then synthesize results. WARNING: This can consume " +
						"many tokens (roughly 2x document size + synthesis). " +
						"Max document size: 20 MB. Default: false.",
				),
			// Web-specific options (ignored for PDFs)
			waitMs: z
				.number()
				.int()
				.nonnegative()
				.optional()
				.describe(
					"Extra milliseconds to wait after page load for dynamic content (web only)",
				),
			timeoutMs: z
				.number()
				.int()
				.positive()
				.optional()
				.describe(
					"Maximum time to wait for page load (default: 15000, web only)",
				),
			headless: z
				.boolean()
				.optional()
				.describe("Run browser without UI (default: true, web only)"),
		},
	},
	async (args) => {
		try {
			const result = await askWeb({ ...args, _server: server });
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				content: [{ type: "text", text: `Error asking about URL: ${message}` }],
				isError: true,
			};
		}
	},
);

// stash-process-inbox - Process documents in the inbox
server.registerTool(
	"stash_process_inbox",
	{
		title: "Process Stash Inbox",
		description:
			"Process documents in the inbox folder (~/.research-friend/inbox/). " +
			"Extracts text, classifies topics using LLM, and stores in the stash.",
		inputSchema: {},
	},
	async () => {
		try {
			const result = await processInbox({
				_server: server,
				_db: getDatabase(),
				_stashRoot: getStashRoot(),
			});
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				content: [{ type: "text", text: `Error processing inbox: ${message}` }],
				isError: true,
			};
		}
	},
);

// reindex-stash - Reindex documents in the stash
server.registerTool(
	"reindex_stash",
	{
		title: "Reindex Stash",
		description:
			"Regenerate summaries, re-allocate topics, and update store metadata for stashed documents. " +
			"If ids is omitted or empty, reindexes all documents.",
		inputSchema: {
			ids: z
				.array(z.number().int().positive())
				.optional()
				.describe(
					"Document IDs to reindex. If omitted or empty, all documents are reindexed.",
				),
		},
	},
	async (args) => {
		try {
			const result = await reindexStash({
				...args,
				_server: server,
				_db: getDatabase(),
				_stashRoot: getStashRoot(),
			});
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				content: [{ type: "text", text: `Error reindexing stash: ${message}` }],
				isError: true,
			};
		}
	},
);

// stash-open-inbox - Open the stash inbox folder
server.registerTool(
	"stash_open_inbox",
	{
		title: "Open Stash Inbox",
		description:
			"Open the stash inbox folder in your file manager for easier drag-and-drop.",
		inputSchema: {},
	},
	async () => {
		try {
			const inboxPath = getInboxPath(getStashRoot());
			const { command, args } = await openFolder(inboxPath);
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{ opened: true, inboxPath, command, args },
							null,
							2,
						),
					},
				],
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				content: [{ type: "text", text: `Error opening inbox: ${message}` }],
				isError: true,
			};
		}
	},
);

// stash-search - Search documents in the stash
server.registerTool(
	"stash_search",
	{
		title: "Search Stash",
		description:
			"Search filenames and content in the stash. " +
			"Returns matching documents with snippets. " +
			"Filename matches are listed first.",
		inputSchema: {
			query: z.string().min(1).describe("The search query"),
			topic: z
				.string()
				.optional()
				.describe("Filter results to a specific topic"),
			ids: z
				.array(z.number().int().positive())
				.optional()
				.describe("Filter results to specific document IDs"),
			limit: z
				.number()
				.int()
				.positive()
				.max(100)
				.optional()
				.describe("Maximum number of documents to return (default: 20)"),
			offset: z
				.number()
				.int()
				.nonnegative()
				.optional()
				.describe("Number of documents to skip (default: 0)"),
			maxMatchesPerDoc: z
				.number()
				.int()
				.positive()
				.max(500)
				.optional()
				.describe("Maximum matches per document (default: 50)"),
			context: z
				.number()
				.int()
				.nonnegative()
				.max(5)
				.optional()
				.describe(
					"Lines of context around each match (default: 1, max: 5). Controls both how close terms must appear to match AND how much surrounding text is returned.",
				),
		},
	},
	async (args) => {
		try {
			const result = await searchStash({
				...args,
				_db: getDatabase(),
				_stashRoot: getStashRoot(),
			});
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				content: [{ type: "text", text: `Error searching stash: ${message}` }],
				isError: true,
			};
		}
	},
);

// stash-extract - Extract content from a stashed document
server.registerTool(
	"stash_extract",
	{
		title: "Extract from Stash",
		description:
			"Retrieve content from a stashed document. " +
			"Supports pagination by character offset or line number. " +
			"Use line numbers from stash_search results to jump to matches.",
		inputSchema: {
			id: z.number().int().positive().describe("The document ID"),
			maxChars: z
				.number()
				.int()
				.positive()
				.optional()
				.describe("Maximum characters to return (default: 40000)"),
			offset: z
				.number()
				.int()
				.nonnegative()
				.optional()
				.describe(
					"Character offset to start from (mutually exclusive with 'line')",
				),
			line: z
				.number()
				.int()
				.positive()
				.optional()
				.describe(
					"Line number to start from (mutually exclusive with 'offset')",
				),
		},
	},
	async (args) => {
		try {
			const result = await extractFromStash({
				...args,
				_db: getDatabase(),
				_stashRoot: getStashRoot(),
			});
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				content: [
					{ type: "text", text: `Error extracting from stash: ${message}` },
				],
				isError: true,
			};
		}
	},
);

// stash-ask - Ask questions about a stashed document
server.registerTool(
	"stash_ask",
	{
		title: "Ask about Stashed Document",
		description:
			"Have an LLM answer questions about a stashed document. " +
			"Keeps document out of main context.",
		inputSchema: {
			id: z.number().int().positive().describe("The document ID"),
			ask: z
				.string()
				.describe(
					"Question or instruction for the LLM (e.g., summarize, extract info, answer a question). " +
						"Write the request as if addressing the entire document, " +
						"even when using askSplitAndSynthesize - chunking is handled automatically.",
				),
			askTimeout: z
				.number()
				.int()
				.positive()
				.optional()
				.describe(
					"Timeout in milliseconds for LLM processing (default: 300000 = 5 minutes)",
				),
			askMaxInputTokens: z
				.number()
				.int()
				.positive()
				.optional()
				.describe(
					"Maximum estimated input tokens (document + prompt). " +
						"Default 150000. Reduce for smaller context models.",
				),
			askMaxOutputTokens: z
				.number()
				.int()
				.positive()
				.optional()
				.describe("Maximum output tokens (model response). Default 4096."),
			askSplitAndSynthesize: z
				.boolean()
				.optional()
				.describe(
					"For large documents exceeding askMaxInputTokens: split into chunks, " +
						"process each, then synthesize results. WARNING: This can consume " +
						"many tokens (roughly 2x document size + synthesis). " +
						"Max document size: 20 MB. Default: false.",
				),
		},
	},
	async (args) => {
		try {
			const result = await askStashDocument({
				...args,
				_db: getDatabase(),
				_server: server,
				_stashRoot: getStashRoot(),
			});
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				content: [
					{
						type: "text",
						text: `Error asking about stash document: ${message}`,
					},
				],
				isError: true,
			};
		}
	},
);

// stash-list - List topics or documents in the stash
server.registerTool(
	"stash_list",
	{
		title: "List Stash",
		description:
			"List topics in the stash (with document counts), or list documents in a specific topic.",
		inputSchema: {
			topic: z
				.string()
				.optional()
				.describe(
					"Topic to list documents for. If omitted, lists all topics with counts.",
				),
			limit: z
				.number()
				.int()
				.positive()
				.max(100)
				.optional()
				.describe("Maximum number of documents to return (default: 50)"),
			offset: z
				.number()
				.int()
				.nonnegative()
				.optional()
				.describe("Number of documents to skip (default: 0)"),
		},
	},
	async (args) => {
		try {
			const result = listStash({ ...args, _db: getDatabase() });
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				content: [{ type: "text", text: `Error listing stash: ${message}` }],
				isError: true,
			};
		}
	},
);

// update-stash prompt - Entry point for inbox processing
server.registerPrompt(
	"update-stash",
	{
		title: "Update Stash",
		description:
			"Process new documents in the inbox and add them to the research stash.",
	},
	async () => ({
		messages: [
			{
				role: "user",
				content: {
					type: "text",
					text: "Process any documents in my research stash inbox. Use the stash_process_inbox tool to extract, classify, and store them. Then show me a summary of what was processed.",
				},
			},
		],
	}),
);

// Initialize stash directories and database
await initializeStash();

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);
