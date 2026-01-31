# Research Friend

A friendly helper for AI assistants that need to look things up on the web and manage a local research stash.

Research Friend is an MCP server that gives your AI tools the ability to fetch web pages and search the internet. It uses a real web browser behind the scenes, so it works even with modern websites that rely heavily on JavaScript. It also includes a local “stash” for storing documents, extracting text, and searching across your library.

To make use of all its features, you'll want an MCP client that supports
prompts (common) and sampling (less common). We're building Research Friend
alongside [Chabeau](https://github.com/permacommons/chabeau), which supports
both.

## What can it do?

- **Fetch web pages** with a real browser (including JS-heavy sites)
- **Fetch PDFs** and extract their text content
- **Search the web** via DuckDuckGo or Google
- **Maintain a local stash** of documents for search, listing, and extraction

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

### 3. Start the server

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

## Tools

### Web tools

#### friendly_web_fetch

Fetches a web page and returns its content. By default, returns markdown with links preserved — ideal for LLMs. Uses [Readability](https://github.com/mozilla/readability) to extract the main content (stripping navigation, ads, etc.). For PDFs, pagination, or searching within content, use `friendly_web_extract` instead.

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

#### friendly_search

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

#### friendly_web_extract

Extracts content from a URL. Auto-detects whether the URL points to a PDF or a web page and handles each appropriately.

**Parameters:**
- `url` (required) - The URL to fetch (PDF or web page)
- `maxChars` - Maximum amount of text to return (default: 40,000 characters)
- `offset` - Character position to start from (default: 0). Use this to paginate through large content.
- `search` - Search for a phrase and return matches with surrounding context instead of full content
- `contextChars` - Characters of context around each search match (default: 200)
- `waitMs` - Extra time to wait after page load for dynamic content (web pages only)
- `timeoutMs` - How long to wait before giving up (default: 15 seconds, web pages only)
- `headless` - Set to `false` to see the browser window (web pages only)

**Returns (normal mode):**
- `url` - The URL that was requested
- `contentType` - Either `pdf` or `html`
- `title` - The page/document title
- `author` - The PDF author (PDFs only, if available)
- `creationDate` - When the PDF was created (PDFs only, if available)
- `pageCount` - Number of pages (PDFs only)
- `totalChars` - Total characters (use with `offset` to paginate)
- `offset` - The offset that was used
- `content` - The extracted text content
- `fetchedAt` - ISO timestamp
- `truncated` - Whether more content remains after this chunk

**Returns (search mode):**
- `url`, `contentType`, `title`, `totalChars`, `fetchedAt` - Same as above
- `search` - The search phrase that was used
- `matchCount` - Number of matches found
- `matches` - Array of matches, each with `position`, `context`, `prefix`, and `suffix`

#### friendly_web_ask

Fetches a URL (PDF or web page) and has an LLM answer questions about it. Auto-detects content type. The document is processed in a separate context, keeping your main conversation compact.

**Parameters:**
- `url` (required) - The URL to fetch (PDF or web page)
- `ask` (required) - Question or instruction for the LLM (summarize, extract info, answer questions, etc.)
- `askMaxInputTokens` - Maximum input tokens per LLM call (default: 150,000)
- `askMaxOutputTokens` - Maximum output tokens per LLM call (default: 4,096)
- `askTimeout` - Timeout in milliseconds (default: 300,000 = 5 minutes)
- `askSplitAndSynthesize` - For large documents: split into chunks, process each, then synthesize results (default: false). Warning: consumes many tokens.
- `waitMs` - Extra time to wait after page load for dynamic content (web pages only)
- `timeoutMs` - How long to wait before giving up (default: 15 seconds, web pages only)
- `headless` - Set to `false` to see the browser window (web pages only)

**Returns:**
- `url` - The URL that was requested
- `contentType` - Either `pdf` or `html`
- `title` - The page/document title
- `totalChars` - Total characters in the document
- `ask` - The instruction that was given
- `answer` - The LLM's response
- `model` - The model that generated the response
- `chunksProcessed` - Number of chunks processed (1 for small documents, more when using `askSplitAndSynthesize`)
- `fetchedAt` - ISO timestamp

**Ask mode** uses MCP sampling to have an LLM process the document with any instruction. This is useful for:
- Large documents that would overwhelm context
- Multiple operations on the same document (content is cached)
- Keeping token costs down on the main conversation

When `askSplitAndSynthesize` is enabled, documents exceeding `askMaxInputTokens` are automatically split into overlapping chunks. Each chunk is processed separately, and the results are synthesized into a single coherent answer. The final response is provided in the same language as your request, regardless of the document's language.

## Document stash

The stash is a local, searchable library of documents. It supports PDFs, HTML files, and plaintext (Markdown/TXT). When you add a document, Research Friend stores the original file, extracts text (for PDFs/HTML), and saves metadata in a local database. Searches use ripgrep under the hood for fast, phrase-aware matching.

### Stash location

The stash lives under `~/.research-friend/`:

- `inbox/` - Drop files here to be processed
- `store/` - Organized document storage and extracted text
- `stash.db` - Metadata database

### Supported file types

- PDF: `.pdf` (text extracted)
- HTML: `.html`, `.htm` (text extracted)
- Markdown: `.md`, `.markdown` (stored as plaintext)
- Text: `.txt` (stored as plaintext)

### Stash tools

#### stash_open_inbox

Open the stash inbox folder in your file manager for easier drag-and-drop.

**Returns:**
- `opened` - Whether the folder open request was sent
- `inboxPath` - Absolute path to the inbox
- `command` - OS command used
- `args` - Command arguments used

#### stash_process_inbox

Process files in `inbox/`, classify them into topics, extract text, and store results.
For long documents, classification uses sampled sections (start/middle/end plus a few random chunks) to improve topic accuracy.

**Returns:**
- `processed` - Number of files processed
- `skipped` - Number of files skipped
- `errors` - Any errors encountered

#### reindex_stash

Regenerate summaries, re-allocate topics, and update store metadata for stashed documents. If `ids` is omitted or empty, all documents are reindexed.

**Parameters:**
- `ids` - Document IDs to reindex (optional)

**Returns:**
- `reindexed` - Document IDs reindexed
- `errors` - Any errors encountered

#### stash_list

List documents in the stash.

**Parameters:**
- `topic` - Filter to a topic (optional)
- `limit` - Max results (default: 50)
- `offset` - Pagination offset (default: 0)

**Returns:**
- `type` - `all` or `topic`
- `topics` - Summary of known topics and doc counts
- `documents` - Document list with metadata

#### stash_search

Search filenames and content across the stash. All search terms must be present (AND logic). Filename matches are listed first. Use quotes for exact phrases.

**Parameters:**
- `query` (required) - Search terms. Use quotes for phrases: `"sparkling wine"`
- `topic` - Filter to a topic (optional)
- `ids` - Filter to specific document IDs (optional)
- `limit` - Max documents to return (default: 20)
- `offset` - Pagination offset (default: 0)
- `maxMatchesPerDoc` - Max matches per document (default: 50)
- `context` - Lines of context around each match (default: 1, max: 5). Controls both how close terms must appear to match AND how much surrounding text is returned.

**Returns:**
- `totalMatches` - Total matches found before pagination
- `count` - Results returned after pagination
- `results` - Array of documents, each with:
  - `id`, `filename`, `fileType`, `summary`, `charCount`, `createdAt`
  - `matchType` - `filename`, `content`, or `filename+content`
  - `matches` - Array of `{ line, context }` for each match location

Use the `line` values with `stash_extract` to jump directly to match locations.

#### stash_extract

Extract content from a stashed document for reading. Use line numbers from `stash_search` results to jump directly to matches.

**Parameters:**
- `id` (required) - Document ID from `stash_list`/`stash_search`
- `maxChars` - Maximum amount of text to return (default: 40,000 characters)
- `offset` - Character position to start from (mutually exclusive with `line`)
- `line` - Line number to start from (mutually exclusive with `offset`)

**Returns:**
- `id`, `filename`, `fileType`, `summary` - Document metadata
- `totalChars` - Total characters in the document
- `offset` - Character offset (included when using `line` for reference)
- `line` - Line number (only when `line` parameter was used)
- `content` - The extracted text content
- `truncated` - Whether more content remains after this chunk

#### stash_ask

Have an LLM answer questions about a stashed document. The document is processed in a separate context, keeping your main conversation compact.

**Parameters:**
- `id` (required) - Document ID from `stash_list`/`stash_search`
- `ask` (required) - Question or instruction for the LLM
- `askMaxInputTokens` - Maximum input tokens per LLM call (default: 150,000)
- `askMaxOutputTokens` - Maximum output tokens per LLM call (default: 4,096)
- `askTimeout` - Timeout in milliseconds (default: 300,000 = 5 minutes)
- `askSplitAndSynthesize` - For large documents: split into chunks, process each, then synthesize results (default: false)

**Returns:**
- `id`, `filename`, `fileType`, `summary` - Document metadata
- `totalChars` - Total characters in the document
- `ask` - The instruction that was given
- `answer` - The LLM's response
- `model` - The model that generated the response
- `chunksProcessed` - Number of chunks processed

### Typical flow

1. Drop files into `~/.research-friend/inbox/`
2. Run `stash_process_inbox`
3. Use `stash_list` to browse topics
4. Use `stash_search` to find relevant docs
5. Use `stash_extract` to read a specific doc, or `stash_ask` to ask questions about it

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
