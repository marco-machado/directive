import { blockGrid } from '../game/mapgen.ts';
import type { MissionPlan } from '../game/mapgen.ts';
import { between, mulberry32, pick, shuffle } from '../game/rng.ts';
import type { Rng } from '../game/rng.ts';
import { distance } from '../game/world.ts';
import type { Bounds, Building, Point, Rect, World } from '../game/world.ts';
import { PLINTH } from './view.ts';

// The district's dressing: everything the scene draws around the gameplay layout. It is derived from the mission
// plan and the contract seed (on its own random streams, so mapgen's layout never shifts) and changes nothing the
// simulation reads. Pure data, so the tests can check it against the navigation grid and cover.

type Vec4 = [number, number, number, number];
// One instance of a shared mesh (a unit box, cylinder or plane) scaled to w x h x d, centered on (x, y, z) and
// rotated by (rx, ry, rz) in YXZ order: a yaw `ry` applied after the tilt, so `rx` pitches about the part's own x. `glow` scales an emissive color past 1 so bloom picks it up.
// `data` is per-instance shader input: roughness and metalness for solid parts, the facade parameters for building
// tiers, the atlas rectangle for sign faces. `building` makes a part fade with that building.
export type Part = { x: number; y: number; z: number; w: number; h: number; d: number; rx?: number; ry?: number; rz?: number; color: string; glow?: number; data?: Vec4; building?: number };
export type Pool = { x: number; z: number; r: number; color: string; strength: number };
export type Practical = { x: number; y: number; z: number; color: string; intensity: number };
export type BoardText = { title: string; glyphs: number[] };
export type District = {
  solid: Part[]; cylinders: Part[]; facade: Part[]; neon: Part[]; signs: Part[]; masts: Part[];
  pools: Pool[]; puddles: Part[]; practicals: Practical[];
  blades: number[][]; boards: BoardText[]; // sign atlas content: glyph strings and rooftop board texts
  footprints: Rect[]; // ground footprints of the free-standing street props
  flats: Rect[];      // sidewalks, curbs, crosswalk stripes and puddles
  seed: number;
};

// Facade layout, shared with the facade shader: window floors start at FLOOR0 and repeat every ROW; a face is split
// into bays of about BAY. The atlas is ATLAS_CELLS bays square (see textures.ts).
export const FLOOR0 = 1.25, ROW = .56, BAY = .52, ATLAS_CELLS = 32;
export const PLINTH_TOP = .24;
const SIDEWALK = .55;        // walkway past the plinth
export const RING = { road: 3.4, park: 4.3, walk: 5.3, blocks: 5.5, depth: 3.2 }; // outer ring, meters past the bounds
export const MAX_PRACTICALS = 8;
export const GLYPHS = 24;    // size of the generated sign script
export const BLADE_CELLS = 16, BOARD_CELLS = 8;
const GLYPH_STROKES = 4;

// Material roles for solid parts: [roughness, metalness].
const CONCRETE: Vec4 = [.92, 0, 0, 0], ASPHALT: Vec4 = [.9, 0, 0, 0], PAINT: Vec4 = [.6, .1, 0, 0], METAL: Vec4 = [.42, .8, 0, 0];
const FABRIC: Vec4 = [.95, 0, 0, 0], PLASTIC: Vec4 = [.55, 0, 0, 0], CAR: Vec4 = [.3, .55, 0, 0], GLASS: Vec4 = [.12, .3, 0, 0], RUBBER: Vec4 = [.85, 0, 0, 0];

// The map generator's muted accents, pushed to neon.
const NEON: Record<string, string> = { '#b9d6cc': '#59e3ff', '#ffb17d': '#ff9a3c', '#73dfca': '#2ff5c6', '#bad3c8': '#b77bff', '#e2a078': '#ff4f7e' };
const SIGN_COLORS = ['#ff3d9a', '#3df2ff', '#ffb13d', '#a66bff', '#4dff9b', '#ff5a3d', '#59e3ff'];
const BODY = ['#8a96aa', '#7d8aa3', '#978aab', '#82988d', '#a39282', '#7686a0', '#9b93a3', '#8b909c'];
const SHOPS = ['#5d6573', '#665c6e', '#59675f', '#6e6358', '#545e6e'];
const FABRICS = ['#5a2433', '#1f4a4f', '#3b2d5c', '#5c3b1f', '#26324f'];
const CAR_PAINT = ['#1c2632', '#3b1d2a', '#2a3039', '#1d3a39', '#4a4b53', '#8a9097', '#5a1f1f', '#263a5c'];
const LAMP = '#ffbf7a', LAMP_GLOW = 3.2;

const keyOf = (b: Bounds) => ({ cx: (b.minX + b.maxX) / 2, cz: (b.minZ + b.maxZ) / 2 });
const overlaps = (a: Rect, b: Rect, pad = 0) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 + pad && Math.abs(a.z - b.z) < (a.d + b.d) / 2 + pad;

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

