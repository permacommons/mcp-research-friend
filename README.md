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

#### friendly_fetch

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

#### friendly_pdf_extract

Fetches a PDF from a URL and extracts its text content.

**Parameters:**
- `url` (required) - The URL of the PDF to fetch
- `maxChars` - Maximum amount of text to return (default: 40,000 characters)
- `offset` - Character position to start from (default: 0). Use this to paginate through large PDFs.
- `search` - Search for a phrase and return matches with surrounding context instead of full content
- `ask` - Have an LLM process the document with an instruction (see below)
- `askMaxInputTokens` - Maximum input tokens per LLM call (default: 150,000)
- `askMaxOutputTokens` - Maximum output tokens per LLM call (default: 4,096)
- `askTimeout` - Timeout in milliseconds for `ask` mode (default: 300,000 = 5 minutes)
- `askSplitAndSynthesize` - For large documents: split into chunks, process each, then synthesize results (default: false). Warning: consumes many tokens.
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
- `chunksProcessed` - Number of chunks processed (1 for small documents, more when using `askSplitAndSynthesize`)

**Ask mode** uses MCP sampling to have an LLM process the document with any instruction — summarize, extract information, answer questions, generate a FAQ, etc. The document content is sent to the LLM in a separate context, keeping your main conversation context compact. This is useful for:
- Large documents that would overwhelm context
- Multiple operations on the same document (the document is cached)
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

**Returns:**
- `processed` - Number of files processed
- `skipped` - Number of files skipped
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

Search filenames and content across the stash. Quoted phrases are supported.

**Parameters:**
- `query` (required) - Search terms (use quotes for phrases)
- `topic` - Filter to a topic (optional)
- `limit` - Max results (default: 20)
- `offset` - Pagination offset (default: 0)
- `contextLines` - Lines of context for matches (default: 2)

**Returns:**
- `totalMatches` - Total matches found before pagination
- `count` - Results returned after pagination
- `results` - Documents with `matchType`, `matchCount`, and `snippet`

#### stash_extract

Extract content from a stashed document for reading or question answering.

**Parameters:**
- `id` (required) - Document ID from `stash_list`/`stash_search`
- `maxChars`, `offset`, `search`, `contextChars` - Same behavior as `friendly_pdf_extract`
- `ask`, `askMaxInputTokens`, `askMaxOutputTokens`, `askTimeout`, `askSplitAndSynthesize` - Same behavior as `friendly_pdf_extract`

### Typical flow

1. Drop files into `~/.research-friend/inbox/`
2. Run `stash_process_inbox`
3. Use `stash_list` to browse topics
4. Use `stash_search` to find relevant docs
5. Use `stash_extract` to read or ask questions about a specific doc

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
