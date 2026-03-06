/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../third_party/index.js';
import type {JSHandle} from '../third_party/index.js';

import {ToolCategory} from './categories.js';
import {defineTool} from './ToolDefinition.js';

// Default script evaluation timeout in milliseconds (30 seconds)
const DEFAULT_SCRIPT_TIMEOUT = 30000;

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

export const evaluateScript = defineTool({
  name: 'evaluate_script',
  description: `Evaluate a JavaScript function inside the currently selected page. Returns the response as JSON
so returned values have to JSON-serializable.`,
  annotations: {
    category: ToolCategory.DEBUGGING,
    readOnlyHint: false,
  },
  schema: {
    function: zod.string().describe(
      `A JavaScript function declaration to be executed by the tool in the currently selected page.
Example without arguments: \`() => {
  return document.title
}\` or \`async () => {
  return await fetch("example.com")
}\`.
Example with arguments: \`(el) => {
  return el.innerText;
}\`
`,
    ),
  },
  handler: async (request, response, context) => {
    let fn: JSHandle<unknown> | undefined;
    try {
      const frame = context.getSelectedFrame();
      fn = await withTimeout(
        frame.evaluateHandle(`(${request.params.function})`),
        DEFAULT_SCRIPT_TIMEOUT,
        `Script compilation timed out after ${DEFAULT_SCRIPT_TIMEOUT / 1000}s. The function may have a syntax error.`,
      );
      await context.waitForEventsAfterAction(async () => {
        const result = await withTimeout(
          frame.evaluate(async fn => {
            // @ts-expect-error no types.
            return JSON.stringify(await fn());
          }, fn),
          DEFAULT_SCRIPT_TIMEOUT,
          `Script execution timed out after ${DEFAULT_SCRIPT_TIMEOUT / 1000}s. The script may be waiting for a network response or user interaction that never completes.`,
        );
        if (result === undefined || result === 'undefined') {
          response.appendResponseLine(
            'Script ran on page and returned: undefined',
          );
          response.appendResponseLine(
            '(Tip: Make sure your function returns a value. Use `return` explicitly.)',
          );
        } else if (result === null || result === 'null') {
          response.appendResponseLine('Script ran on page and returned: null');
        } else {
          response.appendResponseLine('Script ran on page and returned:');
          response.appendResponseLine('```json');
          response.appendResponseLine(`${result}`);
          response.appendResponseLine('```');
        }
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      response.appendResponseLine(`Script error: ${errorMessage}`);

      // Add helpful context for common errors
      if (errorMessage.includes('timed out')) {
        response.appendResponseLine('');
        response.appendResponseLine(
          'Tip: For long-running operations, consider using evaluate_script with a shorter operation, or use the direct API call approach.',
        );
      } else if (
        errorMessage.includes('not a function') ||
        errorMessage.includes('is not defined')
      ) {
        response.appendResponseLine('');
        response.appendResponseLine(
          'Tip: Make sure you are passing a function expression, e.g., `() => { ... }` or `async () => { ... }`.',
        );
      }
    } finally {
      if (fn) {
        void fn.dispose();
      }
    }
  },
});
