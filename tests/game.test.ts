import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, parseCampaign, HEAVY_HP, FIRST_WAVE_SECONDS, VIP_DAMAGE_TAKEN, VIP_SECURE_SECONDS, CAMERA_DETECT, COVER_FACTOR, DETECT_DRAIN, detectSeconds, GHOST_SECONDS, HACK_SECONDS, REINFORCE_CAP, SUSPICIOUS, REINFORCE_SECONDS, REVIVE_SECONDS, SIGHT_RANGE, TAKEDOWN_REACH, tierDamage, tierHp } from '../src/game/simulation.ts';
import type { Unit } from '../src/game/simulation.ts';
import { CAMPAIGN_VERSION, CONTRACT_TYPES, contractPayout, freshCampaign, MAX_TIER } from '../src/game/campaign.ts';
import type { Campaign } from '../src/game/campaign.ts';
import { abilityCooldown, CLASS_STATS } from '../src/game/classes.ts';
import { mapSize, planMission, TARGET_AREA_OFFSET, TARGET_AREA_RADIUS } from '../src/game/mapgen.ts';
import type { EnemyKind } from '../src/game/mapgen.ts';
import { mulberry32 } from '../src/game/rng.ts';
import { distance, World } from '../src/game/world.ts';
import type { Point } from '../src/game/world.ts';
import { raiseAlarm } from '../src/game/alarm.ts';
import { recorder, contract, campaignWith, step, arena, BARRIER, withBarrier, alarmed } from './arena.ts';

test('migrates v1 and v2 saves and clamps corrupt values', () => {
  const v1 = parseCampaign('{"cash":500,"weapon":2,"armor":1,"mission":4}');
  assert.equal(v1.version, CAMPAIGN_VERSION); assert.equal(v1.cash, 500); assert.equal(v1.completed, 3);
  assert.deepEqual(v1.roster.map(o => [o.name, o.cls]), [['VEX', 'assault'], ['ROOK', 'support']]);
  assert.equal(v1.offers.length, 3); assert.equal(v1.recruits.length, 2);
  assert.equal(parseCampaign('{"cash":-99,"weapon":900}').weapon, 3);
  assert.equal(parseCampaign('broken').cash, 0);
});

test('districts are deterministic, reachable, and grow with tier', () => {
  for (const type of CONTRACT_TYPES) for (let tier = 1; tier <= MAX_TIER; tier++) {
    const c = contract(type, tier, 99 + tier), plan = planMission(c), again = planMission(c);
    assert.deepEqual(again.world.buildings, plan.world.buildings);
    const { w, d } = mapSize(tier);
    assert.equal(plan.world.bounds.maxX - plan.world.bounds.minX, w); assert.equal(plan.world.bounds.maxZ - plan.world.bounds.minZ, d);
    for (const e of plan.enemies) {
      assert.ok([e, ...e.patrol].every(p => distance(p, plan.extract) > 9), `${e.kind} starts or patrols on top of the squad`);
      if (e.kind !== 'camera' && e.kind !== 'turret') assert.ok(plan.world.findPath(plan.spawn[0], e).length, `${e.kind} unreachable`);
    }
    for (const p of plan.spawn) assert.ok(plan.world.walkable(p), 'squad spawns inside geometry');
    if (type === 'sabotage') assert.equal(plan.sites.length, 2);
    if (type === 'assassination') assert.equal(plan.enemies.filter(e => e.kind === 'target').length, 1);
    if (type === 'escort') assert.ok(plan.vip);
  }
});

test('a posted guard never stands with its back to the map edge, so a takedown has ground behind it', () => {
  for (const type of CONTRACT_TYPES) for (let tier = 1; tier <= MAX_TIER; tier++) for (let seed = 1; seed <= 12; seed++) {
    const plan = planMission(contract(type, tier, seed * 7919 + tier));
    for (const g of plan.enemies.filter(e => e.kind === 'guard' && !e.patrol.length)) {
      const behind = { x: g.x - Math.sin(g.heading) * TAKEDOWN_REACH, z: g.z - Math.cos(g.heading) * TAKEDOWN_REACH };
      assert.ok(plan.world.inBounds(behind), `${type} T${tier} seed ${seed}: guard at ${g.x.toFixed(1)}, ${g.z.toFixed(1)} has its back to the edge`);
    }
  }
});

test('hostiles scale gently up to tier 3 and turrets guard objectives only from tier 4', () => {
  assert.equal(tierHp(1), 1); assert.equal(tierDamage(1), 1);
  assert.ok(tierHp(3) <= 1.1 && tierDamage(3) <= 1.1, 'tier 3 hostiles should stay close to tier 1');
  assert.ok(tierDamage(5) - tierDamage(4) > tierDamage(3) - tierDamage(2), 'the curve steepens past tier 3');
  const turrets = (tier: number) => [1, 2, 3, 4, 5, 6].flatMap(seed => (['heist', 'sabotage'] as const).map(type => planMission(contract(type, tier, seed)).enemies.filter(e => e.kind === 'turret').length));
  assert.ok(turrets(3).every(n => n === 0));
  // A turret is skipped when no free spot lies near its objective, so only most tier-4 districts get one.
  assert.ok(turrets(4).filter(n => n === 1).length >= 10);
});

