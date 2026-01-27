import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { fetchWebPage } from "./web-fetch.js";
import { searchWeb } from "./web-search.js";
import { fetchPdf } from "./pdf-fetch.js";

const server = new McpServer({
	name: "research-friend",
	version: "0.1.0",
});

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
					"Have an LLM process the PDF with this instruction (e.g., summarize, extract key points, answer a question). Keeps PDF out of main context.",
				),
			askTimeout: z
				.number()
				.int()
				.positive()
				.optional()
				.describe(
					"Timeout in milliseconds for 'ask' mode LLM processing (default: 300000 = 5 minutes)",
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

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);
