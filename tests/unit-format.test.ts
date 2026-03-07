/**
 * Unit tests for src/utils/format.ts
 */

import {describe, it} from 'node:test';
import assert from 'node:assert';

import {formatError, truncate} from '../src/utils/format.js';

describe('formatError', () => {
  it('extracts message from Error instances', () => {
    assert.strictEqual(formatError(new Error('boom')), 'boom');
  });

  it('converts non-Error values to string', () => {
    assert.strictEqual(formatError('string error'), 'string error');
    assert.strictEqual(formatError(42), '42');
    assert.strictEqual(formatError(null), 'null');
    assert.strictEqual(formatError(undefined), 'undefined');
  });
});

describe('truncate', () => {
  it('returns short strings unchanged', () => {
    assert.strictEqual(truncate('hello', 10), 'hello');
  });

  it('truncates long strings with ellipsis', () => {
    assert.strictEqual(truncate('hello world', 5), 'hello...');
  });

  it('handles exact length', () => {
    assert.strictEqual(truncate('hello', 5), 'hello');
  });

  it('handles empty string', () => {
    assert.strictEqual(truncate('', 5), '');
  });
});
