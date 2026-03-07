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
 * Contains the call stack when the request was initiated.
 */
export interface RequestInitiator {
  type:
    | 'parser'
    | 'script'
    | 'preload'
    | 'SignedExchange'
    | 'preflight'
    | 'other';
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      page.on(name as any, listener as any);
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        page.off(name as any, listener as any);
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.#session.on('Audits.issueAdded', this.#onIssueAdded as any);
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.#session.off('Audits.issueAdded', this.#onIssueAdded as any);
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
    // Match by URL as fallback. Primary match is via CDP requestId.
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
