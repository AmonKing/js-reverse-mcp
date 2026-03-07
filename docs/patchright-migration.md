# Puppeteer → Patchright (Playwright) 迁移文档

## 概述

将 js-reverse-mcp 从 `rebrowser-puppeteer-core@24.8.1` 迁移到 `patchright`（Playwright API）。
Patchright 是 Playwright 的反检测 fork，API 完全兼容 Playwright。

**目标**：迁移后功能完全等价，同时获得 Patchright 的 CDP 反检测能力。

---

## 1. 行为等价性分析

### 完全等价（零风险）

| 功能 | Puppeteer | Playwright/Patchright | 说明 |
|------|-----------|----------------------|------|
| CDP 操作 | `client.send('Debugger.enable')` | `client.send('Debugger.enable')` | **完全相同** — 两者都是 CDP 的薄封装 |
| page.goto() | `page.goto(url, {waitUntil})` | `page.goto(url, {waitUntil})` | 参数完全相同 |
| page.goBack/Forward | `page.goBack({waitUntil})` | `page.goBack({waitUntil})` | 相同 |
| page.reload | `page.reload({waitUntil})` | `page.reload({waitUntil})` | 相同 |
| page.screenshot | `page.screenshot({type, fullPage})` | `page.screenshot({type, fullPage})` | 相同 |
| page.evaluate | `page.evaluate(fn, arg)` | `page.evaluate(fn, arg)` | 相同 |
| page.evaluateHandle | `page.evaluateHandle(fn, arg)` | `page.evaluateHandle(fn, arg)` | 相同 |
| page.url() | `page.url()` | `page.url()` | 相同 |
| page.title() | `page.title()` | `page.title()` | 相同 |
| page.content() | `page.content()` | `page.content()` | 相同 |
| page.frames() | `page.frames()` | `page.frames()` | 相同 |
| page.mainFrame() | `page.mainFrame()` | `page.mainFrame()` | 相同 |
| page.close() | `page.close()` | `page.close()` | 相同 |
| page.bringToFront | `page.bringToFront()` | `page.bringToFront()` | 相同 |
| page.isClosed | `page.isClosed()` | `page.isClosed()` | 相同 |
| frame.locator | `frame.locator(sel)` | `frame.locator(sel)` | 相同 |
| page.setDefaultTimeout | `page.setDefaultTimeout(ms)` | `page.setDefaultTimeout(ms)` | 相同 |
| page.setDefaultNavigationTimeout | `page.setDefaultNavigationTimeout(ms)` | `page.setDefaultNavigationTimeout(ms)` | 相同 |

### 需要改名但行为等价（低风险）

| 功能 | Puppeteer | Playwright/Patchright | 行为差异 |
|------|-----------|----------------------|---------|
| 注入脚本 | `page.evaluateOnNewDocument(script)` | `page.addInitScript(script)` | **等价** — 都在页面 JS 执行前注入 |
| 等待导航 | `page.waitForNavigation({waitUntil})` | `page.waitForNavigation({waitUntil})` | Playwright 也有此方法但推荐 `waitForURL`，行为等价 |
| 默认导航超时 | `page.getDefaultNavigationTimeout()` | `page.getDefaultNavigationTimeout?.()` | 可能需要从 context 获取 |

### 需要重构但行为可等价（中风险）

| 功能 | Puppeteer | Playwright/Patchright | 迁移方案 |
|------|-----------|----------------------|---------|
| 连接浏览器 | `puppeteer.connect({browserWSEndpoint})` | `chromium.connectOverCDP(endpoint)` | API 不同，但结果等价 |
| 启动浏览器 | `puppeteer.launch({channel, pipe, args})` | `chromium.launch({channel, args})` | Patchright 不需要 pipe:true |
| 获取 CDP Session | `page._client()` (internal API) | `page.context().newCDPSession(page)` | **Playwright 是公开 API**，更稳定 |
| 获取所有页面 | `browser.pages()` | `browser.contexts()[0].pages()` | Playwright 有 BrowserContext 层 |
| 新建页面 | `browser.newPage()` | `browser.contexts()[0].newPage()` | 通过 context |
| 关闭页面 | `page.close({runBeforeUnload})` | `page.close({runBeforeUnload})` | Playwright 也支持此选项 |

