import { chromium } from 'playwright';

async function searchDuckDuckGo(
  query,
  maxResults,
  timeoutMs,
  headless
) {
  const browser = await chromium.launch({ headless });
  const page = await browser.newPage();

  try {
    const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&t=h_&ia=web`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });

    // Wait for results to load
    await page.waitForSelector('[data-testid="result"]', { timeout: timeoutMs }).catch(() => {
      // Results might not appear if no matches, that's okay
    });

    // Extract search results
    const results = await page.evaluate((max) => {
      const items = [];
      const resultElements = document.querySelectorAll('[data-testid="result"]');

      for (const el of resultElements) {
        if (items.length >= max) break;

        const titleEl = el.querySelector('[data-testid="result-title-a"]');
        const snippetEl = el.querySelector('[data-testid="result-snippet"]');

        if (titleEl) {
          items.push({
            title: titleEl.textContent?.trim() || '',
            url: titleEl.getAttribute('href') || '',
            snippet: snippetEl?.textContent?.trim() || '',
          });
        }
      }

      return items;
    }, maxResults);

    // Capture HTML if no results found
    let html;
    if (results.length === 0) {
        html = await page.content();
    }

    return { results, html };
  } finally {
    await page.close();
    await browser.close();
  }
}

async function searchGoogle(
  query,
  maxResults,
  timeoutMs,
  headless
) {
  const browser = await chromium.launch({ headless });
  const page = await browser.newPage();

  try {
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });

    // Wait for search results to load using a semantic selector (a > h3)
    // This is robust against class name changes.
    await page.waitForFunction(() => document.querySelectorAll('a > h3').length >= 3, { timeout: timeoutMs }).catch(() => {});

    const results = await page.evaluate((max) => {
      const items = [];
      // Find all H3s inside A tags - this is the semantic structure of a result title
      const titleElements = document.querySelectorAll('a h3');

      for (const titleEl of titleElements) {
        if (items.length >= max) break;
        
        const linkEl = titleEl.closest('a');
        if (!linkEl) continue;

        const url = linkEl.getAttribute('href') || '';
        // Filter out internal Google links or empty URLs
        if (!url || url.startsWith('/search') || url.includes('google.com/search')) continue;

        const title = titleEl.innerText?.trim() || '';
        
        // Snippet Extraction
        let snippet = '';
        let resultContainer = linkEl.parentElement;
        // Go up to find a container that likely holds the whole result
        for (let i = 0; i < 5; i++) {
            if (resultContainer && resultContainer.parentElement && resultContainer.parentElement.tagName !== 'BODY') {
                resultContainer = resultContainer.parentElement;
            }
        }
        
        if (resultContainer) {
            const textBlocks = Array.from(resultContainer.querySelectorAll('div, span, p'))
                .map(el => el.innerText?.trim())
                .filter(txt => txt && txt.length > 30 && txt !== title && !txt.includes('›'));
            
            // The actual snippet is usually the longest remaining text block
            if (textBlocks.length > 0) {
                snippet = textBlocks.reduce((a, b) => a.length > b.length ? a : b);
            }
        }

        if (title && url) {
            items.push({ title, url, snippet });
        }
      }
      return items;
    }, maxResults);

    // Capture HTML if no results found
    let html;
    if (results.length === 0) {
        html = await page.content();
    }

    return { results, html };
  } finally {
    await page.close();
    await browser.close();
  }
}

async function searchBing(
  query,
  maxResults,
  timeoutMs,
  headless
) {
  const browser = await chromium.launch({ headless });
  const page = await browser.newPage();

  try {
    const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });

    await page.waitForSelector('#b_results', { timeout: timeoutMs }).catch(() => {});

    const results = await page.evaluate((max) => {
      const items = [];
      const resultElements = document.querySelectorAll('.b_algo');

      for (const el of resultElements) {
        if (items.length >= max) break;

        const titleEl = el.querySelector('h2 a');
        const snippetEl = el.querySelector('.b_caption p');

        if (titleEl) {
          items.push({
            title: titleEl.textContent?.trim() || '',
            url: titleEl.getAttribute('href') || '',
            snippet: snippetEl?.textContent?.trim() || '',
          });
        }
      }
      return items;
    }, maxResults);

    // Capture HTML if no results found
    let html;
    if (results.length === 0) {
        html = await page.content();
    }

    return { results, html };
  } finally {
    await page.close();
    await browser.close();
  }
}

export async function searchWeb({
  query,
  engine = 'duckduckgo',
  maxResults = 10,
  timeoutMs = 15000,
  headless = true,
}) {
  let output;

  switch (engine) {
    case 'duckduckgo':
      output = await searchDuckDuckGo(query, maxResults, timeoutMs, headless);
      break;
    case 'google':
      output = await searchGoogle(query, maxResults, timeoutMs, headless);
      break;
    case 'bing':
      output = await searchBing(query, maxResults, timeoutMs, headless);
      break;
    default:
      throw new Error(`Unknown search engine: ${engine}`);
  }

  return {
    query,
    engine,
    results: output.results,
    searchedAt: new Date().toISOString(),
    fallback_result_html: output.html,
  };
}