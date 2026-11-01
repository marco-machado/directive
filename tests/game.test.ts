import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, parseCampaign, CALM_SECONDS, CAMERA_DETECT, COVER_FACTOR, DETECT_DRAIN, detectSeconds, GHOST_SECONDS, HACK_SECONDS, LOOK_ANGLE, LOOK_EVERY, LOOK_PAUSE, QUEUE_SPACING, REINFORCE_CAP, SUSPICIOUS, REINFORCE_SECONDS, REVIVE_SECONDS, SIGHT_RANGE, TAKEDOWN_REACH, TAKEDOWN_SECONDS } from '../src/game/simulation.ts';
import type { CampaignSync, Unit, Upgrade } from '../src/game/simulation.ts';
import { contractPayout, freshCampaign, MAX_TIER } from '../src/game/campaign.ts';
import type { Campaign, ContractType } from '../src/game/campaign.ts';
import { abilityCooldown, CLASS_STATS } from '../src/game/classes.ts';
import { mapSize, planMission } from '../src/game/mapgen.ts';
import type { EnemyKind } from '../src/game/mapgen.ts';
import { mulberry32 } from '../src/game/rng.ts';
import { distance, World } from '../src/game/world.ts';
import type { Point } from '../src/game/world.ts';

const recorder = () => {
  const events: string[] = [];
  const sync: CampaignSync = {
    deployed: (id, squad) => events.push(`deployed:${id}:${squad.join(',')}`), completed: s => events.push(`completed:${s}`),
    bought: (t: Upgrade) => events.push(`bought:${t}`), recruited: id => events.push(`recruited:${id}`), dismissed: id => events.push(`dismissed:${id}`),
  };
  return { events, sync };
};
const contract = (type: ContractType, tier = 1, seed = 1234) => ({ id: `c-${type}`, type, tier, seed, payout: contractPayout(tier), district: 'GLASS DISTRICT', sector: 4 });
const campaignWith = (type: ContractType, extra: Partial<Campaign> = {}): Campaign => ({ ...freshCampaign(mulberry32(7)), offers: [contract(type)], ...extra });
const step = (sim: Simulation, seconds: number, until?: () => boolean) => {
  for (let i = 0; i < seconds * 60 && sim.phase === 'mission' && !until?.(); i++) sim.update(1 / 60);
};

// An open, building-free arena so each rule can be checked in isolation.
function arena(type: ContractType = 'heist', extra: Partial<Campaign> = {}, sync?: CampaignSync) {
  const sim = new Simulation(campaignWith(type, extra), sync);
  sim.deploy();
  const world = new World({ minX: -20, maxX: 20, minZ: -20, maxZ: 20 }, [], []);
  sim.plan = { ...sim.plan!, world, extract: { x: -18, z: -18 }, exits: [{ x: 19, z: 0 }] };
  const extract = sim.objectives.at(-1)!; extract.x = -18; extract.z = -18;
  const squad = sim.units.filter(u => u.faction === 'squad');
  squad.forEach((u, i) => { u.x = i; u.z = 0; u.path = []; });
  sim.units = [...squad, ...sim.units.filter(u => u.faction === 'vip')];
  const hostile = (kind: EnemyKind, x: number, z: number, heading = 0, hp = 75): Unit => {
    const u: Unit = { ...squad[0], id: `t-${sim.units.length}`, name: kind.toUpperCase(), kind, faction: 'hostile', x, z, heading, sweep: heading, hp, maxHp: hp, ability: null, cooldown: 0, path: [], patrol: [], targetId: null, visible: true };
    sim.units.push(u); return u;
  };
  return { sim, squad, hostile, world };
}

