import { Box3, Euler, Group, Matrix3, Matrix4, Mesh, Object3D, Quaternion, Vector3 } from 'three';
import type { Bone, BufferAttribute, MeshStandardMaterial, Skeleton, SkinnedMesh, Texture } from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import type { UnitKind } from '../game/simulation.ts';
import { twoBone } from './ik.ts';
import { ARMED, weaponModel } from './rigs.ts';
import type { Motion } from './rigs.ts';

// Units built from an imported, auto-rigged model with a Mixamo-named skeleton. The model is scaled to a unit's
// height, turned to face +z and stood on y = 0. The procedural rigs' animation layers drive it: the legs, spine
// and head turn by deltas in model space, the rifle rides on the chest as the procedural gun bone does, and the
// arms reach for its grips (or swing at the sides) by two-bone IK.

const HEIGHT = 1.3;
const JOINTS = ['Hips', 'Spine', 'Spine2', 'Head', 'LeftUpLeg', 'LeftLeg', 'RightUpLeg', 'RightLeg', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand'] as const;
type JointName = typeof JOINTS[number];
// A joint's rest pose: its local rotation and position, and its parent's rest rotation in model space.
type Joint = { bone: Bone; q: Quaternion; p: Vector3; parent: Quaternion };
type Gun = { pivot: Object3D; rest: Matrix4; body: Mesh; glow: Mesh | null; grip: Object3D; fore: Object3D };
export type ImportedRig = {
  kind: UnitKind; root: Group; body: SkinnedMesh; skeleton: Skeleton; map: Texture | null; joints: Record<JointName, Joint>;
  // Which side (±x) the right hand is on, the shoulder height, and model up in the hips' parent space (for the bob).
  side: number; shoulder: number; up: Vector3; gun: Gun | null;
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

export function importRig(kind: UnitKind, gltf: GLTF): ImportedRig {
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
  let gun: Gun | null = null;
  if (ARMED[kind]) {
    // The rifle hangs off the upper spine, so it follows the torso; `rest` takes model space into the spine's.
    const model = weaponModel(kind), pivot = new Object3D(), grip = new Object3D(), fore = new Object3D();
    const body = new Mesh(model.body), glow = model.glow ? new Mesh(model.glow) : null;
    // Wrist targets: behind and below the pistol grip, and under the handguard.
    grip.position.set(0, -.09, -.02); fore.position.set(0, -.08, model.body.boundingBox!.max.z * .42 - .06);
    pivot.matrixAutoUpdate = false;
    pivot.add(body, grip, fore); if (glow) pivot.add(glow);
    joints.Spine2.bone.add(pivot);
    gun = { pivot, rest: new Matrix4().copy(joints.Spine2.bone.matrixWorld).invert(), body, glow, grip, fore };
  }
  return { kind, root, body, skeleton: body.skeleton, map: (body.material as MeshStandardMaterial).map ?? null, joints, side, shoulder: shoulder.y, up, gun };
}

const delta = new Quaternion(), euler = new Euler(), gunAt = new Matrix4(), turnQ = new Quaternion(), ONE = new Vector3(1, 1, 1);
// Turns a joint by a rotation given in model space, about its own pivot, on top of its rest pose.
function turn(j: Joint, x: number, y = 0, z = 0) {
  delta.setFromEuler(euler.set(x, y, z));
  j.bone.quaternion.copy(j.parent).invert().multiply(delta).multiply(j.parent).multiply(j.q);
}
const from = new Vector3(), to = new Vector3(), at = new Vector3(), swing = new Quaternion(), own = new Quaternion(), parent = new Quaternion();
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
  const { joints: j, side: s, gun } = rig;
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
  // The rifle at low ready across the body, raised to the shoulder while aiming; each shot kicks it back and up.
  if (gun) {
    const lift = m.aim, across = 1 - lift;
    turnQ.setFromEuler(euler.set(.3 * across - m.kick * .3, -s * .6 * across, s * .2 * across));
    gunAt.compose(v.set(s * .1, rig.shoulder - .18 + .14 * lift, .16 + .06 * lift - m.kick * .07), turnQ, ONE);
    gun.pivot.matrix.multiplyMatrices(gun.rest, gunAt); gun.pivot.matrixWorldNeedsUpdate = true;
  }
  rig.root.updateMatrixWorld(true);
  rig.root.getWorldQuaternion(rootQ);
  const world = (x: number, y: number, z: number, out: Vector3) => out.set(x, y, z).applyMatrix4(rig.root.matrixWorld);
  // Hands: on the rifle's grips, or swinging at the sides against the legs; they go slack at the sides when down.
  if (gun) { gun.grip.getWorldPosition(right); gun.fore.getWorldPosition(left); }
  else { world(s * .3, rig.shoulder - .5, -stride * .25, right); world(-s * .3, rig.shoulder - .5, stride * .25, left); }
  if (slump) { right.lerp(world(s * .32, rig.shoulder - .5, .08, slack), slump); left.lerp(world(-s * .32, rig.shoulder - .5, .08, slack), slump); }
  // Elbows bend down, out and back.
  reach(j.RightArm, j.RightForeArm, j.RightHand, right, bend.set(s * .5, -1, -.3).applyQuaternion(rootQ));
  reach(j.LeftArm, j.LeftForeArm, j.LeftHand, left, bend.set(-s * .5, -1, -.3).applyQuaternion(rootQ));
}
