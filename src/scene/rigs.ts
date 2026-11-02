import { Bone, BufferAttribute, BufferGeometry, Color, CylinderGeometry, Euler, ExtrudeGeometry, LatheGeometry, Matrix4, Quaternion, Shape, Skeleton, SkinnedMesh, TorusGeometry, Uint16BufferAttribute, Vector2, Vector3 } from 'three';
import type { Material } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { UnitKind } from '../game/simulation.ts';

// Procedural unit models. Every part of a unit is merged into one skinned geometry with vertex colors (and a
// second one for the parts that glow), so a unit costs one draw call lit and one glowing. Each part is bound
// rigidly to one bone; animation turns the bones. Forward is +z, up is +y, the feet stand on y = 0.

type V3 = [number, number, number];
export type BoneSpec = { name: string; parent: number; at: V3 };
export type RigModel = { kind: UnitKind; bones: BoneSpec[]; body: BufferGeometry; glow: BufferGeometry | null };

// Squad accents follow the class colors in style.css (.cls-*).
export const CLASS_COLOR: Partial<Record<UnitKind, string>> = { assault: '#ff8a5b', support: '#5ef2c0', recon: '#ffd166', tech: '#62d0ff' };
// The heavy is the standard body built bigger. REACH bounds how far any lit part (the recon's raised rifle)
// sits from the unit's center, for the occlusion test.
export const SCALE: Partial<Record<UnitKind, number>> = { heavy: 1.18 };
export const REACH = 1;
export const ARMED: Record<UnitKind, boolean> = { assault: true, support: true, recon: true, tech: true, guard: true, heavy: true, camera: false, turret: false, target: false, vip: false };

// A box with chamfered edges, centered on the origin: a rectangle inset by the bevel and extruded along z.
function bevelBox(w: number, h: number, d: number, b = Math.min(w, h, d) * .22) {
  const x = w / 2 - b, y = h / 2 - b, depth = Math.max(.002, d - 2 * b);
  const shape = new Shape().moveTo(-x, -y).lineTo(x, -y).lineTo(x, y).lineTo(-x, y).closePath();
  return new ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 1, curveSegments: 1 }).translate(0, 0, -depth / 2);
}
// A side profile, given as [forward, up] points, extruded across x to `thickness` with a small bevel.
function profile(points: [number, number][], thickness: number) {
  const b = thickness * .2, depth = thickness - 2 * b;
  const shape = new Shape(points.map(([z, y]) => new Vector2(z, y)));
  return new ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: b, bevelSize: b * .6, bevelSegments: 1, curveSegments: 2 })
    .translate(0, 0, -depth / 2).rotateY(-Math.PI / 2);
}
// A surface of revolution around y from [radius, height] points.
const lathe = (points: [number, number][], segments = 12) => new LatheGeometry(points.map(([r, y]) => new Vector2(r, y)), segments);
// A rod along z (barrels, lenses, antennas when turned).
const rod = (radius: number, length: number, segments = 8) => new CylinderGeometry(radius, radius, length, segments).rotateX(Math.PI / 2);
const ring = (radius: number, tube: number, segments = 16) => new TorusGeometry(radius, tube, 4, segments);
// A limb hanging from its joint: a capsule tapering from `top` to `bottom` radius over `length`.
const limb = (top: number, bottom: number, length: number) => lathe([[0, -length - bottom * .5], [bottom * .7, -length - bottom * .35], [bottom, -length], [top, 0], [top * .75, top * .35], [0, top * .5]], 8);
const ball = (radius: number, segments = 8) => lathe([[0, -radius], [radius * .7, -radius * .7], [radius, 0], [radius * .7, radius * .7], [0, radius]], segments);

