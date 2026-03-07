# Enhanced Tools Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 5 missing features to js-reverse-mcp: Fetch request interception, dynamic persistent scripts, CDP cookie management, trace_function, and evaluate_script error improvements.

**Architecture:** Each feature is additive — new tool files + wiring into McpContext and main.ts. The Fetch interceptor is a new class (`FetchInterceptor`) similar to `DebuggerContext`. Other features are standalone tool files. All tools follow the existing `defineTool()` pattern with zod schemas.

**Tech Stack:** TypeScript, CDP protocol (via Puppeteer CDPSession), MCP SDK, zod

---

## Codebase Orientation

**Key patterns to follow:**

1. **Tool definition:** `defineTool({ name, description, annotations, schema, handler })` in `src/tools/*.ts`
2. **Context access:** Tools receive `context` which exposes `debuggerContext`, `getSelectedPage()`, `getSelectedFrame()`, etc.
3. **CDP access:** `context.debuggerContext.getClient()` returns a `CDPSession` for raw protocol calls
4. **Registration:** `main.ts` imports `* as fooTools from './tools/foo.js'` and spreads into `tools` array
5. **Categories:** `ToolCategory` enum in `src/tools/categories.ts`, labels in same file
6. **Build:** `npm run build` (tsc + post-build), verify with `node build/src/index.js --help`

**Files you'll touch:**

| File | Action |
|------|--------|
| `src/FetchInterceptor.ts` | CREATE — CDP Fetch domain wrapper |
| `src/tools/fetch.ts` | CREATE — Fetch interception tools |
| `src/tools/persistent-scripts.ts` | CREATE — Persistent script injection tools |
| `src/tools/cookies.ts` | CREATE — CDP cookie management tools |
| `src/tools/debugger.ts` | MODIFY — Add trace_function tool |
| `src/tools/script.ts` | MODIFY — Improve error handling |
| `src/tools/categories.ts` | MODIFY — Add INTERCEPTION category |
| `src/tools/ToolDefinition.ts` | MODIFY — Add new Context methods |
| `src/McpContext.ts` | MODIFY — Add FetchInterceptor + persistent script + cookie methods |
| `src/main.ts` | MODIFY — Import and register new tool modules |

---

## Task 1: Add INTERCEPTION category

**Files:**
- Modify: `src/tools/categories.ts`

**Step 1: Add enum value and label**

In `src/tools/categories.ts`, add `INTERCEPTION` to the enum and labels:

```typescript
export enum ToolCategory {
  NAVIGATION = 'navigation',
  NETWORK = 'network',
  DEBUGGING = 'debugging',
  REVERSE_ENGINEERING = 'reverse_engineering',
  INTERCEPTION = 'interception',
}

export const labels = {
  [ToolCategory.NAVIGATION]: 'Navigation automation',
  [ToolCategory.NETWORK]: 'Network',
  [ToolCategory.DEBUGGING]: 'Debugging',
  [ToolCategory.REVERSE_ENGINEERING]: 'JS Reverse Engineering',
  [ToolCategory.INTERCEPTION]: 'Request Interception',
};
```

**Step 2: Build and verify**

Run: `npm run build`
Expected: Success, no errors

**Step 3: Commit**

```bash
git add src/tools/categories.ts
git commit -m "feat: add INTERCEPTION tool category"
```

---

## Task 2: Create FetchInterceptor

**Files:**
- Create: `src/FetchInterceptor.ts`

**Step 1: Create the FetchInterceptor class**

This class wraps CDP `Fetch` domain. It manages interception rules and paused requests.

```typescript
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

  getLogs(): typeof this.#logs {
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
```

**Step 2: Build and verify**

Run: `npm run build`
Expected: Success

**Step 3: Commit**

```bash
git add src/FetchInterceptor.ts
git commit -m "feat: add FetchInterceptor class for CDP Fetch domain"
```

---

## Task 3: Wire FetchInterceptor into McpContext

**Files:**
- Modify: `src/McpContext.ts`
- Modify: `src/tools/ToolDefinition.ts`

**Step 1: Add FetchInterceptor to McpContext**

In `src/McpContext.ts`:

1. Import `FetchInterceptor`:
```typescript
import {FetchInterceptor} from './FetchInterceptor.js';
import type {InterceptRule} from './FetchInterceptor.js';
```

