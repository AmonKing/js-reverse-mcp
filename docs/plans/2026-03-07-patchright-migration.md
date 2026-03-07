# Patchright Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate js-reverse-mcp from rebrowser-puppeteer-core to patchright (Playwright fork with built-in anti-detection).

**Architecture:** Rewrite core infrastructure (third_party, browser, cdp utils) for Patchright, then cascade type/import changes through collectors, context, and tools. Delete DevToolsConnectionAdapter and stealth scripts. Add input tools last.

**Tech Stack:** TypeScript, patchright (Playwright API), CDP protocol, MCP SDK, zod, devtools-protocol (types)

---

## Codebase Orientation

**Key Puppeteer patterns that change:**

| Pattern | Puppeteer | Patchright |
|---------|-----------|------------|
| Import | `import puppeteer from 'puppeteer-core'` | `import { chromium } from 'patchright'` |
| Connect | `puppeteer.connect({browserWSEndpoint})` | `chromium.connectOverCDP(endpoint, {headers})` |
| Launch | `puppeteer.launch({channel, pipe, args})` | `chromium.launch({channel, args})` |
| Get pages | `browser.pages()` | `browser.contexts()[0].pages()` |
| New page | `browser.newPage()` | `browser.contexts()[0].newPage()` |
| CDP session | `page._client()` (sync, internal) | `page.context().newCDPSession(page)` (async, public) |
| Init script | `page.evaluateOnNewDocument(script)` | `page.addInitScript(script)` |
| Page events | `browser.on('targetcreated', cb)` | `context.on('page', cb)` |
| Page destroy | `browser.on('targetdestroyed', cb)` | `page.on('close', cb)` |
| Event handler | `page.on(name, listener as Handler<unknown>)` | `page.on(name, listener)` |
| Locator race | `Locator.race([loc1, loc2])` | `loc1.or(loc2)` |
| Types | `HTTPRequest`, `HTTPResponse` | `Request`, `Response` |
| Protocol types | `import type {Protocol} from 'puppeteer-core'` | `import type {Protocol} from 'devtools-protocol'` |

**Files touched per task (reference):**

| File | Lines | Task |
|------|-------|------|
| `package.json` | 75 | 1 |
| `src/third_party/index.ts` | 32 | 2 |
| `src/utils/cdp.ts` | 16 | 3 |
| `src/browser.ts` | 201 | 4 |
| `src/DevToolsConnectionAdapter.ts` | 110 | 5 (delete) |
| `src/PageCollector.ts` | 521 | 6 |
| `src/WebSocketCollector.ts` | 367 | 7 |
| `src/McpContext.ts` | 742 | 8 |
| `src/WaitForHelper.ts` | 183 | 9 |
| `src/FetchInterceptor.ts` | 231 | 10 |
| `src/DebuggerContext.ts` | 693 | 10 |
| `src/tools/ToolDefinition.ts` | 223 | 11 |
| `src/McpResponse.ts` | 616 | 11 |
| `src/formatters/networkFormatter.ts` | 115 | 11 |
| `src/tools/*.ts` (13 files) | ~1200 | 12 |
| `src/utils/keyboard.ts` | 306 | 12 |
| `src/main.ts` | 227 | 13 |
| `scripts/stealth*.js` | 2 files | 14 (delete) |
| `src/tools/input.ts` | new | 15 |

---

## Task 1: Switch Dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install patchright and devtools-protocol**

Run: `npm install --save-dev patchright@latest devtools-protocol@latest`

**Step 2: Remove rebrowser-puppeteer-core**

In `package.json`, remove the line:
```
"puppeteer-core": "npm:rebrowser-puppeteer-core@24.8.1",
```

Run: `npm install` to update lockfile.

**Step 3: Verify install**

Run: `npx patchright install chrome`
Run: `node -e "const { chromium } = require('patchright'); console.log('patchright OK')"`

**Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: switch from rebrowser-puppeteer-core to patchright"
```

---

## Task 2: Rewrite third_party/index.ts

**Files:**
- Modify: `src/third_party/index.ts`

**Step 1: Replace all puppeteer exports with patchright + devtools-protocol**

```typescript
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import 'core-js/modules/es.promise.with-resolvers.js';
import 'core-js/proposals/iterator-helpers.js';

