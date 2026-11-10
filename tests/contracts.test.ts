import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, CACHE_SECONDS, SQUAD_SPEED, FLEE_DELAY, HOSTILE_STATS, posted, FIRST_WAVE_SECONDS, VIP_SECURE_SECONDS, HACK_SECONDS, REINFORCE_SECONDS, tierHp } from '../src/game/simulation.ts';
import type { Unit } from '../src/game/simulation.ts';
import { CACHE_BONUS, EXECUTIVES, PRISONER_BONUS, prisonerCount, TAG_RANGE, TAG_SECONDS, CARRY_SPEED, smashSeconds, MODIFIER_FITS, PICKUP_SECONDS, contractPayout, HANDOVER_SECONDS, IDENTIFY_RANGE, IDENTIFY_SECONDS, LOCKDOWN_SECONDS, FIRST_CONTRACT, MAX_TIER } from '../src/game/campaign.ts';
import type { ContractType } from '../src/game/campaign.ts';
import { ABILITY_STATS, MARK_SECONDS } from '../src/game/classes.ts';
import { COURIER_DELAY, COURIER_MIN_RUN, interceptable, planMission, TARGET_AREA_RADIUS } from '../src/game/mapgen.ts';
import { distance } from '../src/game/world.ts';
import type { Point } from '../src/game/world.ts';
import { raiseAlarm } from '../src/game/alarm.ts';
import { earnedBadges } from '../src/game/missions.ts';
import { contract, campaignWith, step, arena, alarmed } from './arena.ts';

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
  raiseAlarm(sim, courier, 'test');
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
function unknownTarget(seed = 78) {
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
  const badges = earnedBadges(sim);
  assert.ok(!badges.includes('bloodless'));
});

test('on alarm an unknown target holds its disguise through its hesitation, then gives itself away by running', () => {
  const { sim, target } = unknownTarget();
  raiseAlarm(sim, target, 'test');
  assert.ok(target.exit);
  step(sim, FLEE_DELAY - .5);
  assert.equal(target.guise, 'guard');
  step(sim, 1);
  assert.equal(target.guise, null); assert.ok(target.path.length, 'running for its exit');
});

// A carry heist (#52) in the open arena, the vault terminal under VEX, hacked until the package is in hand.
function carrying() {
  const c = { ...contract('heist', 2), payout: contractPayout(2, 1), modifiers: ['carry' as const] };
  const { sim, squad, hostile } = arena('heist', { offers: [c] });
  const terminal = sim.objectives[0]; terminal.x = squad[0].x; terminal.z = squad[0].z;
  step(sim, HACK_SECONDS + .1);
  return { sim, squad, hostile, carrier: squad[0], mate: squad[1] };
}

test('under carry the vault gives up a package to the operative at the terminal, who walks slower with it', () => {
  const { sim, carrier, mate } = carrying();
  assert.equal(sim.cargo?.carrier, carrier.id); assert.match(sim.message, /has the package/);
  assert.equal(sim.getSnapshot().cargo?.carrier, carrier.id);
  carrier.path = [{ x: carrier.x, z: 15 }]; mate.path = [{ x: mate.x, z: 15 }];
  const from = { c: { x: carrier.x, z: carrier.z }, m: { x: mate.x, z: mate.z } };
  step(sim, 1);
  assert.ok(Math.abs(distance(carrier, from.c) - SQUAD_SPEED * CARRY_SPEED) < .1, `carrier walked ${distance(carrier, from.c).toFixed(2)} m`);
  assert.ok(Math.abs(distance(mate, from.m) - SQUAD_SPEED) < .1);
  assert.deepEqual({ x: sim.cargo!.x, z: sim.cargo!.z }, { x: carrier.x, z: carrier.z });
  // A plain heist has no package.
  const plain = arena('heist'); const t = plain.sim.objectives[0]; t.x = plain.squad[0].x; t.z = plain.squad[0].z;
  step(plain.sim, HACK_SECONDS + .1);
  assert.ok(plain.sim.objectives[0].done); assert.equal(plain.sim.cargo, null);
});

