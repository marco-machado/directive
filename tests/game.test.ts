import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, parseCampaign, COVER_FACTOR, HACK_SECONDS, REINFORCE_CAP, REINFORCE_SECONDS, REVIVE_SECONDS } from '../src/game/simulation.ts';
import type { CampaignSync, Unit, Upgrade } from '../src/game/simulation.ts';
import { contractPayout, freshCampaign, MAX_TIER } from '../src/game/campaign.ts';
import type { Campaign, ContractType } from '../src/game/campaign.ts';
import { abilityCooldown, CLASS_STATS } from '../src/game/classes.ts';
import { mapSize, planMission } from '../src/game/mapgen.ts';
import type { EnemyKind } from '../src/game/mapgen.ts';
import { mulberry32 } from '../src/game/rng.ts';
import { distance, World } from '../src/game/world.ts';

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
  const guard = hostile('guard', 4, 0, Math.PI); // facing away
  step(sim, 1);
  assert.equal(guard.hp, 75); assert.equal(sim.alarm, false);
  sim.attack(guard.id); step(sim, .2);
  assert.ok(guard.hp < 75);
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
  const target = hostile('guard', 0, 6, 0, 500);
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
  assert.equal(sim.result, 'success'); assert.equal(sim.payout, contractPayout(1));
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
