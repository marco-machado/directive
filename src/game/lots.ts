import { between } from './rng.ts';
import type { Rng } from './rng.ts';
import type { Rect } from './world.ts';

// What stands inside a city block. A block's room is the block less the street on every side; a kind of block
// fills it with zero, one or two building footprints. The streets, and so the patrols, objectives and cover that
// follow them, are the same whatever stands in the room.

export const ALLEY = 1.2;   // m between a twin's two buildings: room for an operative, and a sight line through the block
export const MIN_LOT = 1.6; // narrowest footprint a twin may leave either side of its alley
// How often each kind of block comes up. A plaza is open ground; a single is one building; a twin is two with an
// alley between them; a corner is two that touch in an L around an open pocket.
export const BLOCK_MIX = { plaza: .2, single: .4, twin: .2, corner: .2 } as const;
export type BlockKind = keyof typeof BLOCK_MIX;
const KINDS = Object.keys(BLOCK_MIX) as BlockKind[];

export function pickBlock(rng: Rng): BlockKind {
  let roll = rng();
  return KINDS.find(kind => (roll -= BLOCK_MIX[kind]) < 0) ?? KINDS[KINDS.length - 1];
}

// A footprint from its center and size along a block's axis (`a`) and across it (`c`).
const lot = (room: Rect, alongX: boolean, a: number, c: number, la: number, lc: number): Rect =>
  alongX ? { x: room.x + a, z: room.z + c, w: la, d: lc } : { x: room.x + c, z: room.z + a, w: lc, d: la };

// One building, 55% to 100% of the room each way, anywhere it fits.
function single(room: Rect, rng: Rng): Rect[] {
  const w = between(rng, room.w * .55, room.w), d = between(rng, room.d * .55, room.d);
  return [{ x: room.x + between(rng, -(room.w - w) / 2, (room.w - w) / 2), z: room.z + between(rng, -(room.d - d) / 2, (room.d - d) / 2), w, d }];
}

// Two buildings side by side along the room's longer side, an alley between them. The alley's center line sits on
// the whole meter nearest the room's center, where the navigation grid has its points, so it is always a way through.
// A room too small for two lots holds one building instead.
function twin(room: Rect, rng: Rng): Rect[] {
  const alongX = room.w >= room.d, length = alongX ? room.w : room.d, depth = alongX ? room.d : room.w, center = alongX ? room.x : room.z;
  const alley = Math.round(center) - center;
  const sides = [-1, 1].map(side => ({ side, room: length / 2 - ALLEY / 2 - side * alley }));
  if (sides.some(s => s.room < MIN_LOT)) return single(room, rng);
  return sides.map(s => {
    const la = between(rng, Math.max(MIN_LOT, s.room * .7), s.room), lc = between(rng, depth * .55, depth);
    return lot(room, alongX, alley + s.side * (ALLEY + la) / 2, between(rng, -(depth - lc) / 2, (depth - lc) / 2), la, lc);
  });
}

// Two buildings that touch in an L: a bar the room's full length along one side, 40% to 50% of the way across, and
// a wing of 40% to 50% of the length from one end of the bar to the far side. The rest is an open pocket.
function corner(room: Rect, rng: Rng): Rect[] {
  const alongX = rng() < .5, side = rng() < .5 ? -1 : 1, end = rng() < .5 ? -1 : 1;
  const length = alongX ? room.w : room.d, depth = alongX ? room.d : room.w;
  const bar = depth * between(rng, .4, .5), wing = length * between(rng, .4, .5);
  return [lot(room, alongX, 0, side * (depth - bar) / 2, length, bar), lot(room, alongX, end * (length - wing) / 2, -side * bar / 2, wing, depth - bar)];
}

// The ground a twin's two buildings leave open between them: the alley across the whole room and `reach` past it at
// both ends, out to the streets it joins.
export function alley([a, b]: readonly Rect[], room: Rect, reach: number): Rect {
  return room.w >= room.d
    ? { x: (a.x + a.w / 2 + b.x - b.w / 2) / 2, z: room.z, w: ALLEY, d: room.d + 2 * reach }
    : { x: room.x, z: (a.z + a.d / 2 + b.z - b.d / 2) / 2, w: room.w + 2 * reach, d: ALLEY };
}

export function fillBlock(kind: BlockKind, room: Rect, rng: Rng): Rect[] {
  return kind === 'plaza' ? [] : kind === 'single' ? single(room, rng) : kind === 'twin' ? twin(room, rng) : corner(room, rng);
}