test('a carrier cannot fire, use its ability or join an attack', () => {
  const { sim, carrier, mate, hostile } = carrying();
  mate.x = -15; mate.z = 15;
  const h = hostile('guard', carrier.x + 3, carrier.z, Math.PI);
  h.stunned = 1e9; sim.alarm = true;
  step(sim, 2);
  assert.equal(h.hp, h.maxHp, 'it held fire under the alarm');
  sim.select(carrier.id);
  assert.equal(sim.attackPreview(h.id), null);
  const cd = carrier.abilityCd;
  sim.ability(0);
  assert.match(sim.message, /hands full/); assert.equal(sim.pending, null); assert.equal(carrier.abilityCd, cd);
});

test('a downed carrier drops the package where it fell, and whoever stands on it picks it up', () => {
  const { sim, carrier, mate } = carrying();
  carrier.hp = 0; sim.update(1 / 60);
  assert.equal(sim.cargo!.carrier, null); assert.deepEqual({ x: sim.cargo!.x, z: sim.cargo!.z }, { x: carrier.x, z: carrier.z });
  assert.match(sim.message, /dropped the package/);
  mate.path = [{ x: carrier.x, z: carrier.z + .3 }];
  step(sim, 2);
  assert.equal(sim.cargo!.carrier, mate.id);
});

test('a squadmate sent on its own to stand beside a standing carrier takes the package over; a squad move never swaps it', () => {
  const { sim, carrier, mate } = carrying();
  // The whole squad moved together and stopped side by side: no handover.
  sim.selectAll(); sim.move({ x: 0, z: 6 });
  step(sim, 8);
  assert.ok(distance(carrier, mate) <= 1.2);
  assert.equal(sim.cargo!.carrier, carrier.id);
  sim.select(mate.id); sim.move({ x: carrier.x + .7, z: carrier.z });
  step(sim, 1.5, () => !mate.path.length);
  step(sim, HANDOVER_SECONDS - .3);
  assert.equal(sim.cargo!.carrier, carrier.id, 'not yet');
  step(sim, .5);
  assert.equal(sim.cargo!.carrier, mate.id); assert.match(sim.message, /handed the package/);
  step(sim, HANDOVER_SECONDS * 2);
  assert.equal(sim.cargo!.carrier, mate.id, 'and it is not handed straight back');
});

test('extraction under carry needs the package in the zone', () => {
  const { sim, squad, carrier } = carrying();
  carrier.hp = 0; sim.update(1 / 60); carrier.hp = carrier.maxHp; // dropped, then back up
  const zone = sim.objectives.at(-1)!;
  squad.forEach(u => { u.x = zone.x; u.z = zone.z; u.path = []; });
  step(sim, 1);
  assert.equal(sim.phase, 'mission'); assert.match(sim.message, /Bring the package/);
  sim.cargo!.x = zone.x; sim.cargo!.z = zone.z;
  step(sim, 1);
  assert.equal(sim.result, 'success');
});

// The two endings (#53).
const ending = (type: ContractType, modifier: 'through' | 'called', tier = 2, seed = 4242) => ({ ...contract(type, tier, seed), payout: contractPayout(tier, 1), modifiers: [modifier] });