2. Add field after `#debuggerContext`:
```typescript
#fetchInterceptor: FetchInterceptor = new FetchInterceptor();
```

3. Add getter:
```typescript
get fetchInterceptor(): FetchInterceptor {
  return this.#fetchInterceptor;
}
```

4. In `#initDebugger` method, after `await this.#debuggerContext.enable(client)`, add:
```typescript
await this.#fetchInterceptor.enable(client);
```

5. In `dispose()`, add:
```typescript
void this.#fetchInterceptor.disable();
```

6. In `reinitDebugger()`, add after `await this.#initDebugger()`:
(No change needed — `#initDebugger` already calls enable on the client, and FetchInterceptor.enable checks for same client)

7. Add persistent script storage and methods:
```typescript
#persistentScripts = new Map<string, {identifier: string; label: string; code: string}>();

async addPersistentScript(label: string, code: string): Promise<string> {
  const page = this.getSelectedPage();
  // @ts-expect-error createCDPSession may not exist
  const client = page._client();
  const result = await client.send('Page.addScriptToEvaluateOnNewDocument', {
    source: code,
  });
  const identifier = result.identifier;
  this.#persistentScripts.set(identifier, {identifier, label, code});
  return identifier;
}

async removePersistentScript(identifier: string): Promise<boolean> {
  const page = this.getSelectedPage();
  // @ts-expect-error internal API
  const client = page._client();
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
```

8. Add cookie methods:
```typescript
async getCookies(urls?: string[]): Promise<Protocol.Network.Cookie[]> {
  const page = this.getSelectedPage();
  // @ts-expect-error internal API
  const client = page._client() as CDPSession;
  const params: Protocol.Network.GetCookiesRequest = {};
  if (urls && urls.length > 0) {
    params.urls = urls;
  }
  const result = await client.send('Network.getCookies', params);
  return result.cookies;
}

async setCookie(cookie: Protocol.Network.CookieParam): Promise<boolean> {
  const page = this.getSelectedPage();
  // @ts-expect-error internal API
  const client = page._client() as CDPSession;
  const result = await client.send('Network.setCookie', cookie);
  return result.success;
}

async deleteCookies(params: Protocol.Network.DeleteCookiesRequest): Promise<void> {
  const page = this.getSelectedPage();
  // @ts-expect-error internal API
  const client = page._client() as CDPSession;
  await client.send('Network.deleteCookies', params);
}
```

**Step 2: Update Context type in ToolDefinition.ts**

Add these to the `Context` type (after existing methods):

```typescript
/**
 * Get the fetch interceptor for request interception.
 */
fetchInterceptor: FetchInterceptor;

/**
 * Add a persistent script that survives navigation.
 */
addPersistentScript(label: string, code: string): Promise<string>;

/**
 * Remove a persistent script.
 */
removePersistentScript(identifier: string): Promise<boolean>;

/**
 * Get all registered persistent scripts.
 */
getPersistentScripts(): Array<{identifier: string; label: string; code: string}>;

/**
 * Get cookies via CDP (includes httpOnly).
 */
getCookies(urls?: string[]): Promise<Protocol.Network.Cookie[]>;

/**
 * Set a cookie via CDP.
 */
setCookie(cookie: Protocol.Network.CookieParam): Promise<boolean>;

/**
 * Delete cookies via CDP.
 */
deleteCookies(params: Protocol.Network.DeleteCookiesRequest): Promise<void>;
```

Add imports at the top of `ToolDefinition.ts`:
```typescript
import type {FetchInterceptor} from '../FetchInterceptor.js';
import type {Protocol} from '../third_party/index.js';
```

**Step 3: Build and verify**

Run: `npm run build`
Expected: Success

**Step 4: Commit**

```bash
git add src/McpContext.ts src/tools/ToolDefinition.ts
git commit -m "feat: wire FetchInterceptor, persistent scripts, and cookies into McpContext"
```

---

## Task 4: Create Fetch interception tools

**Files:**
- Create: `src/tools/fetch.ts`

**Step 1: Create the tool file**

