import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BufferGeometry } from 'three';
import { stream } from '../src/game/rng.ts';
import { CAR_LENGTH, CAR_PAINT, CAR_WIDTH, parkedCar } from '../src/scene/generators/car.ts';
import { Kit, partBounds } from '../src/scene/generators/kit.ts';
import type { Placement } from '../src/scene/generators/kit.ts';
import { lamp } from '../src/scene/generators/lamp.ts';
import { carGeometry, lampGeometry } from '../src/scene/propGeometry.ts';

const box = (g: BufferGeometry) => { g.computeBoundingBox(); return g.boundingBox!; };
// The world-space extent of a prop's model once its placement turns, stretches and moves it, vertex by vertex.
function placed(g: BufferGeometry, p: Placement) {
  const at = g.getAttribute('position'), cos = Math.cos(p.ry), sin = Math.sin(p.ry), e = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (let n = 0; n < at.count; n++) {
    const x = at.getX(n) * p.scale[0], y = at.getY(n) * p.scale[1], z = at.getZ(n) * p.scale[2], wx = p.x + x * cos + z * sin, wz = p.z - x * sin + z * cos;
    e.minX = Math.min(e.minX, wx); e.maxX = Math.max(e.maxX, wx); e.minY = Math.min(e.minY, y); e.maxY = Math.max(e.maxY, y); e.minZ = Math.min(e.minZ, wz); e.maxZ = Math.max(e.maxZ, wz);
  }
  return e;
}
// The box around all of a prop's hull parts: the extent the model must stay inside.
const hull = (k: Kit) => k.hulls.map(partBounds).reduce((a, e) => ({ minX: Math.min(a.minX, e.minX), maxX: Math.max(a.maxX, e.maxX), minY: Math.min(a.minY, e.minY), maxY: Math.max(a.maxY, e.maxY), minZ: Math.min(a.minZ, e.minZ), maxZ: Math.max(a.maxZ, e.maxZ) }));
const inside = (e: ReturnType<typeof placed>, h: ReturnType<typeof hull>, slack = .01) => e.minX >= h.minX - slack && e.maxX <= h.maxX + slack && e.minY >= h.minY - slack && e.maxY <= h.maxY + slack && e.minZ >= h.minZ - slack && e.maxZ <= h.maxZ + slack;
const attributes = (g: BufferGeometry) => { const n = g.getAttribute('position').count; for (const [name, size] of [['normal', 3], ['color', 3], ['surface', 4]] as const) { assert.equal(g.getAttribute(name).itemSize, size); assert.equal(g.getAttribute(name).count, n); } return n; };
// Per-vertex surface: roughness, metalness, glow, tint.
const surfaces = (g: BufferGeometry) => { const a = g.getAttribute('surface'), at = g.getAttribute('position'); return Array.from({ length: a.count }, (_, i) => ({ glow: a.getZ(i), tint: a.getW(i), x: at.getX(i), y: at.getY(i), z: at.getZ(i) })); };
// Where the glowing part of a placed model (a car's tail lights, a lamp's lens) is, on the ground plane: its center.
function glowAt(g: BufferGeometry, p: Placement) {
  const lit = surfaces(g).filter(v => v.glow > 0), cos = Math.cos(p.ry), sin = Math.sin(p.ry);
  const at = lit.map(v => ({ x: p.x + v.x * p.scale[0] * cos + v.z * p.scale[2] * sin, z: p.z - v.x * p.scale[0] * sin + v.z * p.scale[2] * cos }));
  return { x: at.reduce((s, v) => s + v.x, 0) / at.length, z: at.reduce((s, v) => s + v.z, 0) / at.length };
}

test('the car model stands on the road, nose forward, inside its box', () => {
  const g = carGeometry(), b = box(g);
  assert.ok(attributes(g) > 100);
  assert.ok(b.min.x >= -.39 - 1e-6 && b.max.x <= .39 + 1e-6 && b.max.x > .35);
  assert.ok(Math.abs(b.min.z + CAR_LENGTH / 2) < 1e-6 && Math.abs(b.max.z - CAR_LENGTH / 2) < 1e-6);
  assert.ok(Math.abs(b.min.y) < 1e-6 && b.max.y <= .6 + 1e-6 && b.max.y > .5);
  const s = surfaces(g);
  // Paint takes the instance color: the whole body (everything between the wheels' tops and the glass, out to the
  // car's full width) and the roof. Glass, tires and lights keep their own.
  const body = s.filter(v => v.y > .13 && v.y < .41 && Math.abs(Math.abs(v.x) - CAR_WIDTH / 2) < 1e-6), roof = s.filter(v => v.y > .59);
  assert.ok(body.length >= 24 && body.every(v => v.tint === 1) && roof.length >= 12 && roof.every(v => v.tint === 1));
  assert.ok(s.filter(v => v.tint === 0).length > 500);
  // The tail lights glow at the back and nothing glows at the front.
  const lit = s.filter(v => v.glow > 0);
  assert.ok(lit.length > 0 && lit.every(v => v.glow === 1.5 && v.z < -CAR_LENGTH / 2 + .05 && v.tint === 0));
});

