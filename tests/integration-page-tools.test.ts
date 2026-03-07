/**
 * Integration tests for page navigation, script evaluation, and input tools.
 * Tests core Patchright API usage patterns from the migration.
 */

import {describe, it, after, before} from 'node:test';
import assert from 'node:assert';

import type {Page} from '../src/third_party/index.js';
import {useBrowser} from './helpers.js';

const env = useBrowser();

describe('Page navigation', () => {
  it('goto and url()', async () => {
    const page = await env.context.newPage();
    await page.goto('data:text/html,<h1>Hello</h1>');
    assert.ok(page.url().startsWith('data:'));
    await page.close();
  });

  it('goBack and goForward', async () => {
    const page = await env.context.newPage();
    await page.goto('data:text/html,<h1>Page1</h1>');
    const url1 = page.url();
    await page.goto('data:text/html,<h1>Page2</h1>');
    await page.goBack({waitUntil: 'domcontentloaded'});
    assert.strictEqual(page.url(), url1);
    await page.goForward({waitUntil: 'domcontentloaded'});
    assert.notStrictEqual(page.url(), url1);
    await page.close();
  });

  it('reload', async () => {
    const page = await env.context.newPage();
    await page.goto('data:text/html,<h1>Reload</h1>');
    await page.reload({waitUntil: 'domcontentloaded'});
    assert.ok(page.url().startsWith('data:'));
    await page.close();
  });

  it('pages() returns open pages', async () => {
    const page1 = await env.context.newPage();
    const page2 = await env.context.newPage();
    const pages = env.context.pages();
    assert.ok(pages.length >= 2);
    await page1.close();
    await page2.close();
  });

  it('bringToFront', async () => {
    const page = await env.context.newPage();
    await page.bringToFront();
    await page.close();
  });
});

describe('Script evaluation (Playwright API)', () => {
  let page: Page;

  before(async () => {
    page = await env.context.newPage();
    await page.goto('data:text/html,<h1 id="title">Test</h1><input id="inp" value="hello">');
  });

  after(async () => {
    await page?.close();
  });

  it('evaluate returns primitive', async () => {
    const result = await page.evaluate(() => 1 + 1);
    assert.strictEqual(result, 2);
  });

  it('evaluate returns string', async () => {
    const result = await page.evaluate(() => document.title);
    assert.strictEqual(typeof result, 'string');
  });

  it('evaluate returns DOM content', async () => {
    const text = await page.evaluate(() => {
      return document.getElementById('title')?.textContent;
    });
    assert.strictEqual(text, 'Test');
  });

  it('evaluateHandle works', async () => {
    const handle = await page.evaluateHandle(() => document);
    assert.ok(handle);
    await handle.dispose();
  });

  it('evaluate async function', async () => {
    const result = await page.evaluate(async () => {
      return await Promise.resolve(42);
    });
    assert.strictEqual(result, 42);
  });

  it('frame.evaluateHandle returns handle', async () => {
    const frame = page.mainFrame();
    const handle = await frame.evaluateHandle(() => window);
    assert.ok(handle);
    await handle.dispose();
  });
});

describe('Input tools (Playwright API)', () => {
  let page: Page;

  before(async () => {
    page = await env.context.newPage();
    await page.goto(`data:text/html,
      <input id="text-input" type="text" value="">
      <button id="btn" onclick="document.getElementById('result').textContent='clicked'">Click</button>
      <div id="result"></div>
      <select id="sel">
        <option value="a">Alpha</option>
        <option value="b">Beta</option>
      </select>
      <textarea id="ta"></textarea>
    `);
  });

  after(async () => {
    await page?.close();
  });

  it('click element by selector', async () => {
    await page.click('#btn');
    const text = await page.locator('#result').textContent();
    assert.strictEqual(text, 'clicked');
  });

  it('fill input field', async () => {
    await page.fill('#text-input', 'hello world');
    const value = await page.inputValue('#text-input');
    assert.strictEqual(value, 'hello world');
  });

  it('type text sequentially', async () => {
    await page.fill('#text-input', '');
    await page.locator('#text-input').pressSequentially('abc');
    const value = await page.inputValue('#text-input');
    assert.strictEqual(value, 'abc');
  });

  it('press key', async () => {
    await page.fill('#text-input', 'hello');
    await page.press('#text-input', 'Control+A');
    await page.press('#text-input', 'Backspace');
    const value = await page.inputValue('#text-input');
    assert.strictEqual(value, '');
  });

  it('select option by value', async () => {
    await page.selectOption('#sel', {value: 'b'});
    const value = await page.inputValue('#sel');
    assert.strictEqual(value, 'b');
  });

  it('select option by label', async () => {
    await page.selectOption('#sel', {label: 'Alpha'});
    const value = await page.inputValue('#sel');
    assert.strictEqual(value, 'a');
  });

  it('hover element (no throw)', async () => {
    await page.hover('#btn');
  });

  it('mouse wheel (no throw)', async () => {
    await page.mouse.wheel(0, 100);
  });

  it('locator waitFor', async () => {
    await page.locator('#btn').waitFor({state: 'visible'});
  });

  it('locator textContent', async () => {
    const text = await page.locator('#btn').textContent();
    assert.strictEqual(text, 'Click');
  });

  it('locator getAttribute', async () => {
    const value = await page.locator('#text-input').getAttribute('type');
    assert.strictEqual(value, 'text');
  });

  it('fill textarea', async () => {
    await page.fill('#ta', 'multi\nline');
    const value = await page.inputValue('#ta');
    assert.strictEqual(value, 'multi\nline');
  });

  it('mouse click at coordinates', async () => {
    await page.mouse.click(50, 50);
  });
});

describe('Screenshot (Playwright API)', () => {
  let page: Page;

  before(async () => {
    page = await env.context.newPage();
    await page.goto('data:text/html,<h1 style="color:red">Screenshot Test</h1>');
  });

  after(async () => {
    await page?.close();
  });

  it('takes png screenshot', async () => {
    const buffer = await page.screenshot({type: 'png'});
    assert.ok(buffer.length > 0);
  });

  it('takes jpeg screenshot', async () => {
    const buffer = await page.screenshot({type: 'jpeg'});
    assert.ok(buffer.length > 0);
  });

  it('takes fullPage screenshot', async () => {
    const buffer = await page.screenshot({type: 'png', fullPage: true});
    assert.ok(buffer.length > 0);
  });
});
