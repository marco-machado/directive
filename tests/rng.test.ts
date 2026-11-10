import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stream } from '../src/game/rng.ts';

const draws = (seed: number, name: string, index?: number) => { const rng = stream(seed, name, index); return Array.from({ length: 8 }, () => rng()); };

test('a named stream always gives the same values for the same seed, name and index', () => {
  assert.deepEqual(draws(7, 'a', 0), draws(7, 'a', 0));
  assert.deepEqual(draws(7, 'a'), draws(7, 'a', 0));
  assert.ok(draws(7, 'a').every(v => v >= 0 && v < 1));
});

test('another seed, name or index gives another stream', () => {
  const first = [draws(7, 'a', 0), draws(7, 'b', 0), draws(7, 'a', 1), draws(8, 'a', 0)].map(d => d[0]);
  assert.equal(new Set(first).size, 4);
});
