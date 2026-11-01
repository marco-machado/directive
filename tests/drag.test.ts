import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { dragged, LONG_PRESS_MS, trackDrags, trackLongPress } from '../src/scene/drag.ts';

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

// Long presses, on a canvas that also tracks drags the way the scene does.
function touchCanvas(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const el = new EventTarget() as unknown as HTMLElement, presses: [number, number][] = [];
  t.after(trackDrags(el)); t.after(trackLongPress(el, (x, y) => presses.push([x, y])));
  const fire = (type: string, x: number, y: number, pointerType = 'touch', isPrimary = true) =>
    el.dispatchEvent(Object.assign(new Event(type), { isPrimary, pointerType, clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1 }));
  return { el, presses, fire };
}

test('a still touch held for LONG_PRESS_MS acts once where it was pressed and swallows its click', t => {
  const { el, presses, fire } = touchCanvas(t);
  let clicks = 0; el.addEventListener('click', () => clicks++);
  fire('pointerdown', 100, 100); fire('pointermove', 102, 101);
  t.mock.timers.tick(LONG_PRESS_MS - 1);
  assert.deepEqual(presses, []);
  t.mock.timers.tick(1);
  assert.deepEqual(presses, [[100, 100]]);
  fire('pointerup', 102, 101); el.dispatchEvent(new Event('click'));
  assert.equal(clicks, 0);
  // The next tap is a click again.
  fire('pointerdown', 100, 100); fire('pointerup', 100, 100); el.dispatchEvent(new Event('click'));
  assert.equal(clicks, 1);
});

test('a short tap, a drag, a second finger or a mouse is no long press', t => {
  const { presses, fire } = touchCanvas(t);
  fire('pointerdown', 100, 100); t.mock.timers.tick(LONG_PRESS_MS - 100); fire('pointerup', 100, 100); t.mock.timers.tick(LONG_PRESS_MS);
  fire('pointerdown', 100, 100); fire('pointermove', 160, 100); t.mock.timers.tick(LONG_PRESS_MS);
  fire('pointerdown', 100, 100); fire('pointerdown', 200, 100, 'touch', false); t.mock.timers.tick(LONG_PRESS_MS);
  fire('pointerdown', 100, 100, 'mouse'); t.mock.timers.tick(LONG_PRESS_MS);
  assert.deepEqual(presses, []);
});