export type {Options as YargsOptions} from 'yargs';
export {default as yargs} from 'yargs';
export {hideBin} from 'yargs/helpers';
export {default as debug} from 'debug';
export type {Debugger} from 'debug';
export {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
export {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
export {
  type CallToolResult,
  SetLevelRequestSchema,
  type ImageContent,
  type TextContent,
} from '@modelcontextprotocol/sdk/types.js';
export {z as zod} from 'zod';

// Patchright (Playwright API)
export {chromium} from 'patchright';
export type {
  Browser,
  BrowserContext,
  Page,
  Frame,
  CDPSession,
  Request as HTTPRequest,
  Response as HTTPResponse,
  ConsoleMessage,
  Dialog,
  Locator,
  JSHandle,
  ElementHandle,
} from 'patchright';

// CDP Protocol types (previously from puppeteer-core)
export type {Protocol} from 'devtools-protocol';
```

**Key changes:**
- Remove `puppeteer` default export, `Locator` value export, `PredefinedNetworkConditions`, `CDPSessionEvent`
- Remove `export type * from 'puppeteer-core'` (was exporting everything)
- Remove `export type {CdpPage}` (doesn't exist in Playwright)
- Add explicit type exports for each type we use
- `HTTPRequest` = Playwright's `Request` (aliased for minimal downstream changes)
- `HTTPResponse` = Playwright's `Response` (aliased)
- `Protocol` now from `devtools-protocol` package

**Types that no longer exist (handle in downstream tasks):**
- `Target` — replaced by BrowserContext events
- `Handler<T>` — use standard function type
- `KeyInput` — use `string`
- `CdpPage` — use `Page`
- `Connection` — not exposed by Playwright
- `CDPSessionEvent` — not needed (delete DevToolsConnectionAdapter)
- `PredefinedNetworkConditions` — inline the values
- `ResourceType` — use `string`
- `ConsoleMessageType` — use `string`
- `PageEvents` — define our own
- `LaunchOptions` — not needed (use inline types)
- `ChromeReleaseChannel` — use `string`

**Step 2: Commit**

```bash
git add src/third_party/index.ts
git commit -m "refactor: switch third_party exports from puppeteer to patchright"
```

> Note: Project will NOT compile after this task. That's expected — we fix downstream in subsequent tasks.

---

## Task 3: Rewrite utils/cdp.ts (async + cache)

**Files:**
- Modify: `src/utils/cdp.ts`

**Step 1: Replace with async cached version**

```typescript
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {CDPSession, Page} from '../third_party/index.js';

const sessionCache = new WeakMap<Page, CDPSession>();

/**
 * Get the CDP session for a page.
 * Uses Playwright's public API: page.context().newCDPSession(page).
 * Sessions are cached per page to avoid creating multiple sessions.
 */
export async function getCdpClient(page: Page): Promise<CDPSession> {
  let session = sessionCache.get(page);
  if (!session) {
    session = await page.context().newCDPSession(page);
    sessionCache.set(page, session);
  }
  return session;
}

/**
 * Invalidate the cached CDP session for a page.
 * Call this when a page is closed or when the session needs to be recreated.
 */
export function invalidateCdpClient(page: Page): void {
  sessionCache.delete(page);
}
```

**Impact:** `getCdpClient` is now `async`. All call sites (~15) need `await`. This is handled in subsequent tasks.

**Step 2: Commit**

```bash
git add src/utils/cdp.ts
git commit -m "refactor: make getCdpClient async with WeakMap cache"
```

---

## Task 4: Rewrite browser.ts

**Files:**
- Modify: `src/browser.ts`

**Step 1: Complete rewrite for Patchright API**

```typescript
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {logger} from './logger.js';
import type {Browser, BrowserContext} from './third_party/index.js';
import {chromium} from './third_party/index.js';

let browser: Browser | undefined;

/**
 * Get the default BrowserContext.
 * Playwright wraps pages in BrowserContext — we always use the first/default one.
 */
export function getDefaultContext(browser: Browser): BrowserContext {
  const contexts = browser.contexts();
  if (contexts.length === 0) {
    throw new Error('No browser context available');
  }
  return contexts[0];
}

export async function ensureBrowserConnected(options: {
  browserURL?: string;
  wsEndpoint?: string;
  wsHeaders?: Record<string, string>;
  devtools: boolean;
  initScript?: string;
}) {
  if (browser?.isConnected()) {
    return browser;
  }

  let endpoint: string;
  if (options.wsEndpoint) {
    endpoint = options.wsEndpoint;
  } else if (options.browserURL) {
    endpoint = options.browserURL;
  } else {
    throw new Error('Either browserURL or wsEndpoint must be provided');
  }

  const connectOptions: Parameters<typeof chromium.connectOverCDP>[1] = {
    headers: options.wsHeaders,
  };

  logger('Connecting Patchright to ', endpoint);
  browser = await chromium.connectOverCDP(endpoint, connectOptions);
  logger('Connected Patchright');

  if (options.initScript) {
    const context = getDefaultContext(browser);
    const pages = context.pages();
    for (const page of pages) {
      await page.addInitScript(options.initScript);
    }
  }

  return browser;
}

interface McpLaunchOptions {
  acceptInsecureCerts?: boolean;
  executablePath?: string;
  channel?: Channel;
  userDataDir?: string;
  headless: boolean;
  isolated: boolean;
  logFile?: fs.WriteStream;
  viewport?: {
    width: number;
    height: number;
  };
  args?: string[];
  devtools: boolean;
  initScript?: string;
}

export async function launch(options: McpLaunchOptions): Promise<Browser> {
  const {channel, executablePath, headless, isolated} = options;
  const profileDirName =
    channel && channel !== 'stable'
      ? `chrome-profile-${channel}`
      : 'chrome-profile';

  let userDataDir = options.userDataDir;
  if (!isolated && !userDataDir) {
    userDataDir = path.join(
      os.homedir(),
      '.cache',
      'chrome-devtools-mcp',
      profileDirName,
    );
    await fs.promises.mkdir(userDataDir, {
      recursive: true,
    });
  }

  const args: string[] = [
    ...(options.args ?? []),
    '--hide-crash-restore-bubble',
  ];
  if (headless) {
    args.push('--screen-info={3840x2160}');
  }

  let playwrightChannel: string | undefined;
  if (options.devtools) {
    args.push('--auto-open-devtools-for-tabs');
  }
  if (!executablePath) {
    playwrightChannel =
      channel && channel !== 'stable'
        ? `chrome-${channel}`
        : 'chrome';
  }

  try {
    // Use launchPersistentContext if we have a userDataDir, otherwise launch
    let browser: Browser;
    if (userDataDir) {
      const context = await chromium.launchPersistentContext(userDataDir, {
        channel: playwrightChannel,
        executablePath,
        headless,
        args,
        ignoreDefaultArgs: ['--enable-automation'],
        acceptDownloads: false,
        viewport: options.viewport
          ? {width: options.viewport.width, height: options.viewport.height}
          : null,
        bypassCSP: false,
      });
      browser = context.browser()!;
    } else {
      browser = await chromium.launch({
        channel: playwrightChannel,
        executablePath,
        headless,
        args,
        ignoreDefaultArgs: ['--enable-automation'],
      });

      // Create default context with viewport
      const context = await browser.newContext({
        viewport: options.viewport
          ? {width: options.viewport.width, height: options.viewport.height}
          : null,
        acceptDownloads: false,
      });
      // Open initial page
      await context.newPage();
    }

    if (options.initScript) {
      const context = getDefaultContext(browser);
      const pages = context.pages();
      for (const page of pages) {
        await page.addInitScript(options.initScript);
      }
    }

    return browser;
  } catch (error) {
    if (
      userDataDir &&
      (error as Error).message.includes('The browser is already running')
    ) {
      throw new Error(
        `The browser is already running for ${userDataDir}. Use --isolated to run multiple browser instances.`,
        {
          cause: error,
        },
      );
    }
    throw error;
  }
}

export async function ensureBrowserLaunched(
  options: McpLaunchOptions,
): Promise<Browser> {
  if (browser?.isConnected()) {
    return browser;
  }
  browser = await launch(options);
  return browser;
}

export type Channel = 'stable' | 'canary' | 'beta' | 'dev';
```

**Key changes:**
- `puppeteer.connect()` → `chromium.connectOverCDP()`
- `puppeteer.launch()` → `chromium.launch()` or `chromium.launchPersistentContext()`
- `browser.connected` → `browser.isConnected()`
- `browser.pages()` → `getDefaultContext(browser).pages()`
- `evaluateOnNewDocument` → `addInitScript`
- Remove `targetFilter` (Playwright doesn't have Target concept)
- Remove `pipe: true` (Patchright doesn't need it)
- Remove `handleDevToolsAsPage` (Playwright doesn't have this)
- Remove `defaultViewport: null` → use `viewport: null` in context options
- Export `getDefaultContext` helper for use in McpContext

**Step 2: Commit**

```bash
git add src/browser.ts
git commit -m "refactor: rewrite browser.ts for patchright connectOverCDP/launch"
```

---

## Task 5: Delete DevToolsConnectionAdapter

**Files:**
- Delete: `src/DevToolsConnectionAdapter.ts`

**Step 1: Delete the file**

```bash
rm src/DevToolsConnectionAdapter.ts
```

**Step 2: Remove any imports of PuppeteerDevToolsConnection**

Search for and remove imports in any file that references it. (Check `src/main.ts` and any other files.)

Run: `grep -r "DevToolsConnectionAdapter\|PuppeteerDevToolsConnection" src/`

Remove all references found.

**Step 3: Commit**

```bash
git add -u
git commit -m "refactor: delete DevToolsConnectionAdapter (experimental devtools only)"
```

---

## Task 6: Rewrite PageCollector.ts

**Files:**
- Modify: `src/PageCollector.ts`

This is one of the most complex changes. The event model changes completely.

**Step 1: Rewrite the entire file**

Key changes:
1. Replace `browser.on('targetcreated/destroyed')` with `context.on('page')` + `page.on('close')`
2. Replace `Handler<unknown>` with standard function types
3. Replace `page.emit('issue')` in PageIssueSubscriber with a callback
4. Make `getCdpClient` calls async
5. Remove `PageEvents extends PuppeteerPageEvents` — define our own event map
6. Pass `BrowserContext` instead of `Browser` to constructors (since events are on context)

The new PageCollector needs to:
- Accept a `BrowserContext` (not `Browser`)
- Listen to `context.on('page', cb)` for new pages
- Listen to `page.on('close', cb)` for page destruction (set up per page in `addPage`)
- Define a simple `ListenerMap` without extending Puppeteer's PageEvents

For `ConsoleCollector`, the `PageIssueSubscriber` needs:
- A callback function instead of `page.emit('issue')`
- The `ConsoleCollector` passes its `collect` function to the subscriber
- `getCdpClient` becomes async (subscriber.subscribe already is async)

For `NetworkCollector`:
- `getCdpClient` calls become async
- `request.id` internal API needs a Playwright equivalent (use CDP requestId from Network.requestWillBeSent)

**Complete rewrite:**

```typescript
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AggregatedIssue,
  Common,
} from '../node_modules/chrome-devtools-frontend/mcp/mcp.js';
import {
  IssueAggregatorEvents,
  IssuesManagerEvents,
  createIssuesFromProtocolIssue,
  IssueAggregator,
} from '../node_modules/chrome-devtools-frontend/mcp/mcp.js';

import {FakeIssuesManager} from './DevtoolsUtils.js';
import {features} from './features.js';
import {logger} from './logger.js';
import {getCdpClient} from './utils/cdp.js';
import type {
  BrowserContext,
  CDPSession,
  ConsoleMessage,
  Frame,
  HTTPRequest,
  Page,
  Protocol,
} from './third_party/index.js';

/**
 * Initiator information for a network request.
 */
export interface RequestInitiator {
  type: 'parser' | 'script' | 'preload' | 'SignedExchange' | 'preflight' | 'other';
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
  stack?: {
    callFrames: Array<{
      functionName: string;
      scriptId: string;
      url: string;
      lineNumber: number;
      columnNumber: number;
    }>;
    parent?: {
      callFrames: Array<{
        functionName: string;
        scriptId: string;
        url: string;
        lineNumber: number;
        columnNumber: number;
      }>;
    };
  };
}

/**
 * Page event names we listen to.
 */
interface PageEvents {
  console: ConsoleMessage;
  pageerror: Error;
  request: HTTPRequest;
  framenavigated: Frame;
  close: Page;
}

export type ListenerMap = {
  [K in keyof PageEvents]?: (event: PageEvents[K]) => void;
};

function createIdGenerator() {
  let i = 1;
  return () => {
    if (i === Number.MAX_SAFE_INTEGER) {
      i = 0;
    }
    return i++;
  };
}

export const stableIdSymbol = Symbol('stableIdSymbol');
type WithSymbolId<T> = T & {
  [stableIdSymbol]?: number;
};

export class PageCollector<T> {
  #context: BrowserContext;
  #listenersInitializer: (
    collector: (item: T) => void,
  ) => ListenerMap;
  #listeners = new WeakMap<Page, ListenerMap>();
  #closeHandlers = new WeakMap<Page, () => void>();
  #maxNavigationSaved = 3;

  protected storage = new WeakMap<Page, Array<Array<WithSymbolId<T>>>>();

  constructor(
    context: BrowserContext,
    listeners: (collector: (item: T) => void) => ListenerMap,
  ) {
    this.#context = context;
    this.#listenersInitializer = listeners;
  }

  async init() {
    const pages = this.#context.pages();
    for (const page of pages) {
      this.addPage(page);
    }

    this.#context.on('page', this.#onPageCreated);
  }

  dispose() {
    this.#context.off('page', this.#onPageCreated);
  }

  #onPageCreated = (page: Page) => {
    this.addPage(page);
  };

  public addPage(page: Page) {
    this.#initializePage(page);
  }

  #initializePage(page: Page) {
    if (this.storage.has(page)) {
      return;
    }
    const idGenerator = createIdGenerator();
    const storedLists: Array<Array<WithSymbolId<T>>> = [[]];
    this.storage.set(page, storedLists);

    const listeners = this.#listenersInitializer(value => {
      const withId = value as WithSymbolId<T>;
      withId[stableIdSymbol] = idGenerator();

      const navigations = this.storage.get(page) ?? [[]];
      navigations[0].push(withId);
    });

    listeners['framenavigated'] = (frame: Frame) => {
      if (frame !== page.mainFrame()) {
        return;
      }
      this.splitAfterNavigation(page);
    };

    for (const [name, listener] of Object.entries(listeners)) {
      page.on(name as keyof PageEvents, listener as any);
    }

    this.#listeners.set(page, listeners);

    // Listen for page close
    const closeHandler = () => this.cleanupPageDestroyed(page);
    this.#closeHandlers.set(page, closeHandler);
    page.on('close', closeHandler);
  }

  protected splitAfterNavigation(page: Page) {
    const navigations = this.storage.get(page);
    if (!navigations) {
      return;
    }
    navigations.unshift([]);
    navigations.splice(this.#maxNavigationSaved);
  }

  protected cleanupPageDestroyed(page: Page) {
    const listeners = this.#listeners.get(page);
    if (listeners) {
      for (const [name, listener] of Object.entries(listeners)) {
        page.off(name as keyof PageEvents, listener as any);
      }
    }
    const closeHandler = this.#closeHandlers.get(page);
    if (closeHandler) {
      page.off('close', closeHandler);
    }
    this.#closeHandlers.delete(page);
    this.storage.delete(page);
  }

  getData(page: Page, includePreservedData?: boolean): T[] {
    const navigations = this.storage.get(page);
    if (!navigations) {
      return [];
    }

    if (!includePreservedData) {
      return navigations[0];
    }

    const data: T[] = [];
    for (let index = this.#maxNavigationSaved; index >= 0; index--) {
      if (navigations[index]) {
        data.push(...navigations[index]);
      }
    }
    return data;
  }

  getIdForResource(resource: WithSymbolId<T>): number {
    return resource[stableIdSymbol] ?? -1;
  }

  getById(page: Page, stableId: number): T {
    const navigations = this.storage.get(page);
    if (!navigations) {
      throw new Error('No requests found for selected page');
    }

    const item = this.find(page, item => item[stableIdSymbol] === stableId);
    if (item) {
      return item;
    }

    throw new Error('Request not found for selected page');
  }

  find(
    page: Page,
    filter: (item: WithSymbolId<T>) => boolean,
  ): WithSymbolId<T> | undefined {
    const navigations = this.storage.get(page);
    if (!navigations) {
      return;
    }

    for (const navigation of navigations) {
      const item = navigation.find(filter);
      if (item) {
        return item;
      }
    }
    return;
  }
}

