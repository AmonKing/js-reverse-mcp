/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../third_party/index.js';

import {ToolCategory} from './categories.js';
import {defineTool} from './ToolDefinition.js';

export const clickElement = defineTool({
  name: 'click_element',
  description:
    'Click an element on the page by CSS selector or at specific coordinates.',
  annotations: {
    category: ToolCategory.INPUT,
    readOnlyHint: false,
  },
  schema: {
    selector: zod
      .string()
      .optional()
      .describe('CSS selector of the element to click.'),
    x: zod.number().optional().describe('X coordinate to click at.'),
    y: zod.number().optional().describe('Y coordinate to click at.'),
    button: zod
      .enum(['left', 'right', 'middle'])
      .default('left')
      .describe('Mouse button to click with.'),
    clickCount: zod
      .number()
      .int()
      .default(1)
      .describe('Number of clicks (e.g. 2 for double-click).'),
  },
  handler: async (request, response, context) => {
    const page = context.getSelectedPage();
    const {selector, x, y, button, clickCount} = request.params;

    if (selector) {
      await page.click(selector, {button, clickCount});
      response.appendResponseLine(
        `Clicked element matching "${selector}".`,
      );
    } else if (x !== undefined && y !== undefined) {
      await page.mouse.click(x, y, {button, clickCount});
      response.appendResponseLine(`Clicked at coordinates (${x}, ${y}).`);
    } else {
      throw new Error('Either selector or x/y coordinates must be provided.');
    }
  },
});

export const fillText = defineTool({
  name: 'fill_text',
  description:
    'Fill an input field with text (clears existing content first). Works with input, textarea, and contenteditable elements.',
  annotations: {
    category: ToolCategory.INPUT,
    readOnlyHint: false,
  },
  schema: {
    selector: zod.string().describe('CSS selector of the input element.'),
    value: zod.string().describe('Text to fill into the element.'),
  },
  handler: async (request, response, context) => {
    const page = context.getSelectedPage();
    const {selector, value} = request.params;

    await page.fill(selector, value);
    response.appendResponseLine(
      `Filled "${selector}" with "${value}".`,
    );
  },
});

export const typeText = defineTool({
  name: 'type_text',
  description:
    'Type text character by character with key events. Use this when you need realistic keystroke simulation (e.g. for autocomplete).',
  annotations: {
    category: ToolCategory.INPUT,
    readOnlyHint: false,
  },
  schema: {
    selector: zod
      .string()
      .describe('CSS selector of the element to type into.'),
    text: zod.string().describe('Text to type.'),
    delay: zod
      .number()
      .optional()
      .describe('Delay between keystrokes in milliseconds.'),
  },
  handler: async (request, response, context) => {
    const page = context.getSelectedPage();
    const {selector, text, delay} = request.params;

    await page.locator(selector).pressSequentially(text, {delay});
    response.appendResponseLine(
      `Typed "${text}" into "${selector}".`,
    );
  },
});

export const pressKey = defineTool({
  name: 'press_key',
  description:
    'Press a key or key combination (e.g. "Enter", "Control+A", "Shift+ArrowDown").',
  annotations: {
    category: ToolCategory.INPUT,
    readOnlyHint: false,
  },
  schema: {
    key: zod
      .string()
      .describe(
        'Key or key combination to press. Examples: "Enter", "Control+A", "Shift+ArrowDown".',
      ),
    selector: zod
      .string()
      .optional()
      .describe(
        'Optional CSS selector to focus before pressing the key.',
      ),
  },
  handler: async (request, response, context) => {
    const page = context.getSelectedPage();
    const {key, selector} = request.params;

    if (selector) {
      await page.press(selector, key);
    } else {
      await page.keyboard.press(key);
    }
    response.appendResponseLine(`Pressed key "${key}".`);
  },
});

