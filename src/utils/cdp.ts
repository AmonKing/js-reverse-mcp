/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {CDPSession, CdpPage, Page} from '../third_party/index.js';

/**
 * Get the CDP session for a page.
 * Wraps the internal Puppeteer `_client()` API with a single @ts-expect-error.
 */
export function getCdpClient(page: Page | CdpPage): CDPSession {
  // @ts-expect-error _client is internal Puppeteer API
  return page._client();
}
