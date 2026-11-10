import type { Rect } from '../../game/world.ts';

// The four walls of an axis-aligned box, and how to place things on them.

export type Face = { nx: number; nz: number }; // outward normal of a wall
export const FACES: Face[] = [{ nx: 1, nz: 0 }, { nx: -1, nz: 0 }, { nx: 0, nz: 1 }, { nx: 0, nz: -1 }];
export const faceLength = (r: Rect, f: Face) => f.nx ? r.d : r.w;
// A point on a wall: `along` meters from the wall's center, `out` meters past it.
export const onFace = (r: Rect, f: Face, along: number, out: number) => ({ x: r.x + f.nx * (r.w / 2 + out) + (f.nx ? 0 : along), z: r.z + f.nz * (r.d / 2 + out) + (f.nz ? 0 : along) });
// Rotation that turns a part's +z toward the wall's outward normal.
export const faceYaw = (f: Face) => Math.atan2(f.nx, f.nz);

// The walls of `b` that no other building stands against. Two buildings touch along a wall when they share some of
// its length with less than 5 cm between them.
export function openFaces(b: Rect, others: readonly Rect[]): Face[] {
  const against = (o: Rect, f: Face) => {
    const gap = f.nx ? f.nx * (o.x - b.x) - (o.w + b.w) / 2 : f.nz * (o.z - b.z) - (o.d + b.d) / 2;
    const shared = f.nx ? (o.d + b.d) / 2 - Math.abs(o.z - b.z) : (o.w + b.w) / 2 - Math.abs(o.x - b.x);
    return Math.abs(gap) < .05 && shared > 0;
  };
  return FACES.filter(f => !others.some(o => o !== b && against(o, f)));
}