const matrix = new Matrix4(), quaternion = new Quaternion(), euler = new Euler(), offset = new Vector3(), UNIT = new Vector3(1, 1, 1), tint = new Color();
class Kit {
  readonly bones: BoneSpec[] = [];
  private readonly body: BufferGeometry[] = [];
  private readonly glows: BufferGeometry[] = [];
  constructor(readonly kind: UnitKind) {}
  bone(name: string, parent: string | null, at: V3) { this.bones.push({ name, parent: parent ? this.index(parent) : -1, at }); return this; }
  private index(name: string) {
    const i = this.bones.findIndex(b => b.name === name);
    if (i < 0) throw new Error(`No bone ${name}`);
    return i;
  }
  // Places a part (rotation first, then position), paints it one color and binds it to a bone.
  add(geometry: BufferGeometry, color: string, bone: string, at: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], glow = false) {
    geometry.applyMatrix4(matrix.compose(offset.set(...at), quaternion.setFromEuler(euler.set(...rot)), UNIT));
    const part = geometry.index ? geometry.toNonIndexed() : geometry;
    for (const name of Object.keys(part.attributes)) if (name !== 'position' && name !== 'normal') part.deleteAttribute(name);
    part.clearGroups();
    const n = part.getAttribute('position').count, colors = new Float32Array(n * 3), index = new Uint16Array(n * 4), weight = new Float32Array(n * 4), b = this.index(bone);
    tint.set(color);
    for (let k = 0; k < n; k++) { colors.set([tint.r, tint.g, tint.b], k * 3); index[k * 4] = b; weight[k * 4] = 1; }
    part.setAttribute('color', new BufferAttribute(colors, 3));
    part.setAttribute('skinIndex', new Uint16BufferAttribute(index, 4));
    part.setAttribute('skinWeight', new BufferAttribute(weight, 4));
    (glow ? this.glows : this.body).push(part);
    return this;
  }
  lit(color: string, bone: string, geometry: BufferGeometry, at?: V3, rot?: V3) { return this.add(geometry, color, bone, at, rot); }
  glow(color: string, bone: string, geometry: BufferGeometry, at?: V3, rot?: V3) { return this.add(geometry, color, bone, at, rot, true); }
  build(): RigModel {
    const body = mergeGeometries(this.body)!, glow = this.glows.length ? mergeGeometries(this.glows)! : null;
    body.computeBoundingBox(); body.computeBoundingSphere();
    return { kind: this.kind, bones: this.bones, body, glow };
  }
}

// ---- Humanoids ----
// Pads are the shoulder caps and knee pads; squad classes paint them in a darkened class color, so a class
// reads by more than its glow at play scale.
type Look = { suit: string; vest: string; legs: string; boots: string; skin: string; glove?: string; pads?: string; width?: number };
// The shared body: hips carry the legs and the waist-hinged chest, which carries the head and the arms. Arms
// hang from the shoulders in the bind pose; the pose code lifts them onto the weapon. Limbs are tapered capsules.
function humanoid(kind: UnitKind, look: Look) {
  const k = new Kit(kind), w = look.width ?? 1, sx = .27 * w, glove = look.glove ?? '#1b2427', pads = look.pads ?? look.vest;
  k.bone('root', null, [0, 0, 0]).bone('hips', 'root', [0, .58, 0])
    .bone('legL', 'hips', [-.11, .58, 0]).bone('legR', 'hips', [.11, .58, 0])
    .bone('chest', 'hips', [0, .6, 0]).bone('head', 'chest', [0, .98, 0])
    .bone('armL', 'chest', [-sx, .92, 0]).bone('armR', 'chest', [sx, .92, 0]);
  if (ARMED[kind]) k.bone('gun', 'chest', [.1, .74, .16]);
  k.lit(look.legs, 'hips', bevelBox(.34 * w, .16, .24), [0, .6, 0])
    .lit('#161c1e', 'hips', bevelBox(.37 * w, .05, .27, .012), [0, .665, 0]);
  for (const [side, x] of [['legL', -.11], ['legR', .11]] as const) {
    k.lit(look.legs, side, limb(.085, .068, .25), [x, .57, 0])
      .lit(pads, side, bevelBox(.11, .1, .06, .02), [x, .3, .07])
      .lit(look.legs, side, limb(.066, .055, .22), [x, .31, 0])
      .lit(look.boots, side, bevelBox(.15, .1, .28), [x, .05, .04]);
  }
  k.lit(look.suit, 'chest', lathe([[.17 * w, .64], [.2 * w, .72], [.24 * w, .86], [.23 * w, .96], [.1, .99], [0, .99]], 10), [0, 0, 0])
    .lit(look.vest, 'chest', bevelBox(.36 * w, .26, .08), [0, .8, .14])
    .lit(look.vest, 'chest', bevelBox(.34 * w, .22, .07), [0, .82, -.13])
    .lit(look.skin, 'head', bevelBox(.08, .06, .08), [0, 1.0, 0])
    .lit(look.skin, 'head', lathe([[0, 1.0], [.085, 1.005], [.112, 1.05], [.12, 1.12], [.108, 1.19], [.065, 1.235], [0, 1.25]], 10), [0, 0, .01]);
  for (const [side, x] of [['armL', -sx], ['armR', sx]] as const) {
    k.lit(pads, side, ball(.085), [x, .91, 0])
      .lit(look.suit, side, limb(.062, .052, .2), [x, .9, 0])
      .lit(look.suit, side, limb(.054, .046, .17), [x, .69, 0])
      .lit(glove, side, bevelBox(.1, .09, .11), [x, .47, .01]);
  }
  return k;
}
// The squad's rounded helmet with a lit visor across the face.
const helmet = (k: Kit, color: string, visor: string) => k
  .lit(color, 'head', lathe([[.15, 1.1], [.16, 1.18], [.13, 1.26], [.06, 1.29], [0, 1.29]], 10))
  .glow(visor, 'head', bevelBox(.21, .06, .03, .01), [0, 1.15, .135]);