export class ConsoleCollector extends PageCollector<
  ConsoleMessage | Error | AggregatedIssue
> {
  #subscribedPages = new WeakMap<Page, PageIssueSubscriber>();
  #collectFn?: (item: ConsoleMessage | Error | AggregatedIssue) => void;

  constructor(
    context: BrowserContext,
    listeners: (
      collector: (item: ConsoleMessage | Error | AggregatedIssue) => void,
    ) => ListenerMap,
  ) {
    // Wrap the listener initializer to capture the collect function
    super(context, (collect) => {
      this.#collectFn = collect;
      return listeners(collect);
    });
  }

  override addPage(page: Page): void {
    super.addPage(page);
    if (!features.issues) {
      return;
    }
    if (!this.#subscribedPages.has(page) && this.#collectFn) {
      const subscriber = new PageIssueSubscriber(page, this.#collectFn);
      this.#subscribedPages.set(page, subscriber);
      void subscriber.subscribe();
    }
  }

  protected override cleanupPageDestroyed(page: Page): void {
    super.cleanupPageDestroyed(page);
    this.#subscribedPages.get(page)?.unsubscribe();
    this.#subscribedPages.delete(page);
  }
}

class PageIssueSubscriber {
  #issueManager = new FakeIssuesManager();
  #issueAggregator = new IssueAggregator(this.#issueManager);
  #seenKeys = new Set<string>();
  #seenIssues = new Set<AggregatedIssue>();
  #page: Page;
  #session: CDPSession | null = null;
  #collect: (item: AggregatedIssue) => void;

  constructor(page: Page, collect: (item: AggregatedIssue) => void) {
    this.#page = page;
    this.#collect = collect;
  }

  #resetIssueAggregator() {
    this.#issueManager = new FakeIssuesManager();
    if (this.#issueAggregator) {
      this.#issueAggregator.removeEventListener(
        IssueAggregatorEvents.AGGREGATED_ISSUE_UPDATED,
        this.#onAggregatedissue,
      );
    }
    this.#issueAggregator = new IssueAggregator(this.#issueManager);
    this.#issueAggregator.addEventListener(
      IssueAggregatorEvents.AGGREGATED_ISSUE_UPDATED,
      this.#onAggregatedissue,
    );
  }

  async subscribe() {
    this.#session = await getCdpClient(this.#page);
    this.#resetIssueAggregator();
    this.#page.on('framenavigated', this.#onFrameNavigated);
    this.#session.on('Audits.issueAdded', this.#onIssueAdded);
    try {
      await this.#session.send('Audits.enable');
    } catch (error) {
      logger('Error subscribing to issues', error);
    }
  }

  unsubscribe() {
    this.#seenKeys.clear();
    this.#seenIssues.clear();
    this.#page.off('framenavigated', this.#onFrameNavigated);
    if (this.#session) {
      this.#session.off('Audits.issueAdded', this.#onIssueAdded);
      void this.#session.send('Audits.disable').catch(() => {});
    }
    if (this.#issueAggregator) {
      this.#issueAggregator.removeEventListener(
        IssueAggregatorEvents.AGGREGATED_ISSUE_UPDATED,
        this.#onAggregatedissue,
      );
    }
  }

  #onAggregatedissue = (
    event: Common.EventTarget.EventTargetEvent<AggregatedIssue>,
  ) => {
    if (this.#seenIssues.has(event.data)) {
      return;
    }
    this.#seenIssues.add(event.data);
    // Direct push to collector instead of page.emit('issue')
    this.#collect(event.data);
  };

  #onFrameNavigated = (frame: Frame) => {
    if (frame !== frame.page().mainFrame()) {
      return;
    }
    this.#seenKeys.clear();
    this.#seenIssues.clear();
    this.#resetIssueAggregator();
  };

  #onIssueAdded = (data: Protocol.Audits.IssueAddedEvent) => {
    try {
      const inspectorIssue = data.issue;
      // @ts-expect-error Types of protocol from devtools-protocol and CDP are
      // incomparable for InspectorIssueCode, one is union, other is enum.
      const issue = createIssuesFromProtocolIssue(null, inspectorIssue)[0];
      if (!issue) {
        logger('No issue mapping for the issue: ', inspectorIssue.code);
        return;
      }

      const primaryKey = issue.primaryKey();
      if (this.#seenKeys.has(primaryKey)) {
        return;
      }
      this.#seenKeys.add(primaryKey);
      this.#issueManager.dispatchEventToListeners(
        IssuesManagerEvents.ISSUE_ADDED,
        {
          issue,
          // @ts-expect-error We don't care that issues model is null
          issuesModel: null,
        },
      );
    } catch (error) {
      logger('Error creating a new issue', error);
    }
  };
}

