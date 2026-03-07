/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import 'core-js/modules/es.promise.with-resolvers.js';
import 'core-js/proposals/iterator-helpers.js';

export type {Options as YargsOptions} from 'yargs';
export {default as yargs} from 'yargs';
export {hideBin} from 'yargs/helpers';
export {default as debug} from 'debug';
export type {Debugger} from 'debug';
export {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
export {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
export {
  type CallToolResult,
  SetLevelRequestSchema,
  type ImageContent,
  type TextContent,
} from '@modelcontextprotocol/sdk/types.js';
export {z as zod} from 'zod';

// Patchright (Playwright API)
export {chromium} from 'patchright';
export type {
  Browser,
  BrowserContext,
  Page,
  Frame,
  CDPSession,
  Request as HTTPRequest,
  Response as HTTPResponse,
  ConsoleMessage,
  Dialog,
  Locator,
  JSHandle,
  ElementHandle,
} from 'patchright';

// CDP Protocol types (previously from puppeteer-core)
export type {Protocol} from 'devtools-protocol';
