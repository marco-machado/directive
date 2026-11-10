import { between } from '../../game/rng.ts';
import type { Rng } from '../../game/rng.ts';
import { distance } from '../../game/world.ts';
import type { Point, Rect, World } from '../../game/world.ts';
import { PLINTH } from '../view.ts';
import { CONCRETE, CURB_TOP, cutStrip, overlaps, PAINT, PAINT_TOP, WALK_TOP } from './kit.ts';
import type { Kit } from './kit.ts';
import { lamp } from './lamp.ts';

// The street inside the bounds: barriers, sidewalks and curbs, the paint and lamps of the block grid, and puddles.

const SIDEWALK = .55; // walkway past the plinth
// The interior street lines of the block grid: streets along z at each of `xs`, streets along x at each of `zs`.
export type Grid = { xs: number[]; zs: number[] };

// Barriers (cover): a footing, a wall and a reflective stripe that glows faintly so cover reads at night.
export function barriers(k: Kit, world: World) {
  for (const r of world.cover) {
    const long = r.w >= r.d, t = long ? r.d : r.w;
    k.box(r.x, .11, r.z, r.w, .22, r.d, '#4f5856', CONCRETE);
    k.box(r.x, .41, r.z, long ? r.w - .06 : t * .55, .38, long ? t * .55 : r.d - .06, '#66716d', CONCRETE);
    k.glow(r.x, .605, r.z, long ? r.w * .82 : .05, .015, long ? .05 : r.d * .82, '#ffa36b', 1);
  }
}

// Sidewalks with curbs around every building, cut where a barrier or another building stands. Where two buildings'
// sidewalks meet (an alley, the joint of an L) the curbs between them are left out, so the paving runs across.
// Returns one rectangle per building: its footprint grown out to the curb, building included. That is ground for
// street paint and puddles to keep off, not the strips drawn here.
export function sidewalks(k: Kit, world: World): Rect[] {
  const walks: Rect[] = [], grown = (r: Rect, by: number): Rect => ({ x: r.x, z: r.z, w: r.w + 2 * by, d: r.d + 2 * by });
  for (const bd of world.buildings) {
    const others = world.buildings.filter(o => o !== bd), barriers = world.cover.map(c => grown(c, .1));
    const solid = [...barriers, ...others.map(o => grown(o, PLINTH))], paved = [...barriers, ...others.map(o => grown(o, PLINTH + SIDEWALK - .04))];
    const inner = PLINTH, outer = PLINTH + SIDEWALK, W = bd.w / 2, D = bd.d / 2;
    const strips: Rect[] = [
      { x: bd.x, z: bd.z + D + (inner + outer) / 2, w: bd.w + 2 * outer, d: SIDEWALK }, { x: bd.x, z: bd.z - D - (inner + outer) / 2, w: bd.w + 2 * outer, d: SIDEWALK },
      { x: bd.x + W + (inner + outer) / 2, z: bd.z, w: SIDEWALK, d: bd.d + 2 * inner }, { x: bd.x - W - (inner + outer) / 2, z: bd.z, w: SIDEWALK, d: bd.d + 2 * inner },
    ];
    walks.push({ x: bd.x, z: bd.z, w: bd.w + 2 * outer, d: bd.d + 2 * outer });
    for (const s of strips) for (const piece of cutStrip(s, solid, 0)) k.flat(piece, 0, WALK_TOP, '#4b525c', CONCRETE);
    const curbs: Rect[] = [
      { x: bd.x, z: bd.z + D + outer, w: bd.w + 2 * outer, d: .06 }, { x: bd.x, z: bd.z - D - outer, w: bd.w + 2 * outer, d: .06 },
      { x: bd.x + W + outer, z: bd.z, w: .06, d: bd.d + 2 * outer }, { x: bd.x - W - outer, z: bd.z, w: .06, d: bd.d + 2 * outer },
    ];
    for (const c of curbs) for (const piece of cutStrip(c, paved, 0)) k.flat(piece, 0, CURB_TOP, '#77808b', CONCRETE);
  }
  return walks;
}

