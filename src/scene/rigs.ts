import { Bone, BufferAttribute, Color, CylinderGeometry, Euler, ExtrudeGeometry, LatheGeometry, Matrix4, Quaternion, Shape, Skeleton, SkinnedMesh, TorusGeometry, Uint16BufferAttribute, Vector2, Vector3 } from 'three';
import type { BufferGeometry, Material } from 'three';
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
const ARMED: Record<UnitKind, boolean> = { assault: true, support: true, recon: true, tech: true, guard: true, heavy: true, camera: false, turret: false, target: false, vip: false };

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
type Look = { suit: string; vest: string; legs: string; boots: string; skin: string; glove?: string; width?: number };
// The shared body: hips carry the legs and the waist-hinged chest, which carries the head and the arms. Arms
// hang from the shoulders in the bind pose; the pose code lifts them onto the weapon.
function humanoid(kind: UnitKind, look: Look) {
  const k = new Kit(kind), w = look.width ?? 1, sx = .27 * w, glove = look.glove ?? '#1b2427';
  k.bone('root', null, [0, 0, 0]).bone('hips', 'root', [0, .58, 0])
    .bone('legL', 'hips', [-.11, .58, 0]).bone('legR', 'hips', [.11, .58, 0])
    .bone('chest', 'hips', [0, .6, 0]).bone('head', 'chest', [0, .98, 0])
    .bone('armL', 'chest', [-sx, .92, 0]).bone('armR', 'chest', [sx, .92, 0]);
  if (ARMED[kind]) k.bone('gun', 'chest', [.1, .74, .16]);
  k.lit(look.legs, 'hips', bevelBox(.34 * w, .16, .24), [0, .6, 0]);
  for (const [side, x] of [['legL', -.11], ['legR', .11]] as const) {
    k.lit(look.legs, side, bevelBox(.15, .3, .19), [x, .43, 0])
      .lit(look.legs, side, bevelBox(.13, .26, .17), [x, .18, 0])
      .lit(look.boots, side, bevelBox(.15, .09, .27), [x, .045, .04]);
  }
  k.lit(look.suit, 'chest', lathe([[.17 * w, .64], [.2 * w, .72], [.24 * w, .86], [.23 * w, .96], [.1, .99], [0, .99]], 10), [0, 0, 0])
    .lit(look.vest, 'chest', bevelBox(.36 * w, .24, .07), [0, .8, .14])
    .lit(look.skin, 'head', bevelBox(.08, .06, .08), [0, 1.0, 0])
    .lit(look.skin, 'head', bevelBox(.23, .25, .25, .07), [0, 1.13, .01]);
  for (const [side, x] of [['armL', -sx], ['armR', sx]] as const) {
    k.lit(look.suit, side, bevelBox(.12, .24, .14), [x, .8, 0])
      .lit(look.suit, side, bevelBox(.1, .2, .12), [x, .6, 0])
      .lit(glove, side, bevelBox(.1, .09, .11), [x, .47, .01]);
  }
  return k;
}
// A long gun on the gun bone, pointing +z from the grip at the bone.
function rifle(k: Kit, length: number, accent: string, { scope = false, stock = .16 } = {}) {
  const [x, y, z] = k.bones.find(b => b.name === 'gun')!.at, dark = '#141d20', metal = '#2b3a3e';
  k.lit(dark, 'gun', profile([[-stock, -.02], [0, -.03], [.02, -.11], [.07, -.11], [.07, -.03], [length * .55, -.03], [length * .55, .04], [-.02, .05], [-stock, .02]], .06), [x, y, z])
    .lit(metal, 'gun', rod(.018, length * .5), [x, y + .015, z + length * .75])
    .glow(accent, 'gun', bevelBox(.065, .015, length * .3, .004), [x, y + .05, z + length * .25]);
  if (scope) k.lit(metal, 'gun', rod(.028, .2), [x, y + .085, z + .12]);
  return k;
}

const SQUAD: Look = { suit: '#466766', vest: '#3a5856', legs: '#22383b', boots: '#151e20', skin: '#697e7a' };

