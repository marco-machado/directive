import { distance } from '../game/world.ts';
import type { Point } from '../game/world.ts';

// Dashed ground lines: patrol intel and planned routes.
export const DASH = .5, GAP = .35, WIDTH = .09; // m
export const PERIOD = DASH + GAP;
// Calls `quad` with the ends of each dash along `route` and the half-width normal (nx, nz) to offset its corners
// by. Dashes start every PERIOD m from `offset` m past the route's start, clipped to the route; returning false
// from `quad` stops the walk.
export function eachDash(route: Point[], quad: (fx: number, fz: number, tx: number, tz: number, nx: number, nz: number) => boolean | void, offset = 0) {
  let s0 = 0;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i], len = distance(a, b), s1 = s0 + len;
    if (!len) continue;
    const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len, nx = -uz * WIDTH / 2, nz = ux * WIDTH / 2;
    for (let k = Math.floor((s0 - offset) / PERIOD); k * PERIOD + offset < s1; k++) {
      const start = k * PERIOD + offset, from = Math.max(s0, start) - s0, to = Math.min(s1, start + DASH) - s0;
      if (to <= from) continue;
      if (quad(a.x + ux * from, a.z + uz * from, a.x + ux * to, a.z + uz * to, nx, nz) === false) return;
    }
    s0 = s1;
  }
}