### 需要重写（高风险，需仔细验证）

| 功能 | Puppeteer | Playwright/Patchright | 迁移难点 |
|------|-----------|----------------------|---------|
| Browser 事件 | `browser.on('targetcreated', cb)` | `context.on('page', cb)` | 事件模型不同，见下文详解 |
| Browser 事件 | `browser.on('targetdestroyed', cb)` | `page.on('close', cb)` | 没有直接对应 |
| Target → Page | `target.page()` | 直接收到 Page | Playwright 的事件直接给 Page |
| Page 事件 | `page.on('request', cb)` | `page.on('request', cb)` | **名字相同但类型不同** |
| CDPSession 事件 | `CDPSessionEvent.SessionAttached` | 无直接对应 | DevToolsConnectionAdapter 需要重新设计 |
| Connection 对象 | `session.connection()` | 无直接对应 | Playwright 不暴露 Connection |
| session.id() | `session.id()` | `session.id?.()` | 需要确认 Playwright CDPSession API |
| page.emit() | `page.emit('issue', data)` | 不支持自定义事件 emit | PageIssueSubscriber 需要重构 |
| page.on('*') | 通配符监听 | 不支持通配符 | DevToolsConnectionAdapter 需要重写 |
| Handler<T> 类型 | Puppeteer 特有 | 需替换 | 类型层面 |
| request.id | `request.id` (internal) | 不同的 internal API | NetworkCollector initiator 关联 |
| request.frame() | `request.frame()` | `request.frame()` | 可能等价，需验证 |
| Locator.race | `Locator.race([...])` | `locator.or(locator)` | API 不同 |

---

## 2. 文件级迁移清单

### 第 0 层：依赖和构建（先做）

#### `package.json`
```diff
- "puppeteer-core": "npm:rebrowser-puppeteer-core@24.8.1",
+ "patchright": "^1.58.2",
```
注意：Patchright 的 npm 包名是 `patchright`（Node.js 版），不是 `patchright-nodejs`。

#### `src/third_party/index.ts`（核心抽象层）
当前：从 `puppeteer-core` 重新导出所有类型和工具
```typescript
export { Locator, PredefinedNetworkConditions, CDPSessionEvent } from 'puppeteer-core';
export { default as puppeteer } from 'puppeteer-core';
export type * from 'puppeteer-core';
export type { CdpPage } from 'puppeteer-core/internal/cdp/Page.js';
```
迁移：
```typescript
import { chromium } from 'patchright';
export { chromium };
export type {
  Browser, BrowserContext, Page, Frame, CDPSession,
  Request as HTTPRequest, Response as HTTPResponse,
  ConsoleMessage, Dialog, Locator,
} from 'patchright';
// 注意：Playwright 的 Request/Response 类名不同
// CdpPage 不存在于 Playwright，需要在用到的地方处理
// CDPSessionEvent 不存在，需要找替代方案
// PredefinedNetworkConditions 不存在，需要自己定义
```

**关键类型映射：**
| Puppeteer 类型 | Playwright 类型 | 备注 |
|---------------|----------------|------|
| `Browser` | `Browser` | 相同名字，不同接口 |
| `Page` | `Page` | 相同名字，不同接口 |
| `Frame` | `Frame` | 相同 |
| `CDPSession` | `CDPSession` | 都有，API 略不同 |
| `HTTPRequest` | `Request` | 名字不同 |
| `HTTPResponse` | `Response` | 名字不同 |
| `ConsoleMessage` | `ConsoleMessage` | 相同 |
| `Dialog` | `Dialog` | 相同 |
| `Target` | 无对应 | Playwright 没有 Target 概念 |
| `Handler<T>` | 无对应 | 用标准函数类型替代 |
| `KeyInput` | `string` | Playwright 用 string |
| `CdpPage` | 无对应 | 用 Page 替代 |
| `Protocol.*` | 需要从 devtools-protocol 包导入 | Playwright 不导出 Protocol 类型 |
| `Connection` | 无对应 | Playwright 不暴露 |
| `ResourceType` | `string` | Playwright 用 string |
| `ConsoleMessageType` | `string` | Playwright 用 string |
| `Locator` | `Locator` | API 不完全相同 |
| `PageEvents` | 无导出 | 需要自己定义事件类型映射 |