// A long gun on the gun bone, pointing +z from the grip at the bone: receiver and stock, a curved magazine,
// the barrel with a muzzle, and a lit rail along the top.
type Rifle = { length: number; accent: string; scope?: boolean; stock?: number };
const RIFLE: Partial<Record<UnitKind, Rifle>> = {
  assault: { length: .58, accent: CLASS_COLOR.assault! }, support: { length: .54, accent: CLASS_COLOR.support! },
  recon: { length: .74, accent: CLASS_COLOR.recon!, scope: true, stock: .2 }, tech: { length: .46, accent: CLASS_COLOR.tech! },
  guard: { length: .62, accent: '#ff5148' }, heavy: { length: .5, accent: '#ff6d5c' },
};
function rifle(k: Kit) {
  const { length, accent, scope = false, stock = .16 } = RIFLE[k.kind]!, [x, y, z] = k.bones.find(b => b.name === 'gun')!.at, dark = '#141d20', metal = '#2b3a3e';
  k.lit(dark, 'gun', profile([[-stock, -.03], [0, -.035], [.02, -.12], [.075, -.12], [.075, -.035], [length * .55, -.035], [length * .55, .045], [-.02, .055], [-stock, .025]], .075), [x, y, z])
    .lit(metal, 'gun', profile([[.1, -.035], [.17, -.035], [.19, -.17], [.12, -.18]], .05), [x, y, z])
    .lit(metal, 'gun', rod(.022, length * .5), [x, y + .015, z + length * .75])
    .lit(dark, 'gun', rod(.032, .07), [x, y + .015, z + length])
    .glow(accent, 'gun', bevelBox(.08, .022, length * .32, .006), [x, y + .058, z + length * .25]);
  if (scope) k.lit(metal, 'gun', rod(.034, .24), [x, y + .1, z + .12]).glow(accent, 'gun', ring(.03, .009, 10), [x, y + .1, z + .245]);
  return k;
}

const SQUAD: Look = { suit: '#4f7370', vest: '#3d5e5b', legs: '#253c3f', boots: '#151e20', skin: '#6f8580' };