test('a through-run starts at one corner and extracts at the opposite one, with hostiles and exits clear of the start', () => {
  for (const type of MODIFIER_FITS.through) for (let seed = 1; seed <= 12; seed++) {
    const plan = planMission(ending(type, 'through', 1 + seed % 5, seed * 977)), b = plan.world.bounds;
    assert.ok(distance(plan.start, plan.extract) > .8 * Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ), `${type} ${seed}: corners ${distance(plan.start, plan.extract).toFixed(1)} m apart`);
    assert.ok(plan.enemies.every(e => distance(e, plan.start) > 9), `${type} ${seed}: a hostile starts by the squad`);
    assert.ok(plan.exits.length && plan.exits.every(e => distance(e, plan.start) > 14 && distance(e, plan.extract) > 14));
    assert.ok(plan.spawn.every(p => distance(p, plan.start) < 3));
  }
  const plain = planMission(contract('heist', 2, 4242));
  assert.deepEqual(plain.start, plain.extract);
  const first = planMission({ ...FIRST_CONTRACT, id: 'c', payout: contractPayout(FIRST_CONTRACT.tier) });
  assert.deepEqual(first.start, first.extract, 'contract 01 stays out-and-back');
});

test("a through-run's squad extracts at the far corner, and the alarm's first wave enters nearest it", () => {
  const sim = new Simulation(campaignWith('heist', { offers: [ending('heist', 'through')] }));
  sim.deploy();
  const plan = sim.plan!, squad = sim.units.filter(u => u.faction === 'squad'), zone = sim.objectives.at(-1)!;
  assert.deepEqual({ x: zone.x, z: zone.z }, plan.extract);
  assert.ok(squad.every(u => distance(u, plan.start) < 3 && distance(u, plan.extract) > 20));
  raiseAlarm(sim, plan.start, 'test');
  sim.units.filter(u => u.faction === 'hostile').forEach(u => { u.stunned = 1e9; });
  squad.forEach(u => { u.hp = u.maxHp = 1e9; });
  step(sim, FIRST_WAVE_SECONDS + .1);
  const wave = sim.units.find(u => u.id === 'r0')!, nearest = plan.exits.reduce((a, b) => distance(b, plan.extract) < distance(a, plan.extract) ? b : a);
  assert.ok(distance(wave, nearest) < 3, 'entered at the exit nearest extraction, ahead of the squad');
  sim.objectives[0].done = true;
  squad.forEach(u => { u.x = plan.extract.x; u.z = plan.extract.z; u.path = []; });
  step(sim, .5);
  assert.equal(sim.result, 'success');
});

test('a called extraction has no zone until the squad calls a pickup, which lands later and takes the whole squad', () => {
  const sim = new Simulation(campaignWith('heist', { offers: [ending('heist', 'called')] }));
  sim.deploy();
  const plan = sim.plan!, squad = sim.units.filter(u => u.faction === 'squad');
  sim.units.filter(u => u.faction === 'hostile').forEach(u => { u.stunned = 1e9; });
  sim.armPickup();
  assert.equal(sim.calling, false, 'not before the objectives are done');
  sim.objectives[0].done = true;
  step(sim, 1);
  assert.equal(sim.phase, 'mission', 'standing at the start does not extract');
  sim.armPickup();
  assert.ok(sim.calling);
  const building = plan.world.buildings[0];
  sim.groundClick({ x: building.x, z: building.z });
  assert.equal(sim.pickup, null); assert.match(sim.message, /open street/);
  const spot = plan.exits[0];
  sim.groundClick(spot);
  assert.ok(sim.pickup && !sim.calling); assert.equal(sim.getSnapshot().pickup?.in, PICKUP_SECONDS);
  assert.deepEqual({ x: sim.objectives.at(-1)!.x, z: sim.objectives.at(-1)!.z }, { x: spot.x, z: spot.z });
  squad.forEach(u => { u.x = spot.x; u.z = spot.z; u.path = []; });
  step(sim, PICKUP_SECONDS - 1);
  assert.equal(sim.phase, 'mission', 'the pickup has not landed yet');
  step(sim, 1.5);
  assert.equal(sim.result, 'success');
});

