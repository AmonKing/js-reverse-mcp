/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {type AggregatedIssue} from '../node_modules/chrome-devtools-frontend/mcp/mcp.js';

import {getDefaultContext} from './browser.js';
import {DebuggerContext} from './DebuggerContext.js';
import {FetchInterceptor} from './FetchInterceptor.js';
import {extractUrlLikeFromDevToolsTitle, urlsEqual} from './DevtoolsUtils.js';
import type {TrafficSummary} from './formatters/websocketFormatter.js';
import {NetworkCollector, ConsoleCollector} from './PageCollector.js';
import type {ListenerMap, RequestInitiator} from './PageCollector.js';
import type {
  Browser,
  BrowserContext,
  ConsoleMessage,
  Debugger,
  Dialog,
  Frame,
  HTTPRequest,
  Page,
  Protocol,
} from './third_party/index.js';
import {listPages} from './tools/pages.js';
import {getCdpClient} from './utils/cdp.js';
import {CLOSE_PAGE_ERROR} from './tools/ToolDefinition.js';
import type {Context, DevToolsData} from './tools/ToolDefinition.js';
import type {TraceResult} from './trace-processing/parse.js';
import {WaitForHelper} from './WaitForHelper.js';
import type {WebSocketData} from './WebSocketCollector.js';
import {WebSocketCollector} from './WebSocketCollector.js';

interface McpContextOptions {
  // Whether the DevTools windows are exposed as pages for debugging of DevTools.
  experimentalDevToolsDebugging: boolean;
  // JavaScript to inject into every page before any other script runs.
  initScript?: string;
}

const DEFAULT_TIMEOUT = 5_000;
const NAVIGATION_TIMEOUT = 10_000;

function getNetworkMultiplierFromString(condition: string | null): number {
  switch (condition) {
    case 'Fast 4G':
      return 1;
    case 'Slow 4G':
      return 2.5;
    case 'Fast 3G':
      return 5;
    case 'Slow 3G':
      return 10;
  }
  return 1;
}

function getExtensionFromMimeType(mimeType: string) {
  switch (mimeType) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpeg';
    case 'image/webp':
      return 'webp';
  }
  throw new Error(`No mapping for Mime type ${mimeType}.`);
}

export class McpContext implements Context {
  browser: Browser;
  logger: Debugger;

  // The most recent page state.
  #pages: Page[] = [];
  #pageToDevToolsPage = new Map<Page, Page>();
  #selectedPage?: Page;
  #networkCollector: NetworkCollector;
  #consoleCollector: ConsoleCollector;
  #webSocketCollector: WebSocketCollector;

  #isRunningTrace = false;
  #networkConditionsMap = new WeakMap<Page, string>();
  #cpuThrottlingRateMap = new WeakMap<Page, number>();
  #dialog?: Dialog;
  #debuggerContext: DebuggerContext = new DebuggerContext();
  #fetchInterceptor: FetchInterceptor = new FetchInterceptor();
  #selectedFrame?: Frame;

  #traceResults: TraceResult[] = [];
  #trafficSummaryCache = new Map<number, TrafficSummary>();

  #options: McpContextOptions;
  #browserContext: BrowserContext;

  private constructor(
    browser: Browser,
    logger: Debugger,
    options: McpContextOptions,
  ) {
    this.browser = browser;
    this.logger = logger;
    this.#options = options;
    this.#browserContext = getDefaultContext(browser);

    this.#networkCollector = new NetworkCollector(this.#browserContext);

    this.#consoleCollector = new ConsoleCollector(
      this.#browserContext,
      collect => {
        return {
          console: event => {
            collect(event);
          },
          pageerror: event => {
            if (event instanceof Error) {
              collect(event);
            } else {
              const error = new Error(`${event}`);
              error.stack = undefined;
              collect(error);
            }
          },
        } as ListenerMap;
      },
    );

