import type { Bounds, Building, Point, Rect } from '../game/world.ts';

// What the orthographic camera can see, reduced to the ground plane: every view ray runs along
// (ux, uz) toward the camera and climbs `rise` meters per meter of ground it crosses.
export type View = { ux: number; uz: number; rise: number };
export const viewAlong = (dx: number, dy: number, dz: number): View => {
  const ground = Math.hypot(dx, dz) || 1e-6;
  return { ux: -dx / ground, uz: -dz / ground, rise: -dy / ground };
};

// Rooftop parts (thin antennas aside) stay within this far above Building.h, and a building's dressing within this far past its footprint
// (district.ts; tests/district.test.ts holds it to both).
export const ROOF = .85, PLINTH = .25;
export const COVER_TOP = .62;
export const buildingTop = (b: Building) => b.h + ROOF;

// True when the ray from `p` at height `y` toward the camera passes through the box over `r`
// (grown by `pad`) that rises from the ground to `top`. The ray climbs, so it only has to enter
// the footprint before it clears the top.
export function hides(p: Point, y: number, view: View, r: Rect, top: number, pad = 0): boolean {
  if (y >= top) return false;
  let lo = 0, hi = view.rise > 0 ? (top - y) / view.rise : Infinity;
  const slabs: [number, number, number, number][] = [[p.x, view.ux, r.x, r.w / 2 + pad], [p.z, view.uz, r.z, r.d / 2 + pad]];
  for (const [origin, step, center, half] of slabs) {
    if (Math.abs(step) < 1e-9) { if (Math.abs(origin - center) > half) return false; continue; }
    const a = (center - half - origin) / step, b = (center + half - origin) / step;
    lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b));
    if (lo > hi) return false;
  }
  return true;
}

// Marks in `out` every building that hides `p` at height `y`, testing the center ray and one on
// either side `spread` meters off it, so a unit half behind a corner still counts.
export function markHiding(buildings: readonly Building[], view: View, p: Point, y: number, spread: number, out: Uint8Array) {
  const sx = -view.uz * spread, sz = view.ux * spread;
  buildings.forEach((b, i) => {
    if (out[i]) return;
    const top = buildingTop(b);
    if (hides(p, y, view, b, top) || spread && (hides({ x: p.x + sx, z: p.z + sz }, y, view, b, top) || hides({ x: p.x - sx, z: p.z - sz }, y, view, b, top))) out[i] = 1;
  });
}

// Whether any building or barrier could hide some part of a unit standing at `p` within `radius`.
// Occluders all rise from the ground, so if the rays from the unit's footprint clear them, every
// ray from higher up clears them too.
export function mayBeHidden(buildings: readonly Building[], cover: readonly Rect[], view: View, p: Point, radius: number): boolean {
  return buildings.some(b => hides(p, 0, view, b, buildingTop(b), PLINTH + radius)) || cover.some(r => hides(p, 0, view, r, COVER_TOP, radius));
}

// The default view looks in from (+29, +34, +32) off the district's center. Mirrored onto the
// squad's spawn corner, it puts the start on the near side of the screen.
export const CAMERA_OFFSET = { x: 29, y: 34, z: 32 } as const;
export function cameraOffset(bounds: Bounds, toward: Point | null) {
  const cx = (bounds.minX + bounds.maxX) / 2, cz = (bounds.minZ + bounds.maxZ) / 2;
  return { x: toward && toward.x < cx ? -CAMERA_OFFSET.x : CAMERA_OFFSET.x, y: CAMERA_OFFSET.y, z: toward && toward.z < cz ? -CAMERA_OFFSET.z : CAMERA_OFFSET.z };
}