```typescript
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../third_party/index.js';

import {ToolCategory} from './categories.js';
import {defineTool} from './ToolDefinition.js';

export const interceptRequest = defineTool({
  name: 'intercept_request',
  description:
    'Add a request interception rule. Intercepts matching requests at CDP level (survives page navigation). Can modify request body, headers, or block requests entirely.',
  annotations: {
    title: 'Intercept Request',
    category: ToolCategory.INTERCEPTION,
    readOnlyHint: false,
  },
  schema: {
    ruleId: zod
      .string()
      .describe('Unique ID for this interception rule.'),
    urlPattern: zod
      .string()
      .describe(
        'URL pattern to match (glob-style: * matches anything). E.g., "*xsolla.com*payment*".',
      ),
    resourceType: zod
      .string()
      .optional()
      .describe('Optional resource type filter (e.g., "XHR", "Fetch", "Document").'),
    action: zod
      .enum(['modify', 'block', 'log'])
      .default('modify')
      .describe(
        'Action: "modify" to change request, "block" to fail it, "log" to just record it.',
      ),
    modifyBody: zod
      .string()
      .optional()
      .describe('New request body (string). For JSON APIs, pass the full JSON string.'),
    modifyHeaders: zod
      .record(zod.string())
      .optional()
      .describe('Headers to add or override. E.g., {"X-Country": "ID"}.'),
  },
  handler: async (request, response, context) => {
    const interceptor = context.fetchInterceptor;

    if (!interceptor.isEnabled()) {
      response.appendResponseLine(
        'Fetch interceptor not enabled. Select a page first.',
      );
      return;
    }

    const {ruleId, urlPattern, resourceType, action, modifyBody, modifyHeaders} =
      request.params;

    interceptor.addRule({
      id: ruleId,
      urlPattern,
      resourceType,
      action,
      modifyBody,
      modifyHeaders,
    });

    response.appendResponseLine(`Interception rule added:`);
    response.appendResponseLine(`- Rule ID: ${ruleId}`);
    response.appendResponseLine(`- URL Pattern: ${urlPattern}`);
    response.appendResponseLine(`- Action: ${action}`);
    if (modifyBody) {
      response.appendResponseLine(
        `- Modify Body: ${modifyBody.substring(0, 100)}${modifyBody.length > 100 ? '...' : ''}`,
      );
    }
    if (modifyHeaders) {
      response.appendResponseLine(
        `- Modify Headers: ${JSON.stringify(modifyHeaders)}`,
      );
    }
    response.appendResponseLine('');
    response.appendResponseLine(
      'This rule operates at CDP level and survives page navigation.',
    );
  },
});

export const removeIntercept = defineTool({
  name: 'remove_intercept',
  description: 'Removes a request interception rule by its ID.',
  annotations: {
    title: 'Remove Intercept',
    category: ToolCategory.INTERCEPTION,
    readOnlyHint: false,
  },
  schema: {
    ruleId: zod.string().describe('The rule ID to remove.'),
  },
  handler: async (request, response, context) => {
    const interceptor = context.fetchInterceptor;
    const removed = interceptor.removeRule(request.params.ruleId);

    if (removed) {
      response.appendResponseLine(
        `Rule "${request.params.ruleId}" removed.`,
      );
    } else {
      response.appendResponseLine(
        `Rule "${request.params.ruleId}" not found.`,
      );
    }
  },
});

export const listIntercepts = defineTool({
  name: 'list_intercepts',
  description: 'Lists all active request interception rules.',
  annotations: {
    title: 'List Intercepts',
    category: ToolCategory.INTERCEPTION,
    readOnlyHint: true,
  },
  schema: {},
  handler: async (request, response, context) => {
    const rules = context.fetchInterceptor.getRules();

    if (rules.length === 0) {
      response.appendResponseLine('No active interception rules.');
      return;
    }

    response.appendResponseLine(`Active interception rules (${rules.length}):\n`);

    for (const rule of rules) {
      response.appendResponseLine(`- ID: ${rule.id}`);
      response.appendResponseLine(`  Pattern: ${rule.urlPattern}`);
      response.appendResponseLine(`  Action: ${rule.action}`);
      if (rule.resourceType) {
        response.appendResponseLine(`  Resource Type: ${rule.resourceType}`);
      }
      if (rule.modifyBody) {
        response.appendResponseLine(
          `  Body: ${rule.modifyBody.substring(0, 80)}...`,
        );
      }
      if (rule.modifyHeaders) {
        response.appendResponseLine(
          `  Headers: ${JSON.stringify(rule.modifyHeaders)}`,
        );
      }
      response.appendResponseLine('');
    }
  },
});

export const getInterceptLogs = defineTool({
  name: 'get_intercept_logs',
  description:
    'Gets the log of intercepted requests. Shows which rules matched and what modifications were applied.',
  annotations: {
    title: 'Get Intercept Logs',
    category: ToolCategory.INTERCEPTION,
    readOnlyHint: true,
  },
  schema: {
    ruleId: zod
      .string()
      .optional()
      .describe('Filter logs by rule ID.'),
    limit: zod
      .number()
      .int()
      .optional()
      .default(20)
      .describe('Max number of log entries to return (default: 20).'),
  },
  handler: async (request, response, context) => {
    let logs = context.fetchInterceptor.getLogs();

    if (request.params.ruleId) {
      logs = logs.filter(l => l.rule === request.params.ruleId);
    }

    const limit = request.params.limit ?? 20;
    const display = logs.slice(-limit);

    if (display.length === 0) {
      response.appendResponseLine('No interception logs.');
      return;
    }

    response.appendResponseLine(
      `Intercept logs (${display.length} of ${logs.length}):\n`,
    );

    for (const log of display) {
      const time = new Date(log.timestamp).toISOString().substring(11, 23);
      response.appendResponseLine(
        `[${time}] ${log.action.toUpperCase()} rule=${log.rule} ${log.request.request.method} ${log.request.request.url.substring(0, 100)}`,
      );
      if (log.request.request.postData) {
        response.appendResponseLine(
          `  Body: ${log.request.request.postData.substring(0, 120)}${log.request.request.postData.length > 120 ? '...' : ''}`,
        );
      }
    }
  },
});
```

