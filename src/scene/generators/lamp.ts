import type { Point } from '../../game/world.ts';
import { METAL } from './kit.ts';
import type { Kit } from './kit.ts';

export const LAMP = '#ffbf7a', LAMP_GLOW = 3.2;
export const LAMP_HEIGHT = 2.6, LAMP_REACH = .75; // the lamp model's size (propGeometry.ts): its mast, and how far its head reaches

// A street lamp: one placement of the lamp model, its mast at (x, z) and its head reaching over the street toward
// `toward`, with a light pool under the head and a practical light ranked `rank` (the district keeps the highest).
// Its hull parts are a mast, arm, head and lens; the model stays inside their overall extent.
export function lamp(k: Kit, x: number, z: number, toward: Point, rank: number) {
  const dx = toward.x - x, dz = toward.z - z, len = Math.hypot(dx, dz) || 1, ux = dx / len, uz = dz / len, ry = Math.atan2(ux, uz);
  k.lamps.push({ x, z, ry, scale: [1, 1, 1], color: '#2c333b' });
  const hx = x + ux * LAMP_REACH, hz = z + uz * LAMP_REACH;
  k.hulls.push(
    { x, y: LAMP_HEIGHT / 2, z, w: .09, h: LAMP_HEIGHT, d: .09, color: '#2c333b', data: METAL },
    { x: x + ux * LAMP_REACH / 2, y: 2.58, z: z + uz * LAMP_REACH / 2, w: .05, h: .05, d: LAMP_REACH, ry, color: '#2c333b', data: METAL },
    { x: hx, y: 2.56, z: hz, w: .2, h: .07, d: .36, ry, color: '#1b2027', data: METAL },
    { x: hx, y: 2.515, z: hz, w: .14, h: .02, d: .28, ry, color: LAMP },
  );
  k.pool(hx, hz, 2.1, '#ffc58e', .26);
  k.lights.push({ x: hx, y: 2.25, z: hz, color: LAMP, intensity: 14, rank });
  k.footprints.push({ x, z, w: .09, d: .09 });
}