export class NetworkCollector extends PageCollector<HTTPRequest> {
  #initiators = new WeakMap<Page, Map<string, RequestInitiator>>();
  #cdpListeners = new WeakMap<
    Page,
    (event: Protocol.Network.RequestWillBeSentEvent) => void
  >();
  #cdpSessions = new WeakMap<Page, CDPSession>();

  constructor(
    context: BrowserContext,
    listeners: (
      collector: (item: HTTPRequest) => void,
    ) => ListenerMap = collect => {
      return {
        request: (req: HTTPRequest) => {
          collect(req);
        },
      };
    },
  ) {
    super(context, listeners);
  }

  override addPage(page: Page): void {
    super.addPage(page);
    void this.#setupInitiatorCollection(page);
  }

  async #setupInitiatorCollection(page: Page): Promise<void> {
    if (this.#initiators.has(page)) {
      return;
    }

    const initiatorMap = new Map<string, RequestInitiator>();
    this.#initiators.set(page, initiatorMap);

    const onRequestWillBeSent = (
      event: Protocol.Network.RequestWillBeSentEvent,
    ): void => {
      if (event.initiator) {
        initiatorMap.set(event.requestId, event.initiator as RequestInitiator);
      }
    };

    this.#cdpListeners.set(page, onRequestWillBeSent);