function assault() {
  const c = CLASS_COLOR.assault!, paint = '#b4613f', k = humanoid('assault', { ...SQUAD, width: 1.12, pads: paint });
  helmet(k, '#3b5a58', c);
  // Heavy shoulder plates and a chest plate in the class color, raked outward, with lit edges.
  for (const [side, x, r] of [['armL', -.3, .3], ['armR', .3, -.3]] as const) {
    k.lit(paint, side, bevelBox(.23, .11, .32, .03), [x * 1.05, .98, 0], [0, 0, r])
      .glow(c, side, bevelBox(.22, .022, .025, .005), [x * 1.05, .98, .17], [0, 0, r]);
  }
  k.lit(paint, 'chest', bevelBox(.3, .18, .04, .012), [0, .85, .195])
    .lit('#2f4644', 'chest', bevelBox(.3, .12, .08), [0, .66, .15]);
  return rifle(k).build();
}
function support() {
  const c = CLASS_COLOR.support!, paint = '#4cc39b', k = humanoid('support', { ...SQUAD, pads: paint });
  helmet(k, '#3b5a58', c);
  // Mint armbands, and the med pack: a tall pale case with a lit cross on its back and lid.
  for (const [side, x] of [['armL', -.27], ['armR', .27]] as const) k.lit(paint, side, bevelBox(.14, .06, .14, .015), [x, .79, 0]);
  k.lit('#d5dfdb', 'chest', bevelBox(.38, .44, .22), [0, .8, -.25])
    .glow(c, 'chest', bevelBox(.24, .075, .02, .006), [0, .82, -.37]).glow(c, 'chest', bevelBox(.075, .24, .02, .006), [0, .82, -.37])
    .glow(c, 'chest', bevelBox(.18, .02, .06, .005), [0, 1.025, -.25]).glow(c, 'chest', bevelBox(.06, .02, .18, .005), [0, 1.025, -.25]);
  return rifle(k).build();
}
function recon() {
  const c = CLASS_COLOR.recon!, cloak = '#7a6a3a', k = humanoid('recon', { ...SQUAD, suit: '#3f5b55', width: .92, pads: cloak });
  // A sand hood peaked over the face, falling to a long drape down the back, and lit goggles.
  k.lit(cloak, 'head', lathe([[.16, 1.02], [.17, 1.12], [.16, 1.22], [.11, 1.3], [.03, 1.34], [0, 1.34]], 10))
    .lit(cloak, 'head', bevelBox(.22, .06, .1), [0, 1.24, .14], [.35, 0, 0])
    .lit(cloak, 'chest', bevelBox(.32, .46, .05), [0, .76, -.17], [-.1, 0, 0])
    .glow(c, 'head', bevelBox(.18, .05, .03, .008), [0, 1.13, .145]);
  return rifle(k).build();
}
function tech() {
  const c = CLASS_COLOR.tech!, pack = '#3482ad', k = humanoid('tech', { ...SQUAD, pads: pack });
  helmet(k, '#3b5a58', c);
  // The drone pack: a disc drone docked on a blue pack, four lit rotors, a whip antenna, and a wrist screen.
  k.lit(pack, 'chest', bevelBox(.32, .32, .17), [0, .8, -.23])
    .lit('#5a7674', 'chest', lathe([[0, -.03], [.22, -.03], [.24, 0], [.22, .03], [0, .045]], 12), [0, .99, -.25])
    .lit('#2c4245', 'chest', rod(.014, .7).rotateX(Math.PI / 2), [-.14, 1.3, -.29]);
  for (const [x, z] of [[-.18, -.07], [.18, -.07], [-.18, -.43], [.18, -.43]]) k.glow(c, 'chest', ring(.07, .014, 12).rotateX(Math.PI / 2), [x, 1.0, z]);
  k.glow(c, 'chest', ball(.035, 6), [-.14, 1.66, -.29])
    .glow(c, 'armL', bevelBox(.04, .06, .1, .008), [-.32, .56, .03]);
  return rifle(k).build();
}

