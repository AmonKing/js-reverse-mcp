# Patchright Migration Design

> Puppeteer (rebrowser-puppeteer-core) -> Patchright (Playwright fork)

## Why

1. **Anti-detection native** — Patchright built-in, drop stealth.min.js + stealth-patch.js + rebrowser version pinning
2. **Public CDP API** — `context.newCDPSession(page)` replaces `page._client()` internal API
3. **Input capabilities** — Playwright's click/fill/type for page interaction during reverse engineering
4. **Unpin version** — rebrowser stuck at 24.8.1 with `@ts-expect-error` everywhere

## Key Decisions

### 1. DevToolsConnectionAdapter.ts -> DELETE

110 lines, deepest Puppeteer internal API dependency (Connection, wildcard events, session management). Only serves `experimentalDevtools` mode. MCP tools already cover all debugging features. Deleting removes ~30% migration complexity.

### 2. stealth.min.js + stealth-patch.js -> DELETE

Patchright handles anti-detection natively. These files + rebrowser are hack-on-hack.

### 3. getCdpClient async

`page._client()` (sync) -> `context.newCDPSession(page)` (async). Use WeakMap cache. ~15 call sites need `await`. TypeScript compiler finds all breakpoints.

### 4. PageIssueSubscriber page.emit('issue') -> direct push to ConsoleCollector

Playwright Page is not an EventEmitter, no custom event emit. PageIssueSubscriber gets a reference to ConsoleCollector and pushes issues directly. No user-visible change.

### 5. Input tools -> add after migration

New `src/tools/input.ts`: click, fill, type, press, select, hover, scroll. Biggest new capability from Patchright.

## Architecture Change

```
Before:                              After:
rebrowser-puppeteer-core             patchright (chromium)
  page._client() [internal]            context.newCDPSession(page) [public]
  browser.on('targetcreated')          context.on('page', cb)
  stealth.min.js                       (built-in anti-detection)
  stealth-patch.js                     (not needed)
  Target concept                       BrowserContext concept
```

## File Change Matrix

| File | Action | Complexity | Notes |
|------|--------|------------|-------|
| `third_party/index.ts` | Rewrite | Low | Switch import source + type mapping |
| `browser.ts` | Rewrite | Medium | connectOverCDP/launch, drop stealth loading |
| `utils/cdp.ts` | Rewrite | Low | async + WeakMap cache |
| `McpContext.ts` | Major | High | BrowserContext events, async getCdpClient, Locator.race->.or() |
| `PageCollector.ts` | Major | High | Event model rewrite, direct push for issues |
| `WebSocketCollector.ts` | Medium | Medium | Same event model change as PageCollector |
| `DevToolsConnectionAdapter.ts` | **DELETE** | - | Not needed |
| `FetchInterceptor.ts` | Minor | Low | Pure CDP, type changes only |
| `DebuggerContext.ts` | Minor | Low | Pure CDP, type changes only |
| `WaitForHelper.ts` | Medium | Medium | async getCdpClient + CdpPage->Page |
| `main.ts` | Medium | Medium | Drop stealth loading, update imports |
| 13x tools/*.ts | Minor | Low | Import + type rename |
| `formatters/*.ts` | Minor | Low | HTTPRequest->Request types |
| `ToolDefinition.ts` | Minor | Low | Interface type updates |
| `scripts/stealth*` | **DELETE** | - | Patchright built-in |
| `src/tools/input.ts` | **NEW** | Medium | click, fill, type, press, select, hover, scroll |

## Dependency Changes

```diff
- "puppeteer-core": "npm:rebrowser-puppeteer-core@24.8.1"
+ "patchright": "^1.58.2"
+ "devtools-protocol": "latest"
```

## Execution Phases

```
Phase 0: Dependencies
  - Install patchright + devtools-protocol
  - Remove rebrowser-puppeteer-core
  - Delete stealth scripts
  - Rewrite third_party/index.ts (type mapping layer)

Phase 1: Core Infrastructure
  - utils/cdp.ts — async + cache
  - browser.ts — connectOverCDP / launch rewrite
  - Delete DevToolsConnectionAdapter.ts
  - Goal: can connect to browser

Phase 2: Event Collectors
  - PageCollector.ts — BrowserContext event model
  - WebSocketCollector.ts — same
  - McpContext.ts — integrate all changes
  - Goal: page create/destroy/switch works

Phase 3: Debug + Intercept
  - DebuggerContext.ts — type updates
  - FetchInterceptor.ts — type updates
  - WaitForHelper.ts — async + types
  - Goal: breakpoints/intercepts work

Phase 4: Tool Layer
  - All tools/*.ts — import/type batch replace
  - ToolDefinition.ts — interface updates
  - formatters/* — type updates
  - McpResponse.ts — type updates
  - main.ts — entry point updates

Phase 5: New Features + Cleanup
  - New tools/input.ts (interaction tools)
  - Full compilation verification
  - Test fixes
  - Doc updates
```

## Type Mapping

| Puppeteer | Playwright/Patchright | Notes |
|-----------|----------------------|-------|
| `Browser` | `Browser` | Different interface |
| `Page` | `Page` | Different interface |
| `Frame` | `Frame` | Same |
| `CDPSession` | `CDPSession` | Slightly different API |
| `HTTPRequest` | `Request` | Name change |
| `HTTPResponse` | `Response` | Name change |
| `ConsoleMessage` | `ConsoleMessage` | Same |
| `Dialog` | `Dialog` | Same |
| `Target` | No equivalent | Playwright has no Target concept |
| `Handler<T>` | Standard function type | Replace |
| `KeyInput` | `string` | Playwright uses string |
| `CdpPage` | `Page` | Replace |
| `Protocol.*` | `import from 'devtools-protocol'` | Separate package |
| `Connection` | No equivalent | Not exposed |
| `ResourceType` | `string` | Playwright uses string |
| `Locator.race([...])` | `loc1.or(loc2).or(loc3)` | API difference |
| `evaluateOnNewDocument` | `addInitScript` | Equivalent behavior |

## Risk Summary

| Risk | Item | Mitigation |
|------|------|-----------|
| HIGH | getCdpClient async propagation | Compiler finds all call sites |
| MEDIUM | Browser event model change | BrowserContext events replace Target events |
| MEDIUM | page.emit custom events | Direct push to collector |
| MEDIUM | Protocol types source change | Install devtools-protocol package |
| LOW | Navigation/screenshot/evaluate API | Nearly identical |
| LOW | CDP operations (Debugger/Network/Fetch) | Identical |
| LOW | MCP tool layer | Mostly import updates |