    try {
      const client = await getCdpClient(page);
      this.#cdpSessions.set(page, client);
      client.on('Network.requestWillBeSent', onRequestWillBeSent);
    } catch {
      // Page might be closed
    }
  }

  protected override cleanupPageDestroyed(page: Page): void {
    super.cleanupPageDestroyed(page);

    const listener = this.#cdpListeners.get(page);
    const client = this.#cdpSessions.get(page);
    if (listener && client) {
      try {
        client.off('Network.requestWillBeSent', listener);
      } catch {
        // Page might already be closed
      }
    }
    this.#cdpListeners.delete(page);
    this.#cdpSessions.delete(page);
    this.#initiators.delete(page);
  }

  getInitiator(page: Page, request: HTTPRequest): RequestInitiator | undefined {
    const initiatorMap = this.#initiators.get(page);
    if (!initiatorMap) {
      return undefined;
    }
    // In Playwright, we don't have request.id directly.
    // We match by URL + method as fallback, but primary match is via CDP requestId
    // stored during Network.requestWillBeSent.
    // For now, iterate and match by URL (this is a known limitation).
    // TODO: improve request-to-CDP-requestId matching
    return undefined;
  }

  getInitiatorByRequestId(
    page: Page,
    requestId: string,
  ): RequestInitiator | undefined {
    const initiatorMap = this.#initiators.get(page);
    return initiatorMap?.get(requestId);
  }

  override splitAfterNavigation(page: Page) {
    const navigations = this.storage.get(page) ?? [];
    if (!navigations) {
      return;
    }

    const requests = navigations[0];

    const lastRequestIdx = requests.findLastIndex(request => {
      return request.frame() === page.mainFrame()
        ? request.isNavigationRequest()
        : false;
    });

    if (lastRequestIdx !== -1) {
      const fromCurrentNavigation = requests.splice(lastRequestIdx);
      navigations.unshift(fromCurrentNavigation);
    } else {
      navigations.unshift([]);
    }

    const initiatorMap = this.#initiators.get(page);
    if (initiatorMap) {
      initiatorMap.clear();
    }
  }
}
```

**Key changes from original:**
- Constructor takes `BrowserContext` instead of `Browser`
- `browser.on('targetcreated/destroyed')` → `context.on('page')` + `page.on('close')`
- `Handler<unknown>` → `any` cast (Playwright uses different event typing)
- `page.emit('issue')` → direct `collect()` callback
- `getCdpClient()` → `await getCdpClient()` (async)
- `ConsoleCollector` captures `collect` function and passes it to `PageIssueSubscriber`
- `NetworkCollector` stores CDP sessions in WeakMap since getCdpClient is async
- Removed `includeAllPages` parameter (not applicable in Playwright)
- Removed `Target` type import

**Step 2: Commit**

```bash
git add src/PageCollector.ts
git commit -m "refactor: rewrite PageCollector for Playwright event model"
```

---

## Task 7: Rewrite WebSocketCollector.ts

**Files:**
- Modify: `src/WebSocketCollector.ts`

**Step 1: Same event model changes as PageCollector**

Key changes:
- Constructor takes `BrowserContext` instead of `Browser`
- `browser.on('targetcreated/destroyed')` → `context.on('page')` + `page.on('close')`
- `getCdpClient()` → `await getCdpClient()` (async in `#setupCdpListeners`)
- Remove `Target` import
- Remove `includeAllPages` parameter
- Store CDP session reference for cleanup