// Crosswalk stripes across a street running along x (or z), kept where `clear` allows.
export function crosswalk(k: Kit, clear: (r: Rect) => boolean, x: number, z: number, alongX: boolean) {
  for (let s = -1.4; s <= 1.41; s += .3) {
    const r: Rect = alongX ? { x, z: z + s, w: .62, d: .15 } : { x: x + s, z, w: .15, d: .62 };
    if (clear(r)) k.flat(r, 0, PAINT_TOP, '#aeb7bc', PAINT);
  }
}

// Street lines of the block grid: dashed center lines, crosswalks and corner lamps at the intersections. `walks` is
// what sidewalks() returned, and nothing is painted near a point in `keep`.
export function streetLines(k: Kit, world: World, { xs, zs }: Grid, walks: readonly Rect[], keep: readonly Point[]) {
  const b = world.bounds;
  const open = (p: Point) => world.walkable(p, .6) && keep.every(q => distance(q, p) > 2);
  for (const x of xs) for (let z = b.minZ + 1; z < b.maxZ - 1; z += 2) if (zs.every(s => Math.abs(s - z) > 1.9) && open({ x, z })) k.box(x, PAINT_TOP / 2, z, .075, PAINT_TOP, .8, '#7d847c', PAINT);
  for (const z of zs) for (let x = b.minX + 1; x < b.maxX - 1; x += 2) if (xs.every(s => Math.abs(s - x) > 1.9) && open({ x, z })) k.box(x, PAINT_TOP / 2, z, .8, PAINT_TOP, .075, '#7d847c', PAINT);
  const blocked = [...walks, ...world.cover.map(c => ({ ...c, w: c.w + .2, d: c.d + .2 }))];
  const street = (r: Rect) => world.walkable(r, .05) && blocked.every(o => !overlaps(o, r));
  const center = { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
  for (const x of xs) for (const z of zs) {
    if (keep.some(q => distance(q, { x, z }) < 1.2)) continue;
    crosswalk(k, street, x + 1.25, z, true); crosswalk(k, street, x - 1.25, z, true);
    crosswalk(k, street, x, z + 1.25, false); crosswalk(k, street, x, z - 1.25, false);
    // The nearest building corner within reach of the intersection carries its lamp, inside the strip units cannot
    // enter. Lamps nearer the district's center rank higher.
    let best: Point | null = null, bestD = 3.2;
    for (const bd of world.buildings) for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const p = { x: bd.x + sx * (bd.w / 2 + .2), z: bd.z + sz * (bd.d / 2 + .2) }, dd = distance(p, { x, z });
      if (dd < bestD && !world.walkable(p) && world.cover.every(c => !overlaps(c, { ...p, w: .09, d: .09 }, .1))) { best = p; bestD = dd; }
    }
    if (best) lamp(k, best.x, best.z, { x, z }, 2 + 1 / (1 + distance({ x, z }, center)));
  }
}

// One puddle; `r` is the half-width of the plane that carries the puddle's outline.
export function puddle(k: Kit, rng: Rng, x: number, z: number, r: number) {
  const w = 2 * r * between(rng, 1.2, 1.8), d = 2 * r, ry = rng() * Math.PI;
  k.puddles.push({ x, y: PAINT_TOP + .001, z, w, h: d, d: 1, rx: -Math.PI / 2, ry, color: '#8d97a6' });
  k.flats.push({ x, z, w: Math.max(w, d), d: Math.max(w, d) });
}

// Puddles on open asphalt, more of them on a higher tier.
export function puddles(k: Kit, world: World, tier: number, walks: readonly Rect[], keep: readonly Point[], rng: Rng) {
  const b = world.bounds;
  for (let n = 0, made = 0; n < 200 && made < 4 + 2 * tier; n++) {
    const p = { x: between(rng, b.minX + 1, b.maxX - 1), z: between(rng, b.minZ + 1, b.maxZ - 1) }, r = between(rng, .45, .8);
    const sq = { ...p, w: 2 * r * 1.8, d: 2 * r * 1.8 };
    if (!world.walkable(p, .6) || walks.some(w => overlaps(w, sq)) || world.cover.some(c => overlaps(c, sq, .3)) || keep.some(q => distance(q, p) < 1.6)) continue;
    puddle(k, rng, p.x, p.z, r); made++;
  }
}
