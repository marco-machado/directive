import { between, mulberry32, pick } from '../../game/rng.ts';
import type { Rng } from '../../game/rng.ts';
import { PLINTH } from '../view.ts';
import { faceLength, faceYaw, onFace } from './faces.ts';
import { METAL } from './kit.ts';
import type { BoardText, Kit } from './kit.ts';
import type { Structure } from './building.ts';

// Signs: the vertical blade signs on a building's walls and the generated script every sign is written in.

export const GLYPHS = 24;    // size of the generated sign script
export const BLADE_CELLS = 16, BOARD_CELLS = 8;
const GLYPH_STROKES = 4;
export const SIGN_COLORS = ['#ff3d9a', '#3df2ff', '#ffb13d', '#a66bff', '#4dff9b', '#ff5a3d', '#59e3ff'];

// What a district's sign atlas holds (textures.ts draws it): a row of glyph strips for the blade signs and a grid
// of name boards. Both are fixed in size, so a district with more signs than cells shares them: a blade sign past
// the last cell shows a strip already there, which nobody can tell in a script that means nothing, and a name
// board past the last cell is not built, since a shared board would carry another building's name.
export class SignAtlas {
  blades: number[][] = []; boards: BoardText[] = [];
  private reused = 0;
  // The cell a blade sign draws from: a new one while there is room, then a stored strip closest to it in
  // length, taking turns among those equally close.
  blade(glyphs: number[]): number {
    if (this.blades.length < BLADE_CELLS) return this.blades.push(glyphs) - 1;
    const off = (cell: number) => Math.abs(this.blades[cell].length - glyphs.length), cells = this.blades.map((_, cell) => cell);
    const least = Math.min(...cells.map(off)), ties = cells.filter(cell => off(cell) === least);
    return ties[this.reused++ % ties.length];
  }
  // The cell a name board draws from, or null when every cell is taken.
  board(text: BoardText): number | null {
    return this.boards.length < BOARD_CELLS ? this.boards.push(text) - 1 : null;
  }
}

// Vertical blade signs on a glowing glyph script, mounted on the tallest tier that spans them: one on the first
// open face, and a second on the next one of a tall building. A sign draws the same values whatever the atlas holds;
// only the cell it shows depends on the signs before it.
export function bladeSigns(k: Kit, { b, i, tiers, faces }: Structure, atlas: SignAtlas, rng: Rng) {
  const [front, side] = faces;
  const tall = [...tiers].sort((a, c) => (c.y1 - c.y0) - (a.y1 - a.y0))[0];
  for (let n = 0; n < (b.h > 4.5 ? 2 : 1); n++) {
    const y0 = Math.max(tall.y0 + .12, 1.45), y1 = Math.min(tall.y1 - .25, y0 + between(rng, 1.1, 2.8)), h = y1 - y0;
    if (h < .9) break;
    const f = n ? side : front;
    if (!f || faceLength(tall, f) < 1.2) continue;
    const len = faceLength(tall, f);
    const along = (rng() < .5 ? -1 : 1) * (len / 2 - .28), at = onFace(tall, f, along, PLINTH / 2), yaw = faceYaw(f), color = pick(rng, SIGN_COLORS);
    k.solid.push({ x: at.x, y: (y0 + y1) / 2, z: at.z, w: .05, h: h + .06, d: PLINTH - .01, ry: yaw, color: '#101318', data: METAL, building: i });
    // A face on either side of the blade: the plane's +z points along the wall, both ways.
    const cell = atlas.blade(Array.from({ length: Math.max(3, Math.min(7, Math.round(h / .38))) }, () => Math.floor(rng() * GLYPHS)));
    for (const s of [1, -1]) {
      const tx = f.nx ? 0 : s * .028, tz = f.nx ? s * .028 : 0;
      k.signs.push({ x: at.x + tx, y: (y0 + y1) / 2, z: at.z + tz, w: PLINTH - .05, h: h - .04, d: 1, ry: Math.atan2(tx, tz), color, glow: 2.8, data: [cell / BLADE_CELLS, .5, 1 / BLADE_CELLS, .5], building: i });
    }
    const foot = onFace(tall, f, along, .5), spill = onFace(tall, f, along, .9);
    k.pool(foot.x, foot.z, .8 + h * .22, color, .24);
    // The sign's light hangs out over the walkway, so it washes the wall and street rather than its own blade.
    k.lights.push({ x: spill.x, y: (y0 + y1) / 2, z: spill.z, color, intensity: 4.5, rank: 1 });
  }
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