test('Esc cancels a pickup call, and reinforcements come in nearest a called pickup', () => {
  const sim = new Simulation(campaignWith('heist', { offers: [ending('heist', 'called')] }));
  sim.deploy();
  const plan = sim.plan!, squad = sim.units.filter(u => u.faction === 'squad');
  sim.objectives[0].done = true;
  sim.armPickup(); assert.ok(sim.cancelAbility()); assert.equal(sim.calling, false);
  sim.units.filter(u => u.faction === 'hostile').forEach(u => { u.stunned = 1e9; });
  squad.forEach(u => { u.hp = u.maxHp = 1e9; });
  const far = [...plan.exits].sort((a, b) => distance(b, plan.start) - distance(a, plan.start))[0];
  sim.armPickup(); sim.groundClick(far);
  raiseAlarm(sim, plan.start, 'test');
  const waves = () => sim.units.filter(u => /^r\d+$/.test(u.id));
  step(sim, FIRST_WAVE_SECONDS + .05);
  const first = waves().length;
  assert.ok(first > 0 && waves().every(u => distance(u, far) < 2), 'the first wave entered by the pickup');
  step(sim, REINFORCE_SECONDS);
  assert.ok(waves().length > first && waves().slice(first).every(u => distance(u, far) < 2), 'and so did the next');
});

test('activating an ability ends a pickup call, so the next click casts it instead of calling the pickup', () => {
  const sim = new Simulation(campaignWith('heist', { offers: [ending('heist', 'called')] }));
  sim.deploy();
  sim.objectives[0].done = true;
  const slot = sim.squad.findIndex(id => { const a = sim.units.find(u => u.id === id)?.ability; return !!a && ABILITY_STATS[a].targeted; });
  assert.ok(slot >= 0, 'the squad has a targeted ability');
  sim.armPickup(); assert.ok(sim.calling);
  sim.ability(slot);
  assert.equal(sim.calling, false); assert.ok(sim.pending);
  const caster = sim.units.find(u => u.id === sim.squad[slot])!;
  sim.groundClick({ x: caster.x + 1, z: caster.z });
  assert.equal(sim.pickup, null, 'the click did not call the pickup');
});

// Smash and grab (#49).
test('Smash and grab plans three caches well apart, each held by a posted guard', () => {
  for (const [tier, seed] of [[2, 84], ...Array.from({ length: 20 }, (_, k) => [3 + (k + 1) % 3, (k + 1) * 131])]) {
    const plan = planMission(contract('smash', tier, seed));
    const caches = plan.sites.filter(s => s.kind === 'cache');
    assert.equal(caches.length, 3);
    caches.forEach((c, i) => caches.slice(i + 1).forEach(d => assert.ok(distance(c, d) >= 8)));
    assert.ok(caches.every(c => plan.enemies.some(e => e.kind === 'guard' && e.patrol.length < 2 && distance(e, c) <= 8)), `seed ${seed}: an unguarded cache`);
  }
});

function smash(tier = 3) {
  const { sim, squad } = arena('smash', { offers: [contract('smash', tier)] });
  const caches = sim.objectives.filter(o => o.kind === 'cache');
  caches.forEach((c, i) => { c.x = 10; c.z = -10 + i * 10; });
  return { sim, squad, caches };
}

test('the first cache opened starts the lockdown clock, alarm or not, and opens extraction; the rest turn optional', () => {
  const { sim, squad, caches } = smash();
  assert.equal(sim.extractReady, false); assert.equal(sim.lockdownIn, null);
  squad[0].x = caches[1].x; squad[0].z = caches[1].z;
  step(sim, CACHE_SECONDS + .1);
  assert.ok(caches[1].done); assert.equal(sim.alarm, false);
  assert.ok(Math.abs(sim.lockdownIn! - (smashSeconds(3) - .1)) < .2);
  assert.ok(sim.extractReady);
  assert.ok(caches[0].optional && caches[2].optional && caches[0].label.includes(`+${CACHE_BONUS}`));
});

test('the exits seal when the lockdown clock runs out, with the squad still inside', () => {
  const { sim, squad, caches } = smash();
  squad[0].x = caches[0].x; squad[0].z = caches[0].z;
  step(sim, CACHE_SECONDS + .1);
  step(sim, smashSeconds(3));
  assert.equal(sim.result, 'failure'); assert.equal(sim.failReason, 'Lockdown. The squad was trapped.');
});

