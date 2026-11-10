import { between, pick } from '../../game/rng.ts';
import type { Rng } from '../../game/rng.ts';
import type { Rect, World } from '../../game/world.ts';
import { faceLength, faceYaw, onFace } from './faces.ts';
import { FABRIC, overlaps, PLASTIC } from './kit.ts';
import type { Kit } from './kit.ts';
import type { Structure } from './building.ts';

// What a building shows at street level: awnings over its storefronts, and a kiosk and crates at the curb.

const FABRICS = ['#5a2433', '#1f4a4f', '#3b2d5c', '#5c3b1f', '#26324f'];

// Awnings on the first one or two open faces, each with a warm strip under its edge that lights the walkway.
export function awnings(k: Kit, { i, base, faces }: Structure, rng: Rng) {
  for (const f of faces.slice(0, rng() < .5 ? 1 : 2)) {
    const len = faceLength(base, f), w = Math.min(len * .6, between(rng, .9, 1.6));
    if (len < 1.2) continue;
    const along = between(rng, -(len - w) / 2 + .1, (len - w) / 2 - .1), at = onFace(base, f, along, .12), yaw = faceYaw(f);
    k.solid.push({ x: at.x, y: 1.1, z: at.z, w, h: .035, d: .24, rx: .32, ry: yaw, color: pick(rng, FABRICS), data: FABRIC, building: i });
    const lip = onFace(base, f, along, .22);
    k.neon.push({ x: lip.x, y: 1.05, z: lip.z, w: w * .96, h: .025, d: .025, ry: yaw, color: '#ffc685', glow: 2.4, building: i });
    const pool = onFace(base, f, along, .6);
    k.pool(pool.x, pool.z, .85, '#ffc58e', .2);
  }
}

// At the curb: a vending kiosk set into the storefront of the third open face and a stack of crates on the fourth, both
// inside the strip by the wall where no unit can stand (world.walkable keeps units 0.38 m off a building).
export function curbProps(k: Kit, world: World, { base, faces }: Structure, rng: Rng) {
  const props = (r: Rect) => world.cover.every(c => !overlaps(c, r, .1));
  if (rng() < .6 && faces.length > 2) {
    const f = faces[2], len = faceLength(base, f);
    if (len > 1.4) {
      const along = between(rng, -len / 2 + .4, len / 2 - .4), at = onFace(base, f, along, .11), yaw = faceYaw(f), r = { ...at, w: f.nx ? .26 : .44, d: f.nx ? .44 : .26 };
      if (props(r)) {
        k.box(at.x, .41, at.z, .44, .82, .26, pick(rng, ['#283a52', '#4a2440', '#1f4a46']), PLASTIC, { ry: yaw });
        const screen = onFace(base, f, along, .245), color = pick(rng, ['#59e3ff', '#ff5fc4', '#7dff9e']);
        k.glow(screen.x, .52, screen.z, .32, .4, .01, color, 1.9, { ry: yaw });
        const lit = onFace(base, f, along, .55);
        k.pool(lit.x, lit.z, .6, color, .22);
        k.footprints.push(r);
      }
    }
  }
  if (rng() < .5 && faces.length > 3) {
    const f = faces[3], len = faceLength(base, f);
    if (len > 1.2) {
      const along = (rng() < .5 ? -1 : 1) * (len / 2 - .3), at = onFace(base, f, along, .17), s = .3, r = { ...at, w: s, d: s };
      if (props(r)) {
        const color = pick(rng, ['#5a4632', '#3c5a3a', '#2f3f5a']);
        k.box(at.x, s / 2, at.z, s, s, s, color, PLASTIC, { ry: rng() * .15 });
        if (rng() < .6) k.box(at.x, s * 1.45, at.z, s * .85, s * .9, s * .85, color, PLASTIC, { ry: rng() * .5 });
        k.footprints.push(r);
      }
    }
  }
}
