/**
 * Integration tests for cookies via CDP and page.addInitScript.
 * Verifies CDP session interaction works correctly after migration.
 */

import {describe, it, after, before} from 'node:test';
import assert from 'node:assert';

import type {Browser, BrowserContext, Page} from '../src/third_party/index.js';
import {chromium} from '../src/third_party/index.js';
import {getCdpClient} from '../src/utils/cdp.js';

let browser: Browser;
let context: BrowserContext;

before(async () => {
  browser = await chromium.launch({channel: 'chrome', headless: true});
  context = await browser.newContext();
});

after(async () => {
  await browser?.close();
});

describe('Cookies via CDP', () => {
  let page: Page;

  before(async () => {
    page = await context.newPage();
    await page.goto('data:text/html,<h1>Cookie Test</h1>');
  });

  after(async () => {
    await page?.close();
  });

  it('Network.setCookie via CDP', async () => {
    const client = await getCdpClient(page);
    const result = await client.send('Network.setCookie', {
      name: 'test_cookie',
      value: 'test_value',
      domain: 'example.com',
      path: '/',
    });
    assert.ok(result.success);
  });

  it('Network.getCookies via CDP', async () => {
    const client = await getCdpClient(page);
    const result = await client.send('Network.getCookies', {
      urls: ['https://example.com'],
    });
    assert.ok(Array.isArray(result.cookies));
    const testCookie = result.cookies.find(
      (c: any) => c.name === 'test_cookie',
    );
    assert.ok(testCookie, 'Should find the test cookie');
    assert.strictEqual(testCookie.value, 'test_value');
  });

  it('Network.deleteCookies via CDP', async () => {
    const client = await getCdpClient(page);
    await client.send('Network.deleteCookies', {
      name: 'test_cookie',
      domain: 'example.com',
    });

    const result = await client.send('Network.getCookies', {
      urls: ['https://example.com'],
    });
    const testCookie = result.cookies.find(
      (c: any) => c.name === 'test_cookie',
    );
    assert.ok(!testCookie, 'Cookie should be deleted');
  });
});

describe('CDP commands', () => {
  let page: Page;

  before(async () => {
    page = await context.newPage();
    await page.goto('data:text/html,<h1>CDP Test</h1>');
  });

  after(async () => {
    await page?.close();
  });

  it('Runtime.evaluate via CDP', async () => {
    const client = await getCdpClient(page);
    const result = await client.send('Runtime.evaluate', {
      expression: 'document.title',
    });
    assert.strictEqual(typeof result.result.value, 'string');
  });

  it('Page.addScriptToEvaluateOnNewDocument via CDP', async () => {
    const client = await getCdpClient(page);
    const result = await client.send('Page.addScriptToEvaluateOnNewDocument', {
      source: 'window.__CDP_SCRIPT = true',
    });
    assert.ok(result.identifier, 'Should return an identifier');

    // Clean up — we just verify the CDP call succeeds and returns an identifier
    await client.send('Page.removeScriptToEvaluateOnNewDocument', {
      identifier: result.identifier,
    });
  });

  it('CDP event listeners work', async () => {
    const client = await getCdpClient(page);

    let received = false;
    const handler = () => {
      received = true;
    };

    client.on('Network.requestWillBeSent', handler);
    await client.send('Network.enable');

    await page.goto('data:text/html,<h1>Event test</h1>');
    await page.evaluate(() => new Promise(r => setTimeout(r, 200)));

    client.off('Network.requestWillBeSent', handler);
    await client.send('Network.disable');

    assert.ok(received, 'Should have received CDP event');
  });
});