test('a Smash and grab win reports its caches, and each past the first pays a bonus', () => {
  for (const taken of [1, 2]) {
    const { sim, squad, caches } = smash();
    caches.slice(0, taken).forEach(c => { squad[0].x = c.x; squad[0].z = c.z; step(sim, CACHE_SECONDS + .1); });
    const zone = sim.objectives.at(-1)!;
    squad.forEach(u => { u.x = zone.x; u.z = zone.z; u.path = []; });
    step(sim, .5);
    assert.equal(sim.result, 'success');
    assert.equal(sim.getSnapshot().reward.credits, (taken - 1) * CACHE_BONUS);
  }
});

// Surveillance (#50).
test('Surveillance plans three executives on their own beats, well apart, with no last known area', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const plan = planMission(contract('surveillance', 3 + seed % 3, seed * 173)), execs = plan.enemies.filter(e => e.kind === 'target');
    assert.equal(execs.length, EXECUTIVES);
    execs.forEach((e, i) => { assert.ok(e.patrol.length >= 2, 'an executive walks'); execs.slice(i + 1).forEach(f => assert.ok(distance(e, f) >= 8)); });
    assert.equal(plan.targetArea, null);
  }
  const sim = new Simulation(campaignWith('surveillance', { offers: [contract('surveillance', 3)] }));
  sim.deploy();
  assert.deepEqual(sim.objectives.map(o => o.kind), ['tag', 'tag', 'tag', 'extract']);
  assert.ok(sim.units.filter(u => u.kind === 'target').every(u => u.name === 'EXECUTIVE'));
});

function surveillance(tier = 3) {
  const { sim, squad, hostile } = arena('surveillance', { offers: [contract('surveillance', tier)] });
  // Executives facing away from the squad, out of each other's way; stunned ones stand still.
  const execs = [hostile('target', 6, 0, Math.PI / 2, 110), hostile('target', -6, 12, Math.PI, 110), hostile('target', 0, -14, 0, 110)];
  const tags = sim.objectives.filter(o => o.kind === 'tag');
  execs.forEach((u, i) => { u.name = 'EXECUTIVE'; u.stunned = 1e9; tags[i].unit = u.id; tags[i].x = u.x; tags[i].z = u.z; });
  return { sim, squad, execs, tags };
}

test('an operative tags an unaware executive by keeping it in sight; a broken watch drains', () => {
  const { sim, execs, tags } = surveillance();
  assert.ok(distance(sim.units[0], execs[0]) <= TAG_RANGE && distance(sim.units[0], execs[1]) > TAG_RANGE);
  step(sim, TAG_SECONDS / 2);
  assert.ok(tags[0].progress > .4 && !tags[0].done && tags[1].progress === 0);
  execs[0].x = 18; step(sim, TAG_SECONDS / 4);
  assert.ok(tags[0].progress < .4, 'the watch drains out of range');
  execs[0].x = 6; step(sim, TAG_SECONDS);
  assert.ok(execs[0].tagged && tags[0].done); assert.equal(sim.extractReady, false);
});

test("Recon's mark tags an executive, and two tags open extraction with the third optional for intel", () => {
  const { sim, execs, tags } = surveillance();
  execs[1].marked = MARK_SECONDS; step(sim, .1);
  assert.ok(tags[1].done && !tags[0].done);
  step(sim, TAG_SECONDS + .1);
  assert.ok(tags[0].done && sim.extractReady);
  assert.ok(tags[2].optional && tags[2].label.includes('intel'));
});

