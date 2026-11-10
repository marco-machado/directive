import { between, pick } from '../../game/rng.ts';
import type { Rng } from '../../game/rng.ts';
import { CAR, GLASS, RUBBER } from './kit.ts';
import type { Kit } from './kit.ts';

export const CAR_PAINT = ['#1c2632', '#3b1d2a', '#2a3039', '#1d3a39', '#4a4b53', '#8a9097', '#5a1f1f', '#263a5c'];
export const CAR_LENGTH = 1.775, CAR_WIDTH = .78; // the car model's size (propGeometry.ts); a placement stretches its length

// A parked car centered on (x, z), its length along x or z: one placement of the car model, nose either way,
// stretched to its own length. Its hull parts are a body, cabin, wheels and lights; the model stays inside their overall extent.
export function parkedCar(k: Kit, rng: Rng, x: number, z: number, alongX: boolean) {
  const L = between(rng, 1.6, 1.95), W = CAR_WIDTH, paint = pick(rng, CAR_PAINT), flip = rng() < .5 ? 1 : -1;
  const at = (a: number, s: number) => alongX ? { x: x + a, z: z + s } : { x: x + s, z: z + a };
  const c = at(0, 0);
  // The model's nose points along +z; `flip` picks which way along the car's street it faces.
  k.cars.push({ x: c.x, z: c.z, ry: alongX ? flip * Math.PI / 2 : (flip > 0 ? 0 : Math.PI), scale: [1, 1, L / CAR_LENGTH], color: paint });
  k.hulls.push({ x: c.x, y: .27, z: c.z, w: alongX ? L : W, h: .26, d: alongX ? W : L, color: paint, data: CAR });
  const cab = at(-flip * L * .06, 0);
  k.hulls.push({ x: cab.x, y: .5, z: cab.z, w: alongX ? L * .52 : W * .86, h: .2, d: alongX ? W * .86 : L * .52, color: '#0d1218', data: GLASS });
  for (const a of [-.32, .32]) for (const s of [-1, 1]) {
    const p = at(a * L, s * W * .42);
    k.hulls.push({ x: p.x, y: .15, z: p.z, w: .3, h: .12, d: .3, rx: alongX ? Math.PI / 2 : 0, rz: alongX ? 0 : Math.PI / 2, color: '#0b0d10', data: RUBBER });
  }
  for (const s of [-1, 1]) for (const end of [-1, 1]) {
    const light = at(end * L / 2, s * W * .32);
    k.hulls.push({ x: light.x, y: .31, z: light.z, w: alongX ? .02 : .14, h: .05, d: alongX ? .14 : .02, color: '#c9d2d9', data: GLASS });
  }
  if (rng() < .12) { const color = pick(rng, ['#ff3dd2', '#3df2ff']); k.pool(c.x, c.z, 1.1, color, .3); }
  k.footprints.push({ ...c, w: alongX ? L : W, d: alongX ? W : L });
}