test('buildings block movement and sight; cover blocks movement but not sight', () => {
  const world = new World({ minX: -10, maxX: 10, minZ: -10, maxZ: 10 }, [{ x: 0, z: 0, w: 4, d: 4, h: 3 }], [{ x: 0, z: 6, w: 1.6, d: .45 }]);
  const path = world.findPath({ x: -6, z: 0 }, { x: 6, z: 0 });
  assert.ok(path.length > 1);
  let prev = { x: -6, z: 0 };
  for (const p of path) { assert.ok(world.passable(prev, p, .3), JSON.stringify({ prev, p })); prev = p; }
  assert.deepEqual(world.findPath({ x: -6, z: 0 }, { x: 0, z: 0 }), []);
  assert.equal(world.sightClear({ x: -6, z: 0 }, { x: 6, z: 0 }), false);
  assert.equal(world.sightClear({ x: 0, z: 4 }, { x: 0, z: 8 }), true);
  assert.equal(world.passable({ x: 0, z: 4 }, { x: 0, z: 8 }), false);
  assert.equal(world.coverBetween({ x: 0, z: 2.5 }, { x: 0, z: 6.7 }), true);
  assert.equal(world.coverBetween({ x: 3, z: 8 }, { x: 0, z: 6.7 }), false);
});

test('pause freezes the mission; queued movement resumes', () => {
  const sim = new Simulation(campaignWith('heist')); sim.deploy(); sim.togglePause();
  sim.move({ x: sim.plan!.extract.x, z: sim.plan!.extract.z });
  const before = structuredClone(sim.units);
  for (let i = 0; i < 60; i++) sim.update(1 / 60);
  assert.deepEqual(sim.units, before); assert.equal(sim.time, 0);
});

test('before the alarm the squad holds fire unless ordered', () => {
  const { sim, hostile } = arena();
  const guard = hostile('guard', 4, 0, Math.PI / 2, 40); // facing straight away; the volley kills, so the order is to fire
  step(sim, 1);
  assert.equal(guard.hp, 40); assert.equal(sim.alarm, false);
  sim.attack(guard.id); step(sim, .2);
  assert.ok(guard.hp < 40);
});

test('detection fills faster up close and raises the alarm', () => {
  const near = arena(), far = arena();
  near.hostile('guard', 2, 0, -Math.PI / 2); far.hostile('guard', 6.5, 0, -Math.PI / 2);
  let tNear = 0, tFar = 0;
  for (let i = 0; i < 600 && !near.sim.alarm; i++) { near.sim.update(1 / 60); tNear += 1 / 60; }
  for (let i = 0; i < 600 && !far.sim.alarm; i++) { far.sim.update(1 / 60); tFar += 1 / 60; }
  assert.ok(near.sim.alarm && far.sim.alarm);
  assert.ok(tNear < tFar, `${tNear} vs ${tFar}`);
  near.sim.update(.1); assert.equal(near.sim.getSnapshot().stealth, false);
});

test('the first alarm records who raised it, whom it saw, where and when', () => {
  const { sim, squad, hostile } = arena('sabotage');
  const guard = hostile('guard', 3, 0, -Math.PI / 2); // facing ROOK (x = 1)
  const charge = sim.objectives[0]; charge.x = 2; charge.z = 1;
  step(sim, 10, () => sim.alarm);
  assert.equal(sim.alarm, true);
  const cause = sim.getSnapshot().alarmCause!;
  assert.equal(cause.trigger, 'sighting'); assert.equal(cause.hostile, 'guard'); assert.equal(cause.operative, squad[1].name);
  assert.deepEqual({ x: cause.x, z: cause.z }, { x: squad[1].x, z: squad[1].z });
  assert.equal(cause.near, 'Charge A');
  assert.ok(cause.at > 0 && Math.abs(cause.at - sim.time) < 1e-9, `${cause.at} vs ${sim.time}`);
  // A later trigger keeps the first cause: that alarm is the one that cost the stealth bonus.
  guard.hp = 0; raiseAlarm(sim, { x: 0, z: 0 }, 'test');
  sim.update(1 / 60);
  assert.equal(sim.getSnapshot().alarmCause!.operative, squad[1].name);
  sim.restart(); assert.equal(sim.getSnapshot().alarmCause, null);
});

// Seconds until the alarm with one hostile watching ROOK (at x = 1) from `d` m down the x axis.
const timeToAlarm = (kind: EnemyKind, d: number) => {
  const { sim, hostile } = arena();
  const h = hostile(kind, 1 + d, 0, -Math.PI / 2, 40);
  h.lookEvery = 1e9; // no look-around in the way
  for (let i = 0; i < 1200 && !sim.alarm; i++) sim.update(1 / 60);
  assert.ok(sim.alarm, `${kind} at ${d} m raised the alarm`);
  return sim.time;
};

test('detection takes about 1.5 s at 2 m and 4 s at a guard\'s full range; cameras are faster', () => {
  assert.equal(detectSeconds('guard', 2), 1.5); assert.equal(detectSeconds('guard', 7), 4);
  for (const [kind, d] of [['guard', 2], ['guard', 7], ['heavy', 4], ['camera', 2]] as const) {
    const t = timeToAlarm(kind, d);
    assert.ok(Math.abs(t - detectSeconds(kind, d)) <= 1 / 60 + 1e-9, `${kind} at ${d} m: ${t.toFixed(3)} s`);
  }
  for (const d of [1, 4, 7]) assert.ok(detectSeconds('camera', d) < detectSeconds('guard', d));
  assert.ok(CAMERA_DETECT < 1);
});

