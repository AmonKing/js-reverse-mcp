/**
 * Integration tests for network collection, console collection, and Playwright Request/Response API.
 * Uses page.route() to intercept real HTTP requests for testing.
 */

import {describe, it} from 'node:test';
import assert from 'node:assert';

import type {HTTPRequest} from '../src/third_party/index.js';
import type {Protocol} from 'devtools-protocol';
import {getCdpClient} from '../src/utils/cdp.js';
import {useBrowser, createRoutedPage, waitFor} from './helpers.js';

const env = useBrowser();

describe('Network requests (Playwright Request API)', () => {
  it('captures request events via route', async () => {
    const page = await createRoutedPage(env.context);
    const requests: HTTPRequest[] = [];
    page.on('request', req => requests.push(req));

    await page.goto('http://localhost/test-page');
    assert.ok(requests.length > 0);
    await page.close();
  });

  it('request.method() works', async () => {
    const page = await createRoutedPage(env.context);
    const requests: HTTPRequest[] = [];
    page.on('request', req => requests.push(req));

    await page.goto('http://localhost/test-method');
    const navReq = requests.find(r => r.url().includes('test-method'));
    assert.ok(navReq);
    assert.strictEqual(navReq.method(), 'GET');
    await page.close();
  });

  it('request.resourceType() returns document for navigation', async () => {
    const page = await createRoutedPage(env.context);
    const requests: HTTPRequest[] = [];
    page.on('request', req => requests.push(req));

    await page.goto('http://localhost/test-type');
    const navReq = requests.find(r => r.url().includes('test-type'));
    assert.ok(navReq);
    assert.strictEqual(navReq.resourceType(), 'document');
    await page.close();
  });

  it('request.headers() returns object', async () => {
    const page = await createRoutedPage(env.context);
    const requests: HTTPRequest[] = [];
    page.on('request', req => requests.push(req));

    await page.goto('http://localhost/test-headers');
    const navReq = requests.find(r => r.url().includes('test-headers'));
    assert.ok(navReq);
    assert.strictEqual(typeof navReq.headers(), 'object');
    await page.close();
  });

  it('response via waitForResponse', async () => {
    const page = await createRoutedPage(env.context);

    const [response] = await Promise.all([
      page.waitForResponse('**/test-resp'),
      page.goto('http://localhost/test-resp'),
    ]);

    assert.ok(response);
    assert.strictEqual(response.status(), 200);
    await page.close();
  });

  it('request.postData() returns string for POST', async () => {
    const page = await createRoutedPage(env.context);
    await page.goto('http://localhost/main-page');

    const requests: HTTPRequest[] = [];
    page.on('request', req => requests.push(req));

    await page.evaluate(async () => {
      await fetch('/api/post', {
        method: 'POST',
        body: JSON.stringify({hello: 'world'}),
        headers: {'Content-Type': 'application/json'},
      });
    });

    const postReq = requests.find(r => r.method() === 'POST');
    assert.ok(postReq, 'Should have a POST request');
    const postData = postReq.postData();
    assert.ok(postData);
    assert.ok(postData.includes('hello'));
    await page.close();
  });

  it('request.failure() returns null for successful requests', async () => {
    const page = await createRoutedPage(env.context);

    const [response] = await Promise.all([
      page.waitForResponse('**/test-ok'),
      page.goto('http://localhost/test-ok'),
    ]);

    assert.strictEqual(response.request().failure(), null);
    await page.close();
  });

  it('request.isNavigationRequest() works', async () => {
    const page = await createRoutedPage(env.context);
    const requests: HTTPRequest[] = [];
    page.on('request', req => requests.push(req));

    await page.goto('http://localhost/test-nav');
    const navReq = requests.find(r => r.isNavigationRequest());
    assert.ok(navReq);
    await page.close();
  });

  it('request.redirectedFrom() returns null for non-redirect', async () => {
    const page = await createRoutedPage(env.context);
    const requests: HTTPRequest[] = [];
    page.on('request', req => requests.push(req));

    await page.goto('http://localhost/test-noredir');
    const req = requests[0];
    assert.ok(req);
    assert.strictEqual(req.redirectedFrom(), null);
    await page.close();
  });

  it('request.frame() returns frame', async () => {
    const page = await createRoutedPage(env.context);
    const requests: HTTPRequest[] = [];
    page.on('request', req => requests.push(req));

    await page.goto('http://localhost/test-frame');
    assert.ok(requests[0].frame());
    await page.close();
  });
});

