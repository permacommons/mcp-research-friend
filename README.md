# Research Friend

A friendly helper for AI assistants that need to look things up on the web.

Research Friend is an MCP server that gives your AI tools the ability to fetch web pages and search the internet. It uses a real web browser behind the scenes, so it works even with modern websites that rely heavily on JavaScript.

## What can it do?

- **Fetch web pages** - Give it a URL and it'll grab the page content, title, and metadata
- **Search the web** - Ask it to search DuckDuckGo and get back a list of results

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

### web_fetch

Fetches a web page and extracts its content.

**Parameters:**
- `url` (required) - The web address to fetch
- `waitMs` - Extra time to wait after the page loads, in case content appears slowly
- `timeoutMs` - How long to wait before giving up (default: 15 seconds)
- `maxChars` - Maximum amount of text to return (default: 40,000 characters)
- `includeHtml` - Set to `true` if you also want the raw HTML
- `headless` - Set to `false` to see the browser window (useful for debugging)

### web_search

Searches the web and returns a list of results.

**Parameters:**
- `query` (required) - What to search for
- `engine` - Which search engine to use (`duckduckgo`, `google`, or `bing`)
- `maxResults` - How many results to return (default: 10, maximum: 50)
- `timeoutMs` - How long to wait before giving up (default: 15 seconds)
- `headless` - Set to `false` to see the browser window

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
