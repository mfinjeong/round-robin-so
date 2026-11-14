// Executable spec for ADR-003 formulas in src/engine/types.ts (R3, M2, M4).
// ponytail: reference formulas duplicated here on purpose; engine tests must match these vectors.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const threshold = (pct: number, quota: number) => Math.floor((pct * quota + 99) / 100);
const p95 = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((95 * s.length + 99) / 100) - 1];
};
const tierFair = (x: number[]) => {
  const S = x.reduce((a, b) => a + b, 0), Q = x.reduce((a, b) => a + b * b, 0);
  return Q === 0 ? 100 : Math.floor((100 * (S * S - Q)) / ((x.length - 1) * Q));
};

test('R3 reserve threshold integer vectors', () => {
  assert.deepEqual([[20, 10], [7, 100], [50, 1], [1, 1], [0, 10]].map(([p, q]) => threshold(p, q)), [2, 7, 1, 1, 0]);
  for (let p = 0; p <= 50; p++) for (let q = 1; q <= 1000; q++) {
    const t = threshold(p, q);
    assert.ok(t * 100 >= p * q && (t - 1) * 100 < p * q, `${p}%/${q}`); // exact ceil
  }
});

test('M2 nearest-rank p95', () => {
  assert.equal(p95([]), 0);
  assert.equal(p95([5]), 5);
  assert.equal(p95(Array.from({ length: 20 }, (_, i) => i + 1)), 19);
  assert.equal(p95(Array.from({ length: 100 }, (_, i) => i + 1)), 95);
});

test('M4 fairness bounds', () => {
  assert.equal(tierFair([0, 0, 0]), 100);
  assert.equal(tierFair([4, 4, 4]), 100);
  assert.equal(tierFair([9, 0, 0]), 0);
  assert.equal(tierFair([2, 1]), 80);
});
