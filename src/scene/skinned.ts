import { Box3, BufferAttribute, Euler, Group, Matrix3, Matrix4, Mesh, Object3D, Quaternion, SkinnedMesh, Uint16BufferAttribute, Vector3 } from 'three';
import type { Bone, BufferGeometry, MeshStandardMaterial, Skeleton, Texture } from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import type { UnitKind } from '../game/simulation.ts';
import { twoBone } from './ik.ts';
import type { Machine, MachinePart, PropFile } from './models.ts';
import { animate, ARMED, briefcaseModel, partsOn, rigModel, shieldModel, skeletonOf, weaponModel } from './rigs.ts';
import type { BoneSpec, Motion, Rig, RigModel } from './rigs.ts';

// Units built from an imported, auto-rigged model with a Mixamo-named skeleton. The model is scaled to a unit's
// height, turned to face +z and stood on y = 0. The procedural rigs' animation layers drive it: the legs, spine
// and head turn by deltas in model space, the rifle and the heavy's shield ride on the chest as the procedural gun
// and shield bones do, and the arms reach for their grips (or swing at the sides) by two-bone IK. The target's
// briefcase hangs from its right hand. The rifle is the unit's imported one once that has loaded, else the procedural one.

const HEIGHT = 1.3;
const JOINTS = ['Hips', 'Spine', 'Spine2', 'Head', 'LeftUpLeg', 'LeftLeg', 'RightUpLeg', 'RightLeg', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand'] as const;
type JointName = typeof JOINTS[number];
// A joint's rest pose: its local rotation and position, and its parent's rest rotation in model space.
type Joint = { bone: Bone; q: Quaternion; p: Vector3; parent: Quaternion };
// A carried model hung off the upper spine; `rest` takes model space into the spine's, and the markers are wrist targets.
type Held = { pivot: Object3D; rest: Matrix4 };
type Prop = { body: Mesh; glow: Mesh | null; map: Texture | null };
export type ImportedRig = {
  kind: UnitKind; root: Group; body: SkinnedMesh; skeleton: Skeleton; map: Texture | null; joints: Record<JointName, Joint>;
  // Which side (±x) the right hand is on, the shoulder height, and model up in the hips' parent space (for the bob).
  side: number; shoulder: number; up: Vector3;
  gun: (Held & { grip: Object3D; fore: Object3D }) | null; shield: (Held & { handle: Object3D }) | null; briefcase: Object3D | null;
  props: Prop[];
};

const v = new Vector3(), w = new Vector3(), m4 = new Matrix4();
function skinnedMeshOf(object: Object3D) {
  let found: SkinnedMesh | null = null;
  object.traverse(o => { if (!found && (o as SkinnedMesh).isSkinnedMesh) found = o as SkinnedMesh; });
  if (!found) throw new Error('The model has no skinned mesh');
  return found as SkinnedMesh;
}
function boneOf(skeleton: Skeleton, name: string) {
  const bone = skeleton.bones.find(b => b.name.replace(/^mixamorig:?/, '') === name);
  if (!bone) throw new Error(`The model has no ${name} bone`);
  return bone;
}

// How to stand a template up: the turn that faces it +z (its toes lie ahead of its feet), the scale to the unit's
// height, and the lift that puts its lowest point on the street.
type Fit = { turn: number; scale: number; lift: number };
const fits = new WeakMap<GLTF, Fit>();
function fitOf(gltf: GLTF) {
  let fit = fits.get(gltf);
  if (fit) return fit;
  gltf.scene.updateMatrixWorld(true);
  const body = skinnedMeshOf(gltf.scene);
  const toe = boneOf(body.skeleton, 'LeftToeBase').getWorldPosition(v), foot = boneOf(body.skeleton, 'LeftFoot').getWorldPosition(w);
  const box = new Box3().setFromBufferAttribute(body.geometry.getAttribute('position') as BufferAttribute).applyMatrix4(body.matrixWorld);
  const scale = HEIGHT / (box.max.y - box.min.y);
  fit = { turn: -Math.atan2(toe.x - foot.x, toe.z - foot.z), scale, lift: -box.min.y * scale };
  fits.set(gltf, fit);
  return fit;
}

// An imported prop, scaled to the procedural prop it replaces (by length or height, see PropFile), turned so its
// long axis runs along +z when fitted by length, and moved so the point the hand holds is at the origin.
export type ImportedProp = { gltf: GLTF; file: PropFile };
type FittedProp = { geometry: BufferGeometry; map: Texture | null; scale: number };
const fittedProps = new WeakMap<GLTF, FittedProp>();
function fitProp({ gltf, file }: ImportedProp, procedural: RigModel) {
  let fitted = fittedProps.get(gltf);
  if (fitted) return fitted;
  let mesh: Mesh | null = null;
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(o => { if (!mesh && (o as Mesh).isMesh) mesh = o as Mesh; });
  if (!mesh) throw new Error(`${file.url} has no mesh`);
  const { geometry: source, material, matrixWorld } = mesh as Mesh, geometry = source.clone().applyMatrix4(matrixWorld);
  geometry.computeBoundingBox();
  const want = procedural.body.boundingBox!, box = geometry.boundingBox!, byLength = file.fit === 'length';
  const scale = byLength ? (want.max.z - want.min.z) / (box.max.x - box.min.x) : (want.max.y - want.min.y) / (box.max.y - box.min.y);
  geometry.translate(-file.hold[0], -file.hold[1], -file.hold[2]).scale(scale, scale, scale);
  if (byLength) geometry.rotateY(-Math.PI / 2);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  fitted = { geometry, map: (material as MeshStandardMaterial).map ?? null, scale };
  fittedProps.set(gltf, fitted);
  return fitted;
}
// The props a unit carries, each its imported model once that has loaded.
export type Carried = { weapon: ImportedProp | null; shield: ImportedProp | null; briefcase: ImportedProp | null };

export function importRig(kind: UnitKind, gltf: GLTF, carried: Carried): ImportedRig {
  const fit = fitOf(gltf), scene = clone(gltf.scene), wrap = new Group(), root = new Group();
  wrap.rotation.y = fit.turn; wrap.scale.setScalar(fit.scale); wrap.position.y = fit.lift;
  wrap.add(scene); root.add(wrap); root.updateMatrixWorld(true);
  const body = skinnedMeshOf(scene);
  // The skinned bounds follow the bind pose, not the animated one.
  body.frustumCulled = false;
  const joints = Object.fromEntries(JOINTS.map(name => {
    const bone = boneOf(body.skeleton, name);
    return [name, { bone, q: bone.quaternion.clone(), p: bone.position.clone(), parent: bone.parent!.getWorldQuaternion(new Quaternion()) }];
  })) as Record<JointName, Joint>;
  const shoulder = joints.RightArm.bone.getWorldPosition(v), side = Math.sign(shoulder.x) || -1;
  const up = new Vector3(0, 1, 0).applyMatrix3(new Matrix3().setFromMatrix4(m4.copy(joints.Hips.bone.parent!.matrixWorld).invert()));
  const props: Prop[] = [], spine = joints.Spine2.bone;
  const dress = (parent: Object3D, model: Pick<RigModel, 'body' | 'glow'>, map: Texture | null, ...markers: Object3D[]) => {
    const prop = { body: new Mesh(model.body), glow: model.glow ? new Mesh(model.glow) : null, map };
    parent.add(prop.body, ...markers); if (prop.glow) parent.add(prop.glow);
    props.push(prop);
  };
  const hold = (model: Pick<RigModel, 'body' | 'glow'>, map: Texture | null, ...markers: Object3D[]): Held => {
    const pivot = new Object3D();
    pivot.matrixAutoUpdate = false; spine.add(pivot); dress(pivot, model, map, ...markers);
    return { pivot, rest: new Matrix4().copy(spine.matrixWorld).invert() };
  };
  const marker = (x: number, y: number, z: number) => { const o = new Object3D(); o.position.set(x, y, z); return o; };
  // A prop's imported model when there is one, else the procedural one.
  const pick = (imported: ImportedProp | null, procedural: RigModel) => {
    const fitted = imported ? fitProp(imported, procedural) : null;
    return { model: fitted ? { body: fitted.geometry, glow: null } : procedural, map: fitted?.map ?? null, fitted };
  };
  let gun: ImportedRig['gun'] = null, shield: ImportedRig['shield'] = null, briefcase: Object3D | null = null;
  if (ARMED[kind]) {
    // Wrist targets: behind and below the pistol grip, and under the handguard.
    const procedural = weaponModel(kind), { model, map, fitted } = pick(carried.weapon, procedural), grip = marker(0, -.09, -.02);
    const [fx, fy] = carried.weapon?.file.fore ?? [0, 0], [hx, hy] = carried.weapon?.file.hold ?? [0, 0];
    const fore = fitted ? marker(0, (fy - hy) * fitted.scale - .04, (fx - hx) * fitted.scale - .06) : marker(0, -.08, procedural.body.boundingBox!.max.z * .42 - .06);
    gun = { ...hold(model, map, grip, fore), grip, fore };
  }
  if (kind === 'heavy') {
    const { model, map } = pick(carried.shield, shieldModel()), handle = marker(0, -.05, -.05);
    shield = { ...hold(model, map, handle), handle };
  }
  if (kind === 'target') {
    const { model, map } = pick(carried.briefcase, briefcaseModel());
    briefcase = new Object3D(); root.add(briefcase); dress(briefcase, model, map);
  }
  return { kind, root, body, skeleton: body.skeleton, map: (body.material as MeshStandardMaterial).map ?? null, joints, side, shoulder: shoulder.y, up, gun, shield, briefcase, props };
}

const delta = new Quaternion(), euler = new Euler(), heldAt = new Matrix4(), heldQ = new Quaternion(), ONE = new Vector3(1, 1, 1);
// Turns a joint by a rotation given in model space, about its own pivot, on top of its rest pose.
function turn(j: Joint, x: number, y = 0, z = 0) {
  delta.setFromEuler(euler.set(x, y, z));
  j.bone.quaternion.copy(j.parent).invert().multiply(delta).multiply(j.parent).multiply(j.q);
}
const from = new Vector3(), to = new Vector3(), at = new Vector3(), swing = new Quaternion(), own = new Quaternion(), parent = new Quaternion();
// Places a carried model in model space, as if the torso were at rest; it then follows the spine.
function place(held: Held, x: number, y: number, z: number, rx: number, ry: number, rz: number) {
  heldQ.setFromEuler(euler.set(rx, ry, rz));
  held.pivot.matrix.multiplyMatrices(held.rest, heldAt.compose(v.set(x, y, z), heldQ, ONE));
  held.pivot.matrixWorldNeedsUpdate = true;
}
// Rotates a bone about its pivot so the point `a` (world) moves to `b`.
function point(bone: Bone, a: Vector3, b: Vector3) {
  bone.getWorldPosition(at);
  swing.setFromUnitVectors(from.subVectors(a, at).normalize(), to.subVectors(b, at).normalize());
  bone.getWorldQuaternion(own).premultiply(swing);
  bone.quaternion.copy(bone.parent!.getWorldQuaternion(parent).invert().multiply(own));
  bone.updateWorldMatrix(false, true);
}
const shoulderAt = new Vector3(), elbowAt = new Vector3(), handAt = new Vector3(), pole = new Vector3(), elbow = new Vector3(), hand = new Vector3();
function reach(arm: Joint, fore: Joint, wrist: Joint, target: Vector3, bendTo: Vector3) {
  arm.bone.getWorldPosition(shoulderAt); fore.bone.getWorldPosition(elbowAt); wrist.bone.getWorldPosition(handAt);
  twoBone(shoulderAt, target, shoulderAt.distanceTo(elbowAt), elbowAt.distanceTo(handAt), pole.copy(shoulderAt).add(bendTo), elbow, hand);
  point(arm.bone, elbowAt, elbow);
  point(fore.bone, wrist.bone.getWorldPosition(handAt), hand);
}

const right = new Vector3(), left = new Vector3(), slack = new Vector3(), bend = new Vector3(), rootQ = new Quaternion();
export function animateImported(rig: ImportedRig, m: Motion) {
  const { joints: j, side: s, gun, shield, briefcase } = rig;
  for (const name of JOINTS) { j[name].bone.quaternion.copy(j[name].q); j[name].bone.position.copy(j[name].p); }
  // Walk: legs swing in opposition and the knees fold on the forward swing, with a bob twice per stride. Downed,
  // the body curls; dead, it sprawls (the fall itself is the whole model's, in units.tsx).
  const stride = Math.sin(m.phase) * .6 * m.walk, slump = Math.max(m.down, m.die), curl = m.down >= m.die ? 1 : .2, stand = 1 - slump;
  turn(j.LeftUpLeg, stride * stand - .95 * curl * slump);
  turn(j.RightUpLeg, -stride * stand - .45 * curl * slump);
  turn(j.LeftLeg, Math.max(0, -Math.cos(m.phase)) * .8 * m.walk * stand + 1.1 * curl * slump);
  turn(j.RightLeg, Math.max(0, Math.cos(m.phase)) * .8 * m.walk * stand + .6 * curl * slump);
  j.Hips.bone.position.addScaledVector(rig.up, Math.abs(Math.cos(m.phase)) * .035 * m.walk);
  // Hit flinch snaps the torso back and twists it, each shot rocks it, and the head jerks or lolls.
  turn(j.Spine, -m.flinch * .32 - m.kick * .06 + .25 * slump, stride * .12, m.flinch * .16);
  turn(j.Head, -m.flinch * .35 + .45 * slump);
  // The rifle at low ready across the body (straight ahead beside the heavy's shield), raised to the shoulder while
  // aiming; each shot kicks it back and up. The shield comes forward and angles across while aiming, and a hit
  // knocks it back.
  const lift = m.aim, across = shield ? 0 : 1 - lift;
  if (gun) place(gun, s * .1, rig.shoulder - .18 + .14 * lift, .16 + .06 * lift - m.kick * .07, .3 * (1 - lift) - m.kick * .3, -s * .6 * across, s * .2 * across);
  if (shield) place(shield, -s * .22, rig.shoulder - .22, .3 + .06 * lift - m.flinch * .08, 0, s * .25 * lift, 0);
  rig.root.updateMatrixWorld(true);
  rig.root.getWorldQuaternion(rootQ);
  const world = (x: number, y: number, z: number, out: Vector3) => out.set(x, y, z).applyMatrix4(rig.root.matrixWorld);
  // Hands: on the rifle's grips and the shield's handle, or swinging at the sides against the legs (the briefcase
  // hand less); they go slack at the sides when down.
  if (gun) gun.grip.getWorldPosition(right);
  else world(s * (briefcase ? .33 : .3), rig.shoulder - .5, -stride * (briefcase ? .12 : .25), right);
  if (shield) shield.handle.getWorldPosition(left);
  else if (gun) gun.fore.getWorldPosition(left);
  else world(-s * .3, rig.shoulder - .5, stride * .25, left);
  if (slump) { right.lerp(world(s * .32, rig.shoulder - .5, .08, slack), slump); left.lerp(world(-s * .32, rig.shoulder - .5, .08, slack), slump); }
  // Elbows bend down, out and back.
  reach(j.RightArm, j.RightForeArm, j.RightHand, right, bend.set(s * .5, -1, -.3).applyQuaternion(rootQ));
  reach(j.LeftArm, j.LeftForeArm, j.LeftHand, left, bend.set(-s * .5, -1, -.3).applyQuaternion(rootQ));
  // The briefcase's handle sits in the right palm, just below the wrist.
  if (briefcase) briefcase.position.copy(rig.root.worldToLocal(j.RightHand.bone.getWorldPosition(v))).y -= .07;
}

// ---- Machines ----
// The turret and camera keep their procedural skeleton and animation (animate in rigs.ts). Their imported parts are
// bound rigidly to its bones in place of the procedural ones: the turret's base to the root and its head, barrels
// included, to the head bone; the camera's head to its head bone. The head bone moves to the imported head's bearing,
// and the turret's laser to its muzzle. What has no imported part stays procedural: the laser line and the camera's
// pole. With the barrels fused into the head, a shot kicks the whole head back.
export type ImportedMachine = { machine: Machine; base: GLTF | null; head: GLTF };
export type MachineRig = Rig & { root: Group; skins: SkinnedMesh[]; paints: { mesh: SkinnedMesh; map: Texture | null; glow: boolean }[] };

const placedParts = new WeakMap<GLTF, BufferGeometry>(), leftovers = new Map<string, { lit: BufferGeometry | null; glow: BufferGeometry | null }>();
// A part's geometry in model space, its `at` point on the bone at `to`, every vertex bound to `bone`.
function placePart(gltf: GLTF, part: MachinePart, to: Vector3, bone: number) {
  let geometry = placedParts.get(gltf);
  if (geometry) return geometry;
  let mesh: Mesh | null = null;
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(o => { if (!mesh && (o as Mesh).isMesh) mesh = o as Mesh; });
  if (!mesh) throw new Error(`${part.url} has no mesh`);
  const { geometry: source, matrixWorld } = mesh as Mesh, [x, y, z] = part.at;
  geometry = source.clone().applyMatrix4(matrixWorld).translate(-x, -y, -z).scale(part.scale, part.scale, part.scale).translate(to.x, to.y, to.z);
  const n = geometry.getAttribute('position').count, index = new Uint16Array(n * 4), weight = new Float32Array(n * 4);
  for (let k = 0; k < n; k++) { index[k * 4] = bone; weight[k * 4] = 1; }
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(index, 4));
  geometry.setAttribute('skinWeight', new BufferAttribute(weight, 4));
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  placedParts.set(gltf, geometry);
  return geometry;
}