test('detection drains at 0.25 per second once the squad is out of sight', () => {
  const { sim, hostile } = arena();
  const guard = hostile('guard', 3, 0, -Math.PI / 2);
  guard.lookEvery = 1e9;
  step(sim, 1);
  assert.ok(Math.abs(guard.detect - 1 / 1.5) < .02, String(guard.detect));
  guard.heading = guard.sweep = Math.PI / 2; // turns its back
  const before = guard.detect;
  step(sim, 1);
  assert.equal(DETECT_DRAIN, .25);
  assert.ok(Math.abs(before - guard.detect - DETECT_DRAIN) < 1e-6, `${before} → ${guard.detect}`);
  assert.equal(sim.alarm, false);
});

test('auto-pause stops the mission once per hostile as it turns suspicious', () => {
  const off = arena();
  off.hostile('guard', 3, 0, -Math.PI / 2).lookEvery = 1e9;
  step(off.sim, 1, () => off.sim.paused);
  assert.equal(off.sim.paused, false, 'off by default');

  const { sim, hostile } = arena();
  sim.setAutoPause(true);
  const guard = hostile('guard', 3, 0, -Math.PI / 2);
  guard.lookEvery = 1e9;
  step(sim, 2, () => sim.paused);
  assert.equal(sim.paused, true);
  assert.ok(guard.detect > SUSPICIOUS && guard.detect < SUSPICIOUS + .02, String(guard.detect));
  assert.match(sim.message, /GUARD is suspicious\. Auto-paused/);
  assert.equal(sim.getSnapshot().paused, true);
  // It looks away, calms below the threshold, then sees the squad again: no second pause for the same guard.
  sim.togglePause(); guard.heading = guard.sweep = Math.PI / 2;
  step(sim, 1); assert.ok(guard.detect < SUSPICIOUS);
  guard.heading = guard.sweep = -Math.PI / 2;
  step(sim, 1, () => guard.detect > SUSPICIOUS + .05);
  assert.equal(sim.paused, false);
  // A second hostile turning suspicious pauses again.
  guard.heading = guard.sweep = Math.PI / 2; guard.detect = 0;
  hostile('heavy', 1, 3, Math.PI).lookEvery = 1e9;
  step(sim, 2, () => sim.paused);
  assert.equal(sim.paused, true); assert.match(sim.message, /HEAVY is suspicious/);
  sim.restart(); sim.setAutoPause(true);
  assert.equal(sim.autoPaused.size, 0, 'a restart forgets who already paused');
});

test('a guard facing away never notices; a camera cone does', () => {
  const { sim, hostile } = arena();
  hostile('guard', 3, 0, Math.PI / 2);
  step(sim, 3); assert.equal(sim.alarm, false);
  const cam = arena();
  cam.hostile('camera', 4, 0, -Math.PI / 2, 40);
  cam.sim.time = 0; step(cam.sim, 4, () => cam.sim.alarm);
  assert.equal(cam.sim.alarm, true);
});

test('a silent sniper kill stays quiet; a survivor raises the alarm', () => {
  const { sim, squad, hostile } = arena('heist', { roster: [{ id: 'k', name: 'KAI', cls: 'recon' }] });
  const guard = hostile('guard', 9, 0, 0);
  sim.ability(0); assert.equal(sim.pending?.ability, 'snipe');
  sim.unitClick(guard.id); sim.update(1 / 60);
  assert.equal(guard.hp, 0); assert.equal(sim.alarm, false);
  assert.ok(squad[0].abilityCd > 0);
  const heavy = hostile('heavy', 9, 3, 0, 180);
  squad[0].abilityCd = 0; sim.ability(0); sim.unitClick(heavy.id); sim.update(1 / 60);
  assert.ok(heavy.hp > 0); assert.equal(sim.alarm, true);
  assert.ok(heavy.marked > 0);
});

test('an EMP stuns guards and turrets, blinds cameras longer, and stays quiet', () => {
  const { sim, hostile } = arena('heist', { roster: [{ id: 't', name: 'HEX', cls: 'tech' }], abilities: { assault: 0, support: 0, recon: 0, tech: 1 } });
  const guard = hostile('guard', 5, 0, Math.PI / 2), camera = hostile('camera', 5.5, 1, Math.PI / 2, 40), far = hostile('guard', 5, 6, Math.PI / 2);
  sim.ability(0); sim.groundClick({ x: 5, z: .5 }); sim.update(1 / 60);
  assert.ok(Math.abs(guard.stunned - 6) < .05, String(guard.stunned));
  assert.ok(Math.abs(camera.stunned - 12) < .05, String(camera.stunned));
  assert.equal(far.stunned, 0); assert.equal(sim.alarm, false);
  guard.heading = -Math.PI / 2; step(sim, 3);
  assert.equal(guard.detect, 0); assert.equal(sim.alarm, false);
});

