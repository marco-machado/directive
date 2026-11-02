import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { twoBone } from '../src/scene/ik.ts';

const close = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 1e-6, `${what}: ${a} vs ${b}`);

test('a limb reaches a target in range with both segments at length, bending toward the pole', () => {
  const root = new Vector3(0, 1, 0), target = new Vector3(.2, .6, .3), pole = new Vector3(.5, .7, -.5), elbow = new Vector3(), hand = new Vector3();
  twoBone(root, target, .3, .28, pole, elbow, hand);
  close(hand.distanceTo(target), 0, 'hand on target');
  close(elbow.distanceTo(root), .3, 'upper length');
  close(elbow.distanceTo(hand), .28, 'lower length');
  // The elbow sits on the pole's side of the reach line.
  const reach = new Vector3().subVectors(target, root).normalize();
  const offPole = new Vector3().subVectors(pole, root).projectOnPlane(reach), offElbow = new Vector3().subVectors(elbow, root).projectOnPlane(reach);
  assert.ok(offPole.dot(offElbow) > 0);
});

test('a target out of reach straightens the limb toward it', () => {
  const root = new Vector3(), elbow = new Vector3(), hand = new Vector3();
  twoBone(root, new Vector3(0, 0, 2), .3, .28, new Vector3(0, -1, 0), elbow, hand);
  assert.ok(hand.z > .579 && hand.z <= .58 && Math.abs(hand.x) < 1e-9);
  close(elbow.distanceTo(root), .3, 'upper length');
  assert.ok(elbow.y <= 0 && elbow.y > -.01, 'nearly straight');
});

test('a pole on the reach line still gives a valid bend', () => {
  const root = new Vector3(), elbow = new Vector3(), hand = new Vector3();
  twoBone(root, new Vector3(0, -.4, 0), .3, .28, new Vector3(0, -1, 0), elbow, hand);
  close(elbow.distanceTo(root), .3, 'upper length');
  close(elbow.distanceTo(hand), .28, 'lower length');
  assert.ok(Number.isFinite(elbow.x + elbow.y + elbow.z));
});
