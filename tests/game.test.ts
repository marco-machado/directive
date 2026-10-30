import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, parseCampaign } from '../src/game/simulation.ts';
import { clearLine, distance, EXTRACT, findPath, walkable } from '../src/game/world.ts';

test('migrates the original canvas save and clamps corrupt values', () => {
  assert.deepEqual(parseCampaign('{"cash":500,"weapon":2,"armor":1,"mission":4}'), { version: 2, cash: 500, weapon: 2, armor: 1, completed: 3 });
  assert.equal(parseCampaign('{"cash":-99,"weapon":900}').weapon, 3);
  assert.equal(parseCampaign('broken').cash, 0);
});

test('navigation routes around solid buildings and rejects roof commands', () => {
  const from = { x: -12.5, z: 7 }, to = { x: 11.5, z: -8 };
  const path = findPath(from, to);
  assert.ok(path.length > 1);
  let prev = from;
  for (const point of path) { assert.ok(walkable(point)); assert.ok(clearLine(prev, point, .38), JSON.stringify({ prev, point })); prev = point; }
  assert.ok(distance(path.at(-1)!, to) < .01);
  assert.deepEqual(findPath(from, { x: -5, z: .5 }), []);
  assert.equal(clearLine({ x: -9, z: .5 }, { x: -1, z: .5 }), false);
});

test('pause freezes movement and combat; queued movement resumes', () => {
  const sim = new Simulation(); sim.deploy(); sim.togglePause(); sim.move({ x: -11, z: 4 });
  const before = structuredClone(sim.units);
  for (let i = 0; i < 60; i++) sim.update(1 / 60);
  assert.deepEqual(sim.units, before); assert.equal(sim.time, 0);
  sim.togglePause(); sim.update(.05); assert.ok(distance(sim.units[0], before[0]) > 0);
});

test('a full combat and extraction contract awards credits exactly once', () => {
  const sim = new Simulation(); sim.deploy();
  for (const id of ['g1', 'g2', 'g3', 'target']) {
    sim.attack(id);
    for (let i = 0; i < 3600 && sim.units.find(u => u.id === id)!.hp > 0 && sim.phase === 'mission'; i++) sim.update(1 / 60);
    assert.equal(sim.units.find(u => u.id === id)!.hp, 0, `Did not eliminate ${id}`);
    assert.equal(sim.phase, 'mission');
  }
  sim.move(EXTRACT);
  for (let i = 0; i < 3600 && sim.phase === 'mission'; i++) sim.update(1 / 60);
  assert.equal(sim.result, 'success'); assert.equal(sim.campaign.cash, 500); assert.equal(sim.campaign.completed, 1);
  sim.update(.05); assert.equal(sim.campaign.cash, 500);
});

test('upgrades debit funds, preserve success state, persist, and apply on deployment', () => {
  let saved = '';
  const sim = new Simulation({ version: 2, cash: 500, weapon: 0, armor: 0, completed: 1 }, c => { saved = JSON.stringify(c); });
  sim.phase = 'headquarters'; sim.result = 'success';
  assert.ok(sim.buy('weapon')); assert.equal(sim.campaign.cash, 200); assert.equal(sim.result, 'success');
  assert.equal(sim.buy('armor'), false); assert.equal(parseCampaign(saved).weapon, 1);
  sim.campaign.cash = 250; assert.ok(sim.buy('armor')); sim.deploy();
  assert.equal(sim.units[0].hp, 160); assert.equal(sim.campaign.weapon, 1);
  assert.equal(sim.buy('armor'), false);
});

test('squad loss grants no payout; restart restores agents without losing upgrades', () => {
  const sim = new Simulation({ version: 2, cash: 200, weapon: 2, armor: 1, completed: 3 });
  sim.deploy(); sim.units.filter(u => !u.enemy).forEach(u => { u.hp = 0; }); sim.update(.05);
  assert.equal(sim.result, 'failure'); assert.equal(sim.campaign.cash, 200); assert.equal(sim.campaign.completed, 3);
  sim.deploy(); assert.equal(sim.units[0].hp, 160); assert.equal(sim.campaign.weapon, 2);
});

test('storage failure keeps the purchased upgrade and reports persistence limitation', () => {
  const sim = new Simulation({ version: 2, cash: 500, weapon: 0, armor: 0, completed: 0 }, () => { throw new Error('disabled'); });
  sim.phase = 'headquarters'; assert.ok(sim.buy('armor'));
  assert.equal(sim.campaign.armor, 1); assert.equal(sim.saveUnavailable, true);
});