**Step 2: Build and verify**

Run: `npm run build`
Expected: Success

**Step 3: Commit**

```bash
git add src/tools/fetch.ts
git commit -m "feat: add fetch interception tools (intercept_request, remove_intercept, list_intercepts, get_intercept_logs)"
```

---

## Task 5: Create persistent script tools

**Files:**
- Create: `src/tools/persistent-scripts.ts`

**Step 1: Create the tool file**

```typescript
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../third_party/index.js';

import {ToolCategory} from './categories.js';
import {defineTool} from './ToolDefinition.js';

export const addPersistentScript = defineTool({
  name: 'add_persistent_script',
  description:
    'Injects a JavaScript script that runs before any other script on every page load, including after navigation. Uses Page.addScriptToEvaluateOnNewDocument. Ideal for fetch hooks that need to survive SPA navigation.',
  annotations: {
    title: 'Add Persistent Script',
    category: ToolCategory.INTERCEPTION,
    readOnlyHint: false,
  },
  schema: {
    label: zod
      .string()
      .describe('A human-readable label for this script (e.g., "fetch-hook").'),
    code: zod
      .string()
      .describe(
        'JavaScript code to inject. Runs before any page script on every navigation.',
      ),
  },
  handler: async (request, response, context) => {
    const {label, code} = request.params;

    try {
      const identifier = await context.addPersistentScript(label, code);

      response.appendResponseLine(`Persistent script added:`);
      response.appendResponseLine(`- Identifier: ${identifier}`);
      response.appendResponseLine(`- Label: ${label}`);
      response.appendResponseLine(
        `- Code: ${code.substring(0, 100)}${code.length > 100 ? '...' : ''}`,
      );
      response.appendResponseLine('');
      response.appendResponseLine(
        'This script will run before any page script on every navigation (including SPA route changes that trigger full page loads).',
      );
      response.appendResponseLine(
        `Use remove_persistent_script(identifier: "${identifier}") to remove.`,
      );
    } catch (error) {
      response.appendResponseLine(
        `Error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});