type Tier = Rect & { y0: number; y1: number };
type Face = { nx: number; nz: number }; // outward normal of a wall
const FACES: Face[] = [{ nx: 1, nz: 0 }, { nx: -1, nz: 0 }, { nx: 0, nz: 1 }, { nx: 0, nz: -1 }];
const faceLength = (r: Rect, f: Face) => f.nx ? r.d : r.w;
// A point on a wall: `along` meters from the wall's center, `out` meters past it.
const onFace = (r: Rect, f: Face, along: number, out: number) => ({ x: r.x + f.nx * (r.w / 2 + out) + (f.nx ? 0 : along), z: r.z + f.nz * (r.d / 2 + out) + (f.nz ? 0 : along) });
// Rotation that turns a part's +z toward the wall's outward normal.
const faceYaw = (f: Face) => Math.atan2(f.nx, f.nz);

class Kit {
  solid: Part[] = []; cylinders: Part[] = []; facade: Part[] = []; neon: Part[] = []; signs: Part[] = []; masts: Part[] = [];
  pools: Pool[] = []; puddles: Part[] = []; lights: (Practical & { rank: number })[] = []; blades: number[][] = []; boards: BoardText[] = [];
  footprints: Rect[] = []; flats: Rect[] = [];
  box(x: number, y: number, z: number, w: number, h: number, d: number, color: string, data: Vec4, extra: Partial<Part> = {}) { this.solid.push({ x, y, z, w, h, d, color, data, ...extra }); }
  glow(x: number, y: number, z: number, w: number, h: number, d: number, color: string, glow: number, extra: Partial<Part> = {}) { this.neon.push({ x, y, z, w, h, d, color, glow, ...extra }); }
  flat(r: Rect, y: number, h: number, color: string, data: Vec4) { this.box(r.x, y + h / 2, r.z, r.w, h, r.d, color, data); this.flats.push(r); }
  pool(x: number, z: number, r: number, color: string, strength: number) { this.pools.push({ x, z, r, color, strength }); }
}

// A parapet: a low rim around a roof, so the roof itself still shows.
function parapet(list: Part[], t: Rect & { y1: number }, building?: number) {
  const h = .14, th = .06, y = t.y1 + h / 2, color = '#1c2129';
  for (const s of [1, -1]) {
    list.push({ x: t.x, y, z: t.z + s * (t.d / 2 + .03 - th / 2), w: t.w + .06, h, d: th, color, data: PAINT, building });
    list.push({ x: t.x + s * (t.w / 2 + .03 - th / 2), y, z: t.z, w: th, h, d: t.d - .06, color, data: PAINT, building });
  }
}

// Splits a strip along its long axis around the obstacles that cross it.
function cutStrip(r: Rect, obstacles: readonly Rect[], pad: number): Rect[] {
  const alongX = r.w >= r.d, lo = alongX ? r.x - r.w / 2 : r.z - r.d / 2, hi = alongX ? r.x + r.w / 2 : r.z + r.d / 2;
  let spans: [number, number][] = [[lo, hi]];
  for (const o of obstacles) {
    if (!overlaps(r, o, pad)) continue;
    const a = (alongX ? o.x - o.w / 2 : o.z - o.d / 2) - pad, b = (alongX ? o.x + o.w / 2 : o.z + o.d / 2) + pad;
    spans = spans.flatMap(([s, e]) => [[s, Math.min(e, a)], [Math.max(s, b), e]] as [number, number][]).filter(([s, e]) => e - s > .2);
  }
  return spans.map(([s, e]) => alongX ? { x: (s + e) / 2, z: r.z, w: e - s, d: r.d } : { x: r.x, z: (s + e) / 2, w: r.w, d: e - s });
}

// Massing: a podium with an inset tower, a stepped stack, or a single slab. Tiers above the first start on a
// floor line so the window rows line up across the building, and every tier stays inside the footprint and
// under Building.h, which keeps view.ts's hide test conservative.
function massing(b: Building, rng: Rng): Tier[] {
  const full: Tier = { x: b.x, z: b.z, w: b.w, d: b.d, y0: PLINTH_TOP, y1: b.h };
  if (b.h < 2.4 || Math.min(b.w, b.d) < 2.2) return [full];
  // Steps each side in by up to `max`, keeping at least 1.2 m of tower.
  const inset = (t: Rect, max: number): Rect => {
    const side = () => rng() < .7 ? between(rng, .15, max) : 0, fit = (a: number, c: number, span: number) => Math.min(1, Math.max(0, span - 1.2) / (a + c || 1));
    const [l, r, n, f] = [side(), side(), side(), side()], kx = fit(l, r, t.w), kz = fit(n, f, t.d);
    return { x: t.x + (l - r) * kx / 2, z: t.z + (n - f) * kz / 2, w: t.w - (l + r) * kx, d: t.d - (n + f) * kz };
  };
  const floorLine = (k: number) => FLOOR0 + k * ROW, style = rng();
  if (style < .4) {
    const top = floorLine(rng() < .5 || b.h < 3.4 ? 0 : 1);
    return [{ ...full, y1: top }, { ...inset(full, .55), y0: top, y1: b.h }];
  }
  if (style < .72) {
    const tiers = [full], count = b.h > 4.4 ? 3 : 2, floors = Math.floor((b.h - FLOOR0) / ROW);
    for (let k = 1; k < count; k++) {
      const prev = tiers[k - 1], split = floorLine(Math.max(1, Math.round(floors * k / count)));
      if (split > b.h - 1 || split <= prev.y0 + .5) break;
      prev.y1 = split;
      tiers.push({ ...inset(prev, .4), y0: split, y1: b.h });
    }
    return tiers;
  }
  return [full];
}