    this.#webSocketCollector = new WebSocketCollector(this.#browserContext);
  }

  async #init() {
    await this.createPagesSnapshot();
    if (this.#options.initScript) {
      for (const page of this.#pages) {
        await page.addInitScript(this.#options.initScript);
      }
    }
    await this.#networkCollector.init();
    await this.#consoleCollector.init();
    await this.#webSocketCollector.init();
    await this.#initDebugger();
  }

  async #initDebugger(frame?: Frame): Promise<void> {
    const page = this.getSelectedPage();
    if (!page) {
      return;
    }
    try {
      let client;
      if (frame && frame !== page.mainFrame()) {
        // For cross-origin iframes, create a CDP session for the frame's page
        // Playwright doesn't expose per-frame CDP sessions directly
        client = await getCdpClient(page);
      } else {
        client = await getCdpClient(page);
      }
      await this.#debuggerContext.enable(client);
      if (this.#fetchInterceptor.hasRules()) {
        await this.#fetchInterceptor.enable(client);
      }
    } catch (error) {
      this.logger('Failed to initialize debugger context', error);
    }
  }

  dispose() {
    this.#networkCollector.dispose();
    this.#consoleCollector.dispose();
    this.#webSocketCollector.dispose();
    void this.#debuggerContext.disable();
    void this.#fetchInterceptor.disable();
  }

  /**
   * Get the debugger context for script/breakpoint management.
   */
  get debuggerContext(): DebuggerContext {
    return this.#debuggerContext;
  }

  get fetchInterceptor(): FetchInterceptor {
    return this.#fetchInterceptor;
  }

  /**
   * Reinitialize the debugger for the current page.
   * Call this after selecting a new page.
   */
  async reinitDebugger(): Promise<void> {
    await this.#debuggerContext.disable();
    await this.#fetchInterceptor.detach();
    await this.#initDebugger();
  }

  /**
   * Reinitialize the debugger for a specific frame's CDP session.
   * This enables script collection from cross-origin iframes (OOPIFs).
   */
  async reinitDebuggerForFrame(frame: Frame): Promise<void> {
    await this.#debuggerContext.disable();
    await this.#fetchInterceptor.detach();
    await this.#initDebugger(frame);
  }

  static async from(
    browser: Browser,
    logger: Debugger,
    opts: McpContextOptions,
  ) {
    const context = new McpContext(browser, logger, opts);
    await context.#init();
    return context;
  }

  resolveCdpRequestId(cdpRequestId: string): number | undefined {
    const selectedPage = this.getSelectedPage();
    if (!cdpRequestId) {
      this.logger('no network request');
      return;
    }
    // In Playwright we can't access request.id directly, so we use
    // getInitiatorByRequestId which stores CDP request IDs
    const request = this.#networkCollector.find(selectedPage, () => {
      // We can't match by internal ID in Playwright
      // This is a known limitation - use getInitiatorByRequestId instead
      return false;
    });
    if (!request) {
      this.logger('no network request for ' + cdpRequestId);
      return;
    }
    return this.#networkCollector.getIdForResource(request);
  }

  getNetworkRequests(includePreservedRequests?: boolean): HTTPRequest[] {
    const page = this.getSelectedPage();
    return this.#networkCollector.getData(page, includePreservedRequests);
  }

  getConsoleData(
    includePreservedMessages?: boolean,
  ): Array<ConsoleMessage | Error | AggregatedIssue> {
    const page = this.getSelectedPage();
    return this.#consoleCollector.getData(page, includePreservedMessages);
  }

  getConsoleMessageStableId(
    message: ConsoleMessage | Error | AggregatedIssue,
  ): number {
    return this.#consoleCollector.getIdForResource(message);
  }

  getConsoleMessageById(id: number): ConsoleMessage | Error | AggregatedIssue {
    return this.#consoleCollector.getById(this.getSelectedPage(), id);
  }

  async newPage(): Promise<Page> {
    const page = await this.#browserContext.newPage();
    if (this.#options.initScript) {
      await page.addInitScript(this.#options.initScript);
    }
    await this.createPagesSnapshot();
    this.selectPage(page);
    this.#networkCollector.addPage(page);
    this.#consoleCollector.addPage(page);
    this.#webSocketCollector.addPage(page);
    return page;
  }
  async closePage(pageIdx: number): Promise<void> {
    if (this.#pages.length === 1) {
      throw new Error(CLOSE_PAGE_ERROR);
    }
    const page = this.getPageByIdx(pageIdx);
    await page.close({runBeforeUnload: false});
  }

  getNetworkRequestById(reqid: number): HTTPRequest {
    return this.#networkCollector.getById(this.getSelectedPage(), reqid);
  }

  setNetworkConditions(conditions: string | null): void {
    const page = this.getSelectedPage();
    if (conditions === null) {
      this.#networkConditionsMap.delete(page);
    } else {
      this.#networkConditionsMap.set(page, conditions);
    }
    this.#updateSelectedPageTimeouts();
  }

  getNetworkConditions(): string | null {
    const page = this.getSelectedPage();
    return this.#networkConditionsMap.get(page) ?? null;
  }

  setCpuThrottlingRate(rate: number): void {
    const page = this.getSelectedPage();
    this.#cpuThrottlingRateMap.set(page, rate);
    this.#updateSelectedPageTimeouts();
  }

  getCpuThrottlingRate(): number {
    const page = this.getSelectedPage();
    return this.#cpuThrottlingRateMap.get(page) ?? 1;
  }

  setIsRunningPerformanceTrace(x: boolean): void {
    this.#isRunningTrace = x;
  }

  isRunningPerformanceTrace(): boolean {
    return this.#isRunningTrace;
  }

  getDialog(): Dialog | undefined {
    return this.#dialog;
  }

  clearDialog(): void {
    this.#dialog = undefined;
  }

  getSelectedPage(): Page {
    const page = this.#selectedPage;
    if (!page) {
      throw new Error('No page selected');
    }
    if (page.isClosed()) {
      throw new Error(
        `The selected page has been closed. Call ${listPages.name} to see open pages.`,
      );
    }
    return page;
  }

  getPageByIdx(idx: number): Page {
    const pages = this.#pages;
    const page = pages[idx];
    if (!page) {
      throw new Error('No page found');
    }
    return page;
  }

  #dialogHandler = (dialog: Dialog): void => {
    this.#dialog = dialog;
  };

  isPageSelected(page: Page): boolean {
    return this.#selectedPage === page;
  }

  selectPage(newPage: Page): void {
    const oldPage = this.#selectedPage;
    if (oldPage) {
      oldPage.off('dialog', this.#dialogHandler);
    }
    this.#selectedPage = newPage;
    this.#selectedFrame = undefined;
    newPage.on('dialog', this.#dialogHandler);
    this.#updateSelectedPageTimeouts();
    // Reinitialize debugger for the new page
    void this.reinitDebugger();
  }

  getSelectedFrame(): Frame {
    return this.#selectedFrame ?? this.getSelectedPage().mainFrame();
  }

  selectFrame(frame: Frame): void {
    this.#selectedFrame = frame;
    void this.reinitDebuggerForFrame(frame);
  }

  resetSelectedFrame(): void {
    this.#selectedFrame = undefined;
    void this.reinitDebugger();
  }

  #persistentScripts = new Map<string, {identifier: string; label: string; code: string}>();

  async addPersistentScript(label: string, code: string): Promise<string> {
    const page = this.getSelectedPage();
    const client = await getCdpClient(page);
    const result = await client.send('Page.addScriptToEvaluateOnNewDocument', {
      source: code,
    });
    const identifier = result.identifier;
    this.#persistentScripts.set(identifier, {identifier, label, code});
    return identifier;
  }

  async removePersistentScript(identifier: string): Promise<boolean> {
    const page = this.getSelectedPage();
    const client = await getCdpClient(page);
    try {
      await client.send('Page.removeScriptToEvaluateOnNewDocument', {identifier});
      this.#persistentScripts.delete(identifier);
      return true;
    } catch {
      return false;
    }
  }

  getPersistentScripts(): Array<{identifier: string; label: string; code: string}> {
    return Array.from(this.#persistentScripts.values());
  }

  async getCookies(urls?: string[]): Promise<Protocol.Network.Cookie[]> {
    const page = this.getSelectedPage();
    const client = await getCdpClient(page);
    const params: Protocol.Network.GetCookiesRequest = {};
    if (urls && urls.length > 0) {
      params.urls = urls;
    }
    const result = await client.send('Network.getCookies', params);
    return result.cookies;
  }

  async setCookie(cookie: Protocol.Network.CookieParam): Promise<boolean> {
    const page = this.getSelectedPage();
    const client = await getCdpClient(page);
    const result = await client.send('Network.setCookie', cookie);
    return result.success;
  }

  async deleteCookies(params: Protocol.Network.DeleteCookiesRequest): Promise<void> {
    const page = this.getSelectedPage();
    const client = await getCdpClient(page);
    await client.send('Network.deleteCookies', params);
  }

  #updateSelectedPageTimeouts() {
    const page = this.getSelectedPage();
    const cpuMultiplier = this.getCpuThrottlingRate();
    page.setDefaultTimeout(DEFAULT_TIMEOUT * cpuMultiplier);
    const networkMultiplier = getNetworkMultiplierFromString(
      this.getNetworkConditions(),
    );
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT * networkMultiplier);
  }

  getNavigationTimeout() {
    // Playwright doesn't expose getDefaultNavigationTimeout()
    // Compute it from our settings
    const networkMultiplier = getNetworkMultiplierFromString(
      this.getNetworkConditions(),
    );
    return NAVIGATION_TIMEOUT * networkMultiplier;
  }

  /**
   * Creates a snapshot of the pages.
   */
  async createPagesSnapshot(): Promise<Page[]> {
    const allPages = this.#browserContext.pages();

    this.#pages = allPages.filter(page => {
      return (
        this.#options.experimentalDevToolsDebugging ||
        !page.url().startsWith('devtools://')
      );
    });

    if (!this.#selectedPage || this.#pages.indexOf(this.#selectedPage) === -1) {
      this.selectPage(this.#pages[0]);
    }

    await this.detectOpenDevToolsWindows();

    return this.#pages;
  }

  async detectOpenDevToolsWindows() {
    this.logger('Detecting open DevTools windows');
    const pages = this.#browserContext.pages();
    this.#pageToDevToolsPage = new Map<Page, Page>();
    for (const devToolsPage of pages) {
      if (devToolsPage.url().startsWith('devtools://')) {
        try {
          this.logger('Calling getTargetInfo for ' + devToolsPage.url());
          const client = await getCdpClient(devToolsPage);
          const data = await client.send('Target.getTargetInfo');
          const devtoolsPageTitle = data.targetInfo.title;
          const urlLike = extractUrlLikeFromDevToolsTitle(devtoolsPageTitle);
          if (!urlLike) {
            continue;
          }
          for (const page of this.#pages) {
            if (urlsEqual(page.url(), urlLike)) {
              this.#pageToDevToolsPage.set(page, devToolsPage);
            }
          }
        } catch (error) {
          this.logger('Issue occurred while trying to find DevTools', error);
        }
      }
    }
  }

  getPages(): Page[] {
    return this.#pages;
  }

  getDevToolsPage(page: Page): Page | undefined {
    return this.#pageToDevToolsPage.get(page);
  }

  async getDevToolsData(): Promise<DevToolsData> {
    try {
      this.logger('Getting DevTools UI data');
      const selectedPage = this.getSelectedPage();
      const devtoolsPage = this.getDevToolsPage(selectedPage);
      if (!devtoolsPage) {
        this.logger('No DevTools page detected');
        return {};
      }
      const {cdpRequestId, cdpBackendNodeId} = await devtoolsPage.evaluate(
        async () => {
          // @ts-expect-error no types
          const UI = await import('/bundled/ui/legacy/legacy.js');
          // @ts-expect-error no types
          const SDK = await import('/bundled/core/sdk/sdk.js');
          const request = UI.Context.Context.instance().flavor(
            SDK.NetworkRequest.NetworkRequest,
          );
          const node = UI.Context.Context.instance().flavor(
            SDK.DOMModel.DOMNode,
          );
          return {
            cdpRequestId: request?.requestId(),
            cdpBackendNodeId: node?.backendNodeId(),
          };
        },
      );
      return {cdpBackendNodeId, cdpRequestId};
    } catch (err) {
      this.logger('error getting devtools data', err);
    }
    return {};
  }

  async saveTemporaryFile(
    data: Uint8Array<ArrayBufferLike>,
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp',
  ): Promise<{filename: string}> {
    try {
      const dir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'chrome-devtools-mcp-'),
      );

      const filename = path.join(
        dir,
        `screenshot.${getExtensionFromMimeType(mimeType)}`,
      );
      await fs.writeFile(filename, data);
      return {filename};
    } catch (err) {
      this.logger(err);
      throw new Error('Could not save a screenshot to a file', {cause: err});
    }
  }
  async saveFile(
    data: Uint8Array<ArrayBufferLike>,
    filename: string,
  ): Promise<{filename: string}> {
    try {
      const filePath = path.resolve(filename);
      await fs.writeFile(filePath, data);
      return {filename};
    } catch (err) {
      this.logger(err);
      throw new Error('Could not save a screenshot to a file', {cause: err});
    }
  }

  storeTraceRecording(result: TraceResult): void {
    this.#traceResults.push(result);
  }

  recordedTraces(): TraceResult[] {
    return this.#traceResults;
  }

  async getWaitForHelper(
    page: Page,
    cpuMultiplier: number,
    networkMultiplier: number,
  ) {
    const client = await getCdpClient(page);
    return new WaitForHelper(page, client, cpuMultiplier, networkMultiplier);
  }

  async waitForEventsAfterAction(action: () => Promise<unknown>): Promise<void> {
    const page = this.getSelectedPage();
    const cpuMultiplier = this.getCpuThrottlingRate();
    const networkMultiplier = getNetworkMultiplierFromString(
      this.getNetworkConditions(),
    );
    const waitForHelper = await this.getWaitForHelper(
      page,
      cpuMultiplier,
      networkMultiplier,
    );
    return waitForHelper.waitForEventsAfterAction(action);
  }

  getNetworkRequestStableId(request: HTTPRequest): number {
    return this.#networkCollector.getIdForResource(request);
  }

  /**
   * Get the initiator (call stack) for a network request.
   */
  getRequestInitiator(request: HTTPRequest): RequestInitiator | undefined {
    const page = this.getSelectedPage();
    return this.#networkCollector.getInitiator(page, request);
  }

  /**
   * Get the initiator by request ID.
   */
  getRequestInitiatorById(requestId: number): RequestInitiator | undefined {
    const page = this.getSelectedPage();
    const request = this.#networkCollector.getById(page, requestId);
    return this.#networkCollector.getInitiator(page, request);
  }

  /**
   * Get all WebSocket connections for the selected page.
   */
  getWebSocketConnections(includePreservedData?: boolean): WebSocketData[] {
    const page = this.getSelectedPage();
    return this.#webSocketCollector.getData(page, includePreservedData);
  }

  /**
   * Get a WebSocket connection by stable ID.
   */
  getWebSocketById(wsid: number): WebSocketData {
    const page = this.getSelectedPage();
    return this.#webSocketCollector.getById(page, wsid);
  }

  /**
   * Get stable ID for a WebSocket connection.
   */
  getWebSocketStableId(ws: WebSocketData): number {
    return this.#webSocketCollector.getIdForResource(ws);
  }

  /**
   * Cache traffic summary for a WebSocket connection.
   */
  cacheTrafficSummary(wsid: number, summary: TrafficSummary): void {
    this.#trafficSummaryCache.set(wsid, summary);
  }

  /**
   * Get cached traffic summary for a WebSocket connection.
   */
  getCachedTrafficSummary(wsid: number): TrafficSummary | undefined {
    return this.#trafficSummaryCache.get(wsid);
  }

  async waitForTextOnPage({
    text,
    timeout,
  }: {
    text: string;
    timeout?: number | undefined;
  }): Promise<void> {
    const page = this.getSelectedPage();
    const frames = page.frames();

    // Build an .or() chain across all frames with aria and text locators
    const locators = frames.flatMap(frame => [
      frame.locator(`text=${text}`),
      frame.getByText(text),
    ]);

    if (locators.length === 0) {
      throw new Error('No frames available');
    }

    let combined = locators[0];
    for (let i = 1; i < locators.length; i++) {
      combined = combined.or(locators[i]);
    }

    await combined.first().waitFor({
      timeout: timeout ?? DEFAULT_TIMEOUT,
    });
  }

  /**
   * We need to ignore favicon request as they make our test flaky
   */
  async setUpNetworkCollectorForTesting() {
    this.#networkCollector = new NetworkCollector(this.#browserContext, collect => {
      return {
        request: req => {
          if (req.url().includes('favicon.ico')) {
            return;
          }
          collect(req);
        },
      } as ListenerMap;
    });
    await this.#networkCollector.init();
  }
}
