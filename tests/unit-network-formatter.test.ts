/**
 * Unit tests for src/formatters/networkFormatter.ts
 */

import {describe, it} from 'node:test';
import assert from 'node:assert';

import {
  getShortDescriptionForRequest,
  getFormattedHeaderValue,
  getRedirectChain,
} from '../src/formatters/networkFormatter.js';
import type {HTTPRequest} from '../src/third_party/index.js';

function mockRequest(overrides: {
  method?: string;
  url?: string;
  redirectedFrom?: HTTPRequest | null;
}): HTTPRequest {
  return {
    method: () => overrides.method ?? 'GET',
    url: () => overrides.url ?? 'https://example.com',
    redirectedFrom: () => overrides.redirectedFrom ?? null,
  } as unknown as HTTPRequest;
}

describe('getShortDescriptionForRequest', () => {
  it('formats basic request', () => {
    const req = mockRequest({method: 'POST', url: 'https://api.test/data'});
    const result = getShortDescriptionForRequest(req, 42);
    assert.strictEqual(result, 'reqid=42 POST https://api.test/data');
  });

  it('includes DevTools selection marker', () => {
    const req = mockRequest({});
    const result = getShortDescriptionForRequest(req, 1, true);
    assert.ok(result.includes('[selected in the DevTools Network panel]'));
  });
});

describe('getFormattedHeaderValue', () => {
  it('formats headers', () => {
    const result = getFormattedHeaderValue({
      'content-type': 'application/json',
      'x-custom': 'value',
    });
    assert.deepStrictEqual(result, [
      '- content-type:application/json',
      '- x-custom:value',
    ]);
  });

  it('handles empty headers', () => {
    assert.deepStrictEqual(getFormattedHeaderValue({}), []);
  });
});

describe('getRedirectChain', () => {
  it('returns empty array for non-redirect', () => {
    const req = mockRequest({});
    assert.deepStrictEqual(getRedirectChain(req), []);
  });

  it('builds chain from redirectedFrom links', () => {
    const req1 = mockRequest({url: 'https://a.com'});
    const req2 = mockRequest({url: 'https://b.com', redirectedFrom: req1});
    const req3 = mockRequest({url: 'https://c.com', redirectedFrom: req2});

    const chain = getRedirectChain(req3);
    assert.strictEqual(chain.length, 2);
    assert.strictEqual(chain[0].url(), 'https://b.com');
    assert.strictEqual(chain[1].url(), 'https://a.com');
  });
});
