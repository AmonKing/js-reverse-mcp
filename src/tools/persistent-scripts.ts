/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../third_party/index.js';

import {ToolCategory} from './categories.js';
import {defineTool} from './ToolDefinition.js';

export const addPersistentScript = defineTool({
  name: 'add_persistent_script',
  description:
    'Injects a JavaScript script that runs before any other script on every page load, including after navigation. Uses Page.addScriptToEvaluateOnNewDocument. Ideal for fetch hooks that need to survive SPA navigation.',
  annotations: {
    title: 'Add Persistent Script',
    category: ToolCategory.INTERCEPTION,
    readOnlyHint: false,
  },
  schema: {
    label: zod
      .string()
      .describe('A human-readable label for this script (e.g., "fetch-hook").'),
    code: zod
      .string()
      .describe(
        'JavaScript code to inject. Runs before any page script on every navigation.',
      ),
  },
  handler: async (request, response, context) => {
    const {label, code} = request.params;

    try {
      const identifier = await context.addPersistentScript(label, code);

      response.appendResponseLine(`Persistent script added:`);
      response.appendResponseLine(`- Identifier: ${identifier}`);
      response.appendResponseLine(`- Label: ${label}`);
      response.appendResponseLine(
        `- Code: ${code.substring(0, 100)}${code.length > 100 ? '...' : ''}`,
      );
      response.appendResponseLine('');
      response.appendResponseLine(
        'This script will run before any page script on every navigation (including SPA route changes that trigger full page loads).',
      );
      response.appendResponseLine(
        `Use remove_persistent_script(identifier: "${identifier}") to remove.`,
      );
    } catch (error) {
      response.appendResponseLine(
        `Error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});

export const removePersistentScript = defineTool({
  name: 'remove_persistent_script',
  description: 'Removes a previously added persistent script.',
  annotations: {
    title: 'Remove Persistent Script',
    category: ToolCategory.INTERCEPTION,
    readOnlyHint: false,
  },
  schema: {
    identifier: zod
      .string()
      .describe(
        'The identifier returned by add_persistent_script.',
      ),
  },
  handler: async (request, response, context) => {
    const removed = await context.removePersistentScript(
      request.params.identifier,
    );

    if (removed) {
      response.appendResponseLine(
        `Persistent script "${request.params.identifier}" removed.`,
      );
    } else {
      response.appendResponseLine(
        `Script "${request.params.identifier}" not found or already removed.`,
      );
    }
  },
});

export const listPersistentScripts = defineTool({
  name: 'list_persistent_scripts',
  description: 'Lists all active persistent scripts.',
  annotations: {
    title: 'List Persistent Scripts',
    category: ToolCategory.INTERCEPTION,
    readOnlyHint: true,
  },
  schema: {},
  handler: async (request, response, context) => {
    const scripts = context.getPersistentScripts();

    if (scripts.length === 0) {
      response.appendResponseLine('No active persistent scripts.');
      return;
    }

    response.appendResponseLine(
      `Active persistent scripts (${scripts.length}):\n`,
    );

    for (const script of scripts) {
      response.appendResponseLine(`- Identifier: ${script.identifier}`);
      response.appendResponseLine(`  Label: ${script.label}`);
      response.appendResponseLine(
        `  Code: ${script.code.substring(0, 80)}${script.code.length > 80 ? '...' : ''}`,
      );
      response.appendResponseLine('');
    }
  },
});