test('the lamp model is a 2.6 m mast with a head reaching forward over a lens', () => {
  const g = lampGeometry(), b = box(g);
  assert.ok(attributes(g) > 60);
  assert.ok(Math.abs(b.min.y) < 1e-6 && b.max.y <= 2.62 && b.max.y >= 2.58);
  assert.ok(b.min.z >= -.06 && b.max.z <= .93 + 1e-6 && b.max.z > .9);
  assert.ok(b.min.x >= -.1 - 1e-6 && b.max.x <= .1 + 1e-6);
  const lit = surfaces(g).filter(v => v.glow > 0);
  // The lens glows under the head, out over the street.
  assert.ok(lit.length > 0 && lit.every(v => Math.abs(v.glow - 3.2) < 1e-6 && v.y > 2.4 && v.y < 2.56 && v.z > .5));
});

test('a parked car is one placement of the car model, inside the hull it is tested by', () => {
  const g = carGeometry();
  for (let seed = 1; seed <= 200; seed++) for (const alongX of [true, false]) {
    const k = new Kit();
    parkedCar(k, stream(seed, 'ring-cars'), 3.5, -7.25, alongX);
    assert.equal(k.cars.length, 1);
    const [car] = k.cars, length = car.scale[2] * CAR_LENGTH;
    assert.deepEqual(car.scale.slice(0, 2), [1, 1]);
    assert.ok(length >= 1.6 && length <= 1.95 && CAR_PAINT.includes(car.color));
    assert.deepEqual([car.x, car.z], [3.5, -7.25]);
    // Nothing of it goes to the lists the scene draws as boxes and cylinders.
    assert.equal(k.solid.length + k.cylinders.length + k.neon.length, 0);
    assert.ok(k.hulls.length >= 8 && k.footprints.length === 1);
    const e = placed(g, car), h = hull(k);
    assert.ok(inside(e, h), `seed ${seed}: the car model leaves its hull`);
    // And it fills it: the model is as long and as wide as the car the layout made room for.
    assert.ok(e.maxX - e.minX > (h.maxX - h.minX) - .05 && e.maxZ - e.minZ > (h.maxZ - h.minZ) - .05);
    assert.ok(Math.abs((alongX ? e.maxX - e.minX : e.maxZ - e.minZ) - length) < 1e-6);
    // It faces the way its hull does: the cabin sits toward the rear, and the tail lights are at that end.
    const cabin = k.hulls[1], tail = glowAt(g, car), rear = { x: cabin.x - car.x, z: cabin.z - car.z };
    assert.ok(Math.hypot(rear.x, rear.z) > .05 && (tail.x - car.x) * rear.x + (tail.z - car.z) * rear.z > .5 * Math.hypot(rear.x, rear.z), `seed ${seed}: the car faces the wrong way`);
  }
});

test('a street lamp is one placement of the lamp model, its head over its light pool', () => {
  const g = lampGeometry();
  for (let n = 0; n < 24; n++) {
    const k = new Kit(), a = n * Math.PI / 12, at = { x: -4, z: 9 };
    lamp(k, at.x, at.z, { x: at.x + Math.sin(a) * 3, z: at.z + Math.cos(a) * 3 }, 2);
    assert.equal(k.lamps.length, 1);
    const [l] = k.lamps;
    assert.deepEqual([l.x, l.z, l.scale], [at.x, at.z, [1, 1, 1]]);
    assert.equal(k.solid.length + k.cylinders.length + k.neon.length, 0);
    assert.ok(inside(placed(g, l), hull(k)), `direction ${n}: the lamp model leaves its hull`);
    // The model's lens, where it ends up, is over the pool and under the practical light.
    const lens = glowAt(g, l);
    assert.equal(k.pools.length, 1); assert.equal(k.lights.length, 1);
    assert.ok(Math.hypot(k.pools[0].x - lens.x, k.pools[0].z - lens.z) < 1e-6 && Math.hypot(k.lights[0].x - lens.x, k.lights[0].z - lens.z) < 1e-6, `direction ${n}: the lens is not over the pool`);
  }
});