function guard() {
  const k = humanoid('guard', { suit: '#6b3d39', vest: '#4f2f2c', legs: '#2a2224', boots: '#161214', skin: '#8a7c70' });
  // A domed helmet with a brim and a white lamp, a red beacon on the left shoulder, a radio antenna and chest pouches.
  k.lit('#3a2826', 'head', lathe([[.17, 1.09], [.18, 1.16], [.16, 1.24], [.09, 1.3], [0, 1.31]], 10))
    .lit('#3a2826', 'head', bevelBox(.3, .025, .12, .008), [0, 1.11, .15])
    .glow('#fff3cf', 'head', bevelBox(.1, .08, .06, .015), [0, 1.24, .15])
    .glow('#ff8a7a', 'head', bevelBox(.2, .05, .03, .008), [0, 1.16, .14])
    .glow('#ff3b30', 'armL', bevelBox(.09, .09, .09, .02), [-.3, 1.0, .02])
    .lit('#1d1517', 'chest', rod(.01, .36, 6).rotateX(Math.PI / 2), [-.17, 1.15, -.13]);
  for (const x of [-.11, 0, .11]) k.lit('#3a2422', 'chest', bevelBox(.09, .1, .05, .015), [x, .7, .18]);
  return rifle(k).build();
}
function heavy() {
  const k = humanoid('heavy', { suit: '#5c3532', vest: '#47302e', legs: '#1d2729', boots: '#121618', skin: '#5d6765', pads: '#4a3a3a', width: 1.2 });
  k.bone('shield', 'chest', [-.22, .7, .3]);
  // Full helmet with a face plate and a lit slit, bulky shoulder armor, and a tall riot shield carried on the left
  // with a lit viewport.
  k.lit('#3d3332', 'head', lathe([[.17, 1.0], [.19, 1.1], [.18, 1.22], [.11, 1.3], [0, 1.31]], 10))
    .lit('#2a2222', 'head', bevelBox(.24, .14, .04, .012), [0, 1.14, .16])
    .glow('#ff6d5c', 'head', bevelBox(.2, .035, .03, .006), [0, 1.17, .18]);
  for (const [side, x] of [['armL', -.34], ['armR', .34]] as const) {
    k.lit('#4a3a3a', side, lathe([[.0, -.08], [.12, -.08], [.16, .0], [.15, .08], [0, .1]], 8), [x, .94, 0])
      .lit('#4a3a3a', side, bevelBox(.18, .12, .22), [x, .78, 0]);
  }
  return rifle(shield(k)).build();
}
// The riot shield on the shield bone, its handle at the bone: a warm gray face with dark rims, a lit viewport and stripe.
function shield(k: Kit) {
  const [x, y, z] = k.bones.find(b => b.name === 'shield')!.at, at = (dx: number, dy: number, dz: number): V3 => [x + dx, y + dy, z + dz];
  return k.lit('#7d7470', 'shield', bevelBox(.48, .84, .06, .02), at(-.02, -.04, .08))
    .lit('#3a3233', 'shield', bevelBox(.52, .06, .08, .02), at(-.02, .37, .08))
    .lit('#3a3233', 'shield', bevelBox(.52, .05, .08, .02), at(-.02, -.45, .08))
    .glow('#ffb3a6', 'shield', bevelBox(.3, .05, .02, .006), at(-.02, .26, .12))
    .glow('#ff6d5c', 'shield', bevelBox(.05, .5, .02, .006), at(-.02, -.1, .12));
}
function target() {
  const gold = '#ffcf6b', trim = '#c99a45', k = humanoid('target', { suit: '#6e5040', vest: '#5a4034', legs: '#2a2421', boots: '#171312', skin: '#b0a18d', glove: '#2a1f1a', pads: '#5b4134' });
  // A long coat flaring to the knees with a painted gold hem and collar (lit gold there blooms into a halo),
  // lapels, slicked hair, gold shades, and a briefcase in the right hand.
  k.lit('#5b4134', 'hips', lathe([[.36, .22], [.31, .4], [.26, .58], [.245, .66]], 14))
    .lit(trim, 'hips', ring(.355, .022, 20).rotateX(Math.PI / 2), [0, .23, 0])
    .lit(trim, 'chest', ring(.15, .02, 14).rotateX(Math.PI / 2), [0, .99, 0])
    .glow(gold, 'chest', bevelBox(.05, .3, .02, .006), [0, .8, .19])
    .lit('#4a342a', 'chest', bevelBox(.08, .24, .03, .01), [-.08, .86, .19], [0, 0, -.25])
    .lit('#4a342a', 'chest', bevelBox(.08, .24, .03, .01), [.08, .86, .19], [0, 0, .25])
    .lit('#2a211c', 'head', bevelBox(.25, .07, .26, .03), [0, 1.26, -.01])
    .glow(gold, 'head', bevelBox(.18, .035, .03, .006), [0, 1.15, .135])
  return briefcase(k, 'armR', [.29, .47, 0]).build();
}
// A slim briefcase hanging from its handle at `at`, with a gold clasp along the top.
const briefcase = (k: Kit, bone: string, [x, y, z]: V3) => k
  .lit('#2c2420', bone, bevelBox(.09, .26, .36, .02), [x, y - .14, z])
  .glow('#ffcf6b', bone, bevelBox(.1, .035, .12, .006), [x, y, z]);
function vip() {
  const gold = '#ffe08a', k = humanoid('vip', { suit: '#2c363c', vest: '#e9e3d4', legs: '#1d2328', boots: '#111416', skin: '#c9bfae' });
  // A sharp suit: white shirt front between dark lapels, gold tie and pocket square, and a brimmed hat with a gold band.
  k.glow(gold, 'chest', bevelBox(.06, .26, .02, .006), [0, .82, .19])
    .lit('#1f272c', 'chest', bevelBox(.08, .26, .03, .01), [-.1, .84, .18], [0, 0, -.2])
    .lit('#1f272c', 'chest', bevelBox(.08, .26, .03, .01), [.1, .84, .18], [0, 0, .2])
    .glow(gold, 'chest', bevelBox(.05, .03, .02, .005), [.15, .9, .2])
    .lit('#1f272c', 'head', lathe([[0, 1.22], [.27, 1.22], [.27, 1.235], [.14, 1.24], [.13, 1.35], [0, 1.36]], 14))
    .glow(gold, 'head', ring(.135, .018, 14).rotateX(Math.PI / 2), [0, 1.26, 0]);
  return k.build();
}

