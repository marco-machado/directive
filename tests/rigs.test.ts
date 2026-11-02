import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MeshBasicMaterial, Vector3 } from 'three';
import type { UnitKind } from '../src/game/simulation.ts';
import { animate, makeRig, partsOn, REACH, rigModel, SCALE } from '../src/scene/rigs.ts';
import type { Motion } from '../src/scene/rigs.ts';

const KINDS: UnitKind[] = ['assault', 'support', 'recon', 'tech', 'guard', 'heavy', 'camera', 'turret', 'target', 'vip'];
const still = (over: Partial<Motion> = {}): Motion => ({ t: 0, walk: 0, phase: 0, aim: 0, kick: 0, kickSide: 0, flinch: 0, down: 0, die: 0, ...over });
const paint = new MeshBasicMaterial();

test('every unit is one skinned, vertex-colored body plus at most one glow mesh', () => {
  for (const kind of KINDS) {
    const model = rigModel(kind);
    for (const g of [model.body, model.glow]) {
      if (!g) continue;
      assert.ok(g.getAttribute('position').count > 0, kind);
      assert.equal(g.getAttribute('color').count, g.getAttribute('position').count, kind);
      const bones = g.getAttribute('skinIndex').array;
      assert.ok(bones.every(b => b < model.bones.length), `${kind} binds to a missing bone`);
    }
    assert.ok(model.glow, `${kind} has lit accents`);
  }
});

test('lit models stay within the reach the occlusion test assumes', () => {
  for (const kind of KINDS) {
    const box = rigModel(kind).body.boundingBox!, scale = SCALE[kind] ?? 1;
    const reach = Math.max(-box.min.x, box.max.x, -box.min.z, box.max.z) * scale;
    assert.ok(reach <= REACH, `${kind} reaches ${reach.toFixed(2)}`);
    assert.ok(box.min.y >= -.01, `${kind} stands on the street`);
  }
});

test('walking swings the legs against each other and aiming raises the weapon', () => {
  const rig = makeRig('guard', paint, paint), { legL, legR, gun } = rig.bones;
  animate(rig, still({ walk: 1, phase: Math.PI / 2 }));
  assert.ok(legL.rotation.x > .3 && legR.rotation.x < -.3);
  animate(rig, still());
  assert.equal(legL.rotation.x, 0);
  const low = gun.position.y;
  animate(rig, still({ aim: 1 }));
  assert.ok(gun.position.y > low + .1 && Math.abs(gun.rotation.x) < .01);
  animate(rig, still({ aim: 1, kick: 1 }));
  assert.ok(gun.rotation.x < -.2, 'recoil tips the muzzle up');
});

test('rifles rest slung across the body and point ahead when aimed; the heavy keeps its clear of the shield', () => {
  const rifleman = makeRig('assault', paint, paint), heavy = makeRig('heavy', paint, paint);
  animate(rifleman, still());
  assert.ok(rifleman.bones.gun.rotation.y < -.3);
  animate(rifleman, still({ aim: 1 }));
  assert.ok(Math.abs(rifleman.bones.gun.rotation.y) < .01);
  animate(heavy, still());
  assert.ok(Math.abs(heavy.bones.gun.rotation.y) < .01);
});

test('the turret recoils one barrel at a time and stretches its laser while aiming', () => {
  const rig = makeRig('turret', paint, paint), { barrelL, barrelR, laser } = rig.bones, rest = new Vector3().copy(barrelR.position);
  animate(rig, still({ aim: 1, kick: 1, kickSide: 1 }));
  assert.ok(barrelR.position.z < rest.z && barrelL.position.z === rest.z);
  assert.ok(laser.scale.z > 2);
  animate(rig, still());
  assert.ok(laser.scale.z < 1);
});

test('a rig geometry splits by bone: the camera keeps its pole without its head', () => {
  const model = rigModel('camera'), root = model.bones.findIndex(b => b.name === 'root'), head = model.bones.findIndex(b => b.name === 'head');
  const pole = partsOn(model.body, [root])!, all = model.body.getAttribute('position').count;
  const bones = pole.getAttribute('skinIndex');
  assert.ok(pole.getAttribute('position').count > 0 && pole.getAttribute('position').count < all);
  for (let v = 0; v < bones.count; v++) assert.equal(bones.getX(v), root);
  assert.equal(pole.getAttribute('color').count, pole.getAttribute('position').count);
  assert.equal(partsOn(model.body, [head])!.getAttribute('position').count + pole.getAttribute('position').count, all);
  assert.equal(partsOn(rigModel('turret').body, [model.bones.length + 5]), null);
});