test('an alarm sends the untagged executives running; one that gets away is lost, and losing two blows the contract', () => {
  const { sim, execs, tags } = surveillance();
  execs[0].tagged = true;
  execs.forEach(u => { u.stunned = 0; });
  raiseAlarm(sim, { x: 0, z: 0 }, 'test');
  assert.equal(execs[0].exit, null, 'a tagged executive does not run');
  assert.ok(execs[1].exit && execs[2].exit);
  sim.units.filter(u => u.faction === 'squad').forEach(u => { u.hp = u.maxHp = 1e9; });
  step(sim, 60, () => !sim.units.includes(execs[1]) || sim.phase !== 'mission');
  assert.ok(!sim.units.includes(execs[1]), 'the executive left the district');
  step(sim, .1);
  assert.ok(tags[1].lost && tags[1].optional); assert.match(tags[1].label, /got away/);
  execs[2].hp = 0; step(sim, .1);
  assert.equal(sim.result, 'failure'); assert.match(sim.failReason, /Too many executives lost/);
});

test('a killed executive is lost, not tagged, and costs Bloodless; all three tagged report intel', () => {
  for (const all of [false, true]) {
    const { sim, squad, execs } = surveillance();
    if (!all) execs[2].hp = 0;
    execs.forEach(u => { if (u.hp > 0) u.marked = MARK_SECONDS; });
    step(sim, .1);
    assert.ok(sim.extractReady);
    squad.forEach(u => { u.x = -18; u.z = -18; u.path = []; });
    step(sim, .5);
    assert.equal(sim.result, 'success');
    const snap = sim.getSnapshot();
    assert.equal(snap.reward.intel, all);
    assert.equal(snap.badges.includes('bloodless'), all);
  }
});

test('under the alarm the squad never fires on an executive unordered', () => {
  const { sim, execs } = surveillance();
  raiseAlarm(sim, { x: 0, z: 0 }, 'test');
  step(sim, 2);
  assert.equal(execs[0].hp, execs[0].maxHp);
  sim.selectAll(); sim.attack(execs[0].id); step(sim, 3);
  assert.ok(execs[0].hp < execs[0].maxHp, 'an ordered attack still fires');
});

// Jailbreak (#51).
test('Jailbreak plans two cells, three from tier 5, well apart and each held by a posted guard', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const tier = 4 + seed % 2, plan = planMission(contract('jailbreak', tier, seed * 197)), cells = plan.sites.filter(s => s.kind === 'cell');
    assert.equal(cells.length, prisonerCount(tier));
    cells.forEach((c, i) => cells.slice(i + 1).forEach(d => assert.ok(distance(c, d) >= 8)));
    assert.ok(cells.every(c => plan.enemies.some(e => e.kind === 'guard' && e.patrol.length < 2 && distance(e, c) <= 8)), `seed ${seed}: an unguarded cell`);
  }
});

function jailbreak(tier = 5) {
  const { sim, squad, hostile } = arena('jailbreak', { offers: [contract('jailbreak', tier)] });
  const prisoners = sim.units.filter(u => u.faction === 'vip'), cells = sim.objectives.filter(o => o.kind === 'cell');
  prisoners.forEach((u, i) => { u.x = cells[i].x = 12; u.z = cells[i].z = -12 + i * 12; });
  return { sim, squad, hostile, prisoners, cells };
}

const free = (sim: Simulation, squad: Unit[], p: Unit) => { squad[0].x = p.x - 1; squad[0].z = p.z; squad[0].path = []; step(sim, VIP_SECURE_SECONDS + .1); };

const extractWith = (sim: Simulation, squad: Unit[], followers: Unit[]) => { [...squad, ...followers].forEach(u => { u.x = -18; u.z = -18; u.path = []; }); step(sim, .5); };

