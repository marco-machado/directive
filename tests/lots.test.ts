import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALLEY, alley, BLOCK_MIX, fillBlock, MIN_LOT, pickBlock } from '../src/game/lots.ts';
import type { BlockKind } from '../src/game/lots.ts';
import { mulberry32 } from '../src/game/rng.ts';
import { World } from '../src/game/world.ts';
import type { Rect } from '../src/game/world.ts';
import { FACES, openFaces } from '../src/scene/generators/faces.ts';

const KINDS = Object.keys(BLOCK_MIX) as BlockKind[], EPS = 1e-9;
const lo = (r: Rect, x: boolean) => x ? r.x - r.w / 2 : r.z - r.d / 2, hi = (r: Rect, x: boolean) => x ? r.x + r.w / 2 : r.z + r.d / 2;
const within = (r: Rect, room: Rect) => [true, false].every(x => lo(r, x) >= lo(room, x) - EPS && hi(r, x) <= hi(room, x) + EPS);
// How far two rects reach into each other on both axes (0 or less: they do not overlap).
const overlap = (a: Rect, b: Rect) => Math.min(...[true, false].map(x => Math.min(hi(a, x), hi(b, x)) - Math.max(lo(a, x), lo(b, x))));
const room = (w: number, d: number, x = 0, z = 0): Rect => ({ x, z, w, d });

test('a plaza block is empty and a single block holds one building of 55% to 100% of the room', () => {
  for (let seed = 1; seed <= 200; seed++) {
    assert.deepEqual(fillBlock('plaza', room(5, 5), mulberry32(seed)), []);
    const lots = fillBlock('single', room(5, 4.4, 3.3, -7.1), mulberry32(seed));
    assert.equal(lots.length, 1);
    assert.ok(within(lots[0], room(5, 4.4, 3.3, -7.1)));
    assert.ok(lots[0].w >= 5 * .55 - EPS && lots[0].d >= 4.4 * .55 - EPS);
  }
});

test('a twin block is two buildings either side of an alley on a whole meter', () => {
  for (const [r, alongX] of [[room(5, 5), true], [room(5, 5.6, 4, -8), false], [room(5.75, 5, -4.4, 8), true]] as const) for (let seed = 1; seed <= 200; seed++) {
    const lots = fillBlock('twin', r, mulberry32(seed));
    assert.equal(lots.length, 2);
    const [a, b] = [...lots].sort((p, q) => lo(p, alongX) - lo(q, alongX)), center = (hi(a, alongX) + lo(b, alongX)) / 2;
    assert.ok(within(a, r) && within(b, r));
    assert.ok(Math.abs(lo(b, alongX) - hi(a, alongX) - ALLEY) < EPS, 'the alley is not ALLEY wide');
    assert.ok(Math.abs(center - Math.round(alongX ? r.x : r.z)) < EPS, `the alley runs along ${center}`);
    for (const lot of lots) {
      assert.ok(hi(lot, alongX) - lo(lot, alongX) >= MIN_LOT - EPS);
      const along = hi(lot, !alongX) - lo(lot, !alongX), full = hi(r, !alongX) - lo(r, !alongX);
      assert.ok(along >= full * .55 - EPS && along <= full + EPS);
    }
  }
});

test('an alley is 1.2 m wide, and its ground runs between the two buildings out to the streets', () => {
  assert.equal(ALLEY, 1.2); // what an operative (0.38 m of clearance each side) and the navigation grid (0.4 m) need
  for (const [r, alongX] of [[room(5, 5, 4, -8), true], [room(5, 5.6, 4, -8), false]] as const) {
    const lots = fillBlock('twin', r, mulberry32(5)), strip = alley(lots, r, 1.5);
    assert.ok(Math.abs((alongX ? strip.w : strip.d) - ALLEY) < EPS && Math.abs((alongX ? strip.d : strip.w) - ((alongX ? r.d : r.w) + 3)) < EPS);
    assert.ok(Math.abs(lo(strip, alongX) - hi(lots[0], alongX)) < EPS && Math.abs(hi(strip, alongX) - lo(lots[1], alongX)) < EPS);
    assert.ok(lots.every(lot => overlap(lot, strip) < EPS));
  }
});

test('a twin block too small for two lots holds one building', () => {
  for (let seed = 1; seed <= 50; seed++) {
    for (const r of [room(4, 4), room(4.33, 4.2, 3.67, 0)]) { const lots = fillBlock('twin', r, mulberry32(seed)); assert.equal(lots.length, 1); assert.ok(within(lots[0], r)); }
  }
});

