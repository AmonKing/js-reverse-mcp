/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {RequestInitiator} from './PageCollector.js';
import type {
  BrowserContext,
  CDPSession,
  Page,
  Protocol,
} from './third_party/index.js';
import {getCdpClient} from './utils/cdp.js';

/**
 * WebSocket connection status.
 */
export type WebSocketStatus = 'connecting' | 'open' | 'closed';

/**
 * WebSocket frame direction.
 */
export type WebSocketDirection = 'sent' | 'received';

/**
 * WebSocket connection information.
 */
export interface WebSocketConnection {
  requestId: string;
  url: string;
  initiator?: RequestInitiator;
  status: WebSocketStatus;
  createdAt: number;
  closedAt?: number;
}

/**
 * WebSocket frame (message).
 */
export interface WebSocketFrame {
  requestId: string;
  direction: WebSocketDirection;
  timestamp: number;
  opcode: number; // 1=text, 2=binary
  payloadData: string;
}

/**
 * Combined WebSocket data structure.
 */
export interface WebSocketData {
  connection: WebSocketConnection;
  frames: WebSocketFrame[];
}

const stableIdSymbol = Symbol('wsStableIdSymbol');

type WebSocketDataWithId = WebSocketData & {
  [stableIdSymbol]?: number;
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

/**
 * Collector for WebSocket connections and messages.
 * Listens to CDP Network events for WebSocket activity.
 */
export class WebSocketCollector {
  #context: BrowserContext;

  /**
   * Storage: Page -> Array of navigations -> Array of WebSocket connections.
   * Newer navigations come first.
   */
  #storage = new WeakMap<Page, WebSocketDataWithId[][]>();

  /**
   * Quick lookup: Page -> requestId -> WebSocketData
   */
  #connectionMap = new WeakMap<Page, Map<string, WebSocketDataWithId>>();

  /**
   * ID generator per page for stable IDs.
   */
  #idGenerators = new WeakMap<Page, () => number>();

  /**
   * CDP listeners per page.
   */
  #cdpListeners = new WeakMap<
    Page,
    {
      onCreated: (event: Protocol.Network.WebSocketCreatedEvent) => void;
      onFrameSent: (event: Protocol.Network.WebSocketFrameSentEvent) => void;
      onFrameReceived: (
        event: Protocol.Network.WebSocketFrameReceivedEvent,
      ) => void;
      onClosed: (event: Protocol.Network.WebSocketClosedEvent) => void;
      onFrameNavigated: () => void;
    }
  >();

  /**
   * CDP sessions per page for cleanup.
   */
  #cdpSessions = new WeakMap<Page, CDPSession>();

  /**
   * Close handlers per page.
   */
  #closeHandlers = new WeakMap<Page, () => void>();

  #maxNavigationSaved = 3;

  constructor(context: BrowserContext) {
    this.#context = context;
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

  addPage(page: Page) {
    if (this.#storage.has(page)) {
      return;
    }

    const idGenerator = createIdGenerator();
    this.#idGenerators.set(page, idGenerator);

    const storedLists: WebSocketDataWithId[][] = [[]];
    this.#storage.set(page, storedLists);
    this.#connectionMap.set(page, new Map());

    void this.#setupCdpListeners(page);

    // Listen for page close
    const closeHandler = () => this.#cleanupPage(page);
    this.#closeHandlers.set(page, closeHandler);
    page.on('close', closeHandler);
  }

  async #setupCdpListeners(page: Page): Promise<void> {
    let client: CDPSession;
    try {
      client = await getCdpClient(page);
    } catch {
      return; // Page might be closed
    }
    this.#cdpSessions.set(page, client);

    const connectionMap = this.#connectionMap.get(page)!;
    const idGenerator = this.#idGenerators.get(page)!;

    const onCreated = (event: Protocol.Network.WebSocketCreatedEvent): void => {
      const wsData: WebSocketDataWithId = {
        connection: {
          requestId: event.requestId,
          url: event.url,
          initiator: event.initiator as RequestInitiator | undefined,
          status: 'connecting',
          createdAt: Date.now(),
        },
        frames: [],
      };
      wsData[stableIdSymbol] = idGenerator();

      connectionMap.set(event.requestId, wsData);

      const navigations = this.#storage.get(page);
      if (navigations) {
        navigations[0].push(wsData);
      }

      wsData.connection.status = 'open';
    };

    const onFrameSent = (
      event: Protocol.Network.WebSocketFrameSentEvent,
    ): void => {
      const wsData = connectionMap.get(event.requestId);
      if (!wsData) {
        return;
      }

      wsData.frames.push({
        requestId: event.requestId,
        direction: 'sent',
        timestamp: event.timestamp * 1000,
        opcode: event.response.opcode,
        payloadData: event.response.payloadData,
      });
    };

    const onFrameReceived = (
      event: Protocol.Network.WebSocketFrameReceivedEvent,
    ): void => {
      const wsData = connectionMap.get(event.requestId);
      if (!wsData) {
        return;
      }

      wsData.frames.push({
        requestId: event.requestId,
        direction: 'received',
        timestamp: event.timestamp * 1000,
        opcode: event.response.opcode,
        payloadData: event.response.payloadData,
      });
    };

    const onClosed = (event: Protocol.Network.WebSocketClosedEvent): void => {
      const wsData = connectionMap.get(event.requestId);
      if (!wsData) {
        return;
      }

      wsData.connection.status = 'closed';
      wsData.connection.closedAt = event.timestamp * 1000;
    };

    const onFrameNavigated = (): void => {
      this.#splitAfterNavigation(page);
    };

    client.on('Network.webSocketCreated', onCreated);
    client.on('Network.webSocketFrameSent', onFrameSent);
    client.on('Network.webSocketFrameReceived', onFrameReceived);
    client.on('Network.webSocketClosed', onClosed);
    page.on('framenavigated', frame => {
      if (frame === page.mainFrame()) {
        onFrameNavigated();
      }
    });

    this.#cdpListeners.set(page, {
      onCreated,
      onFrameSent,
      onFrameReceived,
      onClosed,
      onFrameNavigated,
    });
  }

  #splitAfterNavigation(page: Page): void {
    const navigations = this.#storage.get(page);
    if (!navigations) {
      return;
    }

    navigations.unshift([]);
    navigations.splice(this.#maxNavigationSaved);

    this.#connectionMap.set(page, new Map());
  }

  #cleanupPage(page: Page): void {
    const listeners = this.#cdpListeners.get(page);
    const client = this.#cdpSessions.get(page);
    if (listeners && client) {
      try {
        client.off('Network.webSocketCreated', listeners.onCreated);
        client.off('Network.webSocketFrameSent', listeners.onFrameSent);
        client.off('Network.webSocketFrameReceived', listeners.onFrameReceived);
        client.off('Network.webSocketClosed', listeners.onClosed);
      } catch {
        // Page might already be closed
      }
    }

    const closeHandler = this.#closeHandlers.get(page);
    if (closeHandler) {
      page.off('close', closeHandler);
    }

    this.#closeHandlers.delete(page);
    this.#cdpListeners.delete(page);
    this.#cdpSessions.delete(page);
    this.#storage.delete(page);
    this.#connectionMap.delete(page);
    this.#idGenerators.delete(page);
  }

  /**
   * Get all WebSocket connections for a page.
   */
  getData(page: Page, includePreservedData?: boolean): WebSocketData[] {
    const navigations = this.#storage.get(page);
    if (!navigations) {
      return [];
    }

    if (!includePreservedData) {
      return navigations[0] ?? [];
    }

    const data: WebSocketData[] = [];
    for (let index = this.#maxNavigationSaved; index >= 0; index--) {
      if (navigations[index]) {
        data.push(...navigations[index]);
      }
    }
    return data;
  }

  /**
   * Get stable ID for a WebSocket connection.
   */
  getIdForResource(resource: WebSocketDataWithId): number {
    return resource[stableIdSymbol] ?? -1;
  }

  /**
   * Get WebSocket connection by stable ID.
   */
  getById(page: Page, stableId: number): WebSocketData {
    const navigations = this.#storage.get(page);
    if (!navigations) {
      throw new Error('No WebSocket connections found for selected page');
    }

    for (const navigation of navigations) {
      const item = navigation.find(ws => ws[stableIdSymbol] === stableId);
      if (item) {
        return item;
      }
    }

    throw new Error('WebSocket connection not found for selected page');
  }

  /**
   * Find a WebSocket connection matching the filter.
   */
  find(
    page: Page,
    filter: (item: WebSocketDataWithId) => boolean,
  ): WebSocketDataWithId | undefined {
    const navigations = this.#storage.get(page);
    if (!navigations) {
      return undefined;
    }

    for (const navigation of navigations) {
      const item = navigation.find(filter);
      if (item) {
        return item;
      }
    }
    return undefined;
  }
}