export const selectOption = defineTool({
  name: 'select_option',
  description: 'Select an option from a <select> element.',
  annotations: {
    category: ToolCategory.INPUT,
    readOnlyHint: false,
  },
  schema: {
    selector: zod
      .string()
      .describe('CSS selector of the <select> element.'),
    value: zod
      .string()
      .optional()
      .describe('Option value to select.'),
    label: zod
      .string()
      .optional()
      .describe('Option label (visible text) to select.'),
    index: zod
      .number()
      .int()
      .optional()
      .describe('Option index to select.'),
  },
  handler: async (request, response, context) => {
    const page = context.getSelectedPage();
    const {selector, value, label, index} = request.params;

    if (value !== undefined) {
      await page.selectOption(selector, {value});
      response.appendResponseLine(
        `Selected option with value "${value}" in "${selector}".`,
      );
    } else if (label !== undefined) {
      await page.selectOption(selector, {label});
      response.appendResponseLine(
        `Selected option with label "${label}" in "${selector}".`,
      );
    } else if (index !== undefined) {
      await page.selectOption(selector, {index});
      response.appendResponseLine(
        `Selected option at index ${index} in "${selector}".`,
      );
    } else {
      throw new Error(
        'One of value, label, or index must be provided.',
      );
    }
  },
});

export const hoverElement = defineTool({
  name: 'hover_element',
  description: 'Hover over an element on the page.',
  annotations: {
    category: ToolCategory.INPUT,
    readOnlyHint: false,
  },
  schema: {
    selector: zod
      .string()
      .describe('CSS selector of the element to hover over.'),
  },
  handler: async (request, response, context) => {
    const page = context.getSelectedPage();
    await page.hover(request.params.selector);
    response.appendResponseLine(
      `Hovered over "${request.params.selector}".`,
    );
  },
});

export const scrollPage = defineTool({
  name: 'scroll_page',
  description:
    'Scroll the page by the specified amount using mouse wheel events.',
  annotations: {
    category: ToolCategory.INPUT,
    readOnlyHint: false,
  },
  schema: {
    x: zod
      .number()
      .default(0)
      .describe('Horizontal scroll amount in pixels.'),
    y: zod
      .number()
      .default(0)
      .describe(
        'Vertical scroll amount in pixels. Positive values scroll down.',
      ),
  },
  handler: async (request, response, context) => {
    const page = context.getSelectedPage();
    await page.mouse.wheel(request.params.x, request.params.y);
    response.appendResponseLine(
      `Scrolled by (${request.params.x}, ${request.params.y}).`,
    );
  },
});

export const waitForSelector = defineTool({
  name: 'wait_for_selector',
  description:
    'Wait for an element matching the selector to appear in the page.',
  annotations: {
    category: ToolCategory.INPUT,
    readOnlyHint: true,
  },
  schema: {
    selector: zod.string().describe('CSS selector to wait for.'),
    state: zod
      .enum(['attached', 'detached', 'visible', 'hidden'])
      .default('visible')
      .describe('State to wait for.'),
    timeout: zod
      .number()
      .int()
      .optional()
      .describe('Maximum wait time in milliseconds.'),
  },
  handler: async (request, response, context) => {
    const page = context.getSelectedPage();
    const {selector, state, timeout} = request.params;

    await page.locator(selector).waitFor({state, timeout});
    response.appendResponseLine(
      `Element "${selector}" is now ${state}.`,
    );
  },
});

export const getElementText = defineTool({
  name: 'get_element_text',
  description: 'Get the text content of an element.',
  annotations: {
    category: ToolCategory.INPUT,
    readOnlyHint: true,
  },
  schema: {
    selector: zod.string().describe('CSS selector of the element.'),
  },
  handler: async (request, response, context) => {
    const page = context.getSelectedPage();
    const text = await page.locator(request.params.selector).textContent();
    response.appendResponseLine(
      `Text content of "${request.params.selector}": ${text ?? '<null>'}`,
    );
  },
});

export const getElementAttribute = defineTool({
  name: 'get_element_attribute',
  description: 'Get the value of an attribute on an element.',
  annotations: {
    category: ToolCategory.INPUT,
    readOnlyHint: true,
  },
  schema: {
    selector: zod.string().describe('CSS selector of the element.'),
    attribute: zod.string().describe('Name of the attribute to get.'),
  },
  handler: async (request, response, context) => {
    const page = context.getSelectedPage();
    const {selector, attribute} = request.params;
    const value = await page
      .locator(selector)
      .getAttribute(attribute);
    response.appendResponseLine(
      `${attribute}="${value ?? '<null>'}" on "${selector}"`,
    );
  },
});
