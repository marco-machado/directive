import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contractPayout, MAX_TIER } from '../src/game/campaign.ts';
import type { ContractType } from '../src/game/campaign.ts';
import { planMission } from '../src/game/mapgen.ts';
import type { Building, Rect } from '../src/game/world.ts';
import { CAMERA_OFFSET, cameraOffset, hides, markHiding, mayBeHidden, viewAlong } from '../src/scene/view.ts';

// The default view: the camera sits at +CAMERA_OFFSET and looks at the origin.
const view = viewAlong(-CAMERA_OFFSET.x, -CAMERA_OFFSET.y, -CAMERA_OFFSET.z);
const tower: Building = { x: 0, z: 0, w: 2, d: 2, h: 5, name: 'TOWER', accent: '#fff' };
const contract = (type: ContractType, tier: number, seed: number) => ({ id: `c-${seed}`, type, tier, seed, payout: contractPayout(tier), district: 'GLASS DISTRICT', sector: 4 });

test('a building hides a unit behind it from the camera, not one in front of it', () => {
  assert.ok(hides({ x: -2, z: -2 }, .9, view, tower, tower.h));
  assert.ok(!hides({ x: 2, z: 2 }, .9, view, tower, tower.h));
  // Beside it, with the view ray running past the corner.
  assert.ok(!hides({ x: -4, z: 2 }, .9, view, tower, tower.h));
});

test('the view ray climbs over a low building', () => {
  const low: Rect = { x: 0, z: 0, w: 2, d: 2 };
  assert.ok(hides({ x: -1.3, z: -1.3 }, .9, view, low, 1.5));
  assert.ok(!hides({ x: -6, z: -6 }, .9, view, low, 1.5));
  assert.ok(!hides({ x: -1.5, z: -1.5 }, 1.6, view, low, 1.5));
});

test('a unit half behind a corner fades the building through its side rays', () => {
  // The center ray just misses the far corner; one side ray catches it.
  const p = { x: -.9, z: -3.2 }, top = tower.h + .85;
  assert.ok(!hides(p, .9, view, tower, top));
  const marked = new Uint8Array(1);
  markHiding([tower], view, p, .9, .25, marked);
  assert.equal(marked[0], 1);
  const clear = new Uint8Array(1);
  markHiding([tower], view, { x: 4, z: 4 }, .9, .25, clear);
  assert.equal(clear[0], 0);
});

test('silhouettes are only drawn where a building or barrier could cover the unit', () => {
  const barrier: Rect = { x: 0, z: 0, w: 1.6, d: .45 };
  assert.ok(!mayBeHidden([], [], view, { x: 0, z: 0 }, .9));
  assert.ok(mayBeHidden([], [barrier], view, { x: 0, z: -1.2 }, .9));
  assert.ok(!mayBeHidden([], [barrier], view, { x: 0, z: 3 }, .9));
  assert.ok(mayBeHidden([tower], [], view, { x: -3, z: -3 }, .9));
});

test('the opening view looks in from the squad corner, and no building hides the squad there', () => {
  const corners = new Set<string>();
  for (const type of ['assassination', 'heist', 'sabotage', 'escort'] as const) for (let tier = 1; tier <= MAX_TIER; tier++) for (const seed of [11, 4242, 90001]) {
    const plan = planMission(contract(type, tier, seed + tier)), b = plan.world.bounds;
    const off = cameraOffset(b, plan.spawn[0]), cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    // The map corner closest to the camera is the one the squad starts in.
    assert.equal(Math.sign(off.x), Math.sign(plan.extract.x - cx));
    assert.equal(Math.sign(off.z), Math.sign(plan.extract.z - cz));
    corners.add(`${Math.sign(off.x)},${Math.sign(off.z)}`);
    const start = viewAlong(-off.x, -off.y, -off.z), hidden = new Uint8Array(plan.world.buildings.length);
    for (const p of plan.spawn) markHiding(plan.world.buildings, start, p, .9, .25, hidden);
    assert.equal(hidden.indexOf(1), -1, `seed ${seed + tier} tier ${tier}: a building hides the squad's start`);
  }
  assert.equal(corners.size, 4);
  assert.deepEqual(cameraOffset({ minX: -16, maxX: 16, minZ: -12, maxZ: 12 }, null), { ...CAMERA_OFFSET });
});
