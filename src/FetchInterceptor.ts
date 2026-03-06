/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {CDPSession, Protocol} from './third_party/index.js';

export interface InterceptRule {
  id: string;
  urlPattern: string;
  resourceType?: string;
  modifyBody?: string;        // JSON string to replace request body
  modifyHeaders?: Record<string, string>; // Headers to add/override
  modifyResponse?: string;    // Response body override
  modifyResponseHeaders?: Record<string, string>;
  action: 'modify' | 'block' | 'log';
}

export interface PausedRequest {
  requestId: string;
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    postData?: string;
  };
  resourceType: string;
  frameId: string;
  responseStatusCode?: number;
  responseHeaders?: Array<{name: string; value: string}>;
}

export class FetchInterceptor {
  #client: CDPSession | null = null;
  #enabled = false;
  #rules = new Map<string, InterceptRule>();
  #pausedRequests = new Map<string, PausedRequest>();
  #logs: Array<{timestamp: number; rule: string; request: PausedRequest; action: string}> = [];
  #maxLogs = 100;

  async enable(client: CDPSession): Promise<void> {
    if (this.#enabled && this.#client === client) {
      return;
    }

    this.#client = client;
    client.on('Fetch.requestPaused', this.#onRequestPaused);

    // Enable with all patterns — we filter in the handler
    await client.send('Fetch.enable', {
      patterns: [{urlPattern: '*', requestStage: 'Request'}],
      handleAuthRequests: false,
    });

    this.#enabled = true;
  }

  async disable(): Promise<void> {
    if (!this.#enabled || !this.#client) {
      return;
    }

    this.#client.off('Fetch.requestPaused', this.#onRequestPaused);

    try {
      await this.#client.send('Fetch.disable');
    } catch {
      // Ignore
    }

    this.#rules.clear();
    this.#pausedRequests.clear();
    this.#logs = [];
    this.#enabled = false;
    this.#client = null;
  }

  isEnabled(): boolean {
    return this.#enabled;
  }

  getClient(): CDPSession | null {
    return this.#client;
  }

  addRule(rule: InterceptRule): void {
    this.#rules.set(rule.id, rule);
    this.#updatePatterns();
  }

  removeRule(ruleId: string): boolean {
    const deleted = this.#rules.delete(ruleId);
    if (deleted) {
      this.#updatePatterns();
    }
    return deleted;
  }

  getRules(): InterceptRule[] {
    return Array.from(this.#rules.values());
  }

  getRule(ruleId: string): InterceptRule | undefined {
    return this.#rules.get(ruleId);
  }

  getLogs(): Array<{timestamp: number; rule: string; request: PausedRequest; action: string}> {
    return this.#logs;
  }

  clearLogs(): void {
    this.#logs = [];
  }

  async #updatePatterns(): Promise<void> {
    if (!this.#client || !this.#enabled) {
      return;
    }

    // If no rules, disable interception to avoid overhead
    if (this.#rules.size === 0) {
      try {
        await this.#client.send('Fetch.disable');
        await this.#client.send('Fetch.enable', {
          patterns: [{urlPattern: '*', requestStage: 'Request'}],
          handleAuthRequests: false,
        });
      } catch {
        // Ignore
      }
      return;
    }
  }

  #matchRule(url: string, resourceType: string): InterceptRule | undefined {
    for (const rule of this.#rules.values()) {
      // Simple glob match: * matches anything
      const pattern = rule.urlPattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*');
      const regex = new RegExp(pattern, 'i');
      if (regex.test(url)) {
        if (rule.resourceType && rule.resourceType !== resourceType) {
          continue;
        }
        return rule;
      }
    }
    return undefined;
  }

  #onRequestPaused = async (event: Protocol.Fetch.RequestPausedEvent): Promise<void> => {
    if (!this.#client) {
      return;
    }

    const paused: PausedRequest = {
      requestId: event.requestId,
      request: {
        url: event.request.url,
        method: event.request.method,
        headers: event.request.headers,
        postData: event.request.postData,
      },
      resourceType: event.resourceType,
      frameId: event.frameId,
      responseStatusCode: event.responseStatusCode,
      responseHeaders: event.responseHeaders,
    };

    const rule = this.#matchRule(event.request.url, event.resourceType);

    if (!rule) {
      // No matching rule — continue without modification
      try {
        await this.#client.send('Fetch.continueRequest', {
          requestId: event.requestId,
        });
      } catch {
        // Request may have been cancelled
      }
      return;
    }

    // Log the interception
    this.#logs.push({
      timestamp: Date.now(),
      rule: rule.id,
      request: paused,
      action: rule.action,
    });
    if (this.#logs.length > this.#maxLogs) {
      this.#logs.shift();
    }

    try {
      switch (rule.action) {
        case 'block':
          await this.#client.send('Fetch.failRequest', {
            requestId: event.requestId,
            errorReason: 'BlockedByClient',
          });
          break;

        case 'modify': {
          const overrides: Protocol.Fetch.ContinueRequestRequest = {
            requestId: event.requestId,
          };

          if (rule.modifyBody !== undefined) {
            overrides.postData = btoa(rule.modifyBody);
          }

          if (rule.modifyHeaders) {
            const headers = {...event.request.headers, ...rule.modifyHeaders};
            overrides.headers = Object.entries(headers).map(([name, value]) => ({
              name,
              value,
            }));
          }

          await this.#client.send('Fetch.continueRequest', overrides);
          break;
        }

        case 'log':
        default:
          await this.#client.send('Fetch.continueRequest', {
            requestId: event.requestId,
          });
          break;
      }
    } catch {
      // Request may have been cancelled
      try {
        await this.#client.send('Fetch.continueRequest', {
          requestId: event.requestId,
        });
      } catch {
        // Double fault — nothing we can do
      }
    }
  };
}
