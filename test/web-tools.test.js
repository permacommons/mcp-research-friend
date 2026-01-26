import { test, describe, it, mock, before } from 'node:test';
import assert from 'node:assert';

// Mock objects
const mockPage = {
  goto: mock.fn(async () => ({})),
  waitForTimeout: mock.fn(async () => {}),
  evaluate: mock.fn(async () => {}),
  title: mock.fn(async () => 'Mock Title'),
  content: mock.fn(async () => '<html>Mock Content</html>'),
  url: mock.fn(() => 'http://example.com/final'),
  waitForSelector: mock.fn(async () => {}),
  waitForFunction: mock.fn(async () => {}),
  close: mock.fn(async () => {}),
  $: mock.fn(async () => null), // Mock finding element (for captcha check)
  innerText: mock.fn(async () => 'Mock Body Text'),
};

const mockBrowser = {
  newPage: mock.fn(async () => mockPage),
  close: mock.fn(async () => {}),
  pages: mock.fn(() => []), // Mock pages() for context cleanup
};

const mockChromium = {
  launch: mock.fn(async () => mockBrowser),
  launchPersistentContext: mock.fn(async () => mockBrowser),
};

// Mock the module before importing dependencies
mock.module('playwright', {
  namedExports: {
    chromium: mockChromium
  }
});

// Import the modules under test
const { fetchWebPage } = await import('../src/web-fetch.js');
const { searchWeb } = await import('../src/web-search.js');

describe('Research Friend Tools', () => {
  it('fetchWebPage should return page content', async () => {
    // Setup specific mock responses for this test
    mockPage.evaluate.mock.mockImplementation(async (script) => {
      if (typeof script === 'string') {
        if (script.includes('document.body?.innerText')) return 'Mock Body Text';
        if (script.includes('const meta = {};')) return { description: 'Mock Description' };
      }
      return null;
    });

    const result = await fetchWebPage({ url: 'http://example.com' });

    assert.strictEqual(result.url, 'http://example.com');
    assert.strictEqual(result.finalUrl, 'http://example.com/final');
    assert.strictEqual(result.title, 'Mock Title');
    assert.strictEqual(result.text, 'Mock Body Text');
    assert.strictEqual(result.meta.description, 'Mock Description');
    assert.strictEqual(mockChromium.launch.mock.callCount(), 1);
  });

  it('searchWeb should return search results', async () => {
    // Reset mock call count if needed, but easier to just check functionality
    
    // Setup mock for search results extraction
    mockPage.evaluate.mock.mockImplementation(async (fn, arg) => {
       if (typeof fn === 'function') {
           // Simulate the browser context function returning items
           return [
             { title: 'Result 1', url: 'http://r1.com', snippet: 'Snippet 1' },
             { title: 'Result 2', url: 'http://r2.com', snippet: 'Snippet 2' }
           ];
       }
       return [];
    });

    const result = await searchWeb({ query: 'test query' });

    assert.strictEqual(result.query, 'test query');
    assert.strictEqual(result.engine, 'duckduckgo');
    assert.strictEqual(result.results.length, 2);
    assert.strictEqual(result.results[0].title, 'Result 1');
    assert.strictEqual(mockChromium.launchPersistentContext.mock.callCount(), 1); 
  });

  it('searchWeb should support google engine', async () => {
    const result = await searchWeb({ query: 'test query', engine: 'google' });
    assert.strictEqual(result.engine, 'google');
    assert.strictEqual(mockChromium.launchPersistentContext.mock.callCount(), 2);
  });
});