test('migrates v1 and v2 saves and clamps corrupt values', () => {
  const v1 = parseCampaign('{"cash":500,"weapon":2,"armor":1,"mission":4}');
  assert.equal(v1.version, 3); assert.equal(v1.cash, 500); assert.equal(v1.completed, 3);
  assert.deepEqual(v1.roster.map(o => [o.name, o.cls]), [['VEX', 'assault'], ['ROOK', 'support']]);
  assert.equal(v1.offers.length, 3); assert.equal(v1.recruits.length, 2);
  assert.equal(parseCampaign('{"cash":-99,"weapon":900}').weapon, 3);
  assert.equal(parseCampaign('broken').cash, 0);
});

test('districts are deterministic, reachable, and grow with tier', () => {
  for (const type of ['assassination', 'heist', 'sabotage', 'escort'] as const) for (let tier = 1; tier <= MAX_TIER; tier++) {
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
  step(sim, .5); assert.equal(sim.objectives[0].done, true);
  sim.selectAll(); sim.move({ x: extract.x, z: extract.z });
  step(sim, 30);
  assert.equal(sim.result, 'success', `VIP ${distance(vip, extract).toFixed(2)} from extraction`);
});

test('the escort VIP joins, follows, and its death fails the contract', () => {
  const { sim, squad } = arena('escort');
  const vip = sim.units.find(u => u.faction === 'vip')!;
  vip.x = 8; vip.z = 0;
  step(sim, .5); assert.equal(sim.objectives[0].done, false);
  squad[0].x = 6; step(sim, .5); assert.equal(sim.objectives[0].done, true);
  squad[0].x = 0; squad[0].z = 6; squad[1].x = -15; squad[1].z = 15;
  step(sim, 3); assert.ok(distance(vip, squad[0]) < 2.5, String(distance(vip, squad[0])));
  vip.hp = 0; sim.update(1 / 60);
  assert.equal(sim.result, 'failure'); assert.equal(sim.failReason, 'The VIP was killed.');
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

test('reinforcements arrive every interval up to the cap', () => {
  const { sim, squad } = arena('heist');
  squad.forEach(u => { u.hp = u.maxHp = 1e6; });
  (sim as unknown as { raiseAlarm(p: object, r: string): void }).raiseAlarm({ x: 0, z: 0 }, 'test');
  step(sim, REINFORCE_SECONDS + .1);
  assert.equal(sim.units.filter(u => /^r\d+$/.test(u.id)).length, 2);
  step(sim, REINFORCE_SECONDS * 4);
  assert.equal(sim.units.filter(u => /^r\d+$/.test(u.id)).length, REINFORCE_CAP);
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
  sim.toggleSquad(recruit.id); sim.deploy();
  assert.deepEqual(sim.squad, ['rook', recruit.id]);
  assert.equal(sim.buy('weapon'), false);
});

test('a server campaign replaces local state and rebuilds the briefing', () => {
  const sim = new Simulation();
  const server = { ...freshCampaign(mulberry32(3)), cash: 750, armor: 2 };
  sim.applyCampaign(server);
  assert.equal(sim.getSnapshot().campaign.cash, 750);
  assert.equal(sim.contract?.id, server.offers[0].id);
  assert.equal(sim.units.find(u => u.id === 'vex')!.maxHp, CLASS_STATS.assault.hp + 80);
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
function alarmed(type: ContractType = 'heist', extra: Partial<Campaign> = {}, sync?: CampaignSync) {
  const a = arena(type, extra, sync);
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

test('a fresh detection after a stand-down raises the alarm again without refilling the waves', () => {
  const { sim, hostile, raise } = alarmed();
  raise(); step(sim, CALM_SECONDS + .5); assert.equal(sim.alarm, false);
  hostile('guard', 3, 0, -Math.PI / 2, 1e6);
  step(sim, 3, () => sim.alarm);
  assert.equal(sim.alarm, true); assert.equal(internals(sim).reinforced, REINFORCE_CAP);
  const before = sim.units.length; step(sim, REINFORCE_SECONDS + 1);
  assert.equal(sim.units.length, before);
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
  step(sim, 30, () => units.every(u => !u.path.length));
  assert.equal(sim.phase, 'mission'); assert.ok(units.every(u => !u.path.length), 'still walking');
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
