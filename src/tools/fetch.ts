/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../third_party/index.js';

import {ToolCategory} from './categories.js';
import {defineTool} from './ToolDefinition.js';

export const interceptRequest = defineTool({
  name: 'intercept_request',
  description:
    'Add a request interception rule. Intercepts matching requests at CDP level (survives page navigation). Can modify request body, headers, or block requests entirely.',
  annotations: {
    title: 'Intercept Request',
    category: ToolCategory.INTERCEPTION,
    readOnlyHint: false,
  },
  schema: {
    ruleId: zod
      .string()
      .describe('Unique ID for this interception rule.'),
    urlPattern: zod
      .string()
      .describe(
        'URL pattern to match (glob-style: * matches anything). E.g., "*xsolla.com*payment*".',
      ),
    resourceType: zod
      .string()
      .optional()
      .describe('Optional resource type filter (e.g., "XHR", "Fetch", "Document").'),
    action: zod
      .enum(['modify', 'block', 'log'])
      .default('modify')
      .describe(
        'Action: "modify" to change request, "block" to fail it, "log" to just record it.',
      ),
    modifyBody: zod
      .string()
      .optional()
      .describe('New request body (string). For JSON APIs, pass the full JSON string.'),
    modifyHeaders: zod
      .record(zod.string())
      .optional()
      .describe('Headers to add or override. E.g., {"X-Country": "ID"}.'),
  },
  handler: async (request, response, context) => {
    const interceptor = context.fetchInterceptor;

    if (!interceptor.isEnabled()) {
      response.appendResponseLine(
        'Fetch interceptor not enabled. Select a page first.',
      );
      return;
    }

    const {ruleId, urlPattern, resourceType, action, modifyBody, modifyHeaders} =
      request.params;

    interceptor.addRule({
      id: ruleId,
      urlPattern,
      resourceType,
      action,
      modifyBody,
      modifyHeaders,
    });

    response.appendResponseLine(`Interception rule added:`);
    response.appendResponseLine(`- Rule ID: ${ruleId}`);
    response.appendResponseLine(`- URL Pattern: ${urlPattern}`);
    response.appendResponseLine(`- Action: ${action}`);
    if (modifyBody) {
      response.appendResponseLine(
        `- Modify Body: ${modifyBody.substring(0, 100)}${modifyBody.length > 100 ? '...' : ''}`,
      );
    }
    if (modifyHeaders) {
      response.appendResponseLine(
        `- Modify Headers: ${JSON.stringify(modifyHeaders)}`,
      );
    }
    response.appendResponseLine('');
    response.appendResponseLine(
      'This rule operates at CDP level and survives page navigation.',
    );
  },
});

export const removeIntercept = defineTool({
  name: 'remove_intercept',
  description: 'Removes a request interception rule by its ID.',
  annotations: {
    title: 'Remove Intercept',
    category: ToolCategory.INTERCEPTION,
    readOnlyHint: false,
  },
  schema: {
    ruleId: zod.string().describe('The rule ID to remove.'),
  },
  handler: async (request, response, context) => {
    const interceptor = context.fetchInterceptor;
    const removed = interceptor.removeRule(request.params.ruleId);

    if (removed) {
      response.appendResponseLine(
        `Rule "${request.params.ruleId}" removed.`,
      );
    } else {
      response.appendResponseLine(
        `Rule "${request.params.ruleId}" not found.`,
      );
    }
  },
});

export const listIntercepts = defineTool({
  name: 'list_intercepts',
  description: 'Lists all active request interception rules.',
  annotations: {
    title: 'List Intercepts',
    category: ToolCategory.INTERCEPTION,
    readOnlyHint: true,
  },
  schema: {},
  handler: async (request, response, context) => {
    const rules = context.fetchInterceptor.getRules();

    if (rules.length === 0) {
      response.appendResponseLine('No active interception rules.');
      return;
    }

    response.appendResponseLine(`Active interception rules (${rules.length}):\n`);

    for (const rule of rules) {
      response.appendResponseLine(`- ID: ${rule.id}`);
      response.appendResponseLine(`  Pattern: ${rule.urlPattern}`);
      response.appendResponseLine(`  Action: ${rule.action}`);
      if (rule.resourceType) {
        response.appendResponseLine(`  Resource Type: ${rule.resourceType}`);
      }
      if (rule.modifyBody) {
        response.appendResponseLine(
          `  Body: ${rule.modifyBody.substring(0, 80)}...`,
        );
      }
      if (rule.modifyHeaders) {
        response.appendResponseLine(
          `  Headers: ${JSON.stringify(rule.modifyHeaders)}`,
        );
      }
      response.appendResponseLine('');
    }
  },
});

export const getInterceptLogs = defineTool({
  name: 'get_intercept_logs',
  description:
    'Gets the log of intercepted requests. Shows which rules matched and what modifications were applied.',
  annotations: {
    title: 'Get Intercept Logs',
    category: ToolCategory.INTERCEPTION,
    readOnlyHint: true,
  },
  schema: {
    ruleId: zod
      .string()
      .optional()
      .describe('Filter logs by rule ID.'),
    limit: zod
      .number()
      .int()
      .optional()
      .default(20)
      .describe('Max number of log entries to return (default: 20).'),
  },
  handler: async (request, response, context) => {
    let logs = context.fetchInterceptor.getLogs();

    if (request.params.ruleId) {
      logs = logs.filter(l => l.rule === request.params.ruleId);
    }

    const limit = request.params.limit ?? 20;
    const display = logs.slice(-limit);

    if (display.length === 0) {
      response.appendResponseLine('No interception logs.');
      return;
    }

    response.appendResponseLine(
      `Intercept logs (${display.length} of ${logs.length}):\n`,
    );

    for (const log of display) {
      const time = new Date(log.timestamp).toISOString().substring(11, 23);
      response.appendResponseLine(
        `[${time}] ${log.action.toUpperCase()} rule=${log.rule} ${log.request.request.method} ${log.request.request.url.substring(0, 100)}`,
      );
      if (log.request.request.postData) {
        response.appendResponseLine(
          `  Body: ${log.request.request.postData.substring(0, 120)}${log.request.request.postData.length > 120 ? '...' : ''}`,
        );
      }
    }
  },
});
