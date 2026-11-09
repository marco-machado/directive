import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, LOOK_ANGLE, LOOK_EVERY, LOOK_PAUSE, SUSPICIOUS, TAKEDOWN_REACH, TAKEDOWN_SECONDS } from '../src/game/simulation.ts';
import { contractPayout, FIRST_CONTRACT, freshCampaign } from '../src/game/campaign.ts';
import { planMission } from '../src/game/mapgen.ts';
import { mulberry32 } from '../src/game/rng.ts';
import { distance, World } from '../src/game/world.ts';
import { recorder, campaignWith, step, arena, withBarrier, alarmed, FOUR } from './arena.ts';

// ---- Takedowns, synchronized volleys and posted guards looking around ----
test('an attack order on an unaware guard sends the nearest operative around its sight for a silent takedown', () => {
  const { sim, squad, hostile } = arena();
  const [vex, rook] = squad;
  // The guard faces the squad from just beyond its vision range: walking straight at it would cross its cone.
  const guard = hostile('guard', 12, 0, -Math.PI / 2);
  assert.equal(sim.attackHint(guard.id), 'Takedown · ROOK');
  sim.attack(guard.id);
  assert.equal(rook.takedownId, guard.id); assert.equal(vex.takedownId, null); assert.equal(rook.targetId, null);
  assert.match(sim.message, /ROOK circling out of sight for a takedown on GUARD/);
  let peak = 0, reached = -1, shots = 0;
  step(sim, 20, () => {
    peak = Math.max(peak, guard.detect); shots += sim.shots.length;
    if (reached < 0 && distance(rook, guard) <= TAKEDOWN_REACH) reached = sim.time;
    return guard.hp <= 0;
  });
  assert.equal(guard.hp, 0); assert.equal(sim.alarm, false); assert.equal(sim.getSnapshot().stealth, true);
  assert.equal(peak, 0, 'the guard never saw ROOK coming');
  assert.equal(shots, 0, 'no shots fired');
  assert.ok(rook.x > guard.x, `ROOK finished it from behind, at ${rook.x.toFixed(2)}, ${rook.z.toFixed(2)}`);
  assert.ok(Math.abs(sim.time - reached - TAKEDOWN_SECONDS) < .05, `${(sim.time - reached).toFixed(3)} s in reach`);
  assert.deepEqual([vex.x, vex.z], [0, 0], 'VEX stays put');
  assert.equal(rook.takedownId, null); assert.match(sim.message, /ROOK took down GUARD/);
});

test('a takedown stays quiet unless another hostile sees it happen', () => {
  for (const watching of [false, true]) {
    const { sim, squad, hostile } = arena();
    const rook = squad[1];
    const guard = hostile('guard', 6, 0, Math.PI / 2); // facing away from the squad
    rook.x = 5; // already at its back
    // A second guard 6 m off, facing the struggle or looking away from it.
    hostile('guard', 6, 6, watching ? Math.PI : 0);
    sim.selected = [rook.id]; sim.attack(guard.id);
    assert.equal(rook.takedownId, guard.id);
    sim.update(1 / 60);
    assert.ok(guard.held > 0, 'pinned at once');
    if (watching) { assert.equal(sim.alarm, true); assert.match(sim.message, /GUARD saw the takedown/); continue; }
    step(sim, TAKEDOWN_SECONDS - .1); assert.ok(guard.hp > 0, 'not before 1.5 s');
    step(sim, .2); assert.equal(guard.hp, 0); assert.equal(sim.alarm, false);
  }
});

test('a guard that turns suspicious as the operative reaches it is not pinned', () => {
  const { sim, squad, hostile } = arena();
  const rook = squad[1];
  // ROOK stands 1 m in front of a guard that is just short of suspicious, so the order is still a takedown.
  const guard = hostile('guard', 2, 0, -Math.PI / 2);
  guard.detect = SUSPICIOUS - .01;
  sim.selected = [rook.id]; sim.attack(guard.id);
  assert.equal(rook.takedownId, guard.id);
  sim.update(1 / 60);
  assert.ok(guard.detect > SUSPICIOUS);
  assert.equal(guard.held, 0); assert.equal(rook.takedownId, null);
  assert.match(sim.message, /GUARD turned suspicious\. ROOK holding/);
  step(sim, 2, () => sim.alarm);
  assert.equal(sim.alarm, true); assert.ok(guard.hp > 0);
});