test('a single-frame volley that kills stays quiet; a grenade always raises the alarm', () => {
  const { sim, hostile } = arena();
  const guard = hostile('guard', 3, 0, Math.PI, 40);
  sim.attack(guard.id); sim.update(1 / 60);
  assert.equal(guard.hp, 0); assert.equal(sim.alarm, false);
  const g = arena();
  g.hostile('guard', 5, 0, Math.PI, 500);
  g.sim.ability(0); g.sim.groundClick({ x: 5, z: 0 }); g.sim.update(1 / 60);
  assert.equal(g.sim.alarm, true);
});

test('cover halves incoming fire from the far side', () => {
  const { sim, squad, hostile } = arena();
  const target = hostile('turret', 0, 6, 0, 500); // a turret is never taken down
  sim.plan = { ...sim.plan!, world: new World(sim.plan!.world.bounds, [], [{ x: 0, z: 5.3, w: 1.6, d: .45 }]) };
  sim.selected = [squad[0].id]; sim.attack(target.id); sim.update(1 / 60);
  assert.equal(500 - target.hp, (CLASS_STATS.assault.damage) * COVER_FACTOR);
});

test('coverStatus reports cover against each visible armed hostile before the alarm, and a flank', () => {
  const { sim, squad, hostile } = arena();
  withBarrier(sim);
  const u = squad[0]; u.x = 0; u.z = 6;
  assert.deepEqual(sim.coverStatus(u), { threats: [], shield: null });
  const front = hostile('guard', 0, 1);
  hostile('camera', 1, 1); // unarmed: never a threat
  assert.deepEqual(sim.coverStatus(u), { threats: [{ id: front.id, covered: true }], shield: 'covered' });
  assert.equal(sim.getSnapshot().cover[u.id], null, 'the snapshot catches up at its next emit');
  step(sim, .2); assert.equal(sim.getSnapshot().cover[u.id], 'covered');
  const flank = hostile('guard', 6, 6);
  assert.deepEqual(sim.coverStatus(u), { threats: [{ id: front.id, covered: true }, { id: flank.id, covered: false }], shield: 'flanked' });
  flank.visible = false; // out of the squad's sight, it is not a threat before the alarm
  assert.equal(sim.coverStatus(u).shield, 'covered');
  u.x = 4; // away from the barrier: no shield, though the threat list stays
  assert.deepEqual(sim.coverStatus(u), { threats: [{ id: front.id, covered: false }], shield: null });
});

test('during the alarm coverStatus counts only armed hostiles in range and in sight', () => {
  const { sim, squad, hostile, raise } = alarmed();
  withBarrier(sim);
  const u = squad[0]; u.x = 0; u.z = 6;
  const near = hostile('guard', 0, 2), far = hostile('guard', 0, -1); // 4 m and 7 m away; a guard reaches 5.5 m
  far.visible = near.visible = false;
  raise();
  assert.deepEqual(sim.coverStatus(u), { threats: [{ id: near.id, covered: true }], shield: 'covered' });
  hostile('turret', -6, 6); // 6 m along the barrier, inside its 7 m reach
  assert.equal(sim.coverStatus(u).shield, 'flanked');
});

test('coverSnap moves a point near a barrier to its side away from the nearest known threat', () => {
  const { sim, hostile } = arena();
  withBarrier(sim);
  const click = { x: .3, z: 4.7 }, behind = BARRIER.z + BARRIER.d / 2 + .45, before = BARRIER.z - BARRIER.d / 2 - .45;
  assert.equal(sim.coverSnap(click), null, 'no known threat');
  const south = hostile('guard', 0, 0);
  const snap = sim.coverSnap(click)!;
  assert.deepEqual({ x: snap.x, z: +snap.z.toFixed(3), along: snap.along }, { x: .3, z: +behind.toFixed(3), along: { x: 1, z: 0 } });
  assert.ok(sim.plan!.world.coverBetween(south, snap));
  assert.equal(sim.coverSnap({ x: 3, z: 3 }), null, 'more than 1 m from the barrier');
  // A nearer threat on the far side flips the spot to the near face.
  const north = hostile('guard', 0, 9);
  assert.equal(+sim.coverSnap({ x: 0, z: 6 })!.z.toFixed(3), +before.toFixed(3));
  // Out of sight, a hostile still counts through its last-seen marker.
  north.hp = 0; south.visible = false;
  (sim as unknown as { lastSeen: Map<string, Point & { heading: number; at: number }> }).lastSeen.set(south.id, { x: 0, z: 0, heading: 0, at: 0 });
  assert.equal(+sim.coverSnap(click)!.z.toFixed(3), +behind.toFixed(3));
  // The same district, contract and threat always give the same spot.
  assert.deepEqual(sim.coverSnap(click), sim.coverSnap(click));
});

test('during the alarm a move order released next to a barrier ends on its covered side', () => {
  const { sim, squad, hostile, raise } = alarmed();
  withBarrier(sim);
  squad.forEach(u => { u.hp = u.maxHp = 1e6; });
  const guard = hostile('guard', 0, -2, 0, 1e6);
  raise();
  sim.selected = squad.map(u => u.id); sim.move({ x: 0, z: 4.6 });
  const end = sim.commandPoint!;
  assert.ok(end.z > BARRIER.z, `order ended at z = ${end.z}`);
  step(sim, 6, () => squad.every(u => !u.path.length));
  for (const u of squad) assert.ok(u.z > BARRIER.z && Math.abs(u.z - end.z) < 1e-6, `${u.name} at ${u.x.toFixed(2)}, ${u.z.toFixed(2)}`);
  assert.equal(sim.coverStatus(squad[0]).threats.find(t => t.id === guard.id)?.covered, true);
});

