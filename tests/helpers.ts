/**
 * Shared test helpers for integration tests.
 */

import {before, after} from 'node:test';
import type {Browser, BrowserContext, Page} from '../src/third_party/index.js';
import {chromium} from '../src/third_party/index.js';

/**
 * Sets up a shared browser + context for a test file.
 * Call at file scope — returns an accessor object populated by before/after hooks.
 */
export function useBrowser() {
  const state = {} as {browser: Browser; context: BrowserContext};

  before(async () => {
    state.browser = await chromium.launch({channel: 'chrome', headless: true});
    state.context = await state.browser.newContext();
  });

  after(async () => {
    await state.browser?.close();
  });

  return state;
}

/**
 * Creates a page with a catch-all route that fulfills every request.
 * Useful for network/console tests that need HTTP requests without a real server.
 */
export async function createRoutedPage(
  context: BrowserContext,
  options: {status?: number; contentType?: string; body?: string; headers?: Record<string, string>} = {},
): Promise<Page> {
  const page = await context.newPage();
  await page.route('**/*', route => {
    route.fulfill({
      status: options.status ?? 200,
      contentType: options.contentType ?? 'text/html',
      body: options.body ?? '<h1>OK</h1>',
      ...(options.headers ? {headers: options.headers} : {}),
    });
  });
  return page;
}

/**
 * Polls a condition until it returns true, with timeout.
 */
export async function waitFor(
  condition: () => boolean,
  timeout = 5000,
  interval = 50,
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error(`waitFor timed out after ${timeout}ms`);
    }
    await new Promise(r => setTimeout(r, interval));
  }
}