export const removePersistentScript = defineTool({
  name: 'remove_persistent_script',
  description: 'Removes a previously added persistent script.',
  annotations: {
    title: 'Remove Persistent Script',
    category: ToolCategory.INTERCEPTION,
    readOnlyHint: false,
  },
  schema: {
    identifier: zod
      .string()
      .describe(
        'The identifier returned by add_persistent_script.',
      ),
  },
  handler: async (request, response, context) => {
    const removed = await context.removePersistentScript(
      request.params.identifier,
    );

    if (removed) {
      response.appendResponseLine(
        `Persistent script "${request.params.identifier}" removed.`,
      );
    } else {
      response.appendResponseLine(
        `Script "${request.params.identifier}" not found or already removed.`,
      );
    }
  },
});

export const listPersistentScripts = defineTool({
  name: 'list_persistent_scripts',
  description: 'Lists all active persistent scripts.',
  annotations: {
    title: 'List Persistent Scripts',
    category: ToolCategory.INTERCEPTION,
    readOnlyHint: true,
  },
  schema: {},
  handler: async (request, response, context) => {
    const scripts = context.getPersistentScripts();

    if (scripts.length === 0) {
      response.appendResponseLine('No active persistent scripts.');
      return;
    }

    response.appendResponseLine(
      `Active persistent scripts (${scripts.length}):\n`,
    );

    for (const script of scripts) {
      response.appendResponseLine(`- Identifier: ${script.identifier}`);
      response.appendResponseLine(`  Label: ${script.label}`);
      response.appendResponseLine(
        `  Code: ${script.code.substring(0, 80)}${script.code.length > 80 ? '...' : ''}`,
      );
      response.appendResponseLine('');
    }
  },
});
```

**Step 2: Build and verify**

Run: `npm run build`
Expected: Success

**Step 3: Commit**

```bash
git add src/tools/persistent-scripts.ts
git commit -m "feat: add persistent script tools (add/remove/list_persistent_script)"
```

---

## Task 6: Create cookie management tools

**Files:**
- Create: `src/tools/cookies.ts`

**Step 1: Create the tool file**

```typescript
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../third_party/index.js';

import {ToolCategory} from './categories.js';
import {defineTool} from './ToolDefinition.js';