describe('Console messages via CDP', () => {
  // NOTE: Patchright does NOT fire Playwright-level 'console'/'pageerror' events
  // (anti-detection feature). Console collection must use CDP Runtime.consoleAPICalled.

  it('captures console.log via CDP Runtime.consoleAPICalled', async () => {
    const page = await createRoutedPage(env.context, {
      body: '<h1>Test</h1><script>console.log("hello from test")</script>',
    });
    const client = await getCdpClient(page);
    await client.send('Runtime.enable');

    const messages: string[] = [];
    client.on('Runtime.consoleAPICalled', (event: Protocol.Runtime.ConsoleAPICalledEvent) => {
      messages.push(event.args.map(a => a.value).join(' '));
    });

    await page.goto('http://localhost/console-cdp');
    await waitFor(() => messages.some(m => m.includes('hello from test')));

    assert.ok(
      messages.some(m => m.includes('hello from test')),
      `Expected "hello from test" in CDP messages: ${JSON.stringify(messages)}`,
    );
    await client.send('Runtime.disable');
    await page.close();
  });

  it('captures console.warn type via CDP', async () => {
    const page = await createRoutedPage(env.context, {
      body: '<h1>Test</h1><script>console.warn("warn test")</script>',
    });
    const client = await getCdpClient(page);
    await client.send('Runtime.enable');

    const types: string[] = [];
    client.on('Runtime.consoleAPICalled', (event: Protocol.Runtime.ConsoleAPICalledEvent) => {
      types.push(event.type);
    });

    await page.goto('http://localhost/console-warn-cdp');
    await waitFor(() => types.includes('warning'));

    assert.ok(types.includes('warning'), `Expected 'warning' in types: ${JSON.stringify(types)}`);
    await client.send('Runtime.disable');
    await page.close();
  });

  it('captures uncaught exception via CDP', async () => {
    const page = await createRoutedPage(env.context, {
      body: '<h1>Test</h1><script>throw new Error("test error")</script>',
    });
    const client = await getCdpClient(page);
    await client.send('Runtime.enable');

    const exceptions: string[] = [];
    client.on('Runtime.exceptionThrown', (event: Protocol.Runtime.ExceptionThrownEvent) => {
      exceptions.push(event.exceptionDetails?.text ?? '');
    });

    await page.goto('http://localhost/error-cdp');
    await waitFor(() => exceptions.some(e => e.includes('Uncaught')));

    assert.ok(
      exceptions.some(e => e.includes('Uncaught')),
      `Expected exception, got: ${JSON.stringify(exceptions)}`,
    );
    await client.send('Runtime.disable');
    await page.close();
  });
});

describe('Response API (Playwright)', () => {
  it('response.status() returns number', async () => {
    const page = await createRoutedPage(env.context, {status: 201, body: '<h1>Created</h1>'});

    const [response] = await Promise.all([
      page.waitForResponse('**/test-status'),
      page.goto('http://localhost/test-status'),
    ]);

    assert.strictEqual(response.status(), 201);
    await page.close();
  });

  it('response.allHeaders() is async and returns headers', async () => {
    const page = await createRoutedPage(env.context, {
      headers: {'x-custom': 'test-value'},
      body: '<h1>Headers</h1>',
    });

    const [response] = await Promise.all([
      page.waitForResponse('**/test-headers'),
      page.goto('http://localhost/test-headers'),
    ]);

    const headers = await response.allHeaders();
    assert.strictEqual(typeof headers, 'object');
    assert.strictEqual(headers['x-custom'], 'test-value');
    await page.close();
  });

  it('response.body() returns Buffer', async () => {
    const page = await createRoutedPage(env.context, {body: '<h1>Body content</h1>'});

    const [response] = await Promise.all([
      page.waitForResponse('**/test-body'),
      page.goto('http://localhost/test-body'),
    ]);

    const body = await response.body();
    assert.ok(Buffer.isBuffer(body));
    assert.ok(body.toString().includes('Body content'));
    await page.close();
  });
});