The structure mirrors PageCollector changes. Update:
1. Replace `Browser` with `BrowserContext` in constructor and field
2. Replace `targetcreated/destroyed` events with `context.on('page')` + per-page close handler
3. Make `#setupCdpListeners` async
4. Store CDP session per page for cleanup
5. Remove `@ts-expect-error includeAllPages` lines

**Step 2: Commit**

```bash
git add src/WebSocketCollector.ts
git commit -m "refactor: rewrite WebSocketCollector for Playwright event model"
```

---

## Task 8: Rewrite McpContext.ts

**Files:**
- Modify: `src/McpContext.ts`

This is the largest change. Key modifications:

1. **Import changes:**
   - Remove `Locator` value import (use page.locator API)
   - Remove `PredefinedNetworkConditions` reference
   - Add `BrowserContext` type
   - Import `getDefaultContext` from browser.ts

2. **Constructor changes:**
   - Store `BrowserContext` reference (derived from browser)
   - Pass `BrowserContext` to collectors instead of `Browser`
   - Remove `locatorClass` parameter (Playwright uses page.locator)

3. **Page management changes:**
   - `browser.pages()` → `getDefaultContext(browser).pages()`
   - `browser.newPage()` → `getDefaultContext(browser).newPage()`
   - `evaluateOnNewDocument` → `addInitScript`

4. **CDP changes (all getCdpClient calls become async):**
   - `#initDebugger`: `getCdpClient(page)` → `await getCdpClient(page)`
   - `addPersistentScript`: add `await`
   - `removePersistentScript`: add `await`
   - `getCookies`: add `await`
   - `setCookie`: add `await`
   - `deleteCookies`: add `await`
   - Remove `frame.client` access → use `page.context().newCDPSession(frame)` or keep CDP session from debugger