test('a heavy takedown needs two operatives, and only starts with both in reach', () => {
  const { sim, squad, hostile } = arena();
  const [vex, rook] = squad;
  const heavy = hostile('heavy', 8, 0, Math.PI / 2, 180); // facing away
  vex.x = -12; // VEX has the longer walk
  sim.selected = [rook.id];
  assert.equal(sim.attackHint(heavy.id), '20 / 180 · will alert · takedown needs 2');
  sim.selectAll();
  assert.equal(sim.attackHint(heavy.id), 'Takedown · ROOK + VEX');
  sim.attack(heavy.id);
  assert.ok(squad.every(u => u.takedownId === heavy.id));
  let early = false;
  step(sim, 15, () => {
    if (heavy.held > 0 && squad.some(u => distance(u, heavy) > TAKEDOWN_REACH)) early = true;
    return heavy.hp <= 0;
  });
  assert.equal(early, false, 'the hold waited for the second operative');
  assert.equal(heavy.hp, 0); assert.equal(sim.alarm, false);
  assert.ok(distance(vex, rook) > .3, 'they take either shoulder');
});

test('ordered operatives hold fire until all can hit, then fire on the same frame', () => {
  const { sim, squad, hostile } = arena();
  const [, rook] = squad;
  rook.x = -12; // out of range
  const guard = hostile('guard', 4, 0, Math.PI / 2, 40); // VEX 28 + ROOK 20 kills it, so this is a volley
  assert.equal(sim.attackHint(guard.id), '48 / 40 · silent kill');
  sim.attack(guard.id);
  assert.ok(squad.every(u => u.targetId === guard.id && !u.takedownId));
  assert.match(sim.message, /Volley 48 \/ 40, silent kill\. Firing together once all can hit/);
  step(sim, 1);
  assert.equal(guard.hp, 40, 'VEX, already in range, waits for ROOK'); assert.equal(sim.shots.length, 0);
  step(sim, 10, () => guard.hp <= 0);
  assert.equal(guard.hp, 0); assert.equal(sim.alarm, false);
  const volley = sim.shots.filter(s => s.faction === 'squad');
  assert.equal(volley.length, 2); assert.ok(volley.every(s => s.ttl === volley[0].ttl), 'both shots on one frame');
});

test('a volley that cannot kill says it will alert, and does', () => {
  const { sim, squad, hostile } = arena();
  const guard = hostile('guard', 4, 0, Math.PI / 2);
  guard.detect = .5; // suspicious, so no takedown
  assert.equal(sim.attackHint(guard.id), '48 / 75 · will alert');
  sim.attack(guard.id); sim.update(1 / 60);
  assert.equal(guard.hp, 75 - 48); assert.equal(sim.alarm, true);
  assert.equal(sim.attackHint(guard.id), '48 / 27');
  assert.ok(squad.every(u => u.cooldown > 0));
});

test('posted guards look 60° to either side every 6 to 8 s, holding each look for 2 s', () => {
  const run = () => {
    const { sim, hostile } = arena();
    const guard = hostile('guard', 12, 12, 0); // posted: no patrol route
    const trace: number[] = [];
    for (let i = 0; i < 45 * 60; i++) { sim.update(1 / 60); trace.push(Math.atan2(Math.sin(guard.heading), Math.cos(guard.heading))); }
    assert.deepEqual([guard.x, guard.z], [12, 12], 'it never leaves its post');
    return trace;
  };
  const trace = run();
  assert.deepEqual(run(), trace, 'the schedule replays exactly');
  // Look-arounds are the stretches away from the post heading.
  const looks: { start: number; side: number; held: number; peak: number }[] = [];
  trace.forEach((h, i) => {
    const away = Math.abs(h) > 1e-9, last = looks.at(-1);
    if (away && (!i || Math.abs(trace[i - 1]) <= 1e-9)) looks.push({ start: i, side: Math.sign(h), held: 0, peak: 0 });
    if (away && last && i > last.start) { last.peak = Math.max(last.peak, Math.abs(h)); if (Math.abs(Math.abs(h) - LOOK_ANGLE) < 1e-9) last.held++; }
  });
  const whole = looks.slice(1, -1); // the first and last may be cut off
  assert.ok(whole.length >= 3, String(looks.length));
  for (const l of whole) {
    assert.ok(Math.abs(l.peak - LOOK_ANGLE) < 1e-9, `peak ${l.peak}`);
    assert.ok(Math.abs(l.held / 60 - LOOK_PAUSE) <= 2 / 60, `held ${l.held / 60} s`);
  }
  for (let k = 2; k < looks.length; k++) {
    const gap = (looks[k].start - looks[k - 1].start) / 60;
    assert.ok(gap >= LOOK_EVERY[0] - 2 / 60 && gap <= LOOK_EVERY[1] + 2 / 60, `gap ${gap} s`);
    assert.equal(looks[k].side, -looks[k - 1].side, 'sides alternate');
  }
});