### 第 1 层：基础设施（高优先级）

#### `src/browser.ts` — 连接/启动逻辑
**改动范围：大**

当前逻辑：
- `ensureBrowserConnected()`: `puppeteer.connect({browserWSEndpoint | browserURL})`
- `launch()`: `puppeteer.launch({channel, pipe, headless, args, ignoreDefaultArgs})`

迁移：
```typescript
import { chromium } from 'patchright';

// Connect mode
const browser = await chromium.connectOverCDP(wsEndpoint);
// 或 通过 HTTP endpoint
const browser = await chromium.connectOverCDP(`http://localhost:${port}`);

// Launch mode
const browser = await chromium.launch({
  channel: 'chrome',
  headless: false,
  args: ['--hide-crash-restore-bubble'],
  // Patchright 自动处理 --disable-blink-features=AutomationControlled
  // 不需要 ignoreDefaultArgs
  // 不需要 pipe: true
});
```

**行为差异：**
- Patchright `launch()` 返回 `Browser`，但 Playwright 的 Browser 包含 BrowserContext
- `browser.pages()` → 需要通过 `browser.contexts()[0].pages()`
- `browser.newPage()` → `browser.contexts()[0].newPage()`
- initScript 注入：`page.addInitScript(script)` 替代 `page.evaluateOnNewDocument(script)`
- `browser.process()` → Playwright 也有 `browser.process?.()`（可能没有 stderr/stdout pipe）

**stealth 脚本：**
Patchright 本身自带反检测，不需要 stealth.min.js 和 stealth-patch.js。
但 initScript 机制保留，用户可以自定义注入脚本。

#### `src/utils/cdp.ts` — CDP Session 获取
**改动范围：小但关键**

当前（使用 Puppeteer internal API）：
```typescript
export function getCdpClient(page: Page): CDPSession {
  return page._client(); // internal API with @ts-expect-error
}
```

迁移（使用 Playwright 公开 API）：
```typescript
// 方案 A：每次新建 session（简单但可能有问题）
export async function getCdpClient(page: Page): Promise<CDPSession> {
  return await page.context().newCDPSession(page);
}