5. **Locator.race replacement:**
   - `Locator.race(frames.flatMap(...))` → chain `.or()` on locators
   - Playwright: `loc1.or(loc2).or(loc3)...`

6. **DevTools detection:**
   - `page._client().send('Target.getTargetInfo')` → use CDP session from cache
   - Remove `experimentalIncludeAllPages` parameter

7. **Remove `getNavigationTimeout`** — Playwright doesn't expose `page.getDefaultNavigationTimeout()`. Track internally.

**Step 2: Commit**

```bash
git add src/McpContext.ts
git commit -m "refactor: rewrite McpContext for patchright BrowserContext API"
```

---

## Task 9: Update WaitForHelper.ts

**Files:**
- Modify: `src/WaitForHelper.ts`

**Step 1: Key changes**

1. Remove `CdpPage` type — use `Page`
2. `getCdpClient()` calls → `await getCdpClient()` (but this is in sync context...)
   - Solution: pre-resolve the CDP client in constructor or make methods that use it async
   - The `waitForNavigationStarted` method uses `getCdpClient` synchronously in a callback. Need to resolve it upfront.
3. Change constructor to accept and store a pre-resolved CDPSession

```typescript
import {logger} from './logger.js';
import type {Page, CDPSession, Protocol} from './third_party/index.js';

export class WaitForHelper {
  #abortController = new AbortController();
  #page: Page;
  #cdpClient: CDPSession;
  #stableDomTimeout: number;
  #stableDomFor: number;
  #expectNavigationIn: number;
  #navigationTimeout: number;

  constructor(
    page: Page,
    cdpClient: CDPSession,
    cpuTimeoutMultiplier: number,
    networkTimeoutMultiplier: number,
  ) {
    this.#stableDomTimeout = 3000 * cpuTimeoutMultiplier;
    this.#stableDomFor = 100 * cpuTimeoutMultiplier;
    this.#expectNavigationIn = 100 * cpuTimeoutMultiplier;
    this.#navigationTimeout = 3000 * networkTimeoutMultiplier;
    this.#page = page;
    this.#cdpClient = cdpClient;
  }

  // ... rest stays mostly the same but use this.#cdpClient instead of getCdpClient(this.#page)
  // and this.#page instead of this.#page as CdpPage cast
}
```

Then in `McpContext.getWaitForHelper`, resolve the CDP client before constructing:

```typescript
async getWaitForHelper(page: Page, cpuMultiplier: number, networkMultiplier: number) {
  const client = await getCdpClient(page);
  return new WaitForHelper(page, client, cpuMultiplier, networkMultiplier);
}
```

**Step 2: Commit**

```bash
git add src/WaitForHelper.ts
git commit -m "refactor: update WaitForHelper for patchright Page + CDPSession"
```

---

## Task 10: Update FetchInterceptor.ts and DebuggerContext.ts

**Files:**
- Modify: `src/FetchInterceptor.ts`
- Modify: `src/DebuggerContext.ts`

These files are pure CDP — they only use `CDPSession` and `Protocol` types. The changes are minimal:

**Step 1: Update FetchInterceptor.ts imports**

The `CDPSession` and `Protocol` types come from the updated `third_party/index.ts`.
Since that file now exports `CDPSession` from `patchright` and `Protocol` from `devtools-protocol`,
the imports should still work. Verify and fix any type mismatches.

Playwright's `CDPSession` has the same `.send()`, `.on()`, `.off()` API as Puppeteer's for CDP events.
No logic changes needed.

**Step 2: Update DebuggerContext.ts imports**

Same as above — verify Protocol type compatibility. The CDP event handler types should be compatible.

**Step 3: Commit**

```bash
git add src/FetchInterceptor.ts src/DebuggerContext.ts
git commit -m "refactor: update CDP-only files for patchright types"
```

---

## Task 11: Update ToolDefinition.ts, McpResponse.ts, formatters

**Files:**
- Modify: `src/tools/ToolDefinition.ts`
- Modify: `src/McpResponse.ts`
- Modify: `src/formatters/networkFormatter.ts`
- Modify: `src/formatters/consoleFormatter.ts`

**Step 1: ToolDefinition.ts**

- `HTTPRequest` is already aliased in third_party, so import stays
- `Protocol` now from devtools-protocol via third_party
- Remove any types that don't exist (`ResourceType` → `string`)
- `getWaitForHelper` becomes async → update `Context` interface

**Step 2: McpResponse.ts**

- `ResourceType` → `string`
- `ConsoleMessage` API: Playwright's ConsoleMessage has `.type()`, `.text()`, `.args()` — same as Puppeteer
- `request.resourceType()` → returns string in Playwright (same)
- `request.response()` → returns Response in Playwright (same API surface)

**Step 3: networkFormatter.ts**

- `HTTPRequest` and `HTTPResponse` are aliased in third_party → import works
- `request.method()`, `.url()`, `.headers()`, `.postData()`, `.hasPostData()` — all exist in Playwright's Request
- `response.status()`, `.headers()` — exist in Playwright's Response
- `response.buffer()` → Playwright uses `response.body()` which returns `Buffer`
- `request.failure()` → Playwright uses `request.failure()` which returns `{errorText: string} | null`
- `request.redirectChain()` → exists in Playwright
- `request.fetchPostData()` → does NOT exist in Playwright. Use `request.postDataBuffer()` instead

