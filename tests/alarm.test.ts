import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CALM_SECONDS, CALM_STEP, escalation, FIRST_WAVE_SECONDS, waveSize, REPEAT_REINFORCEMENTS, HACK_SECONDS, REINFORCE_CAP, REINFORCE_SECONDS } from '../src/game/simulation.ts';
import type { Simulation } from '../src/game/simulation.ts';
import { contractPayout } from '../src/game/campaign.ts';
import { distance } from '../src/game/world.ts';
import { recorder, step, alarmed } from './arena.ts';

const waves = (sim: Simulation) => sim.units.filter(u => /^r\d+$/.test(u.id));

test('the alarm stands down after a quiet spell, but the stealth bonus stays lost', () => {
  const { sim, raise } = alarmed();
  raise();
  step(sim, CALM_SECONDS - 1); assert.equal(sim.alarm, true);
  step(sim, 1.5);
  assert.equal(sim.alarm, false); assert.equal(sim.getSnapshot().stealth, false);
  assert.match(sim.message, /standing down/);
});

test('a guard that keeps the squad in sight holds the alarm; hunters search the last known position', () => {
  const { sim, squad, hostile, raise } = alarmed();
  squad.forEach(u => { u.hp = u.maxHp = 1e6; });
  const guard = hostile('guard', 6, 0, -Math.PI / 2, 1e6);
  raise(guard);
  step(sim, CALM_SECONDS + 2); assert.equal(sim.alarm, true);
  // Break contact: the squad slips far away and holds still.
  const known = { ...sim.lastKnown! };
  squad.forEach((u, i) => { u.x = -18 + i; u.z = 18; u.path = []; });
  step(sim, 6);
  assert.ok(distance(guard, known) <= 1, `guard at ${guard.x},${guard.z}, last known ${known.x},${known.z}`);
  assert.ok(distance(guard, squad[0]) > 15);
  // Searching on the spot, it turns until it faces an operative standing behind it.
  const back = { x: guard.x - 6.5 * Math.sin(guard.heading), z: guard.z - 6.5 * Math.cos(guard.heading) };
  squad[0].x = back.x; squad[0].z = back.z;
  sim.update(1 / 60); assert.ok(sim.calmIn < CALM_SECONDS - 1);
  step(sim, 5, () => sim.calmIn >= CALM_SECONDS - .05);
  assert.ok(sim.calmIn >= CALM_SECONDS - .05, String(sim.calmIn));
  squad[0].x = -18; squad[0].z = 18;
  step(sim, CALM_SECONDS + 1);
  assert.equal(sim.alarm, false); assert.equal(guard.hunting, false); assert.equal(guard.detect, 0);
});

test('a grenade near the end of the countdown restarts it', () => {
  const { sim, raise } = alarmed();
  raise();
  step(sim, CALM_SECONDS - .5);
  sim.ability(0); sim.groundClick({ x: 5, z: 0 }); sim.update(1 / 60);
  assert.equal(sim.alarm, true); assert.ok(sim.calmIn > CALM_SECONDS - .1);
});

test('gunfire on the frame the countdown runs out keeps the alarm', () => {
  const { sim, squad, hostile, raise } = alarmed();
  hostile('guard', 3, 0, Math.PI / 2, 1e6); // facing away, so only its shot gives the squad away
  squad.forEach(u => { u.cooldown = 1e9; });
  raise({ x: 15, z: 15 });
  sim.calmIn = .001; sim.update(1 / 60);
  assert.ok(sim.shots.length); assert.equal(sim.alarm, true);
});

test('a stunned guard facing the squad is no contact', () => {
  const { sim, squad, hostile, raise } = alarmed('heist', { roster: [{ id: 't', name: 'HEX', cls: 'tech' }] });
  const guard = hostile('guard', 5, 0, -Math.PI / 2, 1e6);
  raise(guard);
  squad[0].cooldown = 1e9; // the operative holds its own fire
  sim.ability(0); sim.groundClick({ x: 5, z: 0 }); sim.update(1 / 60);
  assert.ok(guard.stunned > 0);
  sim.calmIn = 1; step(sim, 1.5);
  assert.equal(sim.alarm, false);
});

test('after a stand-down the next alarm is telegraphed, then brings fresh reinforcements led by heavies and stands down later', () => {
  const { sim, squad, hostile, raise } = alarmed();
  sim.plan = { ...sim.plan!, exits: [{ x: 19, z: 0 }, { x: -19, z: 5 }] };
  squad.forEach(u => { u.hp = u.maxHp = 1e6; });
  raise(); step(sim, CALM_SECONDS + .5); assert.equal(sim.alarm, false);
  const next = escalation(2, 1);
  assert.deepEqual(sim.getSnapshot().nextAlarm, next);
  assert.match(sim.message, /Next alarm/);
  assert.equal(next.calm, CALM_SECONDS + CALM_STEP); assert.equal(next.heavies, 1);
  hostile('guard', 3, 0, -Math.PI / 2, 1e6);
  step(sim, 3, () => sim.alarm);
  assert.equal(sim.alarm, true);
  assert.equal(sim.getSnapshot().calmFor, next.calm); assert.equal(sim.getSnapshot().reinforceCap, next.cap);
  step(sim, FIRST_WAVE_SECONDS + .1);
  assert.equal(waves(sim).length, 2);
  assert.ok(waves(sim).every(u => distance(u, { x: -19, z: 5 }) < 2), 'the first wave of the second alarm flanked too');
  assert.deepEqual(waves(sim).map(u => u.kind), ['heavy', 'guard']);
  step(sim, REINFORCE_SECONDS * 3);
  assert.equal(waves(sim).length, REPEAT_REINFORCEMENTS);
});

