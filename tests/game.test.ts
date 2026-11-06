import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, parseCampaign, FLEE_DELAY, HOSTILE_STATS, posted, CALM_SECONDS, COUNTERMEASURES, EXTENDED_RANGE, HEAVY_HP, LIGHT_CONCEALMENT, PIERCING_BONUS, SUPPRESSOR_STEP, CALM_STEP, escalation, FIRST_WAVE_SECONDS, waveSize, REPEAT_REINFORCEMENTS, VIP_DAMAGE_TAKEN, VIP_SECURE_SECONDS, CAMERA_DETECT, COVER_FACTOR, DETECT_DRAIN, detectSeconds, GHOST_SECONDS, HACK_SECONDS, LOOK_ANGLE, LOOK_EVERY, LOOK_PAUSE, QUEUE_SPACING, REINFORCE_CAP, ROUTE_MAX, SUSPICIOUS, REINFORCE_SECONDS, REVIVE_SECONDS, SIGHT_RANGE, TAKEDOWN_REACH, TAKEDOWN_SECONDS, tierDamage, tierHp, WAIT_MAX, WAIT_STEP } from '../src/game/simulation.ts';
import type { CampaignSync, Unit, Upgrade } from '../src/game/simulation.ts';
import { CAMPAIGN_VERSION, CONTRACT_TYPES, contractPayout, IDENTIFY_RANGE, IDENTIFY_SECONDS, LOCKDOWN_SECONDS, FIRST_CONTRACT, freshCampaign, MAX_LEVEL, MAX_TIER, parSeconds } from '../src/game/campaign.ts';
import type { ArmorMode, Campaign, ContractType, MissionReport, WeaponMode } from '../src/game/campaign.ts';
import { abilityCooldown, CLASS_STATS } from '../src/game/classes.ts';
import { COURIER_DELAY, COURIER_MIN_RUN, interceptable, mapSize, planMission, TARGET_AREA_OFFSET, TARGET_AREA_RADIUS } from '../src/game/mapgen.ts';
import type { EnemyKind } from '../src/game/mapgen.ts';
import { mulberry32 } from '../src/game/rng.ts';
import { distance, World } from '../src/game/world.ts';
import type { Point } from '../src/game/world.ts';

const recorder = () => {
  const events: string[] = [];
  const sync: CampaignSync = {
    deployed: (id, squad) => events.push(`deployed:${id}:${squad.join(',')}`), completed: r => events.push(`completed:${r.stealth}`),
    bought: (t: Upgrade) => events.push(`bought:${t}`), equipped: l => events.push(`equipped:${l.weapon}/${l.armor}`), recruited: id => events.push(`recruited:${id}`), dismissed: id => events.push(`dismissed:${id}`),
    picked: squad => events.push(`picked:${squad.join(',')}`),
  };
  return { events, sync };
};
const contract = (type: ContractType, tier = 1, seed = 1234) => ({ id: `c-${type}`, type, tier, seed, payout: contractPayout(tier), district: 'GLASS DISTRICT', sector: 4 });
const campaignWith = (type: ContractType, extra: Partial<Campaign> = {}): Campaign => ({ ...freshCampaign(mulberry32(7)), offers: [contract(type)], ...extra });
const step = (sim: Simulation, seconds: number, until?: () => boolean) => {
  for (let i = 0; i < seconds * 60 && sim.phase === 'mission' && !until?.(); i++) sim.update(1 / 60);
};

// An open, building-free arena so each rule can be checked in isolation.
function arena(type: ContractType = 'heist', extra: Partial<Campaign> = {}, sync?: CampaignSync, countermeasures = 0) {
  const sim = new Simulation(campaignWith(type, extra), sync);
  sim.chooseCountermeasures(countermeasures);
  sim.deploy();
  const world = new World({ minX: -20, maxX: 20, minZ: -20, maxZ: 20 }, [], []);
  sim.plan = { ...sim.plan!, world, extract: { x: -18, z: -18 }, exits: [{ x: 19, z: 0 }] };
  const extract = sim.objectives.at(-1)!; extract.x = -18; extract.z = -18;
  const squad = sim.units.filter(u => u.faction === 'squad');
  squad.forEach((u, i) => { u.x = i; u.z = 0; u.path = []; });
  sim.units = [...squad, ...sim.units.filter(u => u.faction === 'vip')];
  const hostile = (kind: EnemyKind, x: number, z: number, heading = 0, hp = 75): Unit => {
    const u: Unit = { ...squad[0], id: `t-${sim.units.length}`, name: kind.toUpperCase(), kind, faction: 'hostile', x, z, heading, sweep: heading, hp, maxHp: hp, ability: null, cooldown: 0, path: [], route: [], patrol: [], targetId: null, visible: true };
    sim.units.push(u); return u;
  };
  return { sim, squad, hostile, world };
}

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
  const world = new World({ minX: -10, maxX: 10, minZ: -10, maxZ: 10 }, [{ x: 0, z: 0, w: 4, d: 4, h: 3, name: 'B', accent: '#fff' }], [{ x: 0, z: 6, w: 1.6, d: .45 }]);
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
  guard.hp = 0; (sim as unknown as { raiseAlarm(p: object, r: string): void }).raiseAlarm({ x: 0, z: 0 }, 'test');
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
  assert.equal(internals(sim).autoPaused.size, 0, 'a restart forgets who already paused');
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

// A barrier lying across the street north of the squad: from z < 5 it shelters whoever crouches at z ≈ 6.
const BARRIER = { x: 0, z: 5.3, w: 1.6, d: .45 };
const withBarrier = (sim: Simulation) => { sim.plan = { ...sim.plan!, world: new World(sim.plan!.world.bounds, [], [BARRIER]) }; };

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
  sim.plan && (sim as unknown as { raiseAlarm(p: object, r: string): void }).raiseAlarm({ x: 0, z: 0 }, 'test');
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
  (sim as unknown as { raiseAlarm(p: object, r: string): void }).raiseAlarm(target, 'test');
  step(sim, 10);
  assert.equal(sim.result, 'failure'); assert.equal(sim.failReason, 'The target escaped.');
});

