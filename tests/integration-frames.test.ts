/**
 * Integration tests for frames, locators, and the .or() chain pattern.
 * Verifies Playwright-specific patterns used in the migration.
 */

import {describe, it, after, before} from 'node:test';
import assert from 'node:assert';

import type {Browser, BrowserContext, Page} from '../src/third_party/index.js';
import {chromium} from '../src/third_party/index.js';

let browser: Browser;
let context: BrowserContext;

before(async () => {
  browser = await chromium.launch({channel: 'chrome', headless: true});
  context = await browser.newContext();
});

after(async () => {
  await browser?.close();
});

describe('Frames', () => {
  let page: Page;

  before(async () => {
    page = await context.newPage();
    await page.goto(`data:text/html,
      <h1>Main Frame</h1>
      <iframe srcdoc="<h2>Child Frame</h2>" name="child"></iframe>
    `);
  });

  after(async () => {
    await page?.close();
  });

  it('page.frames() returns frames including iframes', async () => {
    await page.waitForTimeout(500);
    const frames = page.frames();
    assert.ok(frames.length >= 2, `Expected at least 2 frames, got ${frames.length}`);
  });

  it('page.mainFrame() returns the main frame', () => {
    const mainFrame = page.mainFrame();
    assert.ok(mainFrame);
    assert.ok(mainFrame.url().startsWith('data:'));
  });

  it('frame.name() returns name', async () => {
    await page.waitForTimeout(500);
    const frames = page.frames();
    const childFrame = frames.find(f => f.name() === 'child');
    assert.ok(childFrame, 'Should find frame with name "child"');
  });

  it('frame.evaluate works', async () => {
    const mainFrame = page.mainFrame();
    const text = await mainFrame.evaluate(() => document.querySelector('h1')?.textContent);
    assert.strictEqual(text, 'Main Frame');
  });
});

describe('Locator .or() chain pattern', () => {
  let page: Page;

  before(async () => {
    page = await context.newPage();
    await page.goto('data:text/html,<div id="a">Alpha</div><div id="b">Beta</div>');
  });

  after(async () => {
    await page?.close();
  });

  it('locator.or() chains work', async () => {
    const locA = page.locator('#a');
    const locB = page.locator('#b');
    const combined = locA.or(locB);
    const count = await combined.count();
    assert.ok(count >= 1, 'Combined locator should find at least one element');
  });

  it('combined.first().waitFor() works', async () => {
    const locA = page.locator('#a');
    const locB = page.locator('#nonexistent');
    const combined = locA.or(locB);
    await combined.first().waitFor({timeout: 3000});
  });

  it('getByText locator works', async () => {
    const loc = page.getByText('Alpha');
    const count = await loc.count();
    assert.ok(count >= 1);
  });

  it('text= locator works', async () => {
    const loc = page.locator('text=Beta');
    const count = await loc.count();
    assert.ok(count >= 1);
  });
});

describe('Page timeouts', () => {
  let page: Page;

  before(async () => {
    page = await context.newPage();
  });

  after(async () => {
    await page?.close();
  });

  it('setDefaultTimeout', () => {
    page.setDefaultTimeout(5000);
  });

  it('setDefaultNavigationTimeout', () => {
    page.setDefaultNavigationTimeout(10000);
  });
});