test('a corner block is a bar and a wing that touch, around an open pocket of 2 m or more', () => {
  for (const r of [room(4, 4), room(5, 5, 4, -8), room(5.75, 4.4, -1.3, 2.7), room(6, 6)]) for (let seed = 1; seed <= 200; seed++) {
    const lots = fillBlock('corner', r, mulberry32(seed));
    assert.equal(lots.length, 2);
    const [bar, wing] = lots, alongX = Math.abs(bar.w - r.w) < EPS;
    assert.ok(within(bar, r) && within(wing, r));
    assert.ok(overlap(bar, wing) < EPS, 'the bar and the wing overlap');
    // The bar runs the room's full length on one side, 40% to 50% of the way across.
    assert.ok(Math.abs((alongX ? bar.w : bar.d) - (alongX ? r.w : r.d)) < EPS);
    const barDepth = alongX ? bar.d : bar.w, depth = alongX ? r.d : r.w, wingWidth = alongX ? wing.w : wing.d, width = alongX ? r.w : r.d;
    assert.ok(barDepth >= depth * .4 - EPS && barDepth <= depth * .5 + EPS);
    assert.ok(wingWidth >= width * .4 - EPS && wingWidth <= width * .5 + EPS);
    // The wing takes the rest of the depth, flush with one end of the bar.
    assert.ok(Math.abs((alongX ? wing.d : wing.w) - (depth - barDepth)) < EPS);
    assert.ok(Math.abs(lo(wing, alongX) - lo(r, alongX)) < EPS || Math.abs(hi(wing, alongX) - hi(r, alongX)) < EPS);
    assert.equal(openFaces(bar, lots).length, 3); assert.equal(openFaces(wing, lots).length, 3);
    assert.ok(width - wingWidth >= 2 - EPS && depth - barDepth >= 2 - EPS, 'the pocket is under 2 m');
  }
});

test('every kind of block keeps its buildings inside the room', () => {
  for (const kind of KINDS) for (let seed = 1; seed <= 200; seed++) {
    const rng = mulberry32(seed * 7919), r = room(4 + rng() * 2, 4 + rng() * 2, rng() * 20 - 10, rng() * 20 - 10);
    for (const lot of fillBlock(kind, r, rng)) assert.ok(within(lot, r), `${kind}, seed ${seed}`);
  }
});

test('an operative can walk through a twin block\'s alley', () => {
  const bounds = { minX: -8, maxX: 8, minZ: -8, maxZ: 8 };
  for (let seed = 1; seed <= 40; seed++) {
    const r = room(5, 5, seed % 2 ? 0 : .2, 0), lots = fillBlock('twin', r, mulberry32(seed)), world = new World(bounds, lots.map(lot => ({ ...lot, h: 3 })), []);
    assert.equal(lots.length, 2);
    const x = Math.round(r.x);
    for (let z = Math.ceil(lo(r, false)); z <= Math.floor(hi(r, false)); z++) assert.ok(world.walkable({ x, z }), `seed ${seed}: the alley is blocked at z ${z}`);
    const path = world.findPath({ x, z: -4 }, { x, z: 4 });
    assert.ok(path.length > 0 && path.every(p => Math.abs(p.x - x) < .01), `seed ${seed}: the way from one mouth to the other leaves the alley`);
  }
});

test('blocks come in the shares the mix gives', () => {
  const rng = mulberry32(99), counts: Record<string, number> = {};
  for (let n = 0; n < 2000; n++) { const kind = pickBlock(rng); counts[kind] = (counts[kind] ?? 0) + 1; }
  for (const kind of KINDS) assert.ok(Math.abs(counts[kind] / 2000 - BLOCK_MIX[kind]) < .05, `${kind}: ${counts[kind]}`);
});

test('a wall is open unless another building stands against it', () => {
  const a = { x: 0, z: 0, w: 4, d: 2 }, east = { x: 3, z: .5, w: 2, d: 1 }, apart = { x: -4, z: 0, w: 2, d: 2 };
  assert.deepEqual(openFaces(a, [a]), FACES);
  assert.deepEqual(openFaces(a, [a, apart]), FACES);
  assert.deepEqual(openFaces(a, [a, east, apart]), FACES.filter(f => f.nx !== 1));
  assert.deepEqual(openFaces(east, [a, east, apart]), FACES.filter(f => f.nx !== -1));
  // Within 5 cm counts as touching; across an alley does not.
  assert.equal(openFaces(a, [{ ...east, x: 3.04 }]).length, 3);
  assert.equal(openFaces(a, [{ ...east, x: 3 + 1.2 }]).length, 4);
});
