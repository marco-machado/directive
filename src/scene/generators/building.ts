import { between, pick, shuffle, stream } from '../../game/rng.ts';
import type { Rng } from '../../game/rng.ts';
import type { Building, Rect } from '../../game/world.ts';
import { PLINTH } from '../view.ts';
import { FACES, faceLength, faceYaw, onFace } from './faces.ts';
import type { Face } from './faces.ts';
import { CONCRETE, METAL, PAINT } from './kit.ts';
import type { Kit, Part } from './kit.ts';

// A building's body: its massing, the plinth and facade tiers, the parapets, the neon trim and the wall vents.

// Facade layout, shared with the facade shader: window floors start at FLOOR0 and repeat every ROW; a face is split
// into bays of about BAY. The atlas is ATLAS_CELLS bays square (see textures.ts).
export const FLOOR0 = 1.25, ROW = .56, BAY = .52, ATLAS_CELLS = 32;
export const PLINTH_TOP = .24;

// A building's neon trim is one of these.
export const ACCENTS = ['#59e3ff', '#ff9a3c', '#2ff5c6', '#b77bff', '#ff4f7e'];
// What the rooftop boards say.
export const NAMES = ['KESSLER', 'DATA / 04', 'NEXUS', 'RELAY', '07', 'METRO', 'LOGISTICS', 'ARCOLOGY', 'VAULT', 'HYDRO', 'PRISM', 'SPIRE', 'DEPOT', 'ATLAS', 'GRID 9', 'KIOSK'];
const BODY = ['#8a96aa', '#7d8aa3', '#978aab', '#82988d', '#a39282', '#7686a0', '#9b93a3', '#8b909c'];

type Tier = Rect & { y0: number; y1: number };
// What every generator that dresses a building starts from: the building, its index (parts carry it, to fade with
// the building), its name, its colors, its massing and its walls in a shuffled order. `base` is the lowest tier and `top` the
// highest. `faces` holds the open walls only: the first two carry the awnings and the blade signs, the third the kiosk
// and the fourth the crates, and a building with fewer open walls goes without what the missing ones would carry.
export type Structure = { readonly b: Building; readonly i: number; readonly name: string; readonly accent: string; readonly body: string; readonly tiers: readonly Readonly<Tier>[]; readonly base: Readonly<Tier>; readonly top: Readonly<Tier>; readonly faces: readonly Face[] };

// A parapet: a low rim around a roof, so the roof itself still shows.
export function parapet(list: Part[], t: Rect & { y1: number }, building?: number) {
  const h = .14, th = .06, y = t.y1 + h / 2, color = '#1c2129';
  for (const s of [1, -1]) {
    list.push({ x: t.x, y, z: t.z + s * (t.d / 2 + .03 - th / 2), w: t.w + .06, h, d: th, color, data: PAINT, building });
    list.push({ x: t.x + s * (t.w / 2 + .03 - th / 2), y, z: t.z, w: th, h, d: t.d - .06, color, data: PAINT, building });
  }
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

// A name for each of a district's buildings: the names in an order of the district's own, round again past the last.
export function buildingNames(seed: number, count: number): string[] {
  const names = shuffle(stream(seed, 'names'), NAMES);
  return Array.from({ length: count }, (_, i) => names[i % names.length]);
}

// Draws the body color, then the massing, the order of the faces and the accent. `open` is the walls no other
// building stands against (openFaces): only those are kept, so nothing is hung on a wall inside a joint.
export function structure(b: Building, i: number, name: string, open: readonly Face[], rng: Rng): Structure {
  const body = pick(rng, BODY), tiers = massing(b, rng), faces = shuffle(rng, FACES).filter(f => open.includes(f)), accent = pick(rng, ACCENTS);
  return { b, i, name, accent, body, tiers, base: tiers[0], top: tiers[tiers.length - 1], faces };
}

// The plinth, one facade box and parapet per tier, the neon trim and a slab's cornices.
export function shell(k: Kit, { b, i, accent, body, tiers, base, top }: Structure, rng: Rng) {
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
}

// Wall vents, on open walls.
export function vents(k: Kit, { i, tiers, faces }: Structure, rng: Rng) {
  if (!faces.length) return;
  for (let n = 0; n < 2; n++) {
    const t = pick(rng, tiers), f = pick(rng, faces), len = faceLength(t, f), y = between(rng, Math.max(t.y0 + .2, FLOOR0 + .1), t.y1 - .3);
    if (len < 1 || y > t.y1 - .3) continue;
    const at = onFace(t, f, between(rng, -len / 2 + .3, len / 2 - .3), .02);
    k.solid.push({ x: at.x, y, z: at.z, w: .24, h: .16, d: .04, ry: faceYaw(f), color: '#4b525b', data: METAL, building: i });
  }
}