test('the vault hack pauses when nobody is on the terminal', () => {
  const { sim, squad } = arena('heist');
  const terminal = sim.objectives[0];
  squad.forEach(u => { u.x = 10; u.z = 10; });
  squad[0].x = terminal.x; squad[0].z = terminal.z;
  step(sim, HACK_SECONDS / 2);
  const half = terminal.progress;
  assert.ok(half > .45 && half < .55, String(half));
  squad[0].x = 10; step(sim, 2); assert.equal(terminal.progress, half);
  squad[0].x = terminal.x; step(sim, HACK_SECONDS / 2 + .2);
  assert.equal(terminal.done, true);
});

test('sabotage needs both charges before extraction pays', () => {
  const { events, sync } = recorder();
  const { sim, squad } = arena('sabotage', {}, sync);
  const [a, b] = sim.objectives;
  squad[0].x = sim.plan!.extract.x; squad[0].z = sim.plan!.extract.z;
  squad[1].x = a.x; squad[1].z = a.z; step(sim, 3.2);
  assert.equal(a.done, true); assert.equal(sim.phase, 'mission');
  squad[1].x = b.x; squad[1].z = b.z; step(sim, 3.2);
  assert.equal(b.done, true); assert.equal(sim.phase, 'mission');
  squad[1].x = sim.plan!.extract.x; squad[1].z = sim.plan!.extract.z; sim.update(1 / 60);
  assert.equal(sim.result, 'success');
  assert.equal(sim.payout, Math.round(contractPayout(1) * 1.25));
  assert.equal(sim.campaign.cash, sim.payout);
  assert.deepEqual(events.slice(1), ['completed:true']);
});

test('an alarmed contract pays without the stealth bonus', () => {
  const { sim, squad } = arena('heist');
  const terminal = sim.objectives[0];
  squad[0].x = terminal.x; squad[0].z = terminal.z;
  squad[1].x = -18; squad[1].z = -18;
  sim.plan && raiseAlarm(sim, { x: 0, z: 0 }, 'test');
  step(sim, HACK_SECONDS + 1);
  assert.equal(terminal.done, true); assert.equal(sim.phase, 'mission');
  squad[0].x = -18; squad[0].z = -18; sim.update(1 / 60);
  assert.equal(sim.result, 'success'); assert.equal(sim.payout, contractPayout(1));
});

test('extraction waits for every operative, downed ones included', () => {
  const { sim, squad } = arena('heist');
  const [terminal, extract] = sim.objectives, [medic, down] = squad;
  terminal.done = true;
  medic.x = extract.x; medic.z = extract.z; sim.update(1 / 60);
  assert.equal(sim.phase, 'mission'); assert.equal(extract.progress, 1 / squad.length);
  down.x = extract.x + .5; down.z = extract.z; down.hp = 0; sim.update(1 / 60);
  assert.equal(sim.phase, 'mission'); assert.equal(sim.message, `${down.name} is down. Revive them before extracting.`);
  sim.selected = [medic.id]; sim.unitClick(down.id);
  step(sim, REVIVE_SECONDS + .5);
  assert.equal(sim.result, 'success'); assert.equal(extract.done, true);
});

const fullRoster = ['assault', 'support', 'recon', 'tech'].map((cls, i) => ({ id: `o${i}`, name: `OP${i}`, cls })) as Campaign['roster'];

test('a select-all move brings a full squad to a generated extraction corner', () => {
  const roster = fullRoster;
  for (let seed = 1; seed <= 8; seed++) {
    const sim = new Simulation(campaignWith('heist', { roster, offers: [contract('heist', 1, seed)] }));
    sim.deploy();
    const squad = sim.units.filter(u => u.faction === 'squad'), extract = sim.objectives.at(-1)!;
    assert.equal(squad.length, 4);
    sim.units = [...squad]; sim.objectives[0].done = true;
    squad.forEach(u => { u.x += (extract.x > 0 ? -6 : 6); u.z += (extract.z > 0 ? -6 : 6); u.path = []; });
    sim.selectAll(); sim.move({ x: extract.x, z: extract.z });
    assert.ok(squad.every(u => u.path.length), `seed ${seed}: an operative got no route`);
    step(sim, 20);
    assert.equal(sim.result, 'success', `seed ${seed}: ${squad.map(u => distance(u, extract).toFixed(2)).join(' ')}`);
  }
});

test('escort completes once the squad and the VIP are in the zone', () => {
  // Four abreast, the formation's ends sit 1.35 from the beacon, where a VIP trailing them would stop short.
  const { sim, squad } = arena('escort', { roster: fullRoster });
  const vip = sim.units.find(u => u.faction === 'vip')!, extract = sim.objectives.at(-1)!;
  assert.equal(squad.length, 4);
  vip.x = 1; vip.z = 2;
  step(sim, VIP_SECURE_SECONDS + .1); assert.equal(sim.objectives[0].done, true);
  sim.selectAll(); sim.move({ x: extract.x, z: extract.z });
  step(sim, 30);
  assert.equal(sim.result, 'success', `VIP ${distance(vip, extract).toFixed(2)} from extraction`);
});

