import { test } from 'node:test';
import assert from 'node:assert/strict';
import { focusPoint, FOLLOW_SECONDS, followGroup, followStep, MIN_OPERATIVE_PX, missionMinZoom, operativePx, overviewZoom, rectDistance, TACTICAL_SPAN, tacticalZoom } from '../src/scene/framing.ts';
import { mapSize } from '../src/game/mapgen.ts';

const DEFAULT_POLAR = Math.atan2(Math.hypot(29, 32), 34), MIN_POLAR = Math.PI / 6, MAX_POLAR = Math.PI * 13 / 36;

test('the tactical view fits 22 m of street across the free frame', () => {
  for (const width of [444, 700, 1076]) assert.equal(width / tacticalZoom(width), TACTICAL_SPAN);
});

test('the mission zoom floor keeps an operative at least 24 px tall at every allowed tilt', () => {
  for (let polar = MIN_POLAR; polar <= MAX_POLAR; polar += .01) assert.ok(operativePx(missionMinZoom(polar), polar) >= MIN_OPERATIVE_PX - 1e-9);
  // Steeper views foreshorten the body, so they need more zoom.
  assert.ok(missionMinZoom(MIN_POLAR) > missionMinZoom(DEFAULT_POLAR));
  assert.ok(missionMinZoom(DEFAULT_POLAR) > missionMinZoom(MAX_POLAR));
});

test('a tier-5 overview would draw operatives under the floor on a tablet, so the floor has to clamp it', () => {
  const { w, d } = mapSize(5), bounds = { minX: -w / 2, maxX: w / 2, minZ: -d / 2, maxZ: d / 2 };
  assert.ok(operativePx(overviewZoom(444, 776, bounds), DEFAULT_POLAR) < MIN_OPERATIVE_PX);
});

test('focus centers on the selection, or the squad when nothing is selected', () => {
  const units = [{ id: 'a', x: 0, z: 0 }, { id: 'b', x: 4, z: 2 }, { id: 'c', x: 8, z: -2 }, { id: 'h0', x: 50, z: 50 }];
  assert.deepEqual(focusPoint(units, ['b'], ['a', 'b', 'c']), { x: 4, z: 2 });
  assert.deepEqual(focusPoint(units, ['a', 'c'], ['a', 'b', 'c']), { x: 4, z: -1 });
  assert.deepEqual(focusPoint(units, [], ['a', 'b', 'c']), { x: 4, z: 0 });
  assert.deepEqual(focusPoint(units, ['gone'], ['a', 'b', 'c']), { x: 4, z: 0 });
  assert.equal(focusPoint(units, [], []), null);
  assert.deepEqual(followGroup(units, ['a', 'c'], ['a', 'b', 'c']).map(u => u.id), ['a', 'c']);
  assert.deepEqual(followGroup(units, ['gone'], ['a', 'b', 'c']).map(u => u.id), ['a', 'b', 'c']);
});

test('a followed view eases toward the selection without overshooting, at any frame rate', () => {
  const to = { x: 10, z: -4 };
  assert.deepEqual(followStep({ x: 0, z: 0 }, to, 0), { x: 0, z: 0 });
  const one = followStep({ x: 0, z: 0 }, to, FOLLOW_SECONDS);
  assert.ok(Math.abs(one.x - 10 * (1 - Math.exp(-1))) < 1e-9);
  // Two half steps land where one full step does, so a slow frame doesn't change the path.
  const half = followStep(followStep({ x: 0, z: 0 }, to, FOLLOW_SECONDS / 2), to, FOLLOW_SECONDS / 2);
  assert.ok(Math.abs(half.x - one.x) < 1e-9 && Math.abs(half.z - one.z) < 1e-9);
  let at = { x: 0, z: 0 };
  for (let i = 0; i < 120; i++) { at = followStep(at, to, 1 / 60); assert.ok(at.x <= to.x && at.z >= to.z); }
  assert.ok(Math.hypot(at.x - to.x, at.z - to.z) < .01);
});

test('pick distance is zero inside a hitbox and grows from its nearest edge', () => {
  const box = { x0: 100, y0: 100, x1: 110, y1: 140 };
  assert.equal(rectDistance(105, 120, box), 0);
  assert.equal(rectDistance(130, 120, box), 20);
  assert.equal(rectDistance(105, 168, box), 28);
  assert.equal(rectDistance(113, 144, box), 5);
});