function dressBuilding(k: Kit, world: World, b: Building, i: number, rng: Rng, signRng: Rng) {
  const accent = NEON[b.accent] ?? '#59e3ff', body = pick(rng, BODY), tiers = massing(b, rng), base = tiers[0], top = tiers[tiers.length - 1];
  const part = (list: Part[], p: Part) => list.push({ ...p, building: i });
  // Plinth: the base the facade stands on (PLINTH past the footprint).
  part(k.solid, { x: b.x, y: PLINTH_TOP / 2, z: b.z, w: b.w + 2 * PLINTH - .01, h: PLINTH_TOP, d: b.d + 2 * PLINTH - .01, color: '#3a3f48', data: CONCRETE });
  const style = Math.floor(rng() * 4), occupancy = between(rng, .45, 1);
  tiers.forEach((t, n) => {
    part(k.facade, { x: t.x, y: (t.y0 + t.y1) / 2, z: t.z, w: t.w, h: t.y1 - t.y0, d: t.d, color: body, data: [Math.floor(rng() * 8), Math.floor(rng() * 8), (style + n) % 4, occupancy] });
    parapet(k.solid, t, i);
  });
  // Neon trim: a band under the top tier's parapet, glowing corner strips, or a strip over the storefronts.
  const trim = rng();
  if (trim < .4) part(k.neon, { x: top.x, y: top.y1 - .16, z: top.z, w: top.w + .03, h: .045, d: top.d + .03, color: accent, glow: 2.6 });
  else if (trim < .7 && top.y1 - top.y0 > 1.2) {
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const h = top.y1 - top.y0 - .45;
      part(k.neon, { x: top.x + sx * (top.w / 2 + .005), y: top.y0 + .15 + h / 2, z: top.z + sz * (top.d / 2 + .005), w: .05, h, d: .05, color: accent, glow: 2.4 });
    }
  }
  if (trim > .55 || trim < .15) part(k.neon, { x: base.x, y: FLOOR0 - .04, z: base.z, w: base.w + .03, h: .04, d: base.d + .03, color: accent, glow: 2.2 });
  // Cornice ledges on a slab every few floors.
  if (tiers.length === 1 && b.h > 3) for (let y = FLOOR0 + ROW * 3; y < b.h - .6; y += ROW * 3) part(k.solid, { x: b.x, y, z: b.z, w: b.w + .1, h: .05, d: b.d + .1, color: '#20262e', data: PAINT });

  const faces = shuffle(rng, FACES), [front, side] = faces;
  // Awnings over the storefronts, each with a warm strip under its edge that lights the walkway.
  for (const f of faces.slice(0, rng() < .5 ? 1 : 2)) {
    const len = faceLength(base, f), w = Math.min(len * .6, between(rng, .9, 1.6));
    if (len < 1.2) continue;
    const along = between(rng, -(len - w) / 2 + .1, (len - w) / 2 - .1), at = onFace(base, f, along, .12), yaw = faceYaw(f);
    part(k.solid, { x: at.x, y: 1.1, z: at.z, w, h: .035, d: .24, rx: .32, ry: yaw, color: pick(rng, FABRICS), data: FABRIC });
    const lip = onFace(base, f, along, .22);
    part(k.neon, { x: lip.x, y: 1.05, z: lip.z, w: w * .96, h: .025, d: .025, ry: yaw, color: '#ffc685', glow: 2.4 });
    const pool = onFace(base, f, along, .6);
    k.pool(pool.x, pool.z, .85, '#ffc58e', .2);
  }
  // Wall vents.
  for (let n = 0; n < 2; n++) {
    const t = pick(rng, tiers), f = pick(rng, FACES), len = faceLength(t, f), y = between(rng, Math.max(t.y0 + .2, FLOOR0 + .1), t.y1 - .3);
    if (len < 1 || y > t.y1 - .3) continue;
    const at = onFace(t, f, between(rng, -len / 2 + .3, len / 2 - .3), .02);
    part(k.solid, { x: at.x, y, z: at.z, w: .24, h: .16, d: .04, ry: faceYaw(f), color: '#4b525b', data: METAL });
  }

  // Vertical blade signs on a glowing glyph script, mounted on the tallest tier that spans them.
  const tall = [...tiers].sort((a, c) => (c.y1 - c.y0) - (a.y1 - a.y0))[0];
  for (let n = 0; n < (b.h > 4.5 ? 2 : 1); n++) {
    const y0 = Math.max(tall.y0 + .12, 1.45), y1 = Math.min(tall.y1 - .25, y0 + between(rng, 1.1, 2.8)), h = y1 - y0;
    if (h < .9) break;
    const f = n ? side : front, len = faceLength(tall, f);
    if (len < 1.2) continue;
    const along = (rng() < .5 ? -1 : 1) * (len / 2 - .28), at = onFace(tall, f, along, PLINTH / 2), yaw = faceYaw(f), color = pick(signRng, SIGN_COLORS);
    part(k.solid, { x: at.x, y: (y0 + y1) / 2, z: at.z, w: .05, h: h + .06, d: PLINTH - .01, ry: yaw, color: '#101318', data: METAL });
    // A face on either side of the blade: the plane's +z points along the wall, both ways.
    const cell = k.blades.length % BLADE_CELLS;
    if (k.blades.length < BLADE_CELLS) k.blades.push(Array.from({ length: Math.max(3, Math.min(7, Math.round(h / .38))) }, () => Math.floor(signRng() * GLYPHS)));
    for (const s of [1, -1]) {
      const tx = f.nx ? 0 : s * .028, tz = f.nx ? s * .028 : 0;
      part(k.signs, { x: at.x + tx, y: (y0 + y1) / 2, z: at.z + tz, w: PLINTH - .05, h: h - .04, d: 1, ry: Math.atan2(tx, tz), color, glow: 2.8, data: [cell / BLADE_CELLS, .5, 1 / BLADE_CELLS, .5] });
    }
    const foot = onFace(tall, f, along, .5), spill = onFace(tall, f, along, .9);
    k.pool(foot.x, foot.z, .8 + h * .22, color, .24);
    // The sign's light hangs out over the walkway, so it washes the wall and street rather than its own blade.
    k.lights.push({ x: spill.x, y: (y0 + y1) / 2, z: spill.z, color, intensity: 4.5, rank: 1 });
  }

  // Rooftop: a name board, plant, vents, a tank and an antenna, placed without overlaps inside the parapet.
  const roof = { x: top.x, z: top.z, w: top.w - .35, d: top.d - .35 }, taken: Rect[] = [], roofY = top.y1;
  const place = (w: number, d: number, tries = 12): Point | null => {
    for (let n = 0; n < tries; n++) {
      const p = { x: roof.x + between(rng, -(roof.w - w) / 2, (roof.w - w) / 2), z: roof.z + between(rng, -(roof.d - d) / 2, (roof.d - d) / 2) };
      const r = { ...p, w, d };
      if (w <= roof.w && d <= roof.d && taken.every(t => !overlaps(t, r, .08))) { taken.push(r); return p; }
    }
    return null;
  };
  if (rng() < .45 && Math.max(roof.w, roof.d) > 1.8) {
    // The board runs along the roof's longer edge and faces out over it; it tops out under view.ts's ROOF.
    const f = roof.w >= roof.d ? (rng() < .5 ? FACES[2] : FACES[3]) : (rng() < .5 ? FACES[0] : FACES[1]);
    const w = Math.min(faceLength(roof, f) * .85, 2.6), at = onFace(roof, f, 0, -.12), yaw = faceYaw(f), cell = k.boards.length % BOARD_CELLS;
    taken.push({ ...onFace(roof, f, 0, -.12), w: f.nx ? .3 : w, d: f.nx ? w : .3 });
    if (k.boards.length < BOARD_CELLS) k.boards.push({ title: b.name, glyphs: Array.from({ length: 5 }, () => Math.floor(signRng() * GLYPHS)) });
    for (const s of [-.4, .4]) part(k.solid, { x: at.x + (f.nx ? 0 : s * w), y: roofY + .12, z: at.z + (f.nx ? s * w : 0), w: .05, h: .24, d: .05, color: '#2b3139', data: METAL });
    part(k.solid, { x: at.x - f.nx * .03, y: roofY + .46, z: at.z - f.nz * .03, w, h: .46, d: .04, ry: yaw, color: '#15181d', data: METAL });
    part(k.signs, { x: at.x + f.nx * .001, y: roofY + .46, z: at.z + f.nz * .001, w: w - .04, h: .42, d: 1, ry: yaw, color: pick(signRng, SIGN_COLORS), glow: 2.2, data: [(cell % 2) * .5, .375 - Math.floor(cell / 2) * .125, .5, .125] });
  }
  for (let n = 0; n < 1 + Math.floor(rng() * 3); n++) {
    const w = between(rng, .3, .55), d = between(rng, .3, .5), h = between(rng, .22, .4), p = place(w, d);
    if (p) part(k.solid, { ...p, y: roofY + h / 2, w, h, d, color: pick(rng, ['#59606a', '#6a6f75', '#4b5059']), data: PAINT });
  }
  for (let n = 0; n < 2 + Math.floor(rng() * 3); n++) {
    const s = between(rng, .1, .18), p = place(s, s);
    if (p) part(k.solid, { ...p, y: roofY + .08, w: s, h: .16, d: s, color: '#3a4048', data: METAL });
  }
  if (rng() < .3) { const p = place(.62, .62); if (p) { part(k.cylinders, { ...p, y: roofY + .38, w: .58, h: .48, d: .58, color: '#4d4740', data: PAINT }); part(k.cylinders, { ...p, y: roofY + .07, w: .5, h: .14, d: .5, color: '#22262c', data: METAL }); } }
  if (rng() < .5 && b.h > 3) {
    const p = place(.12, .12), h = between(rng, .8, 1.9);
    if (p) {
      k.masts.push({ ...p, y: roofY + h / 2, w: .035, h, d: .035, color: '#5d646d', data: METAL, building: i });
      k.masts.push({ ...p, y: roofY + h + .03, w: .07, h: .07, d: .07, color: '#ff3b3b', glow: 3, building: i });
    }
  }

  // At the curb: a vending kiosk set into the storefront and a stack of crates, both inside the strip by the wall
  // where no unit can stand (world.walkable keeps units 0.38 m off a building).
  const props = (r: Rect) => world.cover.every(c => !overlaps(c, r, .1));
  if (rng() < .6) {
    const f = faces[2], len = faceLength(base, f);
    if (len > 1.4) {
      const along = between(rng, -len / 2 + .4, len / 2 - .4), at = onFace(base, f, along, .11), yaw = faceYaw(f), r = { ...at, w: f.nx ? .26 : .44, d: f.nx ? .44 : .26 };
      if (props(r)) {
        k.box(at.x, .41, at.z, .44, .82, .26, pick(rng, ['#283a52', '#4a2440', '#1f4a46']), PLASTIC, { ry: yaw });
        const screen = onFace(base, f, along, .245), color = pick(rng, ['#59e3ff', '#ff5fc4', '#7dff9e']);
        k.glow(screen.x, .52, screen.z, .32, .4, .01, color, 1.9, { ry: yaw });
        const lit = onFace(base, f, along, .55);
        k.pool(lit.x, lit.z, .6, color, .22);
        k.footprints.push(r);
      }
    }
  }
  if (rng() < .5) {
    const f = faces[3], len = faceLength(base, f);
    if (len > 1.2) {
      const along = (rng() < .5 ? -1 : 1) * (len / 2 - .3), at = onFace(base, f, along, .17), s = .3, r = { ...at, w: s, d: s };
      if (props(r)) {
        const color = pick(rng, ['#5a4632', '#3c5a3a', '#2f3f5a']);
        k.box(at.x, s / 2, at.z, s, s, s, color, PLASTIC, { ry: rng() * .15 });
        if (rng() < .6) k.box(at.x, s * 1.45, at.z, s * .85, s * .9, s * .85, color, PLASTIC, { ry: rng() * .5 });
        k.footprints.push(r);
      }
    }
  }
}