function camera() {
  const k = new Kit('camera'), red = '#ff5a4a';
  k.bone('root', null, [0, 0, 0]).bone('head', 'root', [0, 1.9, 0]);
  // A pole on a footplate with a junction box and its cable; on top a pan joint and a yoke holding a tapered
  // housing under a sun hood, whose lens wears a lit ring around a red eye.
  k.lit('#3c4a4a', 'root', lathe([[.24, 0], [.24, .05], [.12, .09], [.06, .12], [0, .12]], 12))
    .lit('#5c6d6a', 'root', lathe([[.055, .1], [.04, 1.86], [0, 1.86]], 8))
    .lit('#3c4a4a', 'root', bevelBox(.13, .2, .1), [0, 1.1, -.06])
    .lit('#1c2426', 'root', rod(.012, .8).rotateX(Math.PI / 2), [.05, 1.5, -.04])
    .glow(red, 'root', bevelBox(.03, .03, .02, .006), [0, 1.16, -.005])
    .lit('#465452', 'head', bevelBox(.12, .12, .12), [0, 1.9, 0])
    .lit('#465452', 'head', bevelBox(.3, .04, .08, .012), [0, 1.95, .12])
    .lit('#465452', 'head', bevelBox(.03, .16, .1, .008), [-.14, 2.02, .16])
    .lit('#465452', 'head', bevelBox(.03, .16, .1, .008), [.14, 2.02, .16])
    .lit('#2a3436', 'head', profile([[-.16, -.1], [.18, -.11], [.24, -.07], [.24, .08], [.16, .11], [-.16, .1]], .24), [0, 2.03, .2])
    .lit('#1f282a', 'head', bevelBox(.3, .025, .46, .008), [0, 2.155, .24])
    .lit('#0c1213', 'head', rod(.075, .07, 12), [0, 2.03, .46])
    .glow(red, 'head', ring(.08, .022, 16), [0, 2.03, .48])
    .glow(red, 'head', rod(.035, .012, 10), [0, 2.03, .497])
    .glow(red, 'head', bevelBox(.04, .04, .04, .008), [.08, 2.12, .06]);
  return k.build();
}
function turret() {
  const k = new Kit('turret'), red = '#ff6d5c';
  k.bone('root', null, [0, 0, 0]).bone('head', 'root', [0, .3, 0])
    .bone('barrelL', 'head', [-.1, .46, .2]).bone('barrelR', 'head', [.1, .46, .2]).bone('laser', 'head', [0, .55, .3]);
  // A hex base plate on three splayed feet with a lit band, a narrow column that sets the head apart from the base,
  // a squat head with armored cheeks, an ammo box and a sensor eye, long twin barrels, and a laser line out front.
  k.lit('#3d4447', 'root', lathe([[.44, 0], [.46, .03], [.42, .07], [0, .07]], 6), [0, 0, 0], [0, Math.PI / 6, 0])
    .glow(red, 'root', ring(.36, .014, 24).rotateX(Math.PI / 2), [0, .075, 0])
    .lit('#4b5356', 'root', lathe([[.17, .07], [.13, .12], [.12, .22], [.17, .26], [0, .27]], 12));
  for (const a of [0, 2 * Math.PI / 3, 4 * Math.PI / 3]) k.lit('#2e3436', 'root', bevelBox(.13, .07, .28, .02), [Math.sin(a) * .42, .035, Math.cos(a) * .42], [0, a, 0]);
  k.lit('#4b3b3a', 'head', lathe([[.22, .26], [.24, .32], [.2, .35], [0, .35]], 14))
    .lit('#5a3936', 'head', profile([[-.24, 0], [.16, 0], [.26, .08], [.2, .22], [-.2, .22], [-.26, .12]], .46), [0, .34, -.02])
    .lit('#7a3f39', 'head', bevelBox(.06, .2, .36, .015), [-.25, .45, 0])
    .lit('#7a3f39', 'head', bevelBox(.06, .2, .36, .015), [.25, .45, 0])
    .lit('#2e3436', 'head', bevelBox(.12, .16, .24), [.33, .43, -.06])
    .lit('#1c2427', 'head', bevelBox(.3, .06, .05, .012), [0, .48, -.27])
    .glow(red, 'head', bevelBox(.18, .05, .03, .008), [0, .52, .17]);
  for (const side of ['barrelL', 'barrelR'] as const) {
    const x = side === 'barrelL' ? -.1 : .1;
    k.lit('#2b3a3e', side, rod(.06, .16, 10), [x, .46, .26])
      .lit('#1c2427', side, rod(.042, .6, 10), [x, .46, .48])
      .lit('#2b3a3e', side, rod(.058, .12, 10), [x, .46, .76]);
  }
  k.glow('#ff3b30', 'laser', bevelBox(.018, .018, 1, .004), [0, .55, .8]);
  return k.build();
}

