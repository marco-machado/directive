import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dragged, trackDrags } from '../src/scene/drag.ts';

const pointer = (type: string, clientX: number, clientY: number, buttons = 1) => Object.assign(new Event(type), { isPrimary: true, clientX, clientY, buttons });

function canvas(t: { after: (fn: () => void) => void }) {
  const el = new EventTarget() as unknown as HTMLElement;
  t.after(trackDrags(el));
  return (type: string, x: number, y: number, buttons?: number) => el.dispatchEvent(pointer(type, x, y, buttons));
}

test('jitter during a press is still a click', t => {
  const fire = canvas(t);
  fire('pointerdown', 100, 100); fire('pointermove', 102, 99); fire('pointermove', 99, 103); fire('pointermove', 101, 101);
  assert.equal(dragged(), false);
});

test('a drag that comes back to where it started is not a click', t => {
  const fire = canvas(t);
  fire('pointerdown', 100, 100); fire('pointermove', 180, 100); fire('pointermove', 100, 100);
  assert.equal(dragged(), true);
});

test('a new press starts over', t => {
  const fire = canvas(t);
  fire('pointerdown', 100, 100); fire('pointermove', 180, 100);
  fire('pointerdown', 180, 100);
  assert.equal(dragged(), false);
});

test('moving with no button held does not count', t => {
  const fire = canvas(t);
  fire('pointerdown', 100, 100); fire('pointermove', 180, 100, 0);
  assert.equal(dragged(), false);
});
