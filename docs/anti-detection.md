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

## What does NOT pass

| Target | Detection | Why |
|---|---|---|
| **Cloudflare Turnstile** | Blocked | Multi-layer detection: TLS fingerprint (JA3/JA4), HTTP/2 frame order, behavioral analysis, cryptographic proof-of-work, ML models. Not fixable via JS injection. |

## Known limitations

- **Console events in headless shell**: Patchright suppresses `page.on('console')` / `page.on('pageerror')` events in `chrome-headless-shell` mode (anti-detection feature). Use CDP `Runtime.consoleAPICalled` instead, or use `channel: 'chrome'` where these events work normally.
- **`headless: true`** uses `chrome-headless-shell` which has reduced anti-detection capability compared to `headless: false` with real Chrome.

## Industry approaches for strong protection

- **CAPTCHA solving services** (2captcha, CapSolver) — pay per solve
- **Anti-detect browsers** (Camoufox, Kameleo) — modified browser binaries
- **Connect to user's real Chrome** (`--browserUrl` / `--remote-debugging-port`) — real profile with cookies, history, field trials
