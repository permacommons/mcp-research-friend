# Research Friend

A friendly helper for AI assistants that need to look things up on the web.

Research Friend is an MCP server that gives your AI tools the ability to fetch web pages and search the internet. It uses a real web browser behind the scenes, so it works even with modern websites that rely heavily on JavaScript.

## What can it do?

- **Fetch web pages** - Give it a URL and it'll grab the page content as markdown, with links preserved
- **Fetch PDFs** - Download a PDF and extract its text content
- **Search the web** - Search DuckDuckGo or Google and get back a list of results

## Getting started

You'll need [Node.js](https://nodejs.org/) version 20 or newer installed on your computer.

### 1. Install dependencies

Open a terminal in this folder and run:

```
npm install
```

### 2. Install browser support

Research Friend uses Playwright to control a web browser. After installing dependencies, you'll need to install the browser:

```
npx playwright install chromium
```

This downloads a copy of Chromium that Playwright will use. It's separate from any browsers you already have installed.

### 3. Try it out

You can start the server with:

```
node src/index.js
```

The server communicates over stdio (standard input/output), which is how MCP clients connect to it.

## Adding to your MCP client

How you add Research Friend depends on which MCP client you're using. Here's a general example of what the configuration might look like:

```json
{
  "mcpServers": {
    "research-friend": {
      "command": "node",
      "args": ["src/index.js"],
      "cwd": "/path/to/mcp-research-friend"
    }
  }
}
```

Replace `/path/to/mcp-research-friend` with the actual path to this folder on your computer.

## Available tools

### friendly_fetch

Fetches a web page and extracts its content. By default, returns markdown with links preserved — ideal for LLMs. Uses [Readability](https://github.com/mozilla/readability) to extract the main content (stripping navigation, ads, etc.).

**Parameters:**
- `url` (required) - The web address to fetch
- `outputFormat` - Output format: `markdown` (default), `text`, or `html`
- `waitMs` - Extra time to wait after the page loads, in case content appears slowly
- `timeoutMs` - How long to wait before giving up (default: 15 seconds)
- `maxChars` - Maximum amount of content to return (default: 40,000 characters)
- `includeHtml` - Set to `true` to also return the raw HTML alongside the content
- `headless` - Set to `false` to see the browser window (useful for debugging)

**Returns:**
- `url` - The URL that was requested
- `finalUrl` - The URL after any redirects
- `title` - The page title
- `content` - The extracted content (in the requested format)
- `html` - Raw HTML (only if `includeHtml` is true)
- `meta` - Page metadata (description, author, published time, etc.)
- `fetchedAt` - ISO timestamp of when the page was fetched
- `truncated` - Whether the content was truncated to fit `maxChars`

### friendly_search

Searches the web and returns a list of results.

**Parameters:**
- `query` (required) - What to search for
- `engine` - Which search engine to use (`duckduckgo` or `google`)
- `maxResults` - How many results to return (default: 10, maximum: 50)
- `timeoutMs` - How long to wait before giving up (default: 15 seconds)
- `headless` - Set to `false` to see the browser window

**Returns:**
- `query` - The search query that was used
- `engine` - Which search engine was used
- `results` - Array of results, each with `title`, `url`, and `snippet`
- `searchedAt` - ISO timestamp of when the search was performed
- `fallback_result_html` - Raw HTML of the page (only included if no results were found)
- `debug_info` - Diagnostic information about the search attempt

**CAPTCHA handling:**
If a CAPTCHA is detected while running in headless mode, the tool automatically retries with a visible browser window. This gives you a chance to solve the CAPTCHA manually. The `debug_info.retried` field indicates whether this fallback was used.

### friendly_pdf_extract

Fetches a PDF from a URL and extracts its text content.

**Parameters:**
- `url` (required) - The URL of the PDF to fetch
- `maxChars` - Maximum amount of text to return (default: 40,000 characters)
- `offset` - Character position to start from (default: 0). Use this to paginate through large PDFs.
- `search` - Search for a phrase and return matches with surrounding context instead of full content
- `ask` - Have an LLM process the PDF with an instruction (see below)
- `contextChars` - Characters of context around each search match (default: 200)

**Returns (normal mode):**
- `url` - The URL that was requested
- `title` - The PDF title (from metadata, if available)
- `author` - The PDF author (from metadata, if available)
- `creationDate` - When the PDF was created (from metadata, if available)
- `pageCount` - Number of pages in the PDF
- `totalChars` - Total characters in the PDF (use with `offset` to paginate)
- `offset` - The offset that was used
- `content` - The extracted text content
- `fetchedAt` - ISO timestamp of when the PDF was fetched
- `truncated` - Whether more content remains after this chunk

**Returns (search mode):**
- `url`, `title`, `author`, `pageCount`, `totalChars`, `fetchedAt` - Same as above
- `search` - The search phrase that was used
- `matchCount` - Number of matches found
- `matches` - Array of matches, each with `position`, `context`, `prefix`, and `suffix`

**Returns (ask mode):**
- `url`, `title`, `author`, `pageCount`, `totalChars`, `fetchedAt` - Same as above
- `ask` - The instruction that was given
- `answer` - The LLM's response
- `model` - The model that generated the response

**Ask mode** uses MCP sampling to have an LLM process the PDF with any instruction — summarize, extract information, answer questions, generate a FAQ, etc. The PDF content is sent to the LLM in a separate context, keeping your main conversation context compact. This is useful for:
- Large PDFs that would overwhelm context
- Multiple operations on the same document (the PDF is cached)
- Keeping token costs down on the main conversation

## Troubleshooting

### "Browser closed unexpectedly" or similar errors

Try reinstalling the browser:

```
npx playwright install chromium --force
```

On Linux, you might also need system dependencies:

```
npx playwright install-deps chromium
```

### The server won't start

Make sure you're using Node.js 20 or newer:

```
node --version
```

If your version is older, visit [nodejs.org](https://nodejs.org/) to download a newer one.

## License

MIT
