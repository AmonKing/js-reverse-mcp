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
