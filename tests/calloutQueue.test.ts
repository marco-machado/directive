import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enqueue, MERGE_MS, QUEUE_MAX } from '../src/ui/calloutQueue.ts';
import type { Callout } from '../src/ui/calloutQueue.ts';

test('callouts arriving within the merge window share one line with the more severe tone', () => {
  let queue: Callout[] = [];
  queue = enqueue(queue, 0, 'objective', { title: 'Objective complete', detail: 'Plant charge A' }, 1000);
  queue = enqueue(queue, 1, 'danger', { title: 'Alarm', detail: 'reinforcements in 20 s' }, 1000 + MERGE_MS);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].tone, 'danger');
  assert.equal(queue[0].id, 1);
  assert.deepEqual(queue[0].parts.map(p => p.title), ['Objective complete', 'Alarm']);
});

test('callouts further apart than the merge window queue separately', () => {
  let queue: Callout[] = [];
  queue = enqueue(queue, 0, 'danger', { title: 'Alarm' }, 1000);
  queue = enqueue(queue, 1, 'danger', { title: 'Reinforcements' }, 1000 + MERGE_MS + 1);
  assert.equal(queue.length, 2);
});

test('the queue keeps only the newest callouts', () => {
  let queue: Callout[] = [];
  for (let i = 0; i < 5; i++) queue = enqueue(queue, i, 'info', { title: `C${i}` }, i * 1000);
  assert.equal(queue.length, QUEUE_MAX);
  assert.deepEqual(queue.map(c => c.parts[0].title), ['C3', 'C4']);
});
