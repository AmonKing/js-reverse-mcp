/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {isUtf8} from 'node:buffer';

import type {HTTPRequest, HTTPResponse} from '../third_party/index.js';

const BODY_CONTEXT_SIZE_LIMIT = 10000;
const BODY_FETCH_TIMEOUT_MS = 5000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Timed out fetching body')), ms),
    ),
  ]);
}

export function getShortDescriptionForRequest(
  request: HTTPRequest,
  id: number,
  selectedInDevToolsUI = false,
): string {
  return `reqid=${id} ${request.method()} ${request.url()}${selectedInDevToolsUI ? ` [selected in the DevTools Network panel]` : ''}`;
}

export async function getStatusFromRequest(request: HTTPRequest): Promise<string> {
  const httpResponse = await request.response();
  const failure = request.failure();
  let status: string;
  if (httpResponse) {
    const responseStatus = httpResponse.status();
    status =
      responseStatus >= 200 && responseStatus <= 299
        ? `[success - ${responseStatus}]`
        : `[failed - ${responseStatus}]`;
  } else if (failure) {
    status = `[failed - ${failure.errorText}]`;
  } else {
    status = '[pending]';
  }
  return status;
}

export function getFormattedHeaderValue(
  headers: Record<string, string>,
): string[] {
  const response: string[] = [];
  for (const [name, value] of Object.entries(headers)) {
    response.push(`- ${name}:${value}`);
  }
  return response;
}

export async function getFormattedResponseBody(
  httpResponse: HTTPResponse,
  sizeLimit = BODY_CONTEXT_SIZE_LIMIT,
): Promise<string | undefined> {
  try {
    const responseBuffer = await withTimeout(httpResponse.body(), BODY_FETCH_TIMEOUT_MS);

    if (isUtf8(responseBuffer)) {
      const responseAsTest = responseBuffer.toString('utf-8');

      if (responseAsTest.length === 0) {
        return `<empty response>`;
      }

      return `${getSizeLimitedString(responseAsTest, sizeLimit)}`;
    }

    return `<binary data>`;
  } catch {
    return `<not available anymore>`;
  }
}

export async function getFormattedRequestBody(
  httpRequest: HTTPRequest,
  sizeLimit: number = BODY_CONTEXT_SIZE_LIMIT,
): Promise<string | undefined> {
  const data = httpRequest.postData();
  if (data) {
    return `${getSizeLimitedString(data, sizeLimit)}`;
  }

  try {
    const postBuffer = httpRequest.postDataBuffer();
    if (postBuffer) {
      return `${getSizeLimitedString(postBuffer.toString('utf-8'), sizeLimit)}`;
    }
  } catch {
    return `<not available anymore>`;
  }

  return;
}

/**
 * Build redirect chain by walking redirectedFrom() links.
 */
export function getRedirectChain(request: HTTPRequest): HTTPRequest[] {
  const chain: HTTPRequest[] = [];
  let current = request.redirectedFrom();
  while (current) {
    chain.push(current);
    current = current.redirectedFrom();
  }
  return chain;
}

function getSizeLimitedString(text: string, sizeLimit: number) {
  if (text.length > sizeLimit) {
    return `${text.substring(0, sizeLimit) + '... <truncated>'}`;
  }

  return `${text}`;
}