// 方案 B：缓存 session（推荐）
const sessionCache = new WeakMap<Page, CDPSession>();
export async function getCdpClient(page: Page): Promise<CDPSession> {
  let session = sessionCache.get(page);
  if (!session) {
    session = await page.context().newCDPSession(page);
    sessionCache.set(page, session);
  }
  return session;
}
```

**⚠️ 重大影响：`getCdpClient` 变成 async！**
所有调用点都要加 `await`。影响文件：
- `McpContext.ts` (5+ 处)
- `PageCollector.ts` (NetworkCollector, PageIssueSubscriber)
- `WebSocketCollector.ts`
- `WaitForHelper.ts`
- `FetchInterceptor.ts`（已经是 async）
- `DebuggerContext.ts`（已经是 async）

#### `src/utils/keyboard.ts` — 键盘输入映射
**改动范围：中**

当前：Puppeteer `KeyInput` 类型
Playwright 键名基本相同但有细微差异。需要验证所有键名的等价性。
Playwright 文档：https://playwright.dev/docs/api/class-keyboard

### 第 2 层：数据收集器（中优先级）

#### `src/PageCollector.ts` — 页面事件收集
**改动范围：大，风险高**

**核心问题：Browser 事件模型完全不同**

Puppeteer:
```typescript
browser.on('targetcreated', async (target: Target) => {
  const page = await target.page();
  if (page) this.addPage(page);
});
browser.on('targetdestroyed', async (target: Target) => {
  const page = await target.page();
  if (page) this.cleanupPageDestroyed(page);
});
```

Playwright:
```typescript
// Playwright 没有 Target 概念，事件在 BrowserContext 上
const context = browser.contexts()[0];
context.on('page', (page: Page) => {
  this.addPage(page);
});
// 页面关闭事件在 Page 自身
page.on('close', () => {
  this.cleanupPageDestroyed(page);
});
```

**Page 事件名映射：**
| Puppeteer | Playwright | 差异 |
|-----------|------------|------|
| `page.on('request', cb)` | `page.on('request', cb)` | 等价，但类型不同（HTTPRequest vs Request） |
| `page.on('console', cb)` | `page.on('console', cb)` | 等价 |
| `page.on('pageerror', cb)` | `page.on('pageerror', cb)` | 等价 |
| `page.on('dialog', cb)` | `page.on('dialog', cb)` | 等价 |
| `page.on('framenavigated', cb)` | `page.on('framenavigated', cb)` | 等价 |
| `page.on('*', cb)` | ❌ 不支持通配符 | 需要逐个注册 |
| `page.emit('issue', data)` | ❌ 不支持自定义事件 | 用 EventEmitter 或回调替代 |

**`page.emit('issue', data)` 问题：**
`PageIssueSubscriber` 用 `page.emit('issue', data)` 触发自定义事件，
`PageCollector` 的 listener map 里有 `issue` 事件。
Playwright 的 Page 不支持自定义事件 emit。

解决方案：使用独立的 EventEmitter 或直接回调。

#### `src/WebSocketCollector.ts` — WebSocket 数据收集
**改动范围：中**

与 PageCollector 同样的 `targetcreated/targetdestroyed` 问题。
CDP 监听部分（`Network.webSocketCreated` 等）完全不变。

#### `src/DevToolsConnectionAdapter.ts` — DevTools 前端桥接
**改动范围：大，风险最高**

这是迁移中最复杂的部分。

依赖的 Puppeteer 内部 API：
1. `session.connection()` — 获取底层 Connection 对象
2. `CDPSessionEvent.SessionAttached` / `SessionDetached`
3. `session.on('*', handler)` — 通配符事件监听
4. `connection.session(sessionId)` — 按 sessionId 查 session
5. `session.id()` — 获取 session ID

Playwright **没有**暴露 Connection 对象和 session 管理。

**解决方案：**

方案 A（推荐）：直接用 CDP 协议实现
```typescript
// 通过 CDP WebSocket 直接通信，绕过 Playwright 抽象层
// 使用 chrome-remote-interface 或自己实现 WebSocket CDP client
```

方案 B：用 Playwright 的 CDPSession API 重新实现
```typescript
// Playwright CDPSession 支持：
const session = await context.newCDPSession(page);
session.on('eventName', handler);    // 支持具体事件
session.send('method', params);       // 支持
session.detach();                     // 支持
// 但不支持：session.connection(), session.id(), wildcard events
```

方案 C：保留 Puppeteer 作为 DevTools 桥接的依赖（混合方案）
不推荐，增加复杂度。

**实际影响评估：**
DevToolsConnectionAdapter 只在 `experimentalDevtools` 模式下使用。
如果不需要 DevTools debugging（我们的场景不需要），可以暂时跳过。

### 第 3 层：上下文管理（中优先级）

#### `src/McpContext.ts` — 核心上下文
**改动范围：大**

逐点分析：
1. `browser.newPage()` → `browser.contexts()[0].newPage()` ✅
2. `browser.pages()` → `browser.contexts()[0].pages()` ✅
3. `page.evaluateOnNewDocument(script)` → `page.addInitScript(script)` ✅
4. `page.close({runBeforeUnload: false})` → `page.close({runBeforeUnload: false})` ✅
5. `page.isClosed()` → `page.isClosed()` ✅
6. `page.on('dialog', cb)` / `page.off('dialog', cb)` → 等价 ✅
7. `getCdpClient(page)` → `await getCdpClient(page)` ⚠️ async 化
8. `page._client().send('Target.getTargetInfo')` → CDP session ⚠️
9. `Locator.race(locators)` → 需要替代方案 ⚠️
10. `page.setDefaultTimeout()` → 等价 ✅
11. `page.setDefaultNavigationTimeout()` → 等价 ✅
12. `page.getDefaultNavigationTimeout()` → 可能需要自己跟踪 ⚠️

**Locator.race 替代：**
Puppeteer: `Locator.race([loc1, loc2, loc3])`
Playwright: `loc1.or(loc2).or(loc3)` 然后 `.waitFor()`

#### `src/WaitForHelper.ts` — 等待导航/DOM 稳定
**改动范围：中**

1. `page.evaluateHandle()` → 等价 ✅
2. `page.waitForNavigation()` → Playwright 也有 ✅
3. `getCdpClient(page).on('Page.frameStartedNavigating')` → async getCdpClient ⚠️
4. `CdpPage` 类型 → 用 `Page` 替代 ⚠️

#### `src/FetchInterceptor.ts` — 请求拦截
**改动范围：小**

纯 CDP 操作（`Fetch.enable`, `Fetch.requestPaused`, `Fetch.continueRequest` 等）。
只需要把 `CDPSession` 类型改成 Playwright 的，行为完全等价。

#### `src/DebuggerContext.ts` — 调试器上下文
**改动范围：小**

纯 CDP 操作（`Debugger.enable`, `Debugger.pause`, `Debugger.setBreakpointByUrl` 等）。
只需要改类型，行为完全等价。

### 第 4 层：MCP 工具（低优先级）

#### `src/tools/pages.ts` — 页面导航工具
```
page.goto(), page.goBack(), page.goForward(), page.reload()
```
全部等价，只需要改 import。

#### `src/tools/screenshot.ts` — 截图
```
page.screenshot({type, fullPage, encoding})
```
等价。Playwright 的 screenshot 还支持更多选项。

#### `src/tools/script.ts` — 脚本执行
Patchright 特有 API：`page.evaluate(expr, { isolated_context: false })`
可以控制是否在隔离上下文执行。对逆向很有用。

#### `src/tools/debugger.ts`、`network.ts`、`console.ts`、`cookies.ts`、`fetch.ts`、`frames.ts`、`websocket.ts`、`persistent-scripts.ts`
主要通过 CDPSession 操作，改动小。

#### `src/tools/ToolDefinition.ts` — 工具定义
类型引用需要更新（Page, Frame, HTTPRequest, Dialog, Protocol）。

### 第 5 层：辅助文件

#### `src/McpResponse.ts` — 响应格式化
类型引用更新。

#### `src/formatters/networkFormatter.ts`
`HTTPRequest`, `HTTPResponse` → Playwright 的 `Request`, `Response`。
需要验证 API 兼容性（`request.url()`, `request.method()`, `response.status()` 等）。

#### `src/formatters/consoleFormatter.ts`
`ConsoleMessage` API 基本等价。

#### `src/logger.ts`
`debug` 包，无需改动。

#### `src/cli.ts`
无需改动（纯 yargs）。

#### `src/main.ts`
import 路径更新 + stealth 脚本逻辑简化（Patchright 自带反检测）。

---

## 3. Protocol 类型迁移

Puppeteer 从自身导出 `Protocol` namespace（来自 devtools-protocol 包）。
Playwright 不导出这个。

解决方案：直接安装 `devtools-protocol` 包：
```bash
npm install -D devtools-protocol
```
```typescript
import type { Protocol } from 'devtools-protocol';
```

这在语义上更正确，因为 Protocol 是 CDP 协议定义，不属于任何自动化库。

---

## 4. 迁移顺序（推荐）

```
Phase 0: 准备
├── 安装 patchright + devtools-protocol
├── 创建 playwright compat 层（类型别名 + 工具函数）
└── 确保能编译