const BUILDERS: Record<UnitKind, () => RigModel> = { assault, support, recon, tech, guard, heavy, camera, turret, target, vip };
const models = new Map<UnitKind, RigModel>();
export function rigModel(kind: UnitKind) {
  let m = models.get(kind);
  if (!m) { m = BUILDERS[kind](); models.set(kind, m); }
  return m;
}
// The triangles of a rig geometry bound to the given bones, or null when none are.
export function partsOn(geometry: BufferGeometry, bones: number[]) {
  const index = geometry.getAttribute('skinIndex'), keep: number[] = [];
  for (let v = 0; v < index.count; v += 3) if (bones.includes(index.getX(v))) keep.push(v, v + 1, v + 2);
  if (!keep.length) return null;
  const part = new BufferGeometry();
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    const { itemSize, normalized } = attribute, array = new (attribute.array.constructor as new (n: number) => typeof attribute.array)(keep.length * itemSize);
    keep.forEach((v, k) => { for (let c = 0; c < itemSize; c++) array[k * itemSize + c] = attribute.array[v * itemSize + c]; });
    part.setAttribute(name, new BufferAttribute(array, itemSize, normalized));
  }
  return part;
}
// Carried things on their own, for models that hold them in a hand: a unit's rifle (the grip at the origin, the muzzle
// toward +z), the heavy's shield (the handle at the origin, the face toward +z) and the target's briefcase (hanging
// from its handle at the origin).
const props = new Map<string, RigModel>();
const prop = (key: string, build: () => RigModel) => { let m = props.get(key); if (!m) props.set(key, m = build()); return m; };
export const weaponModel = (kind: UnitKind) => prop(`rifle:${kind}`, () => rifle(new Kit(kind).bone('gun', null, [0, 0, 0])).build());
export const shieldModel = () => prop('shield', () => shield(new Kit('heavy').bone('shield', null, [0, 0, 0])).build());
export const briefcaseModel = () => prop('briefcase', () => briefcase(new Kit('target').bone('case', null, [0, 0, 0]), 'case', [0, 0, 0]).build());

// One unit's live rig: its bones, the lit body, the glow, and an optional extra skin (the silhouette) on the
// same skeleton. The glow is a child of the body; an extra skin must sit at the body's world transform too.
export type Rig = { kind: UnitKind; body: SkinnedMesh; glow: SkinnedMesh | null; bones: Record<string, Bone>; rest: Vector3[]; skeleton: Skeleton };
// Bones from their specs, each placed at its rest offset from its parent; bones[0] is the root.
export function skeletonOf(specs: BoneSpec[]) {
  const bones = specs.map(spec => { const b = new Bone(); b.name = spec.name; return b; });
  const rest = specs.map((spec, i) => {
    const p = spec.parent >= 0 ? specs[spec.parent].at : [0, 0, 0];
    const v = new Vector3(spec.at[0] - p[0], spec.at[1] - p[1], spec.at[2] - p[2]);
    bones[i].position.copy(v);
    if (spec.parent >= 0) bones[spec.parent].add(bones[i]);
    return v;
  });
  return { bones, rest, skeleton: new Skeleton(bones) };
}
export function makeRig(kind: UnitKind, body: Material, glow: Material) {
  const model = rigModel(kind), { bones, rest, skeleton } = skeletonOf(model.bones), mesh = new SkinnedMesh(model.body, body);
  mesh.add(bones[0]); mesh.bind(skeleton);
  const lit = model.glow ? new SkinnedMesh(model.glow, glow) : null;
  if (lit) { lit.bind(skeleton, mesh.bindMatrix); mesh.add(lit); }
  return { kind, body: mesh, glow: lit, bones: Object.fromEntries(bones.map(b => [b.name, b])), rest, skeleton } satisfies Rig;
}
export function skin(rig: Pick<Rig, 'body' | 'skeleton'>, material: Material) {
  const mesh = new SkinnedMesh(rig.body.geometry, material);
  mesh.bind(rig.skeleton, rig.body.bindMatrix);
  return mesh;
}