// Street lamp on a building's corner, inside the strip units cannot enter, with its head reaching over the street.
function lamp(k: Kit, x: number, z: number, toward: Point, rank: number) {
  const dx = toward.x - x, dz = toward.z - z, len = Math.hypot(dx, dz) || 1, ux = dx / len, uz = dz / len, reach = .75;
  k.cylinders.push({ x, y: 1.3, z, w: .09, h: 2.6, d: .09, color: '#2c333b', data: METAL });
  k.box(x + ux * reach / 2, 2.58, z + uz * reach / 2, .05, .05, reach, '#2c333b', METAL, { ry: Math.atan2(ux, uz) });
  const hx = x + ux * reach, hz = z + uz * reach;
  k.box(hx, 2.56, hz, .2, .07, .36, '#1b2027', METAL, { ry: Math.atan2(ux, uz) });
  k.glow(hx, 2.515, hz, .14, .02, .28, LAMP, LAMP_GLOW, { ry: Math.atan2(ux, uz) });
  k.pool(hx, hz, 2.1, '#ffc58e', .26);
  k.lights.push({ x: hx, y: 2.25, z: hz, color: LAMP, intensity: 14, rank });
  k.footprints.push({ x, z, w: .09, d: .09 });
}

function parkedCar(k: Kit, rng: Rng, x: number, z: number, alongX: boolean) {
  const L = between(rng, 1.6, 1.95), W = .78, paint = pick(rng, CAR_PAINT), ry = alongX ? 0 : Math.PI / 2, flip = rng() < .5 ? 1 : -1;
  const at = (a: number, s: number) => alongX ? { x: x + a, z: z + s } : { x: x + s, z: z + a };
  const c = at(0, 0);
  k.box(c.x, .27, c.z, alongX ? L : W, .26, alongX ? W : L, paint, CAR);
  const cab = at(-flip * L * .06, 0);
  k.box(cab.x, .5, cab.z, alongX ? L * .52 : W * .86, .2, alongX ? W * .86 : L * .52, '#0d1218', GLASS);
  for (const a of [-.32, .32]) for (const s of [-1, 1]) {
    const p = at(a * L, s * W * .42);
    k.cylinders.push({ x: p.x, y: .15, z: p.z, w: .3, h: .12, d: .3, rx: alongX ? Math.PI / 2 : 0, rz: alongX ? 0 : Math.PI / 2, color: '#0b0d10', data: RUBBER });
  }
  for (const s of [-1, 1]) {
    const tail = at(-flip * L / 2, s * W * .32), head = at(flip * L / 2, s * W * .32);
    k.glow(tail.x, .31, tail.z, alongX ? .02 : .14, .05, alongX ? .14 : .02, '#ff2a3a', 1.5);
    k.box(head.x, .31, head.z, alongX ? .02 : .14, .05, alongX ? .14 : .02, '#c9d2d9', GLASS);
  }
  if (rng() < .12) { const color = pick(rng, ['#ff3dd2', '#3df2ff']); k.pool(c.x, c.z, 1.1, color, .3); }
  k.footprints.push({ ...c, w: alongX ? L : W, d: alongX ? W : L });
}