export const getCookies = defineTool({
  name: 'get_cookies_cdp',
  description:
    'Gets all cookies via CDP, including httpOnly cookies that are invisible to document.cookie. Optionally filter by URL.',
  annotations: {
    title: 'Get Cookies (CDP)',
    category: ToolCategory.NETWORK,
    readOnlyHint: true,
  },
  schema: {
    urls: zod
      .array(zod.string())
      .optional()
      .describe(
        'URLs to get cookies for. If omitted, returns cookies for the current page URL.',
      ),
    filter: zod
      .string()
      .optional()
      .describe(
        'Filter cookies by name (case-insensitive partial match).',
      ),
  },
  handler: async (request, response, context) => {
    const {urls, filter} = request.params;

    try {
      let cookies = await context.getCookies(urls);

      if (filter) {
        const lowerFilter = filter.toLowerCase();
        cookies = cookies.filter(c =>
          c.name.toLowerCase().includes(lowerFilter),
        );
      }

      if (cookies.length === 0) {
        response.appendResponseLine('No cookies found.');
        return;
      }

      response.appendResponseLine(`Cookies (${cookies.length}):\n`);

      for (const cookie of cookies) {
        const flags = [
          cookie.httpOnly ? 'httpOnly' : '',
          cookie.secure ? 'secure' : '',
          cookie.session ? 'session' : '',
          cookie.sameSite || '',
        ]
          .filter(Boolean)
          .join(', ');

        response.appendResponseLine(`- ${cookie.name}`);
        response.appendResponseLine(
          `  Value: ${cookie.value.substring(0, 100)}${cookie.value.length > 100 ? '...' : ''}`,
        );
        response.appendResponseLine(`  Domain: ${cookie.domain}`);
        response.appendResponseLine(`  Path: ${cookie.path}`);
        if (flags) {
          response.appendResponseLine(`  Flags: ${flags}`);
        }
        if (cookie.expires > 0) {
          response.appendResponseLine(
            `  Expires: ${new Date(cookie.expires * 1000).toISOString()}`,
          );
        }
        response.appendResponseLine('');
      }
    } catch (error) {
      response.appendResponseLine(
        `Error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});

export const setCookie = defineTool({
  name: 'set_cookie_cdp',
  description:
    'Sets a cookie via CDP. Can set httpOnly cookies that cannot be set via document.cookie.',
  annotations: {
    title: 'Set Cookie (CDP)',
    category: ToolCategory.NETWORK,
    readOnlyHint: false,
  },
  schema: {
    name: zod.string().describe('Cookie name.'),
    value: zod.string().describe('Cookie value.'),
    domain: zod
      .string()
      .optional()
      .describe('Cookie domain. Defaults to current page domain.'),
    path: zod
      .string()
      .optional()
      .default('/')
      .describe('Cookie path (default: /).'),
    secure: zod
      .boolean()
      .optional()
      .default(false)
      .describe('Whether cookie requires HTTPS.'),
    httpOnly: zod
      .boolean()
      .optional()
      .default(false)
      .describe('Whether cookie is httpOnly.'),
    sameSite: zod
      .enum(['Strict', 'Lax', 'None'])
      .optional()
      .describe('SameSite attribute.'),
    expires: zod
      .number()
      .optional()
      .describe(
        'Expiration as Unix timestamp (seconds). If omitted, creates a session cookie.',
      ),
  },
  handler: async (request, response, context) => {
    const {name, value, domain, path, secure, httpOnly, sameSite, expires} =
      request.params;

    try {
      const cookieParam: Record<string, unknown> = {
        name,
        value,
        path,
        secure,
        httpOnly,
      };

      if (domain) {
        cookieParam.domain = domain;
      } else {
        // Use current page URL
        const page = context.getSelectedPage();
        const url = new URL(page.url());
        cookieParam.domain = url.hostname;
      }

      if (sameSite) {
        cookieParam.sameSite = sameSite;
      }

      if (expires) {
        cookieParam.expires = expires;
      }

      // @ts-expect-error dynamic cookie params
      const success = await context.setCookie(cookieParam);

      if (success) {
        response.appendResponseLine(`Cookie "${name}" set successfully.`);
        response.appendResponseLine(`- Domain: ${cookieParam.domain}`);
        response.appendResponseLine(`- Path: ${path}`);
        response.appendResponseLine(`- HttpOnly: ${httpOnly}`);
        response.appendResponseLine(`- Secure: ${secure}`);
      } else {
        response.appendResponseLine(`Failed to set cookie "${name}".`);
      }
    } catch (error) {
      response.appendResponseLine(
        `Error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});

export const deleteCookie = defineTool({
  name: 'delete_cookie_cdp',
  description: 'Deletes a cookie by name via CDP.',
  annotations: {
    title: 'Delete Cookie (CDP)',
    category: ToolCategory.NETWORK,
    readOnlyHint: false,
  },
  schema: {
    name: zod.string().describe('Cookie name to delete.'),
    domain: zod
      .string()
      .optional()
      .describe('Cookie domain. If omitted, uses current page domain.'),
    path: zod
      .string()
      .optional()
      .default('/')
      .describe('Cookie path (default: /).'),
  },
  handler: async (request, response, context) => {
    const {name, domain, path} = request.params;

    try {
      const deleteDomain =
        domain || new URL(context.getSelectedPage().url()).hostname;

      await context.deleteCookies({name, domain: deleteDomain, path});
      response.appendResponseLine(
        `Cookie "${name}" deleted (domain: ${deleteDomain}, path: ${path}).`,
      );
    } catch (error) {
      response.appendResponseLine(
        `Error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
```

**Step 2: Build and verify**

Run: `npm run build`
Expected: Success

**Step 3: Commit**

```bash
git add src/tools/cookies.ts
git commit -m "feat: add CDP cookie management tools (get/set/delete_cookie_cdp)"
```

---

## Task 7: Add trace_function to debugger.ts

**Files:**
- Modify: `src/tools/debugger.ts` (append at end, before final closing)

**Step 1: Add trace_function tool**

Append this tool at the end of `src/tools/debugger.ts` (before any closing braces or at EOF):

```typescript
/**
 * Trace function calls using conditional breakpoints.
 * Unlike hook_function, this works for module-internal functions
 * that aren't accessible from the global scope.
 */
export const traceFunction = defineTool({
  name: 'trace_function',
  description:
    'Traces calls to a function using a conditional breakpoint with console.trace(). Works for module-internal functions that cannot be hooked via hook_function. The breakpoint logs the call but does not pause execution.',
  annotations: {
    title: 'Trace Function',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    text: zod
      .string()
      .describe(
        'Code text to find and trace (e.g., "function encryptData", "createOrder("). The breakpoint is set at the first match.',
      ),
    urlFilter: zod
      .string()
      .optional()
      .describe(
        'Only search scripts whose URL contains this string.',
      ),
    logExpression: zod
      .string()
      .optional()
      .default(
        'console.log("[TRACE]", new Error().stack?.split("\\n").slice(0,5).join("\\n"))',
      )
      .describe(
        'JavaScript expression to evaluate when the breakpoint hits. Default logs a stack trace. The expression must return a falsy value to avoid pausing.',
      ),
    occurrence: zod
      .number()
      .int()
      .optional()
      .default(1)
      .describe('Which occurrence to trace (1 = first).'),
  },
  handler: async (request, response, context) => {
    const debugger_ = context.debuggerContext;

    if (!debugger_.isEnabled()) {
      response.appendResponseLine(
        'Debugger is not enabled. Please select a page first.',
      );
      return;
    }

    const {text, urlFilter, logExpression, occurrence} = request.params;

    try {
      // Step 1: Search for the text
      const searchResult = await debugger_.searchInScripts(text, {
        caseSensitive: true,
        isRegex: false,
      });

      if (searchResult.matches.length === 0) {
        response.appendResponseLine(
          `"${text}" not found in any loaded script.`,
        );
        return;
      }

      // Apply URL filter
      let matches = searchResult.matches;
      if (urlFilter) {
        const lowerFilter = urlFilter.toLowerCase();
        matches = matches.filter(
          m => m.url && m.url.toLowerCase().includes(lowerFilter),
        );
        if (matches.length === 0) {
          response.appendResponseLine(
            `"${text}" not found in scripts matching "${urlFilter}".`,
          );
          return;
        }
      }

      if (occurrence > matches.length) {
        response.appendResponseLine(
          `Only ${matches.length} occurrence(s) found.`,
        );
        return;
      }

      const match = matches[occurrence - 1];
      const script = debugger_.getScriptById(match.scriptId);
      const url = script?.url || match.url;

      if (!url) {
        response.appendResponseLine(
          'Cannot trace: script has no URL (inline script).',
        );
        return;
      }

      // Get exact column
      const source = await debugger_.getScriptSource(match.scriptId);
      let columnNumber = 0;
      const lines = source.split('\n');
      if (match.lineNumber < lines.length) {
        const colPos = lines[match.lineNumber].indexOf(text);
        if (colPos >= 0) {
          columnNumber = colPos;
        }
      }

      // Create a conditional breakpoint that logs but never pauses
      // The condition evaluates the log expression and returns false
      const condition = `((${logExpression}), false)`;

      const breakpointInfo = await debugger_.setBreakpoint(
        url,
        match.lineNumber,
        columnNumber,
        condition,
      );

      response.appendResponseLine(`Trace set successfully!`);
      response.appendResponseLine(`- Breakpoint ID: ${breakpointInfo.breakpointId}`);
      response.appendResponseLine(`- URL: ${url}`);
      response.appendResponseLine(
        `- Line: ${match.lineNumber + 1}, Column: ${columnNumber}`,
      );
      response.appendResponseLine(`- Log Expression: ${logExpression}`);
      response.appendResponseLine('');
      response.appendResponseLine(
        'Traces will appear in console. Use list_console_messages to view.',
      );
      response.appendResponseLine(
        `Use remove_breakpoint(breakpointId: "${breakpointInfo.breakpointId}") to stop tracing.`,
      );
    } catch (error) {
      response.appendResponseLine(
        `Error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
```

**Step 2: Build and verify**

Run: `npm run build`
Expected: Success

**Step 3: Commit**

```bash
git add src/tools/debugger.ts
git commit -m "feat: add trace_function tool using conditional breakpoints"
```

---

## Task 8: Improve evaluate_script error handling

**Files:**
- Modify: `src/tools/script.ts`

**Step 1: Improve error handling**

Replace the entire `handler` function in `evaluateScript` with better error reporting:

```typescript
handler: async (request, response, context) => {
  let fn: JSHandle<unknown> | undefined;
  try {
    const frame = context.getSelectedFrame();
    fn = await withTimeout(
      frame.evaluateHandle(`(${request.params.function})`),
      DEFAULT_SCRIPT_TIMEOUT,
      `Script compilation timed out after ${DEFAULT_SCRIPT_TIMEOUT / 1000}s. The function may have a syntax error.`,
    );
    await context.waitForEventsAfterAction(async () => {
      const result = await withTimeout(
        frame.evaluate(async fn => {
          // @ts-expect-error no types.
          return JSON.stringify(await fn());
        }, fn),
        DEFAULT_SCRIPT_TIMEOUT,
        `Script execution timed out after ${DEFAULT_SCRIPT_TIMEOUT / 1000}s. The script may be waiting for a network response or user interaction that never completes.`,
      );
      if (result === undefined || result === 'undefined') {
        response.appendResponseLine(
          'Script ran on page and returned: undefined',
        );
        response.appendResponseLine(
          '(Tip: Make sure your function returns a value. Use `return` explicitly.)',
        );
      } else if (result === null || result === 'null') {
        response.appendResponseLine('Script ran on page and returned: null');
      } else {
        response.appendResponseLine('Script ran on page and returned:');
        response.appendResponseLine('```json');
        response.appendResponseLine(`${result}`);
        response.appendResponseLine('```');
      }
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    response.appendResponseLine(`Script error: ${errorMessage}`);

    // Add helpful context for common errors
    if (errorMessage.includes('timed out')) {
      response.appendResponseLine('');
      response.appendResponseLine(
        'Tip: For long-running operations, consider using evaluate_script with a shorter operation, or use the direct API call approach.',
      );
    } else if (
      errorMessage.includes('not a function') ||
      errorMessage.includes('is not defined')
    ) {
      response.appendResponseLine('');
      response.appendResponseLine(
        'Tip: Make sure you are passing a function expression, e.g., `() => { ... }` or `async () => { ... }`.',
      );
    }
  } finally {
    if (fn) {
      void fn.dispose();
    }
  }
},
```

**Step 2: Build and verify**

Run: `npm run build`
Expected: Success

**Step 3: Commit**

```bash
git add src/tools/script.ts
git commit -m "fix: improve evaluate_script error messages with actionable hints"
```

---

## Task 9: Register all new tools in main.ts

**Files:**
- Modify: `src/main.ts`

**Step 1: Add imports**

After the existing tool imports (line ~37), add:

```typescript
import * as fetchTools from './tools/fetch.js';
import * as persistentScriptTools from './tools/persistent-scripts.js';
import * as cookieTools from './tools/cookies.js';
```

**Step 2: Add to tools array**

In the `tools` array (around line 195), add the new modules:

```typescript
const tools = [
  ...Object.values(consoleTools),
  ...Object.values(debuggerTools),
  ...Object.values(frameTools),
  ...Object.values(networkTools),
  ...Object.values(pagesTools),
  ...Object.values(screenshotTools),
  ...Object.values(scriptTools),
  ...Object.values(websocketTools),
  ...Object.values(fetchTools),
  ...Object.values(persistentScriptTools),
  ...Object.values(cookieTools),
] as ToolDefinition[];
```

**Step 3: Build and verify**

Run: `npm run build`
Expected: Success

**Step 4: Verify tools registered**

Run: `node build/src/index.js --help`
Expected: No errors

**Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat: register fetch, persistent-script, and cookie tools in main"
```

---

## Task 10: Final build + push

**Step 1: Full build**

Run: `npm run build`
Expected: Success, no errors

**Step 2: Verify tool count**

Quick sanity check — list the tool names from the build to confirm everything is wired:

```bash
grep -r 'name:' build/src/tools/*.js | grep -oP "name: '.*?'" | sort
```

Expected: Should see all new tools: `intercept_request`, `remove_intercept`, `list_intercepts`, `get_intercept_logs`, `add_persistent_script`, `remove_persistent_script`, `list_persistent_scripts`, `get_cookies_cdp`, `set_cookie_cdp`, `delete_cookie_cdp`, `trace_function`

**Step 3: Push**

```bash
git push -u origin feature/enhanced-tools
```
