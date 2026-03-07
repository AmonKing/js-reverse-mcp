/**
 * Unit tests for src/utils/pagination.ts
 */

import {describe, it} from 'node:test';
import assert from 'node:assert';

import {paginate} from '../src/utils/pagination.js';

describe('paginate', () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it('returns all items when no pagination options', () => {
    const result = paginate(items);
    assert.deepStrictEqual(result.items, items);
    assert.strictEqual(result.currentPage, 0);
    assert.strictEqual(result.totalPages, 1);
    assert.strictEqual(result.hasNextPage, false);
    assert.strictEqual(result.hasPreviousPage, false);
    assert.strictEqual(result.invalidPage, false);
  });

  it('returns all items when options are undefined', () => {
    const result = paginate(items, {pageSize: undefined, pageIdx: undefined});
    assert.deepStrictEqual(result.items, items);
    assert.strictEqual(result.totalPages, 1);
  });

  it('paginates with pageSize', () => {
    const result = paginate(items, {pageSize: 3});
    assert.deepStrictEqual([...result.items], [1, 2, 3]);
    assert.strictEqual(result.currentPage, 0);
    assert.strictEqual(result.totalPages, 4);
    assert.strictEqual(result.hasNextPage, true);
    assert.strictEqual(result.hasPreviousPage, false);
  });

  it('navigates to specific page', () => {
    const result = paginate(items, {pageSize: 3, pageIdx: 1});
    assert.deepStrictEqual([...result.items], [4, 5, 6]);
    assert.strictEqual(result.currentPage, 1);
    assert.strictEqual(result.hasNextPage, true);
    assert.strictEqual(result.hasPreviousPage, true);
  });

  it('handles last page with fewer items', () => {
    const result = paginate(items, {pageSize: 3, pageIdx: 3});
    assert.deepStrictEqual([...result.items], [10]);
    assert.strictEqual(result.hasNextPage, false);
    assert.strictEqual(result.hasPreviousPage, true);
  });

  it('returns invalidPage for out-of-range pageIdx', () => {
    const result = paginate(items, {pageSize: 3, pageIdx: 99});
    assert.strictEqual(result.invalidPage, true);
    assert.strictEqual(result.currentPage, 0);
  });

  it('returns invalidPage for negative pageIdx', () => {
    const result = paginate(items, {pageSize: 3, pageIdx: -1});
    assert.strictEqual(result.invalidPage, true);
  });

  it('handles empty array', () => {
    const result = paginate([], {pageSize: 5});
    assert.deepStrictEqual([...result.items], []);
    assert.strictEqual(result.totalPages, 1);
  });
});
