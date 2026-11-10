import { BoxGeometry, BufferGeometry, Color, CylinderGeometry, Float32BufferAttribute, Matrix4 } from 'three';
import { CAR_LENGTH, CAR_WIDTH } from './generators/car.ts';
import { CAR, GLASS, METAL, RUBBER } from './generators/kit.ts';
import { LAMP, LAMP_GLOW, LAMP_HEIGHT, LAMP_REACH } from './generators/lamp.ts';

// The models of the street props that are more than boxes: a parked car and a street lamp. Each is one geometry,
// drawn once per placement by InstancedProps (props.tsx) with the `prop` material (materials.ts). Besides position
// and normal, every vertex carries its `color` and its `surface`: roughness, metalness, glow (its color's emissive
// gain) and tint (1 where the placement's color replaces white: a car's paint).

type Surface = readonly [roughness: number, metalness: number, glow: number, tint: number];
const role = ([roughness, metalness]: readonly number[], glow = 0, tint = 0): Surface => [roughness, metalness, glow, tint];
const PAINT = role(CAR, 0, 1), WHITE = '#ffffff';

// Collects shapes into one geometry, each moved into place and given its color and surface.
class Model {
  private position: number[] = []; private normal: number[] = []; private color: number[] = []; private surface: number[] = [];
  add(shape: BufferGeometry, at: Matrix4, color: string, surface: Surface) {
    const flat = shape.toNonIndexed().applyMatrix4(at), { r, g, b } = new Color(color);
    flat.computeVertexNormals();
    this.position.push(...flat.getAttribute('position').array); this.normal.push(...flat.getAttribute('normal').array);
    for (let n = 0; n < flat.getAttribute('position').count; n++) { this.color.push(r, g, b); this.surface.push(...surface); }
    return this;
  }
  box(w: number, h: number, d: number, x: number, y: number, z: number, color: string, surface: Surface, tilt = 0) {
    return this.add(new BoxGeometry(w, h, d), new Matrix4().makeRotationX(tilt).setPosition(x, y, z), color, surface);
  }
  build() {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.position, 3)); g.setAttribute('normal', new Float32BufferAttribute(this.normal, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.color, 3)); g.setAttribute('surface', new Float32BufferAttribute(this.surface, 4));
    return g;
  }
}

// A box whose top is narrower and shorter than its base: `front` and `rear` are how far the top stands back at
// either end. A car's cabin, with a raked windshield.
function cabin(w: number, h: number, d: number, top: { w: number; front: number; rear: number }) {
  const g = new BoxGeometry(w, h, d), p = g.getAttribute('position');
  for (let n = 0; n < p.count; n++) {
    if (p.getY(n) < 0) continue;
    p.setX(n, p.getX(n) * top.w / w);
    p.setZ(n, p.getZ(n) > 0 ? p.getZ(n) - top.front : p.getZ(n) + top.rear);
  }
  return g;
}

// A car standing on y = 0, centered, nose toward +z: CAR_WIDTH wide, CAR_LENGTH long and 0.6 m tall.
export function carGeometry(): BufferGeometry {
  const L = CAR_LENGTH, W = CAR_WIDTH, m = new Model();
  // The lights stand 1 cm proud of the body at either end.
  m.box(W, .26, L - .02, 0, .27, 0, WHITE, PAINT);
  // The cabin sits toward the rear, glass all round under a painted roof.
  const glass = { w: W * .86, d: L * .52, z: -L * .06, front: .22, rear: .1 }, roof = glass.d - glass.front - glass.rear;
  m.add(cabin(glass.w, .185, glass.d, { w: W * .74, front: glass.front, rear: glass.rear }), new Matrix4().setPosition(0, .4925, glass.z), '#0d1218', role(GLASS));
  m.box(W * .74, .015, roof, 0, .5925, glass.z + (glass.rear - glass.front) / 2, WHITE, PAINT);
  for (const a of [-.32, .32]) for (const s of [-1, 1]) m.add(new CylinderGeometry(.15, .15, .12, 12), new Matrix4().makeRotationZ(Math.PI / 2).setPosition(s * W * .42, .15, a * L), '#0b0d10', role(RUBBER));
  for (const s of [-1, 1]) {
    m.box(.14, .05, .02, s * W * .32, .31, -L / 2 + .01, '#ff2a3a', role([.4, 0], 1.5));
    m.box(.14, .05, .02, s * W * .32, .31, L / 2 - .01, '#c9d2d9', role(GLASS));
  }
  return m.build();
}

// A street lamp, its mast's foot at the origin: a tapered mast LAMP_HEIGHT tall, an arm curving out toward +z and a
// head LAMP_REACH out, with a glowing lens underneath.
export function lampGeometry(): BufferGeometry {
  const m = new Model(), steel = role(METAL);
  m.add(new CylinderGeometry(.03, .045, LAMP_HEIGHT, 10), new Matrix4().setPosition(0, LAMP_HEIGHT / 2, 0), '#2c333b', steel);
  // The arm: a curve from high on the mast up and out to the head, in straight pieces.
  const curve = (t: number) => ({ y: (1 - t) ** 2 * 2.46 + 2 * (1 - t) * t * 2.61 + t * t * 2.575, z: 2 * (1 - t) * t * .2 + t * t * (LAMP_REACH - .13) });
  for (let n = 0; n < 5; n++) {
    const a = curve(n / 5), b = curve((n + 1) / 5), dy = b.y - a.y, dz = b.z - a.z;
    m.box(.04, .04, Math.hypot(dy, dz) + .01, 0, (a.y + b.y) / 2, (a.z + b.z) / 2, '#2c333b', steel, -Math.atan2(dy, dz));
  }
  m.box(.2, .07, .36, 0, 2.56, LAMP_REACH, '#1b2027', steel);
  m.box(.14, .02, .28, 0, 2.515, LAMP_REACH, LAMP, role([.4, 0], LAMP_GLOW));
  return m.build();
}