test('an EMP only delays a fleeing target', () => {
  const { sim, hostile } = arena('assassination', { roster: [{ id: 't', name: 'HEX', cls: 'tech' }] });
  const target = hostile('target', 5, 0, 0, 1e4); // survives the squad's fire for the whole test
  (sim as unknown as { raiseAlarm(p: object, r: string): void }).raiseAlarm(target, 'test');
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
  (sim as unknown as { raiseAlarm(p: object, r: string): void }).raiseAlarm({ x: 0, z: 0 }, 'test');
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
  sim.plan = { ...sim.plan!, world: new World(sim.plan!.world.bounds, [{ x: 3, z: 0, w: 2, d: 6, h: 3, name: 'B', accent: '#fff' }], []) };
  const guard = hostile('guard', 6, 0, 0);
  sim.update(1 / 60); assert.equal(guard.visible, false);
  sim.attack(guard.id); assert.equal(guard.targetId, null);
  guard.marked = 2; sim.update(1 / 60); assert.equal(guard.visible, true);
});

test('sight rays stop at the first building footprint', () => {
  const world = new World({ minX: -10, maxX: 10, minZ: -10, maxZ: 10 }, [{ x: 3, z: 0, w: 2, d: 2, h: 3, name: 'A', accent: '#fff' }, { x: 6, z: 0, w: 2, d: 2, h: 3, name: 'B', accent: '#fff' }], []);
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

// ---- Alarm stand-down ----
const internals = (sim: Simulation) => sim as unknown as { raiseAlarm(p: Point, r: string): void; reinforced: number; lastKnown: Point | null; autoPaused: Set<string> };
// An alarm with no reinforcement waves left, so only the units a test places can keep contact.
function alarmed(type: ContractType = 'heist', extra: Partial<Campaign> = {}, sync?: CampaignSync, countermeasures = 0) {
  const a = arena(type, extra, sync, countermeasures);
  internals(a.sim).reinforced = REINFORCE_CAP;
  return { ...a, raise: (at: Point = { x: 0, z: 0 }) => internals(a.sim).raiseAlarm(at, 'test') };
}

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
  const known = { ...internals(sim).lastKnown! };
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

const waves = (sim: Simulation) => sim.units.filter(u => /^r\d+$/.test(u.id));

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
  internals(sim).reinforced = REINFORCE_CAP - 2; // the first alarm stood down with two of its reinforcements unsent
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

// ---- Squad movement through narrow streets ----
const FOUR: Partial<Campaign> = { roster: [{ id: 'vex', name: 'VEX', cls: 'assault' }, { id: 'rook', name: 'ROOK', cls: 'support' }, { id: 'kai', name: 'KAI', cls: 'recon' }, { id: 'nova', name: 'NOVA', cls: 'tech' }] };
const block = (x0: number, x1: number, z0: number, z1: number) => ({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0, h: 3, name: 'B', accent: '#fff' });
// A 1.4 m alley along z at x = 0, too narrow for the side-by-side spread.
const ALLEY = [block(-6, -.7, -2, 10), block(.7, 6, -2, 10)];
// A walled-in room around (15, 15) that nothing outside can reach.
const POCKET = [block(12, 18, 17.5, 18.5), block(12, 18, 11.5, 12.5), block(11.5, 12.5, 11.5, 18.5), block(17.5, 18.5, 11.5, 18.5)];
function streets(buildings = ALLEY, type: ContractType = 'heist') {
  const a = arena(type, FOUR);
  a.sim.plan = { ...a.sim.plan!, world: new World(a.world.bounds, buildings, []) };
  a.squad.forEach((u, i) => { u.x = i - 1.5; u.z = -5; });
  return a;
}
const settle = (sim: Simulation, units: Unit[]) => {
  const done = () => units.every(u => !u.path.length && !u.route.length && !u.wait);
  step(sim, 30, done);
  assert.equal(sim.phase, 'mission'); assert.ok(done(), 'still walking');
};
const spaced = (units: Point[]) => units.every((u, i) => units.every((v, j) => i === j || distance(u, v) >= QUEUE_SPACING - 1e-3));

test('the squad queues single file into an alley too narrow to stand abreast', () => {
  const { sim, squad } = streets();
  sim.move({ x: 0, z: 8 });
  assert.ok(squad.every(u => u.path.length), 'someone ignored the order');
  settle(sim, squad);
  const byZ = [...squad].sort((a, b) => b.z - a.z);
  assert.ok(distance(byZ[0], { x: 0, z: 8 }) < 1e-6);
  for (const u of squad) { assert.ok(sim.plan!.world.walkable(u)); assert.ok(Math.abs(u.x) < .32 && u.z > -2, JSON.stringify(u)); }
  for (let i = 1; i < byZ.length; i++) assert.ok(byZ[i - 1].z - byZ[i].z >= QUEUE_SPACING - 1e-3, `gap ${i}`);
});

test('a leader already on the point still gets a queue behind it, not a pile', () => {
  const { sim, squad } = streets();
  squad[0].x = 0; squad[0].z = 8;
  sim.move({ x: 0, z: 8 }); settle(sim, squad);
  assert.ok(spaced(squad), JSON.stringify(squad.map(u => [u.x, u.z])));
});

test('operatives bunched on the point all still move, stacking where the route runs out', () => {
  const { sim, squad } = streets();
  squad.forEach((u, i) => { u.x = 0; u.z = 7.9 + i * .05; });
  sim.move({ x: 0, z: 8 });
  for (const u of squad) assert.deepEqual(u.path.at(-1), { x: 0, z: 8 });
});

test('the queue follows a bent alley around its corner', () => {
  // The alley runs north at x = 0, then turns east along z = 7.
  const { sim, squad } = streets([block(-6, -.7, -2, 10), block(.7, 6, -2, 6.3), block(.7, 6, 7.7, 10)]);
  sim.move({ x: 5, z: 7 }); settle(sim, squad);
  for (const u of squad) assert.ok(sim.plan!.world.walkable(u), JSON.stringify(u));
  assert.ok(spaced(squad));
});

test('an operative who cannot reach the point keeps its orders; the rest queue', () => {
  const { sim, squad } = streets([...ALLEY, ...POCKET]);
  const stuck = squad[3]; stuck.x = 15; stuck.z = 15; stuck.path = [{ x: 16, z: 15 }];
  sim.move({ x: 0, z: 8 });
  assert.deepEqual(stuck.path, [{ x: 16, z: 15 }]);
  const rest = squad.slice(0, 3); settle(sim, rest);
  assert.ok(spaced(rest)); assert.ok(rest.every(u => Math.abs(u.x) < .32));
});

test('when only some fit abreast, the whole squad queues instead', () => {
  // 2.2 m wide: the inner pair could stand abreast, the outer pair could not.
  const { sim, squad } = streets([block(-6, -1.1, -2, 10), block(1.1, 6, -2, 10)]);
  sim.move({ x: 0, z: 8 }); settle(sim, squad);
  const zs = squad.map(u => u.z).sort((a, b) => b - a);
  for (let i = 1; i < zs.length; i++) assert.ok(zs[i - 1] - zs[i] >= QUEUE_SPACING - 1e-3, String(zs));
});

test('in the open the squad still spreads side by side', () => {
  const { sim, squad } = streets([]);
  sim.move({ x: 10, z: 10 });
  squad.forEach((u, i) => assert.deepEqual(u.path.at(-1), { x: 10 + (i - 1.5) * QUEUE_SPACING, z: 10 }));
});

test('a point nobody can reach is refused and leaves every order alone', () => {
  const { sim, squad } = streets([...ALLEY, ...POCKET]);
  squad.forEach(u => { u.path = [{ x: -10, z: -10 }]; });
  sim.move({ x: 15, z: 15 });
  assert.match(sim.message, /Route blocked/); assert.equal(sim.commandPoint, null);
  for (const u of squad) assert.deepEqual(u.path, [{ x: -10, z: -10 }]);
});

test('holding position stops the squad and clears the move destination', () => {
  const { sim, squad } = streets([]);
  sim.move({ x: 10, z: 10 });
  assert.ok(sim.commandPoint);
  sim.hold();
  assert.equal(sim.commandPoint, null);
  for (const u of squad) assert.deepEqual(u.path, []);
});

test('a click on the VIP sends the squad to where the VIP stood', () => {
  const { sim, squad } = streets(ALLEY, 'escort');
  const vip = sim.units.find(u => u.faction === 'vip')!; vip.x = 0; vip.z = 8;
  sim.unitClick(vip.id);
  vip.x = 0; vip.z = 3;
  assert.ok(squad.every(u => u.path.length));
  assert.ok(squad.some(u => u.path.at(-1)!.z === 8)); assert.ok(squad.every(u => u.path.at(-1) !== vip));
});

test('a move order cancels attack and revive orders, abreast or in a queue', () => {
  for (const buildings of [[], ALLEY]) {
    const { sim, squad } = streets(buildings);
    squad.forEach(u => { u.targetId = 'h0'; u.reviveTarget = 'rook'; u.revive = 1; });
    sim.move({ x: 0, z: 8 });
    for (const u of squad) { assert.equal(u.targetId, null); assert.equal(u.reviveTarget, null); assert.equal(u.revive, 0); }
  }
});

test('the same order in the same alley gives the same queue', () => {
  const runs = [streets(), streets()].map(({ sim, squad }) => { sim.move({ x: 0, z: 8 }); return squad.map(u => u.path); });
  assert.deepEqual(runs[0], runs[1]);
});

// ---- Waypoint routes ----
const stops = (sim: Simulation, u: Unit) => sim.waypoints(u).map(w => [w.x, w.z, w.wait]);
// Steps frame by frame until `u` stands exactly on `p` (walk() lands on each path point), returning the mission time.
const reach = (sim: Simulation, u: Unit, p: Point, seconds = 30) => {
  step(sim, seconds, () => u.x === p.x && u.z === p.z);
  assert.ok(u.x === p.x && u.z === p.z, `${u.name} never reached ${JSON.stringify(p)}`);
  return sim.time;
};

test('an appended waypoint starts where the route ends, and the legs are walked in order', () => {
  const { sim, squad } = streets(), vex = squad[0];
  sim.select(vex.id);
  sim.move({ x: 10, z: -10 }); sim.move({ x: 10, z: 5 }, true);
  assert.match(sim.message, /Waypoint added/);
  assert.deepEqual(stops(sim, vex), [[10, -10, 0], [10, 5, 0]]);
  // From where VEX stands the alley's east block is in the way; from the first waypoint it is a straight run.
  assert.ok(sim.plan!.world.findPath(vex, { x: 10, z: 5 }).length > 1);
  assert.deepEqual(vex.route.map(leg => leg.path), [[{ x: 10, z: 5 }]], 'the second leg runs from the first waypoint');
  reach(sim, vex, { x: 10, z: -10 });
  assert.equal(vex.route.length, 1);
  settle(sim, [vex]);
  assert.deepEqual([vex.x, vex.z], [10, 5]); assert.deepEqual(stops(sim, vex), []);
});

test('routes planned leg by leg while paused wait for the resume', () => {
  const { sim, squad } = streets([]), vex = squad[0];
  sim.select(vex.id); sim.togglePause();
  sim.move({ x: 5, z: -5 }); sim.move({ x: 5, z: 5 }, true); sim.move({ x: -5, z: 5 }, true);
  const before = structuredClone(sim.units);
  step(sim, 1);
  assert.deepEqual(sim.units, before);
  sim.togglePause();
  reach(sim, vex, { x: 5, z: -5 }); reach(sim, vex, { x: 5, z: 5 }); reach(sim, vex, { x: -5, z: 5 });
});

test('a plain click replaces the whole route', () => {
  const { sim, squad } = streets([]), vex = squad[0];
  sim.select(vex.id);
  sim.move({ x: 5, z: -5 }); sim.move({ x: 5, z: 5 }, true); sim.addWait();
  sim.move({ x: -5, z: -10 });
  assert.match(sim.message, /Move order confirmed/);
  assert.deepEqual(stops(sim, vex), [[-5, -10, 0]]); assert.deepEqual(vex.route, []);
});

test('appended into an alley, the squad lines up from where its routes end and queues single file', () => {
  const { sim, squad } = streets();
  const slots = squad.map((_, i) => ({ x: 10 + (i - 1.5) * QUEUE_SPACING, z: -10 }));
  sim.move({ x: 10, z: -10 }); sim.move({ x: 0, z: 8 }, true);
  squad.forEach((u, i) => { assert.deepEqual(sim.waypoints(u)[0], { ...slots[i], wait: 0 }); assert.equal(u.route.length, 1); });
  // The queue is the one a plain order would give a squad already standing on those slots.
  const there = streets();
  there.squad.forEach((u, i) => { u.x = slots[i].x; u.z = slots[i].z; });
  there.sim.move({ x: 0, z: 8 });
  assert.deepEqual(squad.map(u => u.route[0].path), there.squad.map(u => u.path));
  const passed = new Set<Unit>();
  step(sim, 30, () => {
    squad.forEach((u, i) => { if (u.x === slots[i].x && u.z === slots[i].z) passed.add(u); });
    return squad.every(u => !u.path.length && !u.route.length);
  });
  assert.equal(passed.size, squad.length, 'someone cut the corner past its first waypoint');
  const byZ = [...squad].sort((a, b) => b.z - a.z);
  assert.ok(distance(byZ[0], { x: 0, z: 8 }) < 1e-6);
  for (const u of squad) assert.ok(Math.abs(u.x) < .32 && u.z > -2, JSON.stringify(u));
  for (let i = 1; i < byZ.length; i++) assert.ok(byZ[i - 1].z - byZ[i].z >= QUEUE_SPACING - 1e-3, `gap ${i}`);
});

test('a plain order into an alley drops a planned route and queues from where the squad stands', () => {
  const fresh = streets(), planned = streets();
  fresh.sim.move({ x: 0, z: 8 });
  planned.sim.move({ x: 10, z: -10 }); planned.sim.move({ x: -10, z: -10 }, true);
  planned.sim.move({ x: 0, z: 8 });
  assert.deepEqual(planned.squad.map(u => u.path), fresh.squad.map(u => u.path));
  for (const u of planned.squad) assert.deepEqual(u.route, []);
});

test('the same appended orders give the same routes', () => {
  const runs = [streets(), streets()].map(({ sim, squad }) => {
    sim.move({ x: 10, z: -10 }); sim.move({ x: 0, z: 8 }, true); sim.move({ x: 4, z: 12 }, true);
    return squad.map(u => [u.path, u.route]);
  });
  assert.deepEqual(runs[0], runs[1]);
});

test('a wait at a waypoint lets two operatives time a crossing', () => {
  const { sim, squad } = streets([]), [vex, rook] = squad;
  sim.select(vex.id); sim.move({ x: vex.x, z: 0 }); sim.addWait(); sim.move({ x: vex.x, z: 5 }, true);
  assert.deepEqual(stops(sim, vex), [[vex.x, 0, WAIT_STEP], [vex.x, 5, 0]]);
  assert.match(sim.message, /Waypoint added/);
  sim.select(rook.id); sim.move({ x: rook.x, z: 0 }); sim.move({ x: rook.x, z: 5 }, true);
  const on = (u: Unit, x: number, z: number) => u.x === x && u.z === z, t = { stop: 0, off: 0, rook: 0, vex: 0, left: -1 };
  step(sim, 30, () => {
    if (!t.stop && on(vex, vex.x, 0)) t.stop = sim.time;
    if (t.stop && !t.off && !on(vex, vex.x, 0)) t.off = sim.time;
    if (t.stop && !t.off && t.left < 0 && sim.time - t.stop >= 1) t.left = stops(sim, vex)[0][2] - (WAIT_STEP - (sim.time - t.stop));
    if (!t.rook && on(rook, rook.x, 5)) t.rook = sim.time;
    if (on(vex, vex.x, 5)) t.vex = sim.time;
    return !!t.vex;
  });
  const frame = 2 / 60;
  assert.ok(Math.abs(t.off - t.stop - WAIT_STEP) < frame, `held ${t.off - t.stop} s`);
  assert.ok(Math.abs(t.left) < frame, 'the marker counts the wait down');
  assert.ok(t.rook && Math.abs(t.vex - t.rook - WAIT_STEP) < frame, `VEX ${t.vex} s, ROOK ${t.rook} s`);
});

test('each wait order adds WAIT_STEP at the last waypoint and one past WAIT_MAX clears it', () => {
  const { sim, squad } = streets([]), vex = squad[0];
  sim.select(vex.id); sim.move({ x: 5, z: -5 }); sim.move({ x: 5, z: 5 }, true);
  for (let w = WAIT_STEP; w <= WAIT_MAX; w += WAIT_STEP) { sim.addWait(); assert.equal(vex.route[0].wait, w); }
  assert.equal(vex.wait, 0, 'only the last waypoint waits');
  sim.addWait();
  assert.equal(vex.route[0].wait, 0); assert.equal(sim.message, 'Wait cleared.');
});

test('without a route a wait holds the operative where it stands, then it takes the appended leg', () => {
  const { sim, squad } = streets([]), vex = squad[0], start = { x: vex.x, z: vex.z };
  sim.select(vex.id); sim.addWait();
  assert.deepEqual(stops(sim, vex), [[start.x, start.z, WAIT_STEP]]);
  sim.move({ x: start.x, z: 0 }, true);
  assert.deepEqual(stops(sim, vex), [[start.x, start.z, WAIT_STEP], [start.x, 0, 0]], 'the leg queues behind the wait');
  step(sim, WAIT_STEP - .1);
  assert.deepEqual([vex.x, vex.z], [start.x, start.z]);
  step(sim, .5);
  assert.ok(vex.z > start.z);
  sim.hold();
  assert.deepEqual(stops(sim, vex), []); assert.equal(vex.wait, 0);
});

test('an appended waypoint replaces an attack order instead of queuing behind it', () => {
  const { sim, squad, hostile } = arena(), vex = squad[0];
  const guard = hostile('guard', 8, 8, Math.PI);
  sim.select(vex.id); sim.attack(guard.id);
  assert.ok(vex.targetId || vex.takedownId);
  sim.move({ x: -5, z: 5 }, true);
  assert.equal(vex.targetId, null); assert.equal(vex.takedownId, null);
  assert.deepEqual(stops(sim, vex), [[-5, 5, 0]]);
});

test(`a route holds ${ROUTE_MAX} waypoints`, () => {
  const { sim, squad } = streets([]), vex = squad[0];
  sim.select(vex.id); sim.move({ x: 0, z: 0 });
  for (let i = 1; i < ROUTE_MAX; i++) sim.move({ x: i, z: i % 2 ? 4 : 0 }, true);
  assert.equal(sim.waypoints(vex).length, ROUTE_MAX);
  const route = structuredClone(vex.route), point = sim.commandPoint;
  sim.move({ x: -5, z: -5 }, true);
  assert.match(sim.message, /Route full/); assert.deepEqual(vex.route, route); assert.equal(sim.commandPoint, point);
});

test('a downed operative drops its route', () => {
  const { sim, squad } = streets([]), vex = squad[0];
  sim.select(vex.id); sim.move({ x: 5, z: -5 }); sim.move({ x: 5, z: 5 }, true); sim.addWait();
  (sim as unknown as { damage(u: Unit, n: number, from: Point | null): void }).damage(vex, vex.hp, null);
  assert.deepEqual(vex.route, []); assert.deepEqual(stops(sim, vex), []);
});

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
  const [vex, rook] = squad;
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

// ---- Gear loadouts ----
const geared = (weapon: WeaponMode, armor: ArmorMode, level = MAX_LEVEL): Partial<Campaign> => ({ weapon: level, armor: level, loadout: { weapon, armor } });

test('piercing rounds add damage a level; suppressed and extended rifles trade it away', () => {
  const base = CLASS_STATS.assault.damage + CLASS_STATS.support.damage;
  for (const [mode, bonus] of [['piercing', MAX_LEVEL * PIERCING_BONUS], ['suppressed', 0], ['extended', 0]] as const) {
    const { sim, hostile } = arena('heist', geared(mode, 'heavy'));
    assert.equal(sim.attackPreview(hostile('guard', 3, 0, Math.PI / 2, 1e4).id)!.damage, base + 2 * bonus, mode);
  }
  const { sim, hostile } = arena('heist', geared('piercing', 'heavy', 0));
  assert.equal(sim.attackPreview(hostile('guard', 3, 0, Math.PI / 2, 1e4).id)!.damage, base);
});

test('extended barrels let the squad fire from farther away', () => {
  const far = CLASS_STATS.assault.range + MAX_LEVEL * EXTENDED_RANGE - .2;
  for (const [mode, hits] of [['extended', true], ['piercing', false]] as const) {
    const { sim, squad, hostile } = arena('heist', geared(mode, 'heavy'));
    squad[1].x = -15; squad[1].z = 15;
    const guard = hostile('guard', far, 0, Math.PI / 2, 1e6); // out of its own range, its back to VEX
    (sim as unknown as { raiseAlarm(p: Point, r: string): void }).raiseAlarm(guard, 'test');
    step(sim, .5);
    assert.equal(guard.hp < 1e6, hits, mode);
  }
});

test('heavy plating adds health a level; light plating trades it away', () => {
  const vex = (armor: ArmorMode) => arena('heist', geared('piercing', armor)).squad[0].maxHp;
  assert.equal(vex('heavy'), CLASS_STATS.assault.hp + MAX_LEVEL * HEAVY_HP);
  assert.equal(vex('light'), CLASS_STATS.assault.hp);
});

test('light plating makes hostiles slower to notice the squad, but not the VIP', () => {
  const squadSeen = (armor: ArmorMode) => {
    const { sim, hostile } = arena('heist', geared('piercing', armor));
    hostile('guard', 3, 0, -Math.PI / 2, 40).lookEvery = 1e9;
    step(sim, 20, () => sim.alarm); return sim.time;
  };
  const close = (t: number, want: number) => assert.ok(Math.abs(t - want) <= 1 / 60 + 1e-9, `${t} vs ${want}`);
  close(squadSeen('heavy'), detectSeconds('guard', 2));
  close(squadSeen('light'), detectSeconds('guard', 2) * (1 + MAX_LEVEL * LIGHT_CONCEALMENT));
  // Only the VIP is in the guard's sight: VEX stands just past its vision, ROOK far away.
  const vipSeen = (armor: ArmorMode) => {
    const { sim, squad, hostile } = arena('escort', geared('piercing', armor));
    const vip = sim.units.find(u => u.faction === 'vip')!;
    squad[0].x = 0; squad[0].z = 0; squad[1].x = 15; squad[1].z = 15; vip.x = -1.5; vip.z = 0;
    step(sim, VIP_SECURE_SECONDS + .1); assert.equal(sim.objectives[0].done, true);
    const start = sim.time;
    hostile('guard', -7.5, 0, Math.PI / 2, 40).lookEvery = 1e9;
    step(sim, 20, () => sim.alarm); return sim.time - start;
  };
  assert.equal(vipSeen('light'), vipSeen('heavy'));
});

test('suppressed rifles leave a hostile that survives a hit suspicious, until hits tip it into the alarm', () => {
  const { sim, hostile } = arena('heist', geared('suppressed', 'heavy'));
  const heavy = hostile('heavy', 4, 0, Math.PI / 2, 180); // its back to the squad
  heavy.lookEvery = 1e9;
  sim.select('vex'); // a heavy needs two for a takedown, so one operative fires instead
  assert.equal(sim.attackPreview(heavy.id)!.outcome, 'suspicious');
  assert.match(sim.attackHint(heavy.id)!, /turns suspicious/);
  sim.attack(heavy.id); step(sim, 1, () => heavy.hp < 180);
  assert.ok(heavy.hp < 180); assert.equal(sim.alarm, false);
  assert.ok(Math.abs(heavy.detect - (1 - MAX_LEVEL * SUPPRESSOR_STEP)) < .02, String(heavy.detect));
  step(sim, 6, () => sim.alarm);
  assert.equal(sim.alarm, true); assert.ok(heavy.hp > 0);
  // Without suppressor levels, the first hit raises the alarm as before.
  const plain = arena('heist', geared('suppressed', 'heavy', 0));
  const other = plain.hostile('heavy', 4, 0, Math.PI / 2, 180);
  plain.sim.select('vex'); assert.equal(plain.sim.attackPreview(other.id)!.outcome, 'alert');
  plain.sim.attack(other.id); step(plain.sim, 1, () => other.hp < 180);
  assert.equal(plain.sim.alarm, true);
});

test('switching the loadout is free, reported to the server, and refused mid-mission', () => {
  const { events, sync } = recorder();
  const sim = new Simulation(campaignWith('heist'), sync), cash = sim.campaign.cash;
  assert.ok(sim.equip({ weapon: 'suppressed', armor: 'light' }));
  assert.deepEqual(sim.campaign.loadout, { weapon: 'suppressed', armor: 'light' }); assert.equal(sim.campaign.cash, cash);
  assert.equal(events.at(-1), 'equipped:suppressed/light');
  sim.deploy();
  assert.equal(sim.equip({ weapon: 'piercing', armor: 'heavy' }), false);
});

// ---- Badges ----
// Wins an arena contract once its objectives are done: the whole squad steps into extraction.
const extractAll = (sim: Simulation, squad: Unit[]) => { squad.forEach(u => { u.x = -18; u.z = -18; u.path = []; }); sim.update(1 / 60); };
const hack = (sim: Simulation, squad: Unit[]) => { const t = sim.objectives[0]; squad.forEach(u => { u.x = t.x; u.z = t.z; u.path = []; }); step(sim, HACK_SECONDS + .5); };

test('a quiet, clean, quick win earns Ghost, Untouched, Swift and Bloodless, and reports them', () => {
  const reports: MissionReport[] = [];
  const sync = { ...recorder().sync, completed: (r: MissionReport) => { reports.push(r); } };
  const { sim, squad } = arena('heist', {}, sync);
  hack(sim, squad); extractAll(sim, squad);
  assert.equal(sim.result, 'success');
  assert.deepEqual(sim.getSnapshot().badges, ['ghost', 'untouched', 'swift', 'bloodless']); // no hostiles, so nothing to purge
  assert.deepEqual(reports, [{ stealth: true, badges: ['ghost', 'untouched', 'swift', 'bloodless'], results: {} }]);
  assert.equal(sim.campaign.badges.swift, 1);
});

test('an alarm, a downed operative, a slow finish and a kill each cost their badge', () => {
  const { sim, squad, hostile, raise } = alarmed();
  squad.forEach(u => { u.hp = u.maxHp = 1e6; });
  hostile('guard', 15, 15, 0).hp = 0;
  hostile('guard', 15, 12, 0, 1e6).cooldown = 1e9;
  raise({ x: 15, z: 15 });
  (sim as unknown as { damage(t: Unit, n: number, from: null): void }).damage(squad[1], 2e6, null);
  squad[1].hp = 50; // revived
  hack(sim, squad); step(sim, parSeconds('heist', 1));
  extractAll(sim, squad);
  assert.equal(sim.result, 'success');
  assert.deepEqual(sim.getSnapshot().badges, []);
  assert.equal(sim.getSnapshot().downs, 1);
});

test('Bloodless spares only the assassination target; Purge counts the district, not reinforcements', () => {
  const play = (killGuard: boolean) => {
    const { sim, squad, hostile } = arena('assassination');
    hostile('target', 10, 10, 0).hp = 0;
    hostile('guard', 12, 10, 0).hp = killGuard ? 0 : 75;
    hostile('guard', 14, 10, 0).id = 'r0'; // a reinforcement, left standing
    step(sim, .1); extractAll(sim, squad);
    assert.equal(sim.result, 'success');
    return sim.getSnapshot().badges;
  };
  const spared = play(false), swept = play(true);
  assert.ok(spared.includes('bloodless') && !spared.includes('purge'), spared.join());
  assert.ok(swept.includes('purge') && !swept.includes('bloodless'), swept.join());
});

test('Elimination counts down the district it started with; reinforcements never count, and it offers no Purge or Bloodless', () => {
  const plan = planMission(contract('elimination', 2, 77));
  assert.ok(plan.enemies.length > 0 && !plan.sites.length && !plan.vip && !plan.enemies.some(e => e.kind === 'target'));
  const reports: MissionReport[] = [];
  const sync = { ...recorder().sync, completed: (r: MissionReport) => { reports.push(r); } };
  const { sim, squad, hostile } = arena('elimination', {}, sync);
  const a = hostile('guard', 12, 10, 0), b = hostile('camera', 14, 10, 0, 40), r = hostile('guard', 16, 10, 0);
  r.id = 'r0'; // a reinforcement, left standing
  const sweep = sim.objectives[0];
  assert.equal(sweep.kind, 'sweep');
  step(sim, .1);
  assert.equal(sweep.label, 'Down every hostile (2 left)'); assert.equal(sim.extractReady, false);
  a.hp = 0; step(sim, .1);
  assert.equal(sweep.label, 'Down every hostile (1 left)'); assert.equal(sweep.progress, .5);
  extractAll(sim, squad);
  assert.equal(sim.phase, 'mission', 'extraction waits for the sweep');
  b.hp = 0; step(sim, .1);
  assert.ok(sweep.done && sim.extractReady, 'the standing reinforcement does not hold up the sweep');
  extractAll(sim, squad);
  assert.equal(sim.result, 'success');
  assert.deepEqual(sim.getSnapshot().badges, ['ghost', 'untouched', 'swift']);
  assert.deepEqual(reports, [{ stealth: true, badges: ['ghost', 'untouched', 'swift'], results: {}, kills: 2 }]);
  assert.equal(sim.campaign.badges.purge, 0);
});

test('a restart clears the downs a run had counted', () => {
  const { sim, squad } = arena('heist');
  (sim as unknown as { damage(t: Unit, n: number, from: null): void }).damage(squad[0], 1e6, null);
  step(sim, .2); assert.equal(sim.getSnapshot().downs, 1);
  sim.restart();
  assert.equal(sim.getSnapshot().downs, 0); assert.deepEqual(sim.getSnapshot().badges, []);
});

// ---- Countermeasures ----
const MAXED: Partial<Campaign> = { weapon: MAX_LEVEL, armor: MAX_LEVEL, abilities: { assault: MAX_LEVEL, support: MAX_LEVEL, recon: MAX_LEVEL, tech: MAX_LEVEL } };
const within = (t: number, want: number) => assert.ok(Math.abs(t - want) <= 1 / 60 + 1e-9, `${t} vs ${want}`);

test('Countermeasures quicken detection, then lengthen the stand-down, then lift the reinforcement cap', () => {
  const open = { ...MAXED, countermeasures: 2 };
  const seen = (level: number) => {
    const { sim, hostile } = arena('heist', open, undefined, level);
    hostile('guard', 3, 0, -Math.PI / 2, 40).lookEvery = 1e9;
    step(sim, 20, () => sim.alarm); return sim.time;
  };
  within(seen(0), detectSeconds('guard', 2));
  within(seen(1), detectSeconds('guard', 2) * COUNTERMEASURES[1].detect);
  const two = alarmed('heist', open, undefined, 2);
  two.raise(); step(two.sim, .2);
  assert.equal(two.sim.getSnapshot().calmFor, CALM_SECONDS + COUNTERMEASURES[2].calm);
  const three = arena('heist', open, undefined, 3);
  three.squad.forEach(u => { u.hp = u.maxHp = 1e6; });
  (three.sim as unknown as { raiseAlarm(p: Point, r: string): void }).raiseAlarm({ x: 0, z: 0 }, 'test');
  step(three.sim, FIRST_WAVE_SECONDS + REINFORCE_SECONDS * 5);
  assert.ok(three.sim.getSnapshot().reinforced > REINFORCE_CAP, String(three.sim.getSnapshot().reinforced));
  assert.equal(three.sim.getSnapshot().reinforceCap, Infinity);
});

test('the board refuses a locked Countermeasures level, reports the pick on deploy, and a restart keeps it', () => {
  const levels: number[] = [];
  const sync = { ...recorder().sync, deployed: (_: string, __: string[], countermeasures: number) => { levels.push(countermeasures); } };
  const sim = new Simulation(campaignWith('heist', MAXED), sync);
  assert.equal(sim.getSnapshot().countermeasuresOpen, 1);
  sim.chooseCountermeasures(2); assert.equal(sim.countermeasures, 0);
  sim.chooseCountermeasures(1); assert.equal(sim.countermeasures, 1);
  sim.deploy(); sim.restart();
  assert.deepEqual(levels, [1, 1]);
  sim.chooseCountermeasures(0); assert.equal(sim.countermeasures, 1); // fixed for the mission
  // A campaign that no longer opens the level drops the pick back to what it opens.
  const plain = new Simulation(campaignWith('heist', MAXED));
  plain.chooseCountermeasures(1);
  plain.applyCampaign({ ...plain.campaign, armor: 2 });
  assert.equal(plain.countermeasures, 0);
});

// ---- Intercept ----
test('an Intercept courier crosses the district edge to edge, and the squad can always get ahead of it', () => {
  for (let tier = 1; tier <= MAX_TIER; tier++) for (let seed = 1; seed <= 24; seed++) {
    const plan = planMission(contract('intercept', tier, seed * 131 + tier)), courier = plan.enemies.find(e => e.kind === 'target')!;
    const route = courier.patrol, { bounds } = plan.world, onEdge = (p: Point) => [p.x - bounds.minX, bounds.maxX - p.x, p.z - bounds.minZ, bounds.maxZ - p.z].some(d => d < 1);
    assert.ok(route.length >= 2 && onEdge(route[0]) && onEdge(route.at(-1)!), `seed ${seed}: the route runs exit to exit`);
    assert.ok(distance(route[0], route.at(-1)!) >= COURIER_MIN_RUN);
    assert.ok(interceptable(plan.world, plan.spawn[0], route), `T${tier} seed ${seed}: the squad cannot reach the route first`);
    assert.equal(plan.enemies.filter(e => e.escort).length, 2);
    assert.deepEqual(plan.targetArea, { x: route[0].x, z: route[0].z, r: TARGET_AREA_RADIUS }, 'the briefing marks where the courier enters');
  }
});

test('the courier sets off after its delay with its escorts, gives its route away at a corner, and escapes at the far exit', () => {
  const sim = new Simulation(campaignWith('intercept', { offers: [contract('intercept', 2, 4242)] }));
  sim.deploy();
  const courier = sim.units.find(u => u.kind === 'target')!, escorts = sim.units.filter(u => u.escort === courier.id);
  assert.equal(courier.name, 'COURIER'); assert.equal(escorts.length, 2);
  assert.equal(sim.objectives[0].label, 'Stop the courier');
  // Keep the squad out of the way: no hostile ever sees it.
  sim.units.filter(u => u.faction === 'squad').forEach(u => { u.hp = u.maxHp = 1e9; });
  const start = { x: courier.x, z: courier.z };
  step(sim, COURIER_DELAY - .5);
  assert.deepEqual({ x: courier.x, z: courier.z }, start, 'it waits out its delay');
  step(sim, 6);
  assert.ok(distance(courier, start) > 2, 'then walks');
  assert.ok(escorts.every(e => distance(e, courier) < 3), 'the escorts keep up');
  courier.marked = 1e9; // a mark keeps it in sight, as if the squad were watching
  step(sim, 30, () => sim.intel.has(courier.id));
  assert.ok(sim.intel.has(courier.id), 'a corner watched gives the route away');
  assert.deepEqual(sim.intel.get(courier.id)!.at(-1), courier.patrol.at(-1));
  for (const u of sim.units) if (u.faction === 'squad') { u.x = sim.plan!.extract.x; u.z = sim.plan!.extract.z; }
  step(sim, 300);
  assert.equal(sim.result, 'failure'); assert.equal(sim.failReason, 'The courier got away.');
});

test('on alarm the courier runs for its own exit at once, and stopping it opens extraction', () => {
  const sim = new Simulation(campaignWith('intercept', { offers: [contract('intercept', 2, 4242)] }));
  sim.deploy();
  const courier = sim.units.find(u => u.kind === 'target')!;
  (sim as unknown as { raiseAlarm(at: Point, reason: string): void }).raiseAlarm(courier, 'test');
  assert.deepEqual(courier.exit, courier.patrol.at(-1)); assert.equal(courier.wait, 0);
  sim.update(1 / 60);
  assert.ok(courier.path.length, 'it runs at once, without waiting out its delay');
  courier.hp = 0; sim.update(1 / 60);
  assert.ok(sim.objectives[0].done && sim.extractReady);
});

test('an intel reward draws every patrol route from the first frame of the next deployment, and only that one', () => {
  const sim = new Simulation(campaignWith('heist', { intel: true, offers: [contract('heist', 3, 99)] }));
  sim.deploy();
  const walkers = sim.units.filter(u => u.faction === 'hostile' && u.patrol.length >= 2);
  assert.ok(walkers.length > 0);
  assert.ok(walkers.every(u => sim.intel.has(u.id)));
  assert.equal(sim.campaign.intel, false); assert.equal(sim.getSnapshot().intelReward, true);
  sim.restart();
  assert.ok(walkers.every(u => sim.intel.has(u.id)), 'a restart keeps it');
  const plain = new Simulation(campaignWith('heist', { offers: [contract('heist', 3, 99)] }));
  plain.deploy();
  assert.equal(plain.intel.size, 0);
});

test('a courier stunned mid-leg finishes that leg before the next, and only escapes at its exit', () => {
  const sim = new Simulation(campaignWith('intercept', { offers: [contract('intercept', 2, 4242)] }));
  sim.deploy();
  sim.units.filter(u => u.faction === 'squad').forEach(u => { u.x = sim.plan!.extract.x; u.z = sim.plan!.extract.z; u.hp = u.maxHp = 1e9; });
  const courier = sim.units.find(u => u.kind === 'target')!, last = courier.patrol.length - 1;
  step(sim, 300, () => courier.patrolIndex === last && courier.path.length > 0 && distance(courier, courier.patrol[last]) > 2);
  assert.equal(courier.patrolIndex, last);
  courier.path = []; courier.stunned = .5; // as an EMP leaves it
  step(sim, 300);
  assert.equal(sim.failReason, 'The courier got away.');
  assert.ok(distance(courier, courier.patrol[last]) < 1, `escaped ${distance(courier, courier.patrol[last]).toFixed(2)} m from its exit`);
});

test('Lockdown seals the exits a set time after the first alarm, even once it stands down', () => {
  const { sim, squad, hostile, raise } = alarmed('heist');
  sim.contract = sim.plan!.contract = { ...sim.plan!.contract, modifiers: ['lockdown'] };
  hostile('guard', 15, 15, 0);
  raise({ x: 15, z: 15 });
  assert.equal(sim.lockdownIn, LOCKDOWN_SECONDS);
  squad.forEach(u => { u.hp = u.maxHp = 1e9; });
  sim.units.filter(u => u.faction === 'hostile').forEach(u => { u.hp = 0; });
  step(sim, LOCKDOWN_SECONDS - 1);
  assert.equal(sim.phase, 'mission'); assert.equal(sim.alarm, false, 'stood down meanwhile');
  step(sim, 2);
  assert.equal(sim.result, 'failure'); assert.match(sim.failReason, /Lockdown/);
  // Without the modifier an alarm starts no clock.
  const plain = alarmed('heist'); plain.raise({ x: 15, z: 15 });
  assert.equal(plain.sim.lockdownIn, null);
});

// An unknown target (#54): deployed with the squad out of the way and every other hostile stunned, so only the target acts.
function unknownTarget(seed = 77) {
  const c = { ...contract('assassination', 3, seed), payout: contractPayout(3, 1), modifiers: ['unknown' as const] };
  const sim = new Simulation(campaignWith('assassination', { offers: [c] }));
  sim.deploy();
  const target = sim.units.find(u => u.kind === 'target')!, squad = sim.units.filter(u => u.faction === 'squad');
  sim.units.filter(u => u.faction === 'hostile' && u !== target).forEach(u => { u.stunned = 1e9; });
  squad.forEach(u => { u.x = sim.plan!.extract.x; u.z = sim.plan!.extract.z; u.hp = u.maxHp = 1e9; });
  // A spot behind the target, in reach and in sight, where it cannot see the operative.
  const behind = [3, 2.5, 3.5, 2].flatMap(d => [0, .4, -.4].map(a => ({ x: target.x - Math.sin(target.sweep + a) * d, z: target.z - Math.cos(target.sweep + a) * d })))
    .find(p => sim.plan!.world.walkable(p, .4) && sim.plan!.world.sightClear(p, target))!;
  return { sim, target, squad, behind };
}

test('an unknown target passes as a posted guard: its name, health reading and sight give nothing away', () => {
  const { sim, target } = unknownTarget();
  assert.equal(target.guise, 'guard'); assert.equal(target.name, HOSTILE_STATS.guard.name); assert.ok(posted(target));
  // Its health reads as a guard's, so a volley planned to kill a guard can leave it standing.
  const op = sim.units.find(u => u.faction === 'squad')!;
  op.x = target.x + 2; op.z = target.z; target.visible = true;
  assert.equal(sim.attackPreview(target.id)!.hp, Math.ceil(HOSTILE_STATS.guard.hp * tierHp(3)));
  assert.ok(target.maxHp > HOSTILE_STATS.guard.hp * tierHp(3));
  op.x = sim.plan!.extract.x; op.z = sim.plan!.extract.z;
  const area = { ...sim.targetArea! };
  target.visible = true; sim.update(1 / 60);
  assert.deepEqual({ x: sim.targetArea!.x, z: sim.targetArea!.z }, { x: area.x, z: area.z }, 'seeing it does not move the target area onto it');
  const plain = new Simulation(campaignWith('assassination', { offers: [contract('assassination', 3, 77)] }));
  plain.deploy();
  assert.equal(plain.units.find(u => u.kind === 'target')!.guise, null);
});

test('an operative identifies an unknown target by watching it, unaware, up close for long enough', () => {
  const { sim, target, squad, behind } = unknownTarget();
  squad[0].x = behind.x; squad[0].z = behind.z;
  assert.ok(distance(squad[0], target) <= IDENTIFY_RANGE);
  step(sim, IDENTIFY_SECONDS - .3);
  assert.equal(target.guise, 'guard', 'not yet');
  step(sim, .5);
  assert.equal(target.guise, null); assert.equal(target.name, 'TARGET'); assert.match(sim.message, /identified the target/);
  assert.equal(sim.alarm, false);
  // From too far, it is never identified.
  const far = unknownTarget();
  const p = { x: far.target.x + (behind.x - target.x) * (IDENTIFY_RANGE + 1.5) / distance(behind, target), z: far.target.z + (behind.z - target.z) * (IDENTIFY_RANGE + 1.5) / distance(behind, target) };
  far.squad[0].x = p.x; far.squad[0].z = p.z;
  step(far.sim, IDENTIFY_SECONDS * 3);
  assert.equal(far.target.guise, 'guard');
});

test("Recon's mark identifies an unknown target", () => {
  const { sim, target } = unknownTarget();
  target.marked = 1; sim.update(1 / 60);
  assert.equal(target.guise, null); assert.match(sim.message, /Recon marked the target/);
});

test('killing the wrong guard on an unknown-target contract is a guard kill, and the target stays hidden', () => {
  const { sim, target } = unknownTarget();
  const decoy = sim.units.find(u => u.faction === 'hostile' && u.kind === 'guard')!;
  decoy.hp = 0; sim.update(1 / 60);
  assert.equal(sim.objectives[0].done, false); assert.equal(target.guise, 'guard');
  target.hp = 0; sim.update(1 / 60);
  assert.ok(sim.objectives[0].done);
  const badges = (sim as unknown as { earnedBadges(): string[] }).earnedBadges();
  assert.ok(!badges.includes('bloodless'));
});

test('on alarm an unknown target holds its disguise through its hesitation, then gives itself away by running', () => {
  const { sim, target } = unknownTarget();
  (sim as unknown as { raiseAlarm(at: Point, reason: string): void }).raiseAlarm(target, 'test');
  assert.ok(target.exit);
  step(sim, FLEE_DELAY - .5);
  assert.equal(target.guise, 'guard');
  step(sim, 1);
  assert.equal(target.guise, null); assert.ok(target.path.length, 'running for its exit');
});