// ---- Animation layers ----
// Every input is a 0..1 weight except `phase` (the walk cycle, radians) and `t` (seconds). `kickSide` says
// which of the turret's barrels fired last.
export type Motion = { t: number; walk: number; phase: number; aim: number; kick: number; kickSide: number; flinch: number; down: number; die: number };
export function animate(rig: Rig, m: Motion) {
  const { bones: b, rest } = rig;
  rig.skeleton.bones.forEach((bone, i) => { bone.position.copy(rest[i]); bone.rotation.set(0, 0, 0); bone.scale.set(1, 1, 1); });
  if (rig.kind === 'turret') {
    b.head.rotation.x = m.die * .45 + m.flinch * .12;
    b.head.rotation.y = (1 - m.aim) * Math.sin(m.t * .7) * .12;
    (m.kickSide ? b.barrelR : b.barrelL).position.z -= m.kick * .12;
    b.laser.scale.z = m.die ? .001 : .35 + m.aim * 2.6;
    return;
  }
  if (rig.kind === 'camera') {
    b.head.rotation.x = .18 + m.die * .9 + m.flinch * .2;
    b.head.rotation.z = m.flinch * Math.sin(m.t * 40) * .15;
    return;
  }
  const armed = ARMED[rig.kind], stride = Math.sin(m.phase) * .6 * m.walk, swing = armed ? .25 : 1;
  // Walk: legs and arms swing in opposition, with a bob twice per stride.
  b.legL.rotation.x = stride; b.legR.rotation.x = -stride;
  b.hips.position.y += Math.abs(Math.cos(m.phase)) * .035 * m.walk;
  b.chest.rotation.y = stride * .12;
  b.armL.rotation.x = -stride * .7 * swing; b.armR.rotation.x = stride * .7 * swing;
  if (armed) {
    // Weapon at low ready, slung across the body so it shows from any side (the heavy keeps it clear of the
    // shield), raised to the shoulder while aiming; each shot kicks it back and up.
    const lift = m.aim, across = rig.kind === 'heavy' ? 0 : 1 - lift;
    b.armR.rotation.x += -.6 - .85 * lift - m.kick * .2; b.armR.rotation.z = -.1;
    if (rig.kind === 'heavy') { b.armL.rotation.x += -.8 - .3 * lift; b.armL.rotation.z = .15; b.shield.position.z += .06 * lift - m.flinch * .08; b.shield.rotation.y = .25 * lift; }
    else { b.armL.rotation.x += -1 - .45 * lift; b.armL.rotation.z = .4 + .1 * lift; }
    b.gun.position.y += .14 * lift; b.gun.position.z += .06 * lift - m.kick * .07;
    b.gun.rotation.set(.3 * (1 - lift) - m.kick * .3, -.6 * across, .2 * across);
    b.chest.rotation.x -= m.kick * .06;
  } else if (rig.kind === 'target') b.armR.rotation.x *= .5;
  // Hit flinch: the torso snaps back and twists, the head jerks.
  b.chest.rotation.x -= m.flinch * .32; b.chest.rotation.z = m.flinch * .16; b.head.rotation.x = -m.flinch * .35;
  // Downed, the body curls on its side; dead, it sprawls on its back. Either way the arms go slack and the head lolls.
  const slump = Math.max(m.down, m.die), curl = m.down >= m.die ? 1 : .2;
  if (slump) {
    b.legL.rotation.x = b.legL.rotation.x * (1 - slump) - .95 * curl * slump; b.legR.rotation.x = b.legR.rotation.x * (1 - slump) - .45 * curl * slump;
    b.armR.rotation.x = b.armR.rotation.x * (1 - slump) - 1.1 * slump; b.armL.rotation.x = b.armL.rotation.x * (1 - slump) - .4 * slump;
    b.head.rotation.x += .45 * slump; b.chest.rotation.x += .25 * slump;
  }
}
