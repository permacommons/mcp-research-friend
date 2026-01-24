import { searchWeb } from './src/web-search.js';

async function run() {
  console.log("Calling web_search with DuckDuckGo...");
  try {
    const result = await searchWeb({
      query: 'Greenland news 2026',
      engine: 'duckduckgo',
      maxResults: 5,
      headless: true,
    });
    console.log("\n--- SEARCH RESULTS ---");
    console.log(JSON.stringify(result, (key, value) => key === 'fallback_result_html' ? undefined : value, 2));
    if (result.results.length === 0 && result.fallback_result_html) {
        import('fs').then(fs => {
            fs.writeFileSync('ddg_error.html', result.fallback_result_html);
            console.log("\nSaved ddg_error.html for inspection.");
        });
    }
    console.log("\nTotal results found:", result.results.length);
  } catch (error) {
    console.error("Search failed:", error);
  }
}

run();