test('a prisoner is freed beside an operative, follows it, and the other cells turn optional with a bonus', () => {
  const { sim, squad, prisoners, cells } = jailbreak();
  assert.equal(cells.length, 3); assert.equal(sim.extractReady, false);
  free(sim, squad, prisoners[1]);
  assert.ok(cells[1].done && sim.following(prisoners[1]) && !sim.following(prisoners[0]));
  assert.ok(sim.extractReady && cells[0].optional && cells[2].optional && cells[0].label.includes(`+${PRISONER_BONUS}`));
  squad.forEach(u => { u.x = -12; u.z = 6; u.path = []; }); step(sim, 10);
  assert.ok(distance(prisoners[1], squad[0]) < 3, 'the freed prisoner followed the squad');
  assert.ok(distance(prisoners[0], cells[0]) < .01, 'a prisoner still in its cell stays there');
});

test('one prisoner out is a win; the extraction waits for every freed prisoner', () => {
  const { sim, squad, prisoners } = jailbreak();
  free(sim, squad, prisoners[0]);
  squad.forEach(u => { u.x = -18; u.z = -18; u.path = []; }); step(sim, .5);
  assert.equal(sim.phase, 'mission', 'the freed prisoner is not in the zone yet');
  extractWith(sim, squad, [prisoners[0]]);
  assert.equal(sim.result, 'success');
  assert.deepEqual(sim.getSnapshot().reward, { credits: 0, operative: false, intel: false });
});

test('every prisoner out pays a bonus for each past the first, and the operative from the last cell joins', () => {
  const { sim, squad, prisoners } = jailbreak();
  prisoners.forEach(p => free(sim, squad, p));
  extractWith(sim, squad, prisoners);
  assert.equal(sim.result, 'success');
  assert.deepEqual(sim.getSnapshot().reward, { credits: 2 * PRISONER_BONUS, operative: true, intel: false });
});

test('prisoners wear no armor; a freed one killed reopens the cells, and every prisoner dead fails the contract', () => {
  const { sim, squad, prisoners, cells } = jailbreak();
  free(sim, squad, prisoners[0]);
  const before = prisoners[0].hp;
  (sim as unknown as { damage(t: Unit, n: number, from: Unit | null): void }).damage(prisoners[0], 20, null);
  assert.equal(before - prisoners[0].hp, 20);
  prisoners[0].hp = 0; step(sim, .1);
  assert.ok(cells[0].lost && !sim.extractReady && !cells[1].optional, 'with no freed prisoner alive, the cells are required again');
  prisoners[1].hp = 0; step(sim, .1);
  assert.equal(sim.phase, 'mission');
  prisoners[2].hp = 0; step(sim, .1);
  assert.equal(sim.result, 'failure'); assert.equal(sim.failReason, 'Every prisoner was killed.');
});

test('two executives tagged in the same update open extraction', () => {
  const { sim, execs, tags } = surveillance();
  execs[0].x = 18; execs[1].marked = MARK_SECONDS; execs[2].marked = MARK_SECONDS;
  step(sim, .05);
  assert.ok(tags[1].done && tags[2].done && sim.extractReady);
  assert.ok(tags[0].optional && tags[0].label.includes('intel'));
});

test('before a pickup is called, reinforcement waves enter at random edge exits', () => {
  const entries = [1, 2, 3, 4, 5, 6, 7, 8].map(seed => {
    const sim = new Simulation(campaignWith('heist', { offers: [ending('heist', 'called', 2, 4242 + seed)] }));
    sim.deploy();
    const plan = sim.plan!, squad = sim.units.filter(u => u.faction === 'squad');
    sim.units.filter(u => u.faction === 'hostile').forEach(u => { u.stunned = 1e9; });
    squad.forEach(u => { u.hp = u.maxHp = 1e9; });
    raiseAlarm(sim, plan.start, 'test');
    step(sim, FIRST_WAVE_SECONDS + .05);
    const wave = sim.units.find(u => u.id === 'r0')!, at = plan.exits.find(e => distance(e, wave) < 2);
    assert.ok(at, 'the wave entered at an edge exit');
    const nearest = plan.exits.reduce((a, b) => distance(b, plan.start) < distance(a, plan.start) ? b : a);
    return at === nearest;
  });
  assert.ok(entries.some(near => !near), 'not always the exit nearest the start');
});