test('the escort VIP joins, follows, and its death fails the contract', () => {
  const { sim, squad } = arena('escort');
  const vip = sim.units.find(u => u.faction === 'vip')!;
  vip.x = 8; vip.z = 0;
  step(sim, .5); assert.equal(sim.objectives[0].done, false);
  squad[0].x = 6; step(sim, VIP_SECURE_SECONDS - .5);
  assert.equal(sim.objectives[0].done, false); assert.ok(sim.objectives[0].progress > .8);
  step(sim, .6); assert.equal(sim.objectives[0].done, true);
  squad[0].x = 0; squad[0].z = 6; squad[1].x = -15; squad[1].z = 15;
  step(sim, 3); assert.ok(distance(vip, squad[0]) < 2.5, String(distance(vip, squad[0])));
  vip.hp = 0; sim.update(1 / 60);
  assert.equal(sim.result, 'failure'); assert.equal(sim.failReason, 'The VIP was killed.');
});

test('under fire the VIP keeps up, ducks behind nearby cover, and takes reduced damage', () => {
  const { sim, squad } = arena('escort');
  // A barrier beside the operative, with a guard firing from the far side of it.
  const cover = { x: 0, z: 2, w: 1.6, d: .45 };
  sim.plan = { ...sim.plan!, world: new World({ minX: -20, maxX: 20, minZ: -20, maxZ: 20 }, [], [cover]) };
  const vip = sim.units.find(u => u.faction === 'vip')!;
  squad.forEach((u, i) => { u.x = i; u.z = 0; });
  vip.x = 1; vip.z = -1;
  step(sim, VIP_SECURE_SECONDS + .1); assert.equal(sim.objectives[0].done, true);
  const before = vip.hp;
  (sim as unknown as { damage(t: Unit, n: number, from: Point): void }).damage(vip, 20, { x: 0, z: 6 });
  assert.equal(before - vip.hp, 20 * VIP_DAMAGE_TAKEN);
  step(sim, 1);
  assert.ok(sim.plan!.world.coverBetween({ x: 0, z: 6 }, vip), `VIP at ${vip.x.toFixed(2)}, ${vip.z.toFixed(2)} is not behind the barrier`);
});

test('the last known area always contains the assassination target at spawn', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const plan = planMission(contract('assassination', 1 + seed % MAX_TIER, seed)), target = plan.enemies.find(e => e.kind === 'target')!, area = plan.targetArea!;
    assert.equal(area.r, TARGET_AREA_RADIUS);
    assert.ok(distance(area, target) <= TARGET_AREA_OFFSET + 1e-9, `seed ${seed}: center ${distance(area, target).toFixed(2)} m from the target`);
    assert.ok(distance(area, target) < area.r, `seed ${seed}: target outside its area`);
    assert.deepEqual(planMission(contract('assassination', 1 + seed % MAX_TIER, seed)).targetArea, area);
  }
  assert.equal(planMission(contract('heist')).targetArea, null);
});

test('the target area recenters on where the target was last seen', () => {
  const { sim, squad, hostile } = arena('assassination');
  const target = hostile('target', 8, 0, Math.PI, 110);
  target.visible = false; sim.targetArea = { x: -5, z: -5, r: TARGET_AREA_RADIUS };
  sim.update(1 / 60);
  assert.ok(target.visible); assert.deepEqual([sim.targetArea.x, sim.targetArea.z], [8, 0]);
  squad.forEach(u => { u.x -= 15; });
  sim.update(1 / 60);
  assert.ok(!target.visible); assert.deepEqual([sim.targetArea.x, sim.targetArea.z], [8, 0]);
});

test('the assassination target flees on alarm and escaping fails', () => {
  const { sim, hostile } = arena('assassination');
  const target = hostile('target', 14, 0, 0, 110);
  sim.objectives[0].x = 14;
  raiseAlarm(sim, target, 'test');
  step(sim, 10);
  assert.equal(sim.result, 'failure'); assert.equal(sim.failReason, 'The target escaped.');
});

test('an EMP only delays a fleeing target', () => {
  const { sim, hostile } = arena('assassination', { roster: [{ id: 't', name: 'HEX', cls: 'tech' }] });
  const target = hostile('target', 5, 0, 0, 1e4); // survives the squad's fire for the whole test
  raiseAlarm(sim, target, 'test');
  step(sim, 5.5); assert.ok(target.path.length);
  sim.ability(0); sim.groundClick({ x: target.x, z: target.z }); sim.update(1 / 60);
  assert.ok(target.stunned > 0);
  step(sim, 30);
  assert.equal(sim.failReason, 'The target escaped.');
});

test('the first wave flanks from the exit nearest extraction soon after the alarm; later waves follow up to the cap', () => {
  const { sim, squad } = arena('heist');
  sim.plan = { ...sim.plan!, exits: [{ x: 19, z: 0 }, { x: -19, z: 5 }] };
  squad.forEach(u => { u.hp = u.maxHp = 1e6; });
  const waves = () => sim.units.filter(u => /^r\d+$/.test(u.id));
  raiseAlarm(sim, { x: 0, z: 0 }, 'test');
  step(sim, FIRST_WAVE_SECONDS - .1); assert.equal(waves().length, 0);
  step(sim, .2);
  assert.equal(waves().length, 2);
  assert.ok(waves().every(u => distance(u, { x: -19, z: 5 }) < 2), 'the first wave entered away from extraction');
  step(sim, REINFORCE_SECONDS); assert.equal(waves().length, 4);
  step(sim, REINFORCE_SECONDS * 4);
  assert.equal(waves().length, REINFORCE_CAP);
});

