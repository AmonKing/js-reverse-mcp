/**
 * Integration tests for Patchright browser lifecycle.
 * These tests launch a real browser to verify the migration works.
 */

import {describe, it, after, before} from 'node:test';
import assert from 'node:assert';

import type {Page} from '../src/third_party/index.js';
import {getDefaultContext} from '../src/browser.js';
import {getCdpClient, invalidateCdpClient} from '../src/utils/cdp.js';
import {useBrowser} from './helpers.js';

const env = useBrowser();

describe('Browser lifecycle (Patchright)', () => {
  it('browser is connected', () => {
    assert.ok(env.browser.isConnected());
  });

  it('getDefaultContext returns first context', () => {
    const ctx = getDefaultContext(env.browser);
    assert.ok(ctx);
  });

  it('can create a new page', async () => {
    const page = await env.context.newPage();
    assert.ok(page);
    assert.strictEqual(page.isClosed(), false);
    await page.close();
  });

  it('can navigate to about:blank', async () => {
    const page = await env.context.newPage();
    await page.goto('about:blank');
    assert.strictEqual(page.url(), 'about:blank');
    await page.close();
  });
});

describe('CDP Session (Patchright)', () => {
  let page: Page;

  before(async () => {
    page = await env.context.newPage();
  });

  after(async () => {
    await page?.close();
  });

  it('getCdpClient returns a CDP session', async () => {
    const client = await getCdpClient(page);
    assert.ok(client);
  });

  it('getCdpClient caches the session', async () => {
    const client1 = await getCdpClient(page);
    const client2 = await getCdpClient(page);
    assert.strictEqual(client1, client2);
  });

  it('invalidateCdpClient clears cache', async () => {
    const client1 = await getCdpClient(page);
    invalidateCdpClient(page);
    const client2 = await getCdpClient(page);
    assert.notStrictEqual(client1, client2);
  });

  it('CDP session can send commands', async () => {
    const client = await getCdpClient(page);
    const result = await client.send('Runtime.evaluate', {
      expression: '1 + 1',
    });
    assert.strictEqual(result.result.value, 2);
  });
});
