import type { Bounds, Point } from '../game/world.ts';

// Framing for the orthographic camera, where zoom is CSS pixels per metre.
// The tactical view fits this much street across the HUD's free frame.
export const TACTICAL_SPAN = 22;
// During a mission no zoom draws an operative shorter than this.
export const MIN_OPERATIVE_PX = 24;
// An operative's body from boot sole to helmet top, and its shallowest depth (head and legs). Seen at
// polar angle p (0 looks straight down), an orthographic view draws it h·sin p + d·cos p tall.
const BODY_HEIGHT = 1.25, BODY_DEPTH = .25;
export const operativePx = (zoom: number, polar: number) => zoom * (BODY_HEIGHT * Math.sin(polar) + BODY_DEPTH * Math.cos(polar));
export const missionMinZoom = (polar: number) => MIN_OPERATIVE_PX / operativePx(1, polar);
export const tacticalZoom = (frameWidth: number) => frameWidth / TACTICAL_SPAN;
// The whole district with a margin: the briefing preview, the title's attract mode and the R overview.
export const overviewZoom = (frameWidth: number, frameHeight: number, b: Bounds) =>
  Math.max(1, Math.min(frameWidth / ((b.maxX - b.minX) * 1.4), frameHeight / ((b.maxZ - b.minZ) * 1.5)));

// The selected operatives, or the whole squad when nothing is selected.
export function followGroup<U extends { id: string }>(units: readonly U[], selected: readonly string[], squad: readonly string[]): U[] {
  const pick = (ids: readonly string[]) => units.filter(u => ids.includes(u.id));
  return selected.length && pick(selected).length ? pick(selected) : pick(squad);
}
// The centroid of the follow group.
export function focusPoint(units: readonly (Point & { id: string })[], selected: readonly string[], squad: readonly string[]): Point | null {
  const group = followGroup(units, selected, squad);
  if (!group.length) return null;
  return { x: group.reduce((s, u) => s + u.x, 0) / group.length, z: group.reduce((s, u) => s + u.z, 0) / group.length };
}

// A followed view eases toward the focus point, closing about 63% of the gap every FOLLOW_SECONDS, so a walking
// operative stays centered without the view jerking at each step.
export const FOLLOW_SECONDS = .25;
export function followStep(from: Point, to: Point, dt: number): Point {
  const k = 1 - Math.exp(-dt / FOLLOW_SECONDS);
  return { x: from.x + (to.x - from.x) * k, z: from.z + (to.z - from.z) * k };
}

// Screen distance from a point to a rectangle; zero inside it.
export const rectDistance = (x: number, y: number, r: { x0: number; y0: number; x1: number; y1: number }) =>
  Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.y0 - y, 0, y - r.y1));

export const smoothstep = (t: number) => t * t * (3 - 2 * t);
