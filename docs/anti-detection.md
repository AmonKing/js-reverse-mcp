# Anti-Detection Strategy

## Current Implementation (Patchright)

### 1. Patchright (Playwright anti-detection fork)

[patchright](https://github.com/AikidoSec/patchright) is a patched version of Playwright designed to be undetectable. Key patches:

- **No `Runtime.Enable` leak**: Playwright/Puppeteer call `Runtime.Enable` to discover execution contexts, which triggers `Runtime.consoleAPICalled` events detectable by anti-bot systems (Cloudflare, DataDome). Patchright avoids this.
- **`navigator.webdriver` returns `undefined`**: In isolated context (default), `navigator.webdriver` is not exposed.
- **Isolated context evaluation**: `page.evaluate()` runs in an isolated context by default, preventing detection via page-level JS introspection.
- **No source URL tracking**: Removes `//# sourceURL=` annotations from injected scripts.

### 2. Browser launch configuration

Recommended configuration (from Patchright docs):

```javascript
chromium.launchPersistentContext("userDataDir", {
    channel: "chrome",      // Real Chrome, not Chromium
    headless: false,         // Maximum undetectability
    viewport: null,          // No custom viewport
    // Do NOT add custom headers or userAgent
});
```

Current launch flags:
- `channel: 'chrome'` — uses real Chrome binary (install via `npx patchright install chrome`)
- `ignoreDefaultArgs: ['--enable-automation']` — removes automation infobar

### 3. Optional init script

Users can pass `--initScript path/to/stealth.js` to inject custom scripts via `page.addInitScript()` for additional anti-detection measures.

## What passes

| Test Site | Result |
|---|---|
| rebrowser-bot-detector | runtimeEnableLeak: PASS, all others: PASS |
| infosimples/detect-headless | All green |
| bot.sannysoft.com | All checks passed |

## Cloudflare Turnstile

Turnstile 会弹出人机验证框（"确认您是真人"），但 **手动点击 checkbox 即可通过**。Patchright 的 CDP 隐藏足够好，Turnstile 不会 silent block，只需要一次人工交互。相比之下，原版 Playwright/Puppeteer 通常会被直接拦死。

全自动绕过（无人点击）仍然不可行，因为 Turnstile 有多层检测：TLS 指纹（JA3/JA4）、HTTP/2 帧顺序、加密 proof-of-work、行为分析 ML 模型。

## Known limitations

- **Console events in headless shell**: Patchright suppresses `page.on('console')` / `page.on('pageerror')` events in `chrome-headless-shell` mode (anti-detection feature). Use CDP `Runtime.consoleAPICalled` instead, or use `channel: 'chrome'` where these events work normally.
- **`headless: true`** uses `chrome-headless-shell` which has reduced anti-detection capability compared to `headless: false` with real Chrome.

## Industry approaches for strong protection

- **CAPTCHA solving services** (2captcha, CapSolver) — pay per solve
- **Anti-detect browsers** (Camoufox, Kameleo) — modified browser binaries
- **Connect to user's real Chrome** (`--browserUrl` / `--remote-debugging-port`) — real profile with cookies, history, field trials
