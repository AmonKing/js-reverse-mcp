/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {logger} from './logger.js';
import type {Browser, BrowserContext} from './third_party/index.js';
import {chromium} from './third_party/index.js';

let browser: Browser | undefined;

/**
 * Get the default BrowserContext.
 * Playwright wraps pages in BrowserContext — we always use the first/default one.
 */
export function getDefaultContext(browser: Browser): BrowserContext {
  const contexts = browser.contexts();
  if (contexts.length === 0) {
    throw new Error('No browser context available');
  }
  return contexts[0];
}

export async function ensureBrowserConnected(options: {
  browserURL?: string;
  wsEndpoint?: string;
  wsHeaders?: Record<string, string>;
  devtools: boolean;
  initScript?: string;
}) {
  if (browser?.isConnected()) {
    return browser;
  }

  let endpoint: string;
  if (options.wsEndpoint) {
    endpoint = options.wsEndpoint;
  } else if (options.browserURL) {
    endpoint = options.browserURL;
  } else {
    throw new Error('Either browserURL or wsEndpoint must be provided');
  }

  logger('Connecting Patchright to ', endpoint);
  browser = await chromium.connectOverCDP(endpoint, {
    headers: options.wsHeaders,
  });
  logger('Connected Patchright');

  if (options.initScript) {
    const context = getDefaultContext(browser);
    const pages = context.pages();
    for (const page of pages) {
      await page.addInitScript(options.initScript);
    }
  }

  return browser;
}

interface McpLaunchOptions {
  acceptInsecureCerts?: boolean;
  executablePath?: string;
  channel?: Channel;
  userDataDir?: string;
  headless: boolean;
  isolated: boolean;
  logFile?: fs.WriteStream;
  viewport?: {
    width: number;
    height: number;
  };
  args?: string[];
  devtools: boolean;
  initScript?: string;
}

export async function launch(options: McpLaunchOptions): Promise<Browser> {
  const {channel, executablePath, headless, isolated} = options;
  const profileDirName =
    channel && channel !== 'stable'
      ? `chrome-profile-${channel}`
      : 'chrome-profile';

  let userDataDir = options.userDataDir;
  if (!isolated && !userDataDir) {
    userDataDir = path.join(
      os.homedir(),
      '.cache',
      'chrome-devtools-mcp',
      profileDirName,
    );
    await fs.promises.mkdir(userDataDir, {
      recursive: true,
    });
  }

  const args: string[] = [
    ...(options.args ?? []),
    '--hide-crash-restore-bubble',
  ];
  if (headless) {
    args.push('--screen-info={3840x2160}');
  }

  let playwrightChannel: string | undefined;
  if (options.devtools) {
    args.push('--auto-open-devtools-for-tabs');
  }
  if (!executablePath) {
    playwrightChannel =
      channel && channel !== 'stable'
        ? `chrome-${channel}`
        : 'chrome';
  }

  try {
    let browser: Browser;
    if (userDataDir) {
      const context = await chromium.launchPersistentContext(userDataDir, {
        channel: playwrightChannel,
        executablePath,
        headless,
        args,
        ignoreDefaultArgs: ['--enable-automation'],
        acceptDownloads: false,
        viewport: options.viewport
          ? {width: options.viewport.width, height: options.viewport.height}
          : null,
        bypassCSP: false,
      });
      browser = context.browser()!;
    } else {
      browser = await chromium.launch({
        channel: playwrightChannel,
        executablePath,
        headless,
        args,
        ignoreDefaultArgs: ['--enable-automation'],
      });

      const context = await browser.newContext({
        viewport: options.viewport
          ? {width: options.viewport.width, height: options.viewport.height}
          : null,
        acceptDownloads: false,
      });
      await context.newPage();
    }

    if (options.initScript) {
      const context = getDefaultContext(browser);
      const pages = context.pages();
      for (const page of pages) {
        await page.addInitScript(options.initScript);
      }
    }

    return browser;
  } catch (error) {
    if (
      userDataDir &&
      (error as Error).message.includes('The browser is already running')
    ) {
      throw new Error(
        `The browser is already running for ${userDataDir}. Use --isolated to run multiple browser instances.`,
        {
          cause: error,
        },
      );
    }
    throw error;
  }
}

export async function ensureBrowserLaunched(
  options: McpLaunchOptions,
): Promise<Browser> {
  if (browser?.isConnected()) {
    return browser;
  }
  browser = await launch(options);
  return browser;
}

/**
 * Connect to an external browser (e.g. fingerprint browser) at runtime.
 * Disconnects the current browser first if connected.
 */
export async function connectToBrowser(endpoint: string): Promise<Browser> {
  if (browser?.isConnected()) {
    try {
      await browser.close();
    } catch {
      // Ignore close errors — may already be disconnected
    }
  }

  logger('Dynamically connecting to ', endpoint);
  browser = await chromium.connectOverCDP(endpoint);
  logger('Connected to external browser');
  return browser;
}

/**
 * Disconnect the current browser. Next tool call will auto-launch a new one.
 */
export async function disconnectBrowser(): Promise<void> {
  if (browser?.isConnected()) {
    try {
      await browser.close();
    } catch {
      // Ignore
    }
  }
  browser = undefined;
}

export type Channel = 'stable' | 'canary' | 'beta' | 'dev';