Phase 1: 核心基础设施
├── third_party/index.ts — 切换导出源
├── utils/cdp.ts — getCdpClient async 化
├── browser.ts — connect/launch 重写
└── 编译通过 + 基础冒烟测试

Phase 2: 数据收集器
├── PageCollector.ts — 事件模型迁移
├── WebSocketCollector.ts — 同上
├── McpContext.ts — 页面管理逻辑
└── 验证：页面创建/销毁/切换正常

Phase 3: 调试和拦截
├── DebuggerContext.ts — 纯类型改动
├── FetchInterceptor.ts — 纯类型改动
├── WaitForHelper.ts — async getCdpClient
└── 验证：断点/拦截/等待正常

Phase 4: MCP 工具层
├── 所有 tools/*.ts — import + 类型更新
├── McpResponse.ts — 类型更新
├── formatters/* — 类型更新
└── 验证：所有 MCP 工具正常

Phase 5: 清理
├── 删除 stealth.min.js + stealth-patch.js
├── 删除 rebrowser 相关 @ts-expect-error
├── DevToolsConnectionAdapter.ts 重写或移除
├── 更新文档
└── 全量测试
```

---

## 5. 可以跳过/延后的部分

| 文件 | 原因 |
|------|------|
| `DevToolsConnectionAdapter.ts` | 只在 experimentalDevtools 模式用，我们不需要 |
| `scripts/stealth.min.js` | Patchright 自带反检测 |
| `scripts/stealth-patch.js` | 同上 |
| rollup bundling | 可以先用 tsc 编译，后续再处理打包 |

---

## 6. 新增：Input 工具

迁移完成后，添加 `src/tools/input.ts`：

```typescript
// Playwright API — 比 Puppeteer 更自然
await page.click(selector);                    // 自动等待 + 点击
await page.fill(selector, text);               // 清空 + 填充（触发完整事件链）
await page.type(selector, text);               // 逐字输入（触发 keydown/keypress/keyup）
await page.selectOption(selector, value);      // 下拉选择
await page.press(selector, key);               // 按键
await page.locator(selector).waitFor();        // 等待元素
await page.keyboard.press('Enter');            // 全局按键
await page.mouse.click(x, y);                 // 坐标点击
```

MCP 工具列表：
- `click_element` — CSS selector 或坐标点击
- `type_text` — 在元素中输入文本（逐字，触发键盘事件）
- `fill_text` — 快速填充（不逐字，适合表单）
- `press_key` — 按键（支持组合键如 Ctrl+A）
- `select_option` — 下拉框选择
- `hover_element` — 悬停
- `scroll_page` — 滚动
- `wait_for_selector` — 等待元素出现
- `get_element_text` — 获取元素文本
- `get_element_attribute` — 获取元素属性

---

## 7. 风险总结

| 风险等级 | 项目 | 缓解措施 |
|---------|------|---------|
| 🔴 高 | DevToolsConnectionAdapter 重写 | 可以暂时跳过（experimental 功能） |
| 🔴 高 | getCdpClient async 化传播 | 编译器会帮你找到所有调用点 |
| 🟡 中 | Browser 事件模型变更 | 用 BrowserContext 事件替代 |
| 🟡 中 | page.emit 自定义事件不支持 | 用独立 EventEmitter |
| 🟡 中 | Protocol 类型来源变更 | 安装 devtools-protocol 包 |
| 🟢 低 | 导航/截图/evaluate API | 几乎完全等价 |
| 🟢 低 | CDP 操作（Debugger/Network/Fetch） | 完全等价 |
| 🟢 低 | MCP 工具层 | 主要是 import 更新 |

---

## 8. Patchright 特有优势（迁移后可利用）

1. **`isolated_context` 参数** — `page.evaluate(expr, { isolated_context: false })` 可以在主世界执行，对逆向很有用
2. **反检测内置** — 不需要 stealth 脚本
3. **`channel: 'chrome'`** — 自动使用系统 Chrome
4. **更好的 Locator API** — `page.locator(sel).fill()`, `.click()`, `.waitFor()` 链式调用
5. **Trace recording** — `context.tracing.start/stop()` 可以录制完整操作追踪

---

## 9. 测试验证清单

迁移后需要验证的核心场景：

- [ ] Launch 模式：启动 Chrome 并打开页面
- [ ] Connect 模式：连接到已有 Chrome/AdsPower
- [ ] 页面导航：goto, goBack, goForward, reload
- [ ] 截图：fullPage, element, 指定格式
- [ ] CDP Session：Debugger.enable, 设置断点, 暂停/恢复
- [ ] 网络请求收集：request 事件, 请求/响应体
- [ ] WebSocket 收集：连接/消息/关闭
- [ ] Console 收集：log, error, warn
- [ ] Fetch 拦截：拦截/修改/阻断请求
- [ ] 脚本管理：列出/搜索/获取源码
- [ ] 页面切换：多页面, select, new, close
- [ ] Frame 切换：列出 frames, 选择 frame
- [ ] 持久化脚本：添加/移除 evaluateOnNewDocument
- [ ] Cookie 操作：get/set/delete
- [ ] Input 工具（新）：click, type, fill, select, press
