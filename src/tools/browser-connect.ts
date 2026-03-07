/**
 * Tools for dynamically connecting to / disconnecting from external browsers
 * (e.g. fingerprint browsers like AdsPower, Multilogin, etc.) at runtime.
 */

import {connectToBrowser, disconnectBrowser} from '../browser.js';
import {zod} from '../third_party/index.js';

import {ToolCategory} from './categories.js';
import {defineTool} from './ToolDefinition.js';

export const connectBrowser = defineTool({
  name: 'connect_browser',
  description: `Connect to an external browser instance (e.g. fingerprint browser) via CDP endpoint. The current browser will be disconnected first. Accepts an HTTP URL (e.g. http://127.0.0.1:9222) or a WebSocket URL (e.g. ws://127.0.0.1:9222/devtools/browser/xxx). The next tool call will use the connected browser.`,
  annotations: {
    category: ToolCategory.NAVIGATION,
    readOnlyHint: false,
  },
  schema: {
    endpoint: zod
      .string()
      .describe(
        'CDP endpoint URL. HTTP (http://host:port) or WebSocket (ws://host:port/devtools/browser/id).',
      ),
  },
  handler: async (request, response) => {
    const {endpoint} = request.params;
    const browser = await connectToBrowser(endpoint);
    const pages = browser.contexts()[0]?.pages() ?? [];
    response.appendResponseLine(
      `Connected to external browser at ${endpoint}. Found ${pages.length} open page(s).`,
    );
    response.setIncludePages(true);
  },
});

export const disconnectBrowserTool = defineTool({
  name: 'disconnect_browser',
  description: `Disconnect from the current browser. The next tool call will automatically launch a new default Chrome instance.`,
  annotations: {
    category: ToolCategory.NAVIGATION,
    readOnlyHint: false,
  },
  schema: {},
  handler: async (_request, response) => {
    await disconnectBrowser();
    response.appendResponseLine(
      'Disconnected from browser. A new Chrome instance will be launched on the next tool call.',
    );
  },
});
