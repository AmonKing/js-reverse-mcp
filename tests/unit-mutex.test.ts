/**
 * Unit tests for src/Mutex.ts
 */

import {describe, it} from 'node:test';
import assert from 'node:assert';

import {Mutex} from '../src/Mutex.js';

describe('Mutex', () => {
  it('acquires and releases', async () => {
    const mutex = new Mutex();
    const guard = await mutex.acquire();
    guard.dispose();
  });

  it('serializes concurrent access (FIFO)', async () => {
    const mutex = new Mutex();
    const order: number[] = [];

    const g1 = await mutex.acquire();

    const p2 = mutex.acquire().then(g => {
      order.push(2);
      g.dispose();
    });

    const p3 = mutex.acquire().then(g => {
      order.push(3);
      g.dispose();
    });

    // Release first lock — should unblock p2 first, then p3
    order.push(1);
    g1.dispose();

    await Promise.all([p2, p3]);
    assert.deepStrictEqual(order, [1, 2, 3]);
  });

  it('allows re-acquire after release', async () => {
    const mutex = new Mutex();
    const g1 = await mutex.acquire();
    g1.dispose();
    const g2 = await mutex.acquire();
    g2.dispose();
  });
});