function assault() {
  const c = CLASS_COLOR.assault!, k = humanoid('assault', { ...SQUAD, width: 1.12 });
  k.lit('#3b5a58', 'head', lathe([[.15, 1.1], [.16, 1.18], [.13, 1.26], [.06, 1.29], [0, 1.29]], 10))
    .glow(c, 'head', bevelBox(.2, .045, .03, .008), [0, 1.16, .14]);
  // Heavy shoulder plates, raked outward, with a lit edge.
  for (const [side, x, r] of [['armL', -.3, .3], ['armR', .3, -.3]] as const) {
    k.lit('#5b7a76', side, bevelBox(.2, .1, .3, .03), [x * 1.04, .97, 0], [0, 0, r])
      .glow(c, side, bevelBox(.2, .015, .02, .004), [x * 1.04, .97, .16], [0, 0, r]);
  }
  k.lit('#2f4644', 'chest', bevelBox(.3, .12, .08), [0, .66, .15]);
  return rifle(k, .62, c).build();
}
function support() {
  const c = CLASS_COLOR.support!, k = humanoid('support', SQUAD);
  k.lit('#3b5a58', 'head', lathe([[.15, 1.1], [.16, 1.18], [.13, 1.26], [.06, 1.29], [0, 1.29]], 10))
    .glow(c, 'head', bevelBox(.2, .045, .03, .008), [0, 1.16, .14])
    // The med pack: a tall pale case with a lit cross on its back and lid.
    .lit('#d5dfdb', 'chest', bevelBox(.36, .42, .2), [0, .8, -.24])
    .glow(c, 'chest', bevelBox(.2, .06, .02, .005), [0, .82, -.35]).glow(c, 'chest', bevelBox(.06, .2, .02, .005), [0, .82, -.35])
    .glow(c, 'chest', bevelBox(.16, .02, .05, .005), [0, 1.015, -.24]).glow(c, 'chest', bevelBox(.05, .02, .16, .005), [0, 1.015, -.24]);
  return rifle(k, .58, c).build();
}
function recon() {
  const c = CLASS_COLOR.recon!, k = humanoid('recon', { ...SQUAD, suit: '#3f5b55', width: .92 });
  // A hood peaked over the face, falling to a drape between the shoulders.
  k.lit('#33504b', 'head', lathe([[.16, 1.02], [.17, 1.12], [.16, 1.22], [.11, 1.3], [.03, 1.33], [0, 1.33]], 10))
    .lit('#33504b', 'head', bevelBox(.22, .06, .1), [0, 1.24, .14], [.35, 0, 0])
    .lit('#33504b', 'chest', bevelBox(.3, .3, .06), [0, .84, -.16], [-.12, 0, 0])
    .glow(c, 'head', bevelBox(.17, .035, .03, .006), [0, 1.13, .145]);
  return rifle(k, .74, c, { scope: true, stock: .2 }).build();
}
function tech() {
  const c = CLASS_COLOR.tech!, k = humanoid('tech', SQUAD);
  k.lit('#3b5a58', 'head', lathe([[.15, 1.1], [.16, 1.18], [.13, 1.26], [.06, 1.29], [0, 1.29]], 10))
    .glow(c, 'head', bevelBox(.2, .045, .03, .008), [0, 1.16, .14])
    // The drone pack: a disc drone docked on the back, four lit rotors, and a whip antenna.
    .lit('#2c4245', 'chest', bevelBox(.3, .3, .16), [0, .8, -.22])
    .lit('#4e6967', 'chest', lathe([[.0, -.03], [.2, -.03], [.22, 0], [.2, .03], [0, .04]], 12), [0, .98, -.24])
    .lit('#2c4245', 'chest', rod(.012, .64).rotateX(Math.PI / 2), [-.13, 1.28, -.28]);
  for (const [x, z] of [[-.16, -.08], [.16, -.08], [-.16, -.4], [.16, -.4]]) k.glow(c, 'chest', ring(.065, .01, 12).rotateX(Math.PI / 2), [x, 1.0, z]);
  k.glow(c, 'chest', bevelBox(.05, .05, .05, .01), [-.13, 1.61, -.28]);
  return rifle(k, .46, c).build();
}