export function importMachine(kind: UnitKind, { machine, base, head }: ImportedMachine): MachineRig {
  const model = rigModel(kind), specs: BoneSpec[] = model.bones.map(b => ({ ...b, at: [...b.at] }));
  const index = (name: string) => specs.findIndex(b => b.name === name), h = index('head'), laser = index('laser');
  const pivot = new Vector3(0, machine.pivot, 0);
  specs[h].at = [0, machine.pivot, 0];
  if (laser >= 0 && machine.head.muzzle) {
    const [mx, my, mz] = machine.head.muzzle, [ax, ay, az] = machine.head.at, s = machine.head.scale;
    specs[laser].at = [(mx - ax) * s, machine.pivot + (my - ay) * s, (mz - az) * s];
  }
  const { bones, rest, skeleton } = skeletonOf(specs), root = new Group();
  root.add(bones[0]); root.updateMatrixWorld(true); skeleton.calculateInverses();
  const paints: MachineRig['paints'] = [], identity = new Matrix4();
  const skinned = (geometry: BufferGeometry, map: Texture | null, glow = false) => {
    const mesh = new SkinnedMesh(geometry);
    mesh.bind(skeleton, identity); mesh.frustumCulled = false; root.add(mesh);
    paints.push({ mesh, map, glow });
    return mesh;
  };
  const textureOf = (gltf: GLTF) => { let map: Texture | null = null; gltf.scene.traverse(o => { map ??= ((o as Mesh).material as MeshStandardMaterial | undefined)?.map ?? null; }); return map; };
  const skins: SkinnedMesh[] = [];
  if (base && machine.base) skins.push(skinned(placePart(base, machine.base, new Vector3(), 0), textureOf(base)));
  skins.push(skinned(placePart(head, machine.head, pivot, h), textureOf(head)));
  // The procedural parts left: those on bones no imported part covers, moved with their bone if it moved.
  const covered = ['head', 'barrelL', 'barrelR', ...(base ? ['root'] : [])], keep = specs.map((b, i) => i).filter(i => !covered.includes(specs[i].name));
  const leftover = (geometry: BufferGeometry | null) => {
    const part = geometry && partsOn(geometry, keep);
    if (!part) return null;
    const position = part.getAttribute('position'), bone = part.getAttribute('skinIndex');
    for (let v = 0; v < position.count; v++) {
      const b = bone.getX(v), from = model.bones[b].at, to = specs[b].at;
      position.setXYZ(v, position.getX(v) + to[0] - from[0], position.getY(v) + to[1] - from[1], position.getZ(v) + to[2] - from[2]);
    }
    part.computeBoundingBox(); part.computeBoundingSphere();
    return part;
  };
  const key = `${kind}:${base ? 'base' : ''}`;
  let left = leftovers.get(key);
  if (!left) leftovers.set(key, left = { lit: leftover(model.body), glow: leftover(model.glow) });
  const { lit, glow } = left;
  if (lit) skins.push(skinned(lit, null));
  const glowMesh = glow ? skinned(glow, null, true) : null;
  return { kind, root, body: skins[0], glow: glowMesh, bones: Object.fromEntries(bones.map(b => [b.name, b])), rest, skeleton, skins, paints };
}
export function animateMachine(rig: MachineRig, m: Motion) {
  animate(rig, m);
  if (rig.kind === 'turret') rig.bones.head.position.z -= m.kick * .05;
}