test('revive takes three still seconds, restarts on damage, and restores 40% HP', () => {
  const { sim, squad } = arena('heist');
  const [medic, down] = squad;
  down.hp = 0; down.x = 1;
  sim.selected = [medic.id]; sim.unitClick(down.id);
  step(sim, REVIVE_SECONDS - .5);
  medic.hurt = 0; (sim as unknown as { damage(t: Unit, n: number, f: null): void }).damage(medic, 1, null);
  assert.equal(medic.revive, 0);
  step(sim, REVIVE_SECONDS - .5); assert.equal(down.hp, 0);
  step(sim, 1); assert.equal(down.hp, Math.round(down.maxHp * .4));
  // An operative downed mid-move stays put once revived.
  (sim as unknown as { damage(t: Unit, n: number, f: null): void }).damage(medic, 0, null);
  down.path = [{ x: 10, z: 10 }]; (sim as unknown as { damage(t: Unit, n: number, f: null): void }).damage(down, 1e6, null);
  assert.deepEqual(down.path, []);
});

test('ability upgrades shorten cooldowns and strengthen heals', () => {
  assert.equal(abilityCooldown('grenade', 2), 18 * .7);
  const { sim, squad } = arena('heist', { abilities: { assault: 0, support: 2, recon: 0, tech: 0 } });
  squad[0].hp = 10;
  sim.ability(1); sim.update(1 / 60);
  assert.equal(squad[0].hp, 10 + 60 * 1.4);
  assert.ok(Math.abs(squad[1].abilityCd - 20 * .7) < .05);
});

test('fog of war hides hostiles behind buildings until marked', () => {
  const { sim, hostile } = arena('heist');
  sim.plan = { ...sim.plan!, world: new World(sim.plan!.world.bounds, [{ x: 3, z: 0, w: 2, d: 6, h: 3 }], []) };
  const guard = hostile('guard', 6, 0, 0);
  sim.update(1 / 60); assert.equal(guard.visible, false);
  sim.attack(guard.id); assert.equal(guard.targetId, null);
  guard.marked = 2; sim.update(1 / 60); assert.equal(guard.visible, true);
});

test('sight rays stop at the first building footprint', () => {
  const world = new World({ minX: -10, maxX: 10, minZ: -10, maxZ: 10 }, [{ x: 3, z: 0, w: 2, d: 2, h: 3 }, { x: 6, z: 0, w: 2, d: 2, h: 3 }], []);
  assert.ok(Math.abs(world.sightDistance({ x: 0, z: 0 }, 1, 0, 9) - 1.95) < 1e-9);
  assert.equal(world.sightDistance({ x: 0, z: 0 }, 0, 1, 9), 9);
  assert.equal(world.sightDistance({ x: 0, z: 0 }, 1, 0, 1.5), 1.5);
  assert.equal(world.sightDistance({ x: 3, z: 0 }, 0, 1, 9), 0);
  // A diagonal ray agrees with sightClear on where A starts blocking.
  const from = { x: 0, z: -2 }, at = (t: number) => ({ x: t * Math.SQRT1_2, z: -2 + t * Math.SQRT1_2 });
  const d = world.sightDistance(from, Math.SQRT1_2, Math.SQRT1_2, 9);
  assert.ok(Math.abs(d - 1.95 * Math.SQRT2) < 1e-9, String(d));
  assert.ok(world.sightClear(from, at(d - .01)));
  assert.equal(world.sightClear(from, at(d + .5)), false);
});

test('a hostile that leaves sight leaves a last-seen record until it is seen again', () => {
  const { sim, hostile } = arena('heist');
  const guard = hostile('guard', 0, -6, Math.PI);
  guard.patrol = [{ x: 0, z: -6 }, { x: 0, z: -16 }];
  sim.update(1 / 60); assert.equal(guard.visible, true); assert.equal(sim.lastSeen.size, 0);
  step(sim, 10, () => !guard.visible);
  const seen = sim.lastSeen.get(guard.id);
  assert.ok(seen, 'no record when the guard left sight');
  assert.ok(Math.abs(seen.z + SIGHT_RANGE) < .1 && seen.x === 0, JSON.stringify(seen));
  assert.equal(seen.heading, Math.PI); assert.equal(seen.at, sim.time);
  // The record holds still while the guard walks on out of sight, and goes once the guard is back in view.
  step(sim, GHOST_SECONDS, () => { if (guard.visible) return true; assert.deepEqual(sim.lastSeen.get(guard.id), seen); return false; });
  assert.equal(guard.visible, true);
  assert.ok(sim.time - seen.at < GHOST_SECONDS);
  assert.equal(sim.lastSeen.has(guard.id), false);
});

