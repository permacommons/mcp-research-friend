import { spawn } from "node:child_process";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { fetchPdf } from "./pdf-fetch.js";
import {
	extractFromStash,
	getDatabase,
	getStashRoot,
	initializeStash,
	listStash,
	processInbox,
	searchStash,
} from "./stash/index.js";
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

// friendly_fetch - Fetch and extract content from a web page
server.registerTool(
	"friendly_fetch",
	{
		title: "Fetch Web Page",
		description:
			"Fetch a web page and extract its content as markdown (with links), plain text, or HTML. " +
			"Uses Readability to extract the main content and a real browser (Playwright) for JavaScript-heavy sites.",
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

// friendly_pdf_extract - Fetch and extract text from a PDF
server.registerTool(
	"friendly_pdf_extract",
	{
		title: "Fetch PDF",
		description:
			"Fetch a PDF from a URL and extract its text content. " +
			"Returns the text along with metadata like title, author, and page count. " +
			"Use 'ask' to have an LLM answer questions about the PDF without loading it into your context.",
		inputSchema: {
			url: z.string().url().describe("The URL of the PDF to fetch"),
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
			ask: z
				.string()
				.optional()
				.describe(
					"Have an LLM process the document with this request (e.g., summarize, extract key points, answer a question). " +
						"Keeps document out of main context. Write the request as if addressing the entire document, " +
						"even when using askSplitAndSynthesize - chunking is handled automatically.",
				),
			askTimeout: z
				.number()
				.int()
				.positive()
				.optional()
				.describe(
					"Timeout in milliseconds for 'ask' mode LLM processing (default: 300000 = 5 minutes)",
				),
			askMaxInputTokens: z
				.number()
				.int()
				.positive()
				.optional()
				.describe(
					"Maximum estimated input tokens for ask mode (document + prompt). " +
						"Default 150000. Reduce for smaller context models.",
				),
			askMaxOutputTokens: z
				.number()
				.int()
				.positive()
				.optional()
				.describe(
					"Maximum output tokens for ask mode (model response). Default 4096.",
				),
			askSplitAndSynthesize: z
				.boolean()
				.optional()
				.describe(
					"For large documents exceeding askMaxInputTokens: split into chunks, " +
						"process each, then synthesize results. WARNING: This can consume " +
						"many tokens (roughly 2x document size + synthesis). " +
						"Max document size: 20 MB. Default: false.",
				),
			contextChars: z
				.number()
				.int()
				.positive()
				.optional()
				.describe(
					"Characters of context around each search match (default: 200)",
				),
		},
	},
	async (args) => {
		try {
			const result = await fetchPdf({ ...args, _server: server });
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				content: [{ type: "text", text: `Error fetching PDF: ${message}` }],
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
			const inboxPath = path.join(getStashRoot(), "inbox");
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
			"Search documents in the stash using full-text search. " +
			"Returns matching documents with snippets and relevance ranking.",
		inputSchema: {
			query: z.string().min(1).describe("The search query"),
			topic: z
				.string()
				.optional()
				.describe("Filter results to a specific topic"),
			limit: z
				.number()
				.int()
				.positive()
				.max(100)
				.optional()
				.describe("Maximum number of results (default: 20)"),
			offset: z
				.number()
				.int()
				.nonnegative()
				.optional()
				.describe("Number of results to skip (default: 0)"),
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
			"Supports pagination, search within document, and LLM-powered ask mode.",
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
				.describe("Character offset to start from (default: 0)"),
			search: z
				.string()
				.optional()
				.describe(
					"Search for a phrase and return matches with context instead of full content",
				),
			ask: z
				.string()
				.optional()
				.describe(
					"Have an LLM process the document with this request (e.g., summarize, extract info, answer a question). " +
						"Keeps document out of main context. Write the request as if addressing the entire document, " +
						"even when using askSplitAndSynthesize - chunking is handled automatically.",
				),
			askTimeout: z
				.number()
				.int()
				.positive()
				.optional()
				.describe(
					"Timeout in milliseconds for 'ask' mode LLM processing (default: 300000 = 5 minutes)",
				),
			askMaxInputTokens: z
				.number()
				.int()
				.positive()
				.optional()
				.describe(
					"Maximum estimated input tokens for ask mode (document + prompt). " +
						"Default 150000. Reduce for smaller context models.",
				),
			askMaxOutputTokens: z
				.number()
				.int()
				.positive()
				.optional()
				.describe(
					"Maximum output tokens for ask mode (model response). Default 4096.",
				),
			askSplitAndSynthesize: z
				.boolean()
				.optional()
				.describe(
					"For large documents exceeding askMaxInputTokens: split into chunks, " +
						"process each, then synthesize results. WARNING: This can consume " +
						"many tokens (roughly 2x document size + synthesis). " +
						"Max document size: 20 MB. Default: false.",
				),
			contextChars: z
				.number()
				.int()
				.positive()
				.optional()
				.describe(
					"Characters of context around each search match (default: 200)",
				),
		},
	},
	async (args) => {
		try {
			const result = await extractFromStash({
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
					{ type: "text", text: `Error extracting from stash: ${message}` },
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