// Crosswalk stripes across a street running along x (or z), kept where `clear` allows.
function crosswalk(k: Kit, clear: (r: Rect) => boolean, x: number, z: number, alongX: boolean) {
  for (let s = -1.4; s <= 1.41; s += .3) {
    const r: Rect = alongX ? { x, z: z + s, w: .62, d: .15 } : { x: x + s, z, w: .15, d: .62 };
    if (clear(r)) k.flat(r, 0, .012, '#aeb7bc', PAINT);
  }
}

const cache = new WeakMap<MissionPlan, District>();
export function dressDistrict(plan: MissionPlan): District {
  const cached = cache.get(plan);
  if (cached) return cached;
  const { world, extract, sites, spawn, contract } = plan, b = world.bounds, seed = contract.seed;
  const k = new Kit(), rng = mulberry32(seed ^ 0x6e656f6e), signRng = mulberry32(seed ^ 0x5197a11);
  const keep = [extract, ...sites, ...spawn];
  world.buildings.forEach((building, i) => dressBuilding(k, world, building, i, mulberry32(seed ^ Math.imul(i + 1, 0x9e3779b1)), signRng));

  // Barriers (cover): a footing, a wall and a reflective stripe that glows faintly so cover reads at night.
  for (const r of world.cover) {
    const long = r.w >= r.d, t = long ? r.d : r.w;
    k.box(r.x, .11, r.z, r.w, .22, r.d, '#4f5856', CONCRETE);
    k.box(r.x, .41, r.z, long ? r.w - .06 : t * .55, .38, long ? t * .55 : r.d - .06, '#66716d', CONCRETE);
    k.glow(r.x, .605, r.z, long ? r.w * .82 : .05, .015, long ? .05 : r.d * .82, '#ffa36b', 1);
  }

  // Sidewalks with curbs around every building, cut where a barrier stands.
  const walks: Rect[] = [];
  for (const bd of world.buildings) {
    const inner = PLINTH, outer = PLINTH + SIDEWALK, W = bd.w / 2, D = bd.d / 2;
    const strips: Rect[] = [
      { x: bd.x, z: bd.z + D + (inner + outer) / 2, w: bd.w + 2 * outer, d: SIDEWALK }, { x: bd.x, z: bd.z - D - (inner + outer) / 2, w: bd.w + 2 * outer, d: SIDEWALK },
      { x: bd.x + W + (inner + outer) / 2, z: bd.z, w: SIDEWALK, d: bd.d + 2 * inner }, { x: bd.x - W - (inner + outer) / 2, z: bd.z, w: SIDEWALK, d: bd.d + 2 * inner },
    ];
    walks.push({ x: bd.x, z: bd.z, w: bd.w + 2 * outer, d: bd.d + 2 * outer });
    for (const s of strips) for (const piece of cutStrip(s, world.cover, .1)) k.flat(piece, 0, .04, '#4b525c', CONCRETE);
    const curbs: Rect[] = [
      { x: bd.x, z: bd.z + D + outer, w: bd.w + 2 * outer, d: .06 }, { x: bd.x, z: bd.z - D - outer, w: bd.w + 2 * outer, d: .06 },
      { x: bd.x + W + outer, z: bd.z, w: .06, d: bd.d + 2 * outer }, { x: bd.x - W - outer, z: bd.z, w: .06, d: bd.d + 2 * outer },
    ];
    for (const c of curbs) for (const piece of cutStrip(c, world.cover, .1)) k.flat(piece, 0, .065, '#77808b', CONCRETE);
  }

  // Street lines of the block grid: dashed center lines, crosswalks and corner lamps at the intersections.
  const { cols, rows, cw, cd } = blockGrid(b);
  const xs = Array.from({ length: cols - 1 }, (_, n) => b.minX + (n + 1) * cw), zs = Array.from({ length: rows - 1 }, (_, n) => b.minZ + (n + 1) * cd);
  const open = (p: Point) => world.walkable(p, .6) && keep.every(q => distance(q, p) > 2);
  for (const x of xs) for (let z = b.minZ + 1; z < b.maxZ - 1; z += 2) if (zs.every(s => Math.abs(s - z) > 1.9) && open({ x, z })) k.box(x, .008, z, .075, .016, .8, '#7d847c', PAINT);
  for (const z of zs) for (let x = b.minX + 1; x < b.maxX - 1; x += 2) if (xs.every(s => Math.abs(s - x) > 1.9) && open({ x, z })) k.box(x, .008, z, .8, .016, .075, '#7d847c', PAINT);
  const blocked = [...walks, ...world.cover.map(c => ({ ...c, w: c.w + .2, d: c.d + .2 }))];
  const street = (r: Rect) => world.walkable(r, .05) && blocked.every(o => !overlaps(o, r));
  const { cx, cz } = keyOf(b);
  for (const x of xs) for (const z of zs) {
    if (keep.some(q => distance(q, { x, z }) < 1.2)) continue;
    crosswalk(k, street, x + 1.25, z, true); crosswalk(k, street, x - 1.25, z, true);
    crosswalk(k, street, x, z + 1.25, false); crosswalk(k, street, x, z - 1.25, false);
    // The nearest building corner within reach of the intersection carries its lamp.
    let best: Point | null = null, bestD = 3.2;
    for (const bd of world.buildings) for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const p = { x: bd.x + sx * (bd.w / 2 + .2), z: bd.z + sz * (bd.d / 2 + .2) }, dd = distance(p, { x, z });
      if (dd < bestD && !world.walkable(p) && world.cover.every(c => !overlaps(c, { ...p, w: .09, d: .09 }, .1))) { best = p; bestD = dd; }
    }
    if (best) lamp(k, best.x, best.z, { x, z }, 2 + 1 / (1 + distance({ x, z }, { x: cx, z: cz })));
  }

  // Puddles on open asphalt; `r` is the half-width of the plane that carries the puddle's outline.
  const puddle = (x: number, z: number, r: number) => {
    const w = 2 * r * between(rng, 1.2, 1.8), d = 2 * r, ry = rng() * Math.PI;
    k.puddles.push({ x, y: .006, z, w, h: d, d: 1, rx: -Math.PI / 2, ry, color: '#8d97a6' });
    k.flats.push({ x, z, w: Math.max(w, d), d: Math.max(w, d) });
  };
  for (let n = 0, made = 0; n < 200 && made < 4 + 2 * contract.tier; n++) {
    const p = { x: between(rng, b.minX + 1, b.maxX - 1), z: between(rng, b.minZ + 1, b.maxZ - 1) }, r = between(rng, .45, .8);
    const sq = { ...p, w: 2 * r * 1.8, d: 2 * r * 1.8 };
    if (!world.walkable(p, .6) || walks.some(w => overlaps(w, sq)) || world.cover.some(c => overlaps(c, sq, .3)) || keep.some(q => distance(q, p) < 1.6)) continue;
    puddle(p.x, p.z, r); made++;
  }

  // The outer ring: the edge streets continue past the bounds into a road with parked cars, a sidewalk with lamps
  // and a row of low blocks. Nothing here is walkable, and nothing stands tall enough near the bounds to hide a
  // unit from the camera's lowest tilt (OrbitControls' maxPolarAngle in GameCanvas.tsx).
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
      k.box(p.x, .008, p.z, alongX ? .8 : .075, .016, alongX ? .075 : .8, '#7d847c', PAINT);
    }
    const cuts = mouths.map(m => strip(RING.road, RING.walk, m - 1.5, m + 1.5));
    for (const piece of cutStrip(strip(RING.park + .03, RING.walk, mid - span / 2, mid + span / 2), cuts, 0)) k.flat(piece, 0, .04, '#4b525c', CONCRETE);
    for (const piece of cutStrip(strip(RING.park, RING.park + .06, mid - span / 2, mid + span / 2), cuts, 0)) k.flat(piece, 0, .065, '#77808b', CONCRETE);
    for (const m of mouths) { const p = point(m, (RING.road + RING.walk) / 2); crosswalk(k, () => true, p.x, p.z, !alongX); }
    // Parked cars along the curb.
    for (let a = s.lo + .6; a < s.hi - .6;) {
      const L = 2.3;
      if (!mouths.some(m => Math.abs(m - a) < 2) && rng() < .7) { const p = point(a, (RING.road + RING.park) / 2); parkedCar(k, rng, p.x, p.z, alongX); }
      a += L + rng() * 1.2;
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
        const a1 = end - a0 < 5 ? end : a0 + between(rng, 2.2, 3.6), depth = between(rng, 2.4, RING.depth), h = between(rng, 1.2, 2);
        const r = strip(RING.blocks, RING.blocks + depth, a0, a1);
        k.solid.push({ x: r.x, y: .12, z: r.z, w: r.w + .3, h: .24, d: r.d + .3, color: '#3a3f48', data: CONCRETE });
        k.facade.push({ x: r.x, y: (PLINTH_TOP + h) / 2, z: r.z, w: r.w, h: h - PLINTH_TOP, d: r.d, color: pick(rng, SHOPS), data: [Math.floor(rng() * 8), Math.floor(rng() * 8), Math.floor(rng() * 4), between(rng, .3, .8)] });
        parapet(k.solid, { ...r, y1: h });
        if (rng() < .7) { const w = between(rng, .35, .6); k.box(r.x + between(rng, -.4, .4), h + .17, r.z + between(rng, -.4, .4), w, .34, w * .8, '#575d66', PAINT); }
        const face = point((a0 + a1) / 2, RING.blocks - .04);
        if (rng() < .5) k.glow(face.x, FLOOR0 - .04, face.z, alongX ? r.w : .03, .04, alongX ? .03 : r.d, pick(rng, SIGN_COLORS), 2.2);
        a0 = a1 + between(rng, .15, .5);
      }
    }
  }
  // Ring corners: sidewalk squares joining the sides.
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const x = (sx > 0 ? b.maxX : b.minX) + sx * (RING.park + RING.walk) / 2, z = (sz > 0 ? b.maxZ : b.minZ) + sz * (RING.park + RING.walk) / 2;
    k.flat({ x, z, w: RING.walk - RING.park, d: RING.walk - RING.park }, 0, .04, '#4b525c', CONCRETE);
  }
  for (let n = 0; n < 6; n++) {
    const s = pick(rng, sides), a = between(rng, s.lo, s.hi), out = between(rng, .9, RING.road - .9), r = between(rng, .45, .8);
    const p = s.n.z !== 0 ? { x: a, z: s.at + s.n.z * out } : { x: s.at + s.n.x * out, z: a };
    if (!keep.some(q => distance(q, p) < 2)) puddle(p.x, p.z, r);
  }

  // Practical lights: a fixed number of point lights (so shaders never recompile between districts), given to
  // the intersection lamps nearest the center, two signs, then whatever is left.
  const ranked = k.lights.sort((a, c) => c.rank - a.rank), lamps = ranked.filter(l => l.rank >= 2).slice(0, MAX_PRACTICALS - 2);
  const practicals = [...lamps, ...ranked.filter(l => !lamps.includes(l))].slice(0, MAX_PRACTICALS).map(({ rank: _, ...p }) => p);
  const district: District = {
    solid: k.solid, cylinders: k.cylinders, facade: k.facade, neon: k.neon, signs: k.signs, masts: k.masts,
    pools: k.pools, puddles: k.puddles, practicals, blades: k.blades, boards: k.boards, footprints: k.footprints, flats: k.flats, seed,
  };
  cache.set(plan, district);
  return district;
}

// The generated sign script: each glyph is a few strokes between points of a 3 x 4 lattice, drawn by textures.ts.
export function glyphStrokes(seed: number): [number, number][][][] {
  const rng = mulberry32(seed ^ 0x67a1f);
  return Array.from({ length: GLYPHS }, () => Array.from({ length: 2 + Math.floor(rng() * (GLYPH_STROKES - 1)) }, () => {
    const a: [number, number] = [Math.floor(rng() * 3), Math.floor(rng() * 4)], len = 1 + Math.floor(rng() * 2), stroke = [a];
    for (let n = 0; n < len; n++) {
      const last = stroke[stroke.length - 1], next: [number, number] = rng() < .5 ? [Math.min(2, Math.max(0, last[0] + (rng() < .5 ? -1 : 1) * (1 + Math.floor(rng() * 2)))), last[1]] : [last[0], Math.min(3, Math.max(0, last[1] + (rng() < .5 ? -1 : 1) * (1 + Math.floor(rng() * 2))))];
      stroke.push(next);
    }
    return stroke;
  }));
}