test('last-seen records fade after GHOST_SECONDS and drop for the dead and on restart', () => {
  const { sim, hostile } = arena('heist');
  const posted = hostile('guard', 0, -5, Math.PI), other = hostile('guard', 3, -5, Math.PI);
  sim.update(1 / 60);
  posted.z = -18; other.z = -18; sim.update(1 / 60);
  assert.deepEqual(sim.lastSeen.get(posted.id), { x: 0, z: -18, heading: posted.heading, at: sim.time });
  other.hp = 0; sim.update(1 / 60);
  assert.equal(sim.lastSeen.has(other.id), false);
  step(sim, GHOST_SECONDS - .2);
  assert.ok(sim.lastSeen.has(posted.id));
  step(sim, .3);
  assert.equal(sim.lastSeen.has(posted.id), false);
  posted.z = -5; sim.update(1 / 60); posted.z = -18; sim.update(1 / 60);
  assert.equal(sim.lastSeen.size, 1);
  sim.restart(); assert.equal(sim.lastSeen.size, 0);
});

test('watching a guard finish a patrol leg reveals its whole route', () => {
  const { sim, hostile } = arena('heist');
  const watched = hostile('guard', 0, -3, Math.PI), far = hostile('guard', 0, -15, Math.PI);
  watched.patrol = [{ x: 0, z: -3 }, { x: 0, z: -7 }]; far.patrol = [{ x: 0, z: -15 }, { x: 0, z: -19 }];
  step(sim, 10, () => sim.intel.has(watched.id));
  assert.deepEqual(sim.intel.get(watched.id), [{ x: 0, z: -3 }, { x: 0, z: -7 }, { x: 0, z: -3 }]);
  assert.deepEqual({ x: watched.x, z: watched.z }, { x: 0, z: -7 }, 'learned at the end of the first leg');
  step(sim, 10);
  assert.equal(sim.intel.has(far.id), false, 'a leg walked out of sight teaches nothing');
  assert.ok(sim.intel.has(watched.id), 'intel lasts the mission');
});

test('squad loss pays nothing and the board rerolls for the next contract', () => {
  const sim = new Simulation(campaignWith('heist', { cash: 200, weapon: 2 }));
  const offered = sim.campaign.offers[0].id;
  sim.deploy();
  assert.ok(!sim.campaign.offers.some(o => o.id === offered));
  sim.units.filter(u => u.faction === 'squad').forEach(u => { u.hp = 0; }); sim.update(.05);
  assert.equal(sim.result, 'failure'); assert.equal(sim.campaign.cash, 200);
  sim.openBoard(); assert.equal(sim.phase, 'briefing'); assert.ok(sim.contract);
  sim.deploy(); assert.equal(sim.units[0].hp, sim.units[0].maxHp);
});

test('headquarters trades report to the server and respect the roster', () => {
  const { events, sync } = recorder();
  const sim = new Simulation({ ...campaignWith('heist'), cash: 1000 }, sync);
  assert.ok(sim.buy('tech')); assert.equal(sim.campaign.abilities.tech, 1);
  const recruit = sim.campaign.recruits[0];
  assert.ok(sim.recruit(recruit.id)); assert.equal(sim.campaign.roster.length, 3);
  assert.equal(sim.campaign.cash, 400);
  assert.ok(sim.dismiss('vex')); assert.ok(!sim.squadPick.includes('vex'));
  assert.deepEqual(events, ['bought:tech', `recruited:${recruit.id}`, 'dismissed:vex']);
  sim.toggleSquad(recruit.id); assert.equal(events.at(-1), `picked:rook,${recruit.id}`);
  sim.deploy();
  assert.deepEqual(sim.squad, ['rook', recruit.id]);
  assert.equal(sim.buy('weapon'), false);
});

test('a restored squad pick keeps only rostered operatives and rebuilds the briefing', () => {
  const sim = new Simulation({ ...campaignWith('heist'), cash: 1000 });
  const recruit = sim.campaign.recruits[0];
  assert.ok(sim.recruit(recruit.id));
  sim.restoreSquadPick([recruit.id, 'gone', recruit.id]);
  assert.deepEqual(sim.squadPick, [recruit.id]);
  assert.deepEqual(sim.units.filter(u => u.faction === 'squad').map(u => u.id), [recruit.id]);
  sim.restoreSquadPick(['gone']);
  assert.deepEqual(sim.squadPick, [recruit.id]);
  sim.deploy(); sim.restoreSquadPick(['vex']);
  assert.deepEqual(sim.squad, [recruit.id]);
});

test('a server campaign replaces local state and rebuilds the briefing', () => {
  const sim = new Simulation();
  const server = { ...freshCampaign(mulberry32(3)), cash: 750, armor: 2 };
  sim.applyCampaign(server);
  assert.equal(sim.getSnapshot().campaign.cash, 750);
  assert.equal(sim.contract?.id, server.offers[0].id);
  assert.equal(sim.units.find(u => u.id === 'vex')!.maxHp, CLASS_STATS.assault.hp + 2 * HEAVY_HP);
});

test('the sync flag reaches the snapshot and notifies only when it changes', () => {
  const sim = new Simulation();
  let notified = 0;
  sim.subscribe(() => notified++);
  sim.setSyncing(true);
  assert.equal(sim.getSnapshot().syncing, true);
  sim.setSyncing(true);
  sim.setSyncing(false);
  assert.equal(sim.getSnapshot().syncing, false);
  assert.equal(notified, 2);
});
