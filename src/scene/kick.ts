import { STILL } from './parts.tsx';

// A short camera kick, in CSS pixels of view offset, for blasts. Times are mission time (Simulation.time), so a
// kick freezes with the pause and a new mission (time back at 0) never inherits one. Skipped for reduced motion.
const KICK_SECONDS = .28;
let start = Infinity, strength = 0;
export function kickCamera(at: number, px: number) { if (!STILL) { start = at; strength = px; } }
export function cameraKick(now: number): [number, number] | null {
  const t = now - start;
  if (t < 0 || t > KICK_SECONDS) return null;
  const k = strength * (1 - t / KICK_SECONDS) ** 2;
  return [Math.sin(t * 95) * k, Math.cos(t * 71) * k * .7];
}