function guard() {
  const k = humanoid('guard', { suit: '#6b3d39', vest: '#4f2f2c', legs: '#2a2224', boots: '#161214', skin: '#8a7c70' });
  // A domed helmet with a white lamp, and a red light on the left shoulder.
  k.lit('#3a2826', 'head', lathe([[.17, 1.09], [.18, 1.16], [.16, 1.24], [.09, 1.3], [0, 1.31]], 10))
    .lit('#3a2826', 'head', bevelBox(.3, .025, .1, .008), [0, 1.11, .15])
    .glow('#fff3cf', 'head', bevelBox(.08, .06, .05, .01), [0, 1.24, .15])
    .glow('#ff8a7a', 'head', bevelBox(.18, .035, .03, .006), [0, 1.15, .14])
    .glow('#ff3b30', 'armL', bevelBox(.07, .07, .07, .015), [-.3, .99, .02]);
  return rifle(k, .62, '#ff5148').build();
}
function heavy() {
  const k = humanoid('heavy', { suit: '#5c3532', vest: '#47302e', legs: '#1d2729', boots: '#121618', skin: '#5d6765', width: 1.2 });
  k.bone('shield', 'chest', [-.22, .7, .3]);
  // Full helmet with a lit slit, bulky shoulder armor, and a tall riot shield carried on the left.
  k.lit('#3d3332', 'head', lathe([[.17, 1.0], [.19, 1.1], [.18, 1.22], [.11, 1.3], [0, 1.31]], 10))
    .glow('#ff6d5c', 'head', bevelBox(.2, .03, .03, .006), [0, 1.17, .17]);
  for (const [side, x] of [['armL', -.34], ['armR', .34]] as const) {
    k.lit('#4a3a3a', side, lathe([[.0, .1], [.15, .08], [.16, .0], [.12, -.08], [0, -.08]], 8), [x, .94, 0])
      .lit('#4a3a3a', side, bevelBox(.18, .12, .22), [x, .78, 0]);
  }
  k.lit('#7d7470', 'shield', bevelBox(.46, .8, .06, .02), [-.24, .66, .38])
    .lit('#3a3233', 'shield', bevelBox(.5, .06, .08, .02), [-.24, 1.05, .38])
    .glow('#ff6d5c', 'shield', bevelBox(.28, .05, .02, .006), [-.24, .92, .42])
    .glow('#ff6d5c', 'shield', bevelBox(.04, .5, .02, .006), [-.24, .6, .42]);
  return rifle(k, .5, '#ff6d5c').build();
}
function target() {
  const gold = '#ffcf6b', k = humanoid('target', { suit: '#6e5040', vest: '#5a4034', legs: '#2a2421', boots: '#171312', skin: '#b0a18d', glove: '#2a1f1a' });
  // A long coat flaring to the knees with a gold hem and collar, slicked hair, and a briefcase in the right hand.
  k.lit('#5b4134', 'hips', lathe([[.33, .24], [.29, .4], [.25, .58], [.24, .66]], 14))
    .glow(gold, 'hips', ring(.325, .014, 20).rotateX(Math.PI / 2), [0, .25, 0])
    .glow(gold, 'chest', ring(.15, .014, 14).rotateX(Math.PI / 2), [0, .99, 0])
    .glow(gold, 'chest', bevelBox(.04, .3, .02, .005), [0, .8, .18])
    .lit('#2a211c', 'head', bevelBox(.25, .07, .26, .03), [0, 1.26, -.01])
    .lit('#2c2420', 'armR', bevelBox(.08, .23, .32, .02), [.29, .34, 0])
    .glow(gold, 'armR', bevelBox(.09, .03, .1, .006), [.29, .46, 0]);
  return k.build();
}
function vip() {
  const gold = '#ffe08a', k = humanoid('vip', { suit: '#2c363c', vest: '#e9e3d4', legs: '#1d2328', boots: '#111416', skin: '#c9bfae' });
  // A sharp suit: white shirt front, gold tie, and a brimmed hat with a gold band.
  k.glow(gold, 'chest', bevelBox(.05, .26, .02, .006), [0, .82, .185])
    .lit('#1f272c', 'head', lathe([[0, 1.22], [.25, 1.22], [.25, 1.235], [.14, 1.24], [.13, 1.35], [0, 1.36]], 14))
    .glow(gold, 'head', ring(.135, .012, 14).rotateX(Math.PI / 2), [0, 1.26, 0]);
  return k.build();
}

