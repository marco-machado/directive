import type { Rect } from '../../game/world.ts';

// What the district's generators emit, and the helpers they share. Pure data, so the tests can check it against the
// navigation grid and cover.

type Vec4 = [number, number, number, number];
// One instance of a shared mesh (a unit box, cylinder or plane) scaled to w x h x d, centered on (x, y, z) and
// rotated by (rx, ry, rz) in YXZ order: a yaw `ry` applied after the tilt, so `rx` pitches about the part's own x. `glow` scales an emissive color past 1 so bloom picks it up.
// `data` is per-instance shader input: roughness and metalness for solid parts, the facade parameters for building
// tiers, the atlas rectangle for sign faces. `building` makes a part fade with that building.
export type Part = { x: number; y: number; z: number; w: number; h: number; d: number; rx?: number; ry?: number; rz?: number; color: string; glow?: number; data?: Vec4; building?: number };
export type Pool = { x: number; z: number; r: number; color: string; strength: number };
export type Practical = { x: number; y: number; z: number; color: string; intensity: number };
export type BoardText = { title: string; glyphs: number[] };
// Where one copy of a modeled prop (a car, a lamp) stands: on the ground at (x, z), turned by `ry`, stretched by
// `scale`, with `color` for the parts of the model that take one (a car's paint).
export type Placement = { x: number; z: number; ry: number; scale: [number, number, number]; color: string };

// Flat street dressing stays under every gameplay ground overlay (vision cones, patrol routes, unit and objective
// markers, combat decals: the lowest sits at OVERLAY_FLOOR), so it never hides one. Paint, puddles, sidewalks and
// curbs also lie under the tactical grid, which city.tsx draws at GRID_Y.
export const OVERLAY_FLOOR = .012, GRID_Y = .011;
export const PAINT_TOP = .004, WALK_TOP = .008, CURB_TOP = .01;

// Material roles for solid parts: [roughness, metalness].
export const CONCRETE: Vec4 = [.92, 0, 0, 0], PAINT: Vec4 = [.6, .1, 0, 0], METAL: Vec4 = [.42, .8, 0, 0];
export const FABRIC: Vec4 = [.95, 0, 0, 0], PLASTIC: Vec4 = [.55, 0, 0, 0], CAR: Vec4 = [.3, .55, 0, 0], GLASS: Vec4 = [.12, .3, 0, 0], RUBBER: Vec4 = [.85, 0, 0, 0];

export const overlaps = (a: Rect, b: Rect, pad = 0) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 + pad && Math.abs(a.z - b.z) < (a.d + b.d) / 2 + pad;

// The axis-aligned ground-plane extent of a part after its rotation, for overlap checks and tests.
export function partBounds(p: Part) {
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(p.rx ?? 0), Math.sin(p.rx ?? 0), Math.cos(p.ry ?? 0), Math.sin(p.ry ?? 0), Math.cos(p.rz ?? 0), Math.sin(p.rz ?? 0)];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let k = 0; k < 8; k++) {
    // Scale, then Rz, Rx and Ry (the YXZ Euler order applies Rz first).
    let x = (k & 1 ? .5 : -.5) * p.w, y = (k & 2 ? .5 : -.5) * p.h, z = (k & 4 ? .5 : -.5) * p.d;
    [x, y] = [x * cz - y * sz, x * sz + y * cz];
    [y, z] = [y * cx - z * sx, y * sx + z * cx];
    [x, z] = [x * cy + z * sy, -x * sy + z * cy];
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  return { minX: p.x + minX, maxX: p.x + maxX, minY: p.y + minY, maxY: p.y + maxY, minZ: p.z + minZ, maxZ: p.z + maxZ };
}

// Splits a strip along its long axis around the obstacles that cross it.
export function cutStrip(r: Rect, obstacles: readonly Rect[], pad: number): Rect[] {
  const alongX = r.w >= r.d, lo = alongX ? r.x - r.w / 2 : r.z - r.d / 2, hi = alongX ? r.x + r.w / 2 : r.z + r.d / 2;
  let spans: [number, number][] = [[lo, hi]];
  for (const o of obstacles) {
    if (!overlaps(r, o, pad)) continue;
    const a = (alongX ? o.x - o.w / 2 : o.z - o.d / 2) - pad, b = (alongX ? o.x + o.w / 2 : o.z + o.d / 2) + pad;
    spans = spans.flatMap(([s, e]) => [[s, Math.min(e, a)], [Math.max(s, b), e]] as [number, number][]).filter(([s, e]) => e - s > .2);
  }
  return spans.map(([s, e]) => alongX ? { x: (s + e) / 2, z: r.z, w: e - s, d: r.d } : { x: r.x, z: (s + e) / 2, w: r.w, d: e - s });
}

// Where every generator puts what it makes: one list per instanced mesh, plus the light pools, the practical lights
// (ranked, so the district can keep the best) and the ground the props and paint cover. Cars and lamps are drawn as
// models (propGeometry.ts), one placement each; `hulls` holds a few boxes and cylinders per prop whose overall
// extent (the box around them all) the model stays inside. Hulls are never drawn: they are what the tests measure a
// prop's extent by, and a model's own shape may leave an individual hull part (a curved arm, a stretched wheel).
export class Kit {
  solid: Part[] = []; cylinders: Part[] = []; facade: Part[] = []; neon: Part[] = []; signs: Part[] = []; masts: Part[] = [];
  pools: Pool[] = []; puddles: Part[] = []; lights: (Practical & { rank: number })[] = [];
  cars: Placement[] = []; lamps: Placement[] = []; hulls: Part[] = [];
  footprints: Rect[] = []; flats: Rect[] = [];
  box(x: number, y: number, z: number, w: number, h: number, d: number, color: string, data: Vec4, extra: Partial<Part> = {}) { this.solid.push({ x, y, z, w, h, d, color, data, ...extra }); }
  glow(x: number, y: number, z: number, w: number, h: number, d: number, color: string, glow: number, extra: Partial<Part> = {}) { this.neon.push({ x, y, z, w, h, d, color, glow, ...extra }); }
  flat(r: Rect, y: number, h: number, color: string, data: Vec4) { this.box(r.x, y + h / 2, r.z, r.w, h, r.d, color, data); this.flats.push(r); }
  pool(x: number, z: number, r: number, color: string, strength: number) { this.pools.push({ x, z, r, color, strength }); }
}
