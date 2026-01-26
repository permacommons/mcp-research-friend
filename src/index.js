import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { fetchWebPage } from './web-fetch.js';
import { searchWeb } from './web-search.js';

const server = new McpServer({
  name: 'research-friend',
  version: '0.1.0',
});

// web_fetch - Fetch and extract content from a web page
server.registerTool(
  'web_fetch',
  {
    title: 'Fetch Web Page',
    description:
      'Fetch a web page and extract its text content, title, and metadata. ' +
      'Uses a real browser (Playwright) so it works with JavaScript-heavy sites.',
    inputSchema: {
      url: z.string().url().describe('The URL to fetch'),
      waitMs: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe('Extra milliseconds to wait after page load (for dynamic content)'),
      timeoutMs: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Maximum time to wait for page load (default: 15000)'),
      maxChars: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Maximum characters to return (default: 40000)'),
      includeHtml: z.boolean().optional().describe('Also return the raw HTML (default: false)'),
      headless: z.boolean().optional().describe('Run browser without UI (default: true)'),
    },
  },
  async args => {
    try {
      const result = await fetchWebPage(args);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error fetching page: ${message}` }],
        isError: true,
      };
    }
  }
);

// web_search - Search the web using a search engine
server.registerTool(
  'web_search',
  {
    title: 'Search the Web',
    description:
      'Search the web using a search engine and get a list of results with titles, URLs, and snippets.',
    inputSchema: {
      query: z.string().min(1).describe('The search query'),
      engine: z
        .enum(['duckduckgo', 'google'])
        .optional()
        .describe('Search engine to use (default: duckduckgo)'),
      maxResults: z
        .number()
        .int()
        .positive()
        .max(50)
        .optional()
        .describe('Maximum number of results to return (default: 10, max: 50)'),
      timeoutMs: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Maximum time to wait for results (default: 15000)'),
      headless: z.boolean().optional().describe('Run browser without UI (default: true)'),
    },
  },
  async args => {
    try {
      const result = await searchWeb({
        ...args,
        engine: args.engine,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error searching: ${message}` }],
        isError: true,
      };
    }
  }
);

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);