function camera() {
  const k = new Kit('camera'), red = '#ff5a4a';
  k.bone('root', null, [0, 0, 0]).bone('head', 'root', [0, 1.9, 0]);
  // Pole on a footplate, a mount arm out front, and a housing whose lens wears a lit ring.
  k.lit('#3c4a4a', 'root', lathe([[.24, 0], [.24, .05], [.12, .09], [.06, .12], [0, .12]], 12))
    .lit('#5c6d6a', 'root', lathe([[.05, .1], [.045, 1.86], [0, 1.86]], 8))
    .lit('#465452', 'head', bevelBox(.12, .14, .12), [0, 1.9, 0])
    .lit('#465452', 'head', bevelBox(.08, .08, .2), [0, 1.98, .08])
    .lit('#2a3436', 'head', bevelBox(.24, .2, .38, .04), [0, 2.03, .2])
    .lit('#1f282a', 'head', bevelBox(.3, .03, .44, .01), [0, 2.145, .22])
    .lit('#0c1213', 'head', rod(.07, .06, 12), [0, 2.03, .41])
    .glow(red, 'head', ring(.075, .016, 16), [0, 2.03, .43])
    .glow(red, 'head', bevelBox(.04, .04, .04, .008), [.08, 2.11, .02]);
  return k.build();
}
function turret() {
  const k = new Kit('turret'), red = '#ff6d5c';
  k.bone('root', null, [0, 0, 0]).bone('head', 'root', [0, .3, 0])
    .bone('barrelL', 'head', [-.09, .46, .2]).bone('barrelR', 'head', [.09, .46, .2]).bone('laser', 'head', [0, .55, .3]);
  // A stepped base ring with a lit band, a squat head on a collar, twin barrels, and a laser line out front.
  k.lit('#3d4447', 'root', lathe([[.5, 0], [.52, .05], [.47, .13], [.36, .17], [.3, .27], [0, .27]], 18))
    .glow(red, 'root', ring(.495, .014, 24).rotateX(Math.PI / 2), [0, .09, 0])
    .lit('#4b3b3a', 'head', lathe([[.22, .26], [.24, .32], [.2, .35], [0, .35]], 14))
    .lit('#5a3936', 'head', profile([[-.24, 0], [.18, 0], [.26, .08], [.2, .22], [-.2, .22], [-.26, .12]], .48), [0, .34, -.02])
    .lit('#2e3436', 'head', bevelBox(.12, .16, .24), [.29, .43, -.06])
    .glow(red, 'head', bevelBox(.18, .04, .02, .006), [0, .5, .19]);
  for (const side of ['barrelL', 'barrelR'] as const) {
    const x = side === 'barrelL' ? -.09 : .09;
    k.lit('#1c2427', side, rod(.04, .5, 10), [x, .46, .44]).lit('#2b3a3e', side, rod(.052, .1, 10), [x, .46, .67]);
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

// One unit's live rig: its bones, the lit body, the glow, and an optional extra skin (the silhouette) on the
// same skeleton. The glow is a child of the body; an extra skin must sit at the body's world transform too.
export type Rig = { kind: UnitKind; body: SkinnedMesh; glow: SkinnedMesh | null; bones: Record<string, Bone>; rest: Vector3[]; skeleton: Skeleton };
export function makeRig(kind: UnitKind, body: Material, glow: Material) {
  const model = rigModel(kind);
  const bones = model.bones.map(spec => { const b = new Bone(); b.name = spec.name; return b; });
  const rest = model.bones.map((spec, i) => {
    const p = spec.parent >= 0 ? model.bones[spec.parent].at : [0, 0, 0];
    const v = new Vector3(spec.at[0] - p[0], spec.at[1] - p[1], spec.at[2] - p[2]);
    bones[i].position.copy(v);
    if (spec.parent >= 0) bones[spec.parent].add(bones[i]);
    return v;
  });
  const skeleton = new Skeleton(bones), mesh = new SkinnedMesh(model.body, body);
  mesh.add(bones[0]); mesh.bind(skeleton);
  const lit = model.glow ? new SkinnedMesh(model.glow, glow) : null;
  if (lit) { lit.bind(skeleton, mesh.bindMatrix); mesh.add(lit); }
  return { kind, body: mesh, glow: lit, bones: Object.fromEntries(bones.map(b => [b.name, b])), rest, skeleton } satisfies Rig;
}
export function skin(rig: Rig, material: Material) {
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
    // Weapon at low ready, raised to the shoulder while aiming; each shot kicks it back and up.
    const lift = m.aim;
    b.armR.rotation.x += -.6 - .85 * lift - m.kick * .2; b.armR.rotation.z = -.1;
    if (rig.kind === 'heavy') { b.armL.rotation.x += -.8 - .3 * lift; b.armL.rotation.z = .15; b.shield.position.z += .06 * lift - m.flinch * .08; b.shield.rotation.y = .25 * lift; }
    else { b.armL.rotation.x += -1 - .45 * lift; b.armL.rotation.z = .4 + .1 * lift; }
    b.gun.position.y += .14 * lift; b.gun.position.z += .06 * lift - m.kick * .07;
    b.gun.rotation.x = .4 * (1 - lift) - m.kick * .3;
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
