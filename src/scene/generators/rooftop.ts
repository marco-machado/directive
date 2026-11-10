import { between, pick } from '../../game/rng.ts';
import type { Rng } from '../../game/rng.ts';
import type { Point, Rect } from '../../game/world.ts';
import { FACES, faceLength, faceYaw, onFace } from './faces.ts';
import { METAL, overlaps, PAINT } from './kit.ts';
import type { Kit, Part } from './kit.ts';
import { GLYPHS, SIGN_COLORS } from './signage.ts';
import type { SignAtlas } from './signage.ts';
import type { Structure } from './building.ts';

// Rooftop: a name board, plant, vents, a tank and an antenna, placed without overlaps inside the parapet. A board
// the atlas has no cell for is not built and takes no room on the roof; it still draws its values, so the plant
// starts from the same point in the stream either way.
export function rooftop(k: Kit, { b, i, name, top }: Structure, atlas: SignAtlas, rng: Rng) {
  const part = (list: Part[], p: Part) => list.push({ ...p, building: i });
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
    const w = Math.min(faceLength(roof, f) * .85, 2.6), at = onFace(roof, f, 0, -.12), yaw = faceYaw(f);
    const glyphs = Array.from({ length: 5 }, () => Math.floor(rng() * GLYPHS)), color = pick(rng, SIGN_COLORS), cell = atlas.board({ title: name, glyphs });
    if (cell !== null) {
      taken.push({ ...at, w: f.nx ? .3 : w, d: f.nx ? w : .3 });
      for (const s of [-.4, .4]) part(k.solid, { x: at.x + (f.nx ? 0 : s * w), y: roofY + .12, z: at.z + (f.nx ? s * w : 0), w: .05, h: .24, d: .05, color: '#2b3139', data: METAL });
      part(k.solid, { x: at.x - f.nx * .03, y: roofY + .46, z: at.z - f.nz * .03, w, h: .46, d: .04, ry: yaw, color: '#15181d', data: METAL });
      part(k.signs, { x: at.x + f.nx * .001, y: roofY + .46, z: at.z + f.nz * .001, w: w - .04, h: .42, d: 1, ry: yaw, color, glow: 2.2, data: [(cell % 2) * .5, .375 - Math.floor(cell / 2) * .125, .5, .125] });
    }
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
}
