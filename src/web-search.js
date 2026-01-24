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

    return results;
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

    await page.waitForSelector('#search', { timeout: timeoutMs }).catch(() => {});

    const results = await page.evaluate((max) => {
      const items = [];
      const resultElements = document.querySelectorAll('.g');

      for (const el of resultElements) {
        if (items.length >= max) break;
        
        const titleEl = el.querySelector('h3');
        const linkEl = el.querySelector('a');
        
        // Try to find snippet
        let snippet = '';
        const snippetEl = el.querySelector('[style*="-webkit-line-clamp"]');
        if (snippetEl) {
          snippet = snippetEl.textContent?.trim() || '';
        } else {
           // Fallback
           const text = el.innerText || '';
           const lines = text.split('\n');
           // Very rough heuristic
           if (lines.length > 2) snippet = lines.find(l => l.length > 50) || '';
        }

        if (titleEl && linkEl) {
            items.push({
            title: titleEl.textContent?.trim() || '',
            url: linkEl.getAttribute('href') || '',
            snippet: snippet,
            });
        }
      }
      return items;
    }, maxResults);

    return results;
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

    return results;
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
  let results;

  switch (engine) {
    case 'duckduckgo':
      results = await searchDuckDuckGo(query, maxResults, timeoutMs, headless);
      break;
    case 'google':
      results = await searchGoogle(query, maxResults, timeoutMs, headless);
      break;
    case 'bing':
      results = await searchBing(query, maxResults, timeoutMs, headless);
      break;
    default:
      throw new Error(`Unknown search engine: ${engine}`);
  }

  return {
    query,
    engine,
    results,
    searchedAt: new Date().toISOString(),
  };
}