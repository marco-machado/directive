import { between, pick } from '../../game/rng.ts';
import type { Rng } from '../../game/rng.ts';
import { distance } from '../../game/world.ts';
import type { Bounds, Point, Rect } from '../../game/world.ts';
import { FLOOR0, parapet, PLINTH_TOP } from './building.ts';
import { parkedCar } from './car.ts';
import { CONCRETE, CURB_TOP, cutStrip, PAINT, PAINT_TOP, WALK_TOP } from './kit.ts';
import type { Kit } from './kit.ts';
import { lamp } from './lamp.ts';
import { SIGN_COLORS } from './signage.ts';
import { crosswalk, puddle } from './street.ts';
import type { Grid } from './street.ts';

const RING = { road: 3.4, park: 4.3, walk: 5.3, blocks: 5.5, depth: 3.2 }; // meters past the bounds
const SHOPS = ['#5d6573', '#665c6e', '#59675f', '#6e6358', '#545e6e'];

// The outer ring: the edge streets continue past the bounds into a road with parked cars, a sidewalk with lamps
// and a row of low blocks. Nothing here is walkable, and nothing stands tall enough near the bounds to hide a
// unit from the camera's lowest tilt (OrbitControls' maxPolarAngle in GameCanvas.tsx). The cars, the shops and
// the puddles each draw from a stream of their own.
export function ring(k: Kit, b: Bounds, { xs, zs }: Grid, keep: readonly Point[], { cars, shops, puddles }: { cars: Rng; shops: Rng; puddles: Rng }) {
  const sides = [
    { n: { x: 0, z: 1 }, lines: xs, lo: b.minX, hi: b.maxX, at: b.maxZ }, { n: { x: 0, z: -1 }, lines: xs, lo: b.minX, hi: b.maxX, at: b.minZ },
    { n: { x: 1, z: 0 }, lines: zs, lo: b.minZ, hi: b.maxZ, at: b.maxX }, { n: { x: -1, z: 0 }, lines: zs, lo: b.minZ, hi: b.maxZ, at: b.minX },
  ];
  for (const s of sides) {
    const alongX = s.n.z !== 0, span = (s.hi - s.lo) + 2 * RING.walk;
    const point = (a: number, out: number) => alongX ? { x: a, z: s.at + s.n.z * out } : { x: s.at + s.n.x * out, z: a };
    const strip = (out0: number, out1: number, a0: number, a1: number): Rect => { const p = point((a0 + a1) / 2, (out0 + out1) / 2); return alongX ? { ...p, w: a1 - a0, d: out1 - out0 } : { ...p, w: out1 - out0, d: a1 - a0 }; };
    const mid = (s.lo + s.hi) / 2, mouths = s.lines;
    // Center dashes on the ring road, then the curb and sidewalk, broken where a street meets the ring.
    for (let a = s.lo - RING.walk + 1; a < s.hi + RING.walk - 1; a += 2) {
      if (mouths.some(m => Math.abs(m - a) < 1.5)) continue;
      const p = point(a, 1.35);
      k.box(p.x, PAINT_TOP / 2, p.z, alongX ? .8 : .075, PAINT_TOP, alongX ? .075 : .8, '#7d847c', PAINT);
    }
    const cuts = mouths.map(m => strip(RING.road, RING.walk, m - 1.5, m + 1.5));
    for (const piece of cutStrip(strip(RING.park + .03, RING.walk, mid - span / 2, mid + span / 2), cuts, 0)) k.flat(piece, 0, WALK_TOP, '#4b525c', CONCRETE);
    for (const piece of cutStrip(strip(RING.park, RING.park + .06, mid - span / 2, mid + span / 2), cuts, 0)) k.flat(piece, 0, CURB_TOP, '#77808b', CONCRETE);
    for (const m of mouths) { const p = point(m, (RING.road + RING.walk) / 2); crosswalk(k, () => true, p.x, p.z, !alongX); }
    // Parked cars along the curb.
    for (let a = s.lo + .6; a < s.hi - .6;) {
      const L = 2.3;
      if (!mouths.some(m => Math.abs(m - a) < 2) && cars() < .7) { const p = point(a, (RING.road + RING.park) / 2); parkedCar(k, cars, p.x, p.z, alongX); }
      a += L + cars() * 1.2;
    }
    // Lamps on the far sidewalk, leaning over the road.
    for (let a = s.lo + 2; a < s.hi - 1; a += 6.5) {
      if (mouths.some(m => Math.abs(m - a) < 1.8)) continue;
      const p = point(a, RING.walk - .25), toward = point(a, RING.walk - 2);
      lamp(k, p.x, p.z, toward, 0);
    }
    // A row of low shops past the sidewalk, between the street mouths: each its own height, front and roof plant.
    const edges = [s.lo - RING.walk, ...mouths, s.hi + RING.walk];
    for (let n = 0; n + 1 < edges.length; n++) {
      const end = edges[n + 1] - (n + 1 < edges.length - 1 ? 1.6 : .2);
      for (let a0 = edges[n] + (n ? 1.6 : .2); end - a0 > 1.5;) {
        const a1 = end - a0 < 5 ? end : a0 + between(shops, 2.2, 3.6), depth = between(shops, 2.4, RING.depth), h = between(shops, 1.2, 2);
        const r = strip(RING.blocks, RING.blocks + depth, a0, a1);
        k.solid.push({ x: r.x, y: .12, z: r.z, w: r.w + .3, h: .24, d: r.d + .3, color: '#3a3f48', data: CONCRETE });
        k.facade.push({ x: r.x, y: (PLINTH_TOP + h) / 2, z: r.z, w: r.w, h: h - PLINTH_TOP, d: r.d, color: pick(shops, SHOPS), data: [Math.floor(shops() * 8), Math.floor(shops() * 8), Math.floor(shops() * 4), between(shops, .3, .8)] });
        parapet(k.solid, { ...r, y1: h });
        if (shops() < .7) { const w = between(shops, .35, .6); k.box(r.x + between(shops, -.4, .4), h + .17, r.z + between(shops, -.4, .4), w, .34, w * .8, '#575d66', PAINT); }
        const face = point((a0 + a1) / 2, RING.blocks - .04);
        if (shops() < .5) k.glow(face.x, FLOOR0 - .04, face.z, alongX ? r.w : .03, .04, alongX ? .03 : r.d, pick(shops, SIGN_COLORS), 2.2);
        a0 = a1 + between(shops, .15, .5);
      }
    }
  }
  // Ring corners: sidewalk squares joining the sides.
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const x = (sx > 0 ? b.maxX : b.minX) + sx * (RING.park + RING.walk) / 2, z = (sz > 0 ? b.maxZ : b.minZ) + sz * (RING.park + RING.walk) / 2;
    k.flat({ x, z, w: RING.walk - RING.park, d: RING.walk - RING.park }, 0, WALK_TOP, '#4b525c', CONCRETE);
  }
  // A few puddles on the ring road.
  for (let n = 0; n < 6; n++) {
    const s = pick(puddles, sides), a = between(puddles, s.lo, s.hi), out = between(puddles, .9, RING.road - .9), r = between(puddles, .45, .8);
    const p = s.n.z !== 0 ? { x: a, z: s.at + s.n.z * out } : { x: s.at + s.n.x * out, z: a };
    if (!keep.some(q => distance(q, p) < 2)) puddle(k, puddles, p.x, p.z, r);
  }
}
