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
  modifyBody?: string;
  modifyHeaders?: Record<string, string>;
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
  #logs: Array<{timestamp: number; rule: string; request: PausedRequest; action: string}> = [];
  #maxLogs = 100;

  async enable(client: CDPSession): Promise<void> {
    if (this.#enabled && this.#client === client) {
      return;
    }

    // Clean up old client if switching
    if (this.#enabled && this.#client) {
      this.#client.off('Fetch.requestPaused', this.#onRequestPaused);
      try {
        await this.#client.send('Fetch.disable');
      } catch {
        // Old session may be gone
      }
    }

    this.#client = client;
    client.on('Fetch.requestPaused', this.#onRequestPaused);

    await client.send('Fetch.enable', {
      patterns: [{urlPattern: '*', requestStage: 'Request'}],
      handleAuthRequests: false,
    });

    this.#enabled = true;
  }

  /**
   * Detach from current CDP session without clearing rules/logs.
   * Used during page/frame switches to preserve configuration.
   */
  async detach(): Promise<void> {
    if (!this.#enabled || !this.#client) {
      return;
    }

    this.#client.off('Fetch.requestPaused', this.#onRequestPaused);

    try {
      await this.#client.send('Fetch.disable');
    } catch {
      // Ignore
    }

    this.#enabled = false;
    this.#client = null;
  }

  /**
   * Full cleanup: detach and clear all rules/logs.
   */
  async disable(): Promise<void> {
    await this.detach();
    this.#rules.clear();
    this.#logs = [];
  }

  isEnabled(): boolean {
    return this.#enabled;
  }

  hasRules(): boolean {
    return this.#rules.size > 0;
  }

  getClient(): CDPSession | null {
    return this.#client;
  }

  addRule(rule: InterceptRule): void {
    this.#rules.set(rule.id, rule);
  }

  removeRule(ruleId: string): boolean {
    return this.#rules.delete(ruleId);
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

  #matchRule(url: string, resourceType: string): InterceptRule | undefined {
    for (const rule of this.#rules.values()) {
      const pattern = rule.urlPattern
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
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
      try {
        await this.#client.send('Fetch.continueRequest', {
          requestId: event.requestId,
        });
      } catch {
        // Request may have been cancelled
      }
      return;
    }

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
            overrides.postData = Buffer.from(rule.modifyBody).toString('base64');
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