test('a posted guard opens a window on ground it otherwise watches', () => {
  const { sim, squad, hostile } = arena();
  squad.forEach(u => { u.x = -18; u.z = 18; });
  const guard = hostile('guard', 10, 10, 0);
  // 4 m off the post heading by 75°: outside the cone at rest, inside it at the far end of one look.
  const spot = { x: 10 + 4 * Math.sin(75 * Math.PI / 180), z: 10 + 4 * Math.cos(75 * Math.PI / 180) };
  const seen = (h: number) => Math.abs(Math.atan2(spot.x - 10, spot.z - 10) - h) <= .87;
  let watched = 0, total = 0;
  for (let i = 0; i < 30 * 60; i++) { sim.update(1 / 60); total++; if (seen(guard.heading)) watched++; }
  assert.ok(watched > 0 && watched < total * .5, `${watched} / ${total}`);
});

test('a covered move order near the end of a barrier keeps the whole line behind it', () => {
  const { sim, squad, hostile, raise } = alarmed('heist', FOUR);
  withBarrier(sim);
  squad.forEach((u, i) => { u.hp = u.maxHp = 1e6; u.x = -3 + 2 * i; u.z = 0; });
  const guard = hostile('guard', 0, 0, 0, 1e6);
  raise();
  sim.selected = squad.map(u => u.id); sim.move({ x: .6, z: 4.6 });
  step(sim, 8, () => squad.every(u => !u.path.length));
  for (const u of squad) assert.ok(sim.plan!.world.coverBetween(guard, u), `${u.name} at ${u.x.toFixed(2)}, ${u.z.toFixed(2)} is exposed`);
});

test('a click on the street drawn past the bounds lands on the nearest walkable point inside them', () => {
  const world = new World({ minX: -16, maxX: 16, minZ: -12, maxZ: 12 }, [], []);
  assert.deepEqual(world.clampToBounds({ x: -19.2, z: 10.4 }), { x: -15.5, z: 10.4 });
  assert.deepEqual(world.clampToBounds({ x: 30, z: -40 }), { x: 15.5, z: -11.5 });
  assert.deepEqual(world.clampToBounds({ x: 3, z: 4 }), { x: 3, z: 4 });
  assert.ok(world.walkable(world.clampToBounds({ x: -8.7, z: 12.03 })));
});

test('contract 01 has one patrol and a quiet route: straight to the terminal and back, whenever the squad sets out', () => {
  const plan = planMission({ ...FIRST_CONTRACT, id: 'c01', payout: contractPayout(1) });
  assert.equal(plan.enemies.filter(e => e.patrol.length > 1).length, 1);
  assert.deepEqual(plan.enemies.map(e => e.kind), ['guard', 'guard', 'guard']);
  for (const delay of [0, 3, 6, 9, 12, 16]) {
    const sim = new Simulation({ ...freshCampaign(mulberry32(7)), offers: [{ ...FIRST_CONTRACT, id: 'c01', payout: contractPayout(1) }] });
    sim.deploy();
    step(sim, delay);
    sim.move(sim.objectives[0]);
    step(sim, 60, () => sim.objectives[0].done);
    sim.move(sim.objectives[1]);
    step(sim, 60);
    assert.equal(sim.result, 'success', `setting out after ${delay} s`);
    assert.equal(sim.detected, false, `setting out after ${delay} s`);
  }
});

test('first-time milestones are recorded once each, in the order they happen, and reset with the mission', () => {
  const { sim, squad, hostile } = arena('heist');
  step(sim, .1);
  assert.deepEqual(sim.milestones, ['abilityReady']);
  const guard = hostile('guard', 0, 4, Math.PI);
  step(sim, 5, () => sim.alarm);
  assert.deepEqual(sim.milestones, ['abilityReady', 'hostileSeen', 'suspicious', 'alarm']);
  squad[0].hp = 1; guard.cooldown = 0;
  step(sim, 3, () => squad[0].hp <= 0);
  assert.deepEqual(sim.milestones.slice(4), ['downed']);
  sim.objectives[0].done = true;
  step(sim, .1);
  assert.deepEqual(sim.milestones.slice(4), ['downed', 'extractOpen']);
  assert.equal(sim.getSnapshot().milestones, sim.milestones);
  sim.restart();
  assert.ok(!sim.milestones.includes('alarm'));
});

test('a deploy waits while a save is in flight, so it only ever names an offer the server dealt', () => {
  const { events, sync } = recorder();
  const sim = new Simulation(campaignWith('heist'), sync);
  sim.setSyncing(true);
  sim.deploy();
  assert.equal(sim.phase, 'briefing'); assert.deepEqual(events, []);
  sim.setSyncing(false);
  sim.deploy();
  assert.equal(sim.phase, 'mission'); assert.equal(events.length, 1);
});