test('heavies grow one an alarm until they fill whole waves', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(n => escalation(n, 1).heavies), [0, 1, 2, 2, 2]);
  assert.deepEqual([1, 2, 3, 4, 5].map(n => escalation(n, 4).heavies), [0, 1, 2, 3, 3]);
  assert.equal(waveSize(1), 2); assert.equal(waveSize(4), 3);
});

test('reinforcements an earlier alarm never sent still come with the next one', () => {
  const { sim, squad, raise } = alarmed();
  squad.forEach(u => { u.hp = u.maxHp = 1e6; });
  raise(); step(sim, CALM_SECONDS + .5); assert.equal(sim.alarm, false);
  sim.reinforced = REINFORCE_CAP - 2; // the first alarm stood down with two of its reinforcements unsent
  raise();
  step(sim, FIRST_WAVE_SECONDS + REINFORCE_SECONDS * 4);
  assert.equal(waves(sim).length, 2 + REPEAT_REINFORCEMENTS);
  assert.equal(sim.getSnapshot().reinforced, escalation(2, 1).cap);
});

test('escalation replays exactly for the same contract', () => {
  const run = () => {
    const { sim, squad, raise } = alarmed();
    sim.plan = { ...sim.plan!, exits: [{ x: 19, z: 0 }, { x: -19, z: 5 }, { x: 0, z: 19 }] };
    squad.forEach(u => { u.hp = u.maxHp = 1e6; });
    raise(); step(sim, CALM_SECONDS + .5);
    raise(); step(sim, FIRST_WAVE_SECONDS + REINFORCE_SECONDS * 2);
    return waves(sim).map(u => `${u.id}:${u.kind}:${u.x.toFixed(2)},${u.z.toFixed(2)}`);
  };
  const first = run();
  assert.ok(first.length > 2);
  assert.deepEqual(run(), first);
});

test('a contract finished after a stand-down pays without the stealth bonus', () => {
  const { events, sync } = recorder();
  const { sim, squad, raise } = alarmed('heist', {}, sync);
  raise(); step(sim, CALM_SECONDS + .5); assert.equal(sim.alarm, false);
  const terminal = sim.objectives[0];
  squad[0].x = terminal.x; squad[0].z = terminal.z;
  squad[1].x = -18; squad[1].z = -18;
  step(sim, HACK_SECONDS + 1);
  assert.equal(terminal.done, true); assert.equal(sim.phase, 'mission');
  squad[0].x = -18; squad[0].z = -18; sim.update(1 / 60);
  assert.equal(sim.result, 'success'); assert.equal(sim.payout, contractPayout(1));
  assert.equal(events.at(-1), 'completed:false');
});

test('a fleeing target keeps running after a stand-down', () => {
  const { sim, squad, hostile, raise } = alarmed('assassination');
  sim.plan = { ...sim.plan!, exits: [{ x: -19, z: 19 }] };
  squad.forEach((u, i) => { u.x = 15 + i; u.z = 15; });
  const target = hostile('target', 19, -19, 0, 1e6);
  raise(target);
  step(sim, CALM_SECONDS + .5);
  assert.equal(sim.alarm, false); assert.equal(sim.phase, 'mission'); assert.ok(target.hp > 0);
  const left = distance(target, { x: -19, z: 19 });
  step(sim, 1); assert.ok(distance(target, { x: -19, z: 19 }) < left);
  step(sim, 30);
  assert.equal(sim.result, 'failure'); assert.equal(sim.failReason, 'The target escaped.');
});

test('a second alarm does not make a fleeing target hesitate again', () => {
  const { sim, squad, hostile, raise } = alarmed('assassination');
  sim.plan = { ...sim.plan!, exits: [{ x: -19, z: 19 }] };
  squad.forEach((u, i) => { u.x = 15 + i; u.z = 15; });
  const target = hostile('target', 19, -19, 0, 1e6);
  raise(target);
  step(sim, CALM_SECONDS + .5); assert.equal(sim.alarm, false);
  const exit = target.exit;
  raise(target); assert.equal(sim.alarm, true);
  assert.equal(target.exit, exit); assert.ok(target.wait <= 0);
  const left = distance(target, exit!);
  step(sim, 1); assert.ok(distance(target, exit!) < left);
});

test('restarting clears the detection; pausing holds the countdown', () => {
  const { sim, raise } = alarmed();
  raise(); step(sim, 2);
  const calm = sim.calmIn;
  sim.togglePause(); step(sim, 5); assert.equal(sim.calmIn, calm);
  sim.togglePause(); sim.restart();
  assert.equal(sim.alarm, false); assert.equal(sim.getSnapshot().stealth, true); assert.equal(sim.calmIn, 0);
});
