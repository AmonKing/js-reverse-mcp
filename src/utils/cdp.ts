/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {CDPSession, Page} from '../third_party/index.js';

const sessionCache = new WeakMap<Page, CDPSession>();

/**
 * Get the CDP session for a page.
 * Uses Playwright's public API: page.context().newCDPSession(page).
 * Sessions are cached per page to avoid creating multiple sessions.
 */
export async function getCdpClient(page: Page): Promise<CDPSession> {
  let session = sessionCache.get(page);
  if (!session) {
    session = await page.context().newCDPSession(page);
    sessionCache.set(page, session);
  }
  return session;
}

/**
 * Invalidate the cached CDP session for a page.
 * Call this when a page is closed or when the session needs to be recreated.
 */
export function invalidateCdpClient(page: Page): void {
  sessionCache.delete(page);
}