**Step 4: Commit**

```bash
git add src/tools/ToolDefinition.ts src/McpResponse.ts src/formatters/
git commit -m "refactor: update ToolDefinition, McpResponse, formatters for patchright types"
```

---

## Task 12: Update all tool files + utils/keyboard.ts

**Files:**
- Modify: `src/tools/console.ts`
- Modify: `src/tools/debugger.ts`
- Modify: `src/tools/frames.ts`
- Modify: `src/tools/network.ts`
- Modify: `src/tools/pages.ts`
- Modify: `src/tools/screenshot.ts`
- Modify: `src/tools/script.ts`
- Modify: `src/tools/websocket.ts`
- Modify: `src/tools/fetch.ts`
- Modify: `src/tools/persistent-scripts.ts`
- Modify: `src/tools/cookies.ts`
- Modify: `src/utils/keyboard.ts`

Most changes are mechanical:

**console.ts:**
- `ConsoleMessageType` → `string`

**network.ts:**
- `ResourceType` → `string`

**pages.ts:**
- Remove `@ts-expect-error ignoreCache` → Playwright reload does not support `ignoreCache`, use CDP `Page.reload` with `ignoreCache` param instead, or remove the option

**script.ts:**
- `JSHandle` exists in Playwright → import works
- `frame.evaluateHandle()`, `frame.evaluate()` → same API

**screenshot.ts:**
- `page.screenshot({type, fullPage, encoding})` → same API

**frames.ts:**
- `Frame` type → same

**fetch.ts:**
- Uses `getCdpClient` → already async, add `await` if needed

**keyboard.ts:**
- `KeyInput` → `string`
- Remove the type import, change `throwIfInvalidKey` return to `string`

**Step 2: Commit**

```bash
git add src/tools/ src/utils/keyboard.ts
git commit -m "refactor: update all tool files for patchright types"
```

---

## Task 13: Update main.ts

**Files:**
- Modify: `src/main.ts`

**Step 1: Key changes**

1. **Remove stealth script loading** — delete the entire `initScript` IIFE that loads stealth.min.js and stealth-patch.js. Replace with simpler logic:
   - If `args.initScript` is provided, load it
   - Otherwise, `initScript` is `undefined` (Patchright handles anti-detection natively)

2. **Update imports** — remove any puppeteer-specific imports

3. **Add input tools** import (if created in Task 15)

```typescript
const initScript = args.initScript
  ? fs.readFileSync(args.initScript, 'utf-8')
  : undefined;
```

**Step 2: Commit**

```bash
git add src/main.ts
git commit -m "refactor: simplify main.ts, remove stealth script loading"
```

---

## Task 14: Delete stealth scripts + cleanup

**Files:**
- Delete: `scripts/stealth.min.js`
- Delete: `scripts/stealth-patch.js`

**Step 1: Delete files**

```bash
rm scripts/stealth.min.js scripts/stealth-patch.js
```

**Step 2: Remove any remaining references**

Search for "stealth" references in the codebase:
```bash
grep -r "stealth" src/ scripts/
```

Remove any found references.

**Step 3: Compile check**

Run: `npm run typecheck`

Fix any remaining type errors. This is the integration checkpoint — all previous tasks' changes should compose into a compilable project.

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: delete stealth scripts, patchright handles anti-detection natively"
```

---

## Task 15: Add input tools (new feature)

**Files:**
- Create: `src/tools/input.ts`
- Modify: `src/main.ts` (add import)
- Modify: `src/tools/categories.ts` (add INPUT category if needed)

**Step 1: Create input.ts**

Implement these MCP tools using Playwright's native APIs:

- `click_element` — `page.click(selector)` or `page.mouse.click(x, y)`
- `type_text` — `page.type(selector, text)` (keystroke by keystroke)
- `fill_text` — `page.fill(selector, text)` (fast fill)
- `press_key` — `page.keyboard.press(key)` (supports combos like Control+A)
- `select_option` — `page.selectOption(selector, value)`
- `hover_element` — `page.hover(selector)`
- `scroll_page` — `page.mouse.wheel(deltaX, deltaY)`
- `wait_for_selector` — `page.waitForSelector(selector)`
- `get_element_text` — `page.locator(selector).textContent()`
- `get_element_attribute` — `page.locator(selector).getAttribute(name)`

Each tool follows the `defineTool()` pattern with zod schema.

**Step 2: Register in main.ts**

```typescript
import * as inputTools from './tools/input.js';
// Add to tools array:
...Object.values(inputTools),
```

**Step 3: Commit**

```bash
git add src/tools/input.ts src/tools/categories.ts src/main.ts
git commit -m "feat: add input tools (click, type, fill, press, select, hover, scroll)"
```

---

## Task 16: Full build + smoke test

**Step 1: Build**

Run: `npm run build`

Fix any compilation errors.

**Step 2: Smoke test with MCP Inspector**

Run: `npx @modelcontextprotocol/inspector node build/src/index.js`

Test:
- [ ] Server starts without errors
- [ ] `list_pages` returns pages
- [ ] `navigate_page` works
- [ ] `take_screenshot` works
- [ ] `evaluate_script` works
- [ ] `list_scripts` works
- [ ] `click_element` works (new)

**Step 3: Update docs**

Run: `npm run docs`

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete patchright migration"
```
