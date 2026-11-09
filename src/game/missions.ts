// What each contract asks of a mission: its objectives, followers and package, the results it reports and the badges
// it earns. Functions over the Simulation, which holds the state.
import { CACHE_BONUS, EXECUTIVES_NEEDED, HANDOVER_REACH, HANDOVER_SECONDS, IDENTIFY_RANGE, IDENTIFY_SECONDS, PICKUP_REACH, PRISONER_BONUS, RECRUIT_COST, ROSTER_CAP, TAG_RANGE, TAG_SECONDS, badgesFor, hasModifier, parSeconds, smashSeconds } from './campaign.ts';
import type { Badge, ContractType, MissionResults, Reward } from './campaign.ts';
import type { MissionPlan } from './mapgen.ts';
import { distance } from './world.ts';
import type { Point } from './world.ts';
import { CACHE_SECONDS, HACK_SECONDS, HOSTILE_STATS, PICKUP_RADIUS, PLANT_SECONDS, SUSPICIOUS, VIP_COVER_REACH, VIP_REACH, VIP_SECURE_SECONDS, VIP_SPEED, cacheLetter, isReinforcement, sweepLabel } from './rules.ts';
import type { Objective, Unit } from './rules.ts';
import type { Simulation } from './simulation.ts';

const objective = (kind: Objective['kind'], label: string, p: Point, unit?: string): Objective => ({ kind, label, x: p.x, z: p.z, progress: 0, done: false, optional: false, ...(unit ? { unit } : {}) });
const done = (sim: Simulation, kind: Objective['kind']) => sim.objectives.filter(o => o.kind === kind && o.done).length;
const targets = (units: readonly Unit[]) => units.filter(u => u.kind === 'target');

// What a contract type asks of a mission, one entry per type:
// - `objectives`: the objectives ahead of extraction, from the plan and the units deployed on it;
// - `target`: what its target is, when not one to kill at its post. A 'courier' walks its route out of the district,
//   runs for the route's end at an alarm, and fails the contract by getting away. An 'executive' strolls a beat and is
//   there to be watched: the squad never fires on one unordered, killing one counts as a kill, and one that gets away
//   is only lost;
// - `company`: who has to reach extraction with the squad, and `extract`, the extraction objective's own wording;
// - `results`: the per-contract results a won contract reports (see RewardSpec in campaign.ts);
// - `trapped`: what a lockdown that catches the squad is called, when not the usual.
type MissionRules = {
  objectives: (plan: MissionPlan, units: readonly Unit[]) => Objective[];
  target?: 'courier' | 'executive'; company?: string; extract?: string; results?: (sim: Simulation) => MissionResults; trapped?: string;
};

export const MISSIONS: Record<ContractType, MissionRules> = {
  assassination: { objectives: plan => plan.enemies.filter(e => e.kind === 'target').slice(0, 1).map(t => objective('target', 'Neutralize the target', t)) },
  heist: { objectives: plan => [objective('terminal', 'Download the vault data', plan.sites[0])] },
  sabotage: { objectives: plan => plan.sites.map((s, i) => objective('charge', `Plant charge ${'AB'[i]}`, s)) },
  escort: { company: 'the VIP', extract: 'Escort the VIP and the whole squad to extraction', objectives: plan => plan.vip ? [objective('vip', 'Free the VIP', plan.vip, 'vip')] : [] },
  // A sweep has no place of its own: its point is the district's center.
  elimination: { objectives: plan => [objective('sweep', sweepLabel(plan.enemies.length), { x: 0, z: 0 })] },
  intercept: { target: 'courier', objectives: plan => plan.enemies.filter(e => e.kind === 'target').slice(0, 1).map(t => objective('target', 'Stop the courier', t)) },
  smash: {
    trapped: 'Lockdown. The squad was trapped.', results: sim => ({ caches: done(sim, 'cache') }),
    objectives: plan => plan.sites.map((s, i) => objective('cache', `Open cache ${'ABC'[i]}`, s)),
  },
  surveillance: {
    target: 'executive', results: sim => ({ tagged: done(sim, 'tag') }),
    objectives: (_, units) => targets(units).map((u, i) => objective('tag', `Tag executive ${'ABC'[i]}`, u, u.id)),
  },
  jailbreak: {
    company: 'the freed prisoners', results: sim => ({ prisoners: rescued(sim).length }),
    objectives: plan => plan.sites.filter(s => s.kind === 'cell').map((s, i) => objective('cell', `Free prisoner ${'ABC'[i]}`, s, `p${i}`)),
  },
};

// The rules of the contract in play.
export const mission = (sim: Simulation) => MISSIONS[sim.plan!.contract.type];

// Whether a dead hostile counts as a kill (for Bloodless and a no-kill clause): every one but a target to kill or stop.
// Executives are to be watched, so killing one counts.
export const countsAsKill = (u: Pick<Unit, 'kind'>, type: ContractType | undefined) => u.kind !== 'target' || (!!type && MISSIONS[type].target === 'executive');

// A mission's objectives, extraction last. A called extraction's zone sits at the start until the pickup is called, and
// nothing shows or points at it till then.
export function objectivesFor(plan: MissionPlan, units: readonly Unit[]): Objective[] {
  const rules = MISSIONS[plan.contract.type], who = rules.company ? `${rules.company} and the whole squad` : 'the whole squad';
  const extract = hasModifier(plan.contract, 'called') ? `Call a pickup, then get ${who} to it` : rules.extract ?? `Get ${who} to extraction`;
  return [...rules.objectives(plan, units), objective('extract', extract, plan.extract)];
}

export const results = (sim: Simulation): MissionResults => mission(sim).results?.(sim) ?? {};

// As applyPayout pays it: an operative for a full roster comes as RECRUIT_COST credits.
export function earnedReward(sim: Simulation, r: Reward): Reward {
  const full = sim.campaign.roster.length >= ROSTER_CAP;
  return { ...r, credits: r.credits + (r.operative && full ? RECRUIT_COST : 0), operative: r.operative && !full };
}

// The badges a won contract earns (see Badge in campaign.ts). Purge counts the hostiles the district started with, not
// reinforcements, which an alarm can keep sending.
export function earnedBadges(sim: Simulation): Badge[] {
  const c = sim.contract!, hostiles = sim.units.filter(u => u.faction === 'hostile'), district = hostiles.filter(u => !isReinforcement(u));
  const earned: Record<Badge, boolean> = {
    ghost: !sim.detected, untouched: !sim.downs, swift: sim.time <= parSeconds(c.type, c.tier),
    bloodless: hostiles.every(u => u.hp > 0 || !countsAsKill(u, c.type)), purge: district.length > 0 && district.every(u => u.hp <= 0),
  };
  return badgesFor(c.type).filter(b => earned[b]);
}

// Jailbreak's freed prisoners still alive.
function rescued(sim: Simulation) { return sim.units.filter(u => u.faction === 'vip' && u.id !== 'vip' && u.hp > 0 && sim.joined.has(u.id)); }

// The package follows its carrier and drops where the carrier goes down. A dropped one goes to whoever stands on it;
// a carried one to a squadmate sent on its own to stand beside the carrier for HANDOVER_SECONDS, both holding still.
export function updateCargo(sim: Simulation, dt: number, squad: Unit[]) {
  const c = sim.cargo; if (!c) return;
  const carrier = c.carrier ? sim.unit(c.carrier) : undefined;
  if (carrier && carrier.hp <= 0) { c.carrier = c.to = null; c.hand = 0; c.x = carrier.x; c.z = carrier.z; sim.message = `${carrier.name} dropped the package.`; return; }
  if (carrier) {
    c.x = carrier.x; c.z = carrier.z;
    const still = (u: Unit) => !u.path.length && !u.route.length;
    const taker = still(carrier) ? squad.find(u => u !== carrier && u.solo && still(u) && distance(u, carrier) <= HANDOVER_REACH) : undefined;
    c.hand = taker && taker.id === c.to ? c.hand + dt : taker ? dt : 0; c.to = taker?.id ?? null;
    if (taker && c.hand >= HANDOVER_SECONDS) carry(sim, taker, `${carrier.name} handed the package to ${taker.name}.`, carrier);
    return;
  }
  const finder = squad.filter(u => distance(u, c) <= PICKUP_REACH).sort((a, b) => distance(a, c) - distance(b, c))[0];
  if (finder) carry(sim, finder, `${finder.name} picked up the package.`);
}

function carry(sim: Simulation, u: Unit, message: string, from?: Unit) {
  const c = sim.cargo!;
  c.carrier = u.id; c.to = null; c.hand = 0; c.x = u.x; c.z = u.z;
  // A carrier drops its attack orders; neither operative hands the package straight back.
  u.targetId = u.takedownId = null; u.solo = false; if (from) from.solo = false;
  if (sim.pending?.unitId === u.id) sim.pending = null;
  sim.message = message; sim.emit();
}

export function updateFollower(sim: Simulation, u: Unit, dt: number, squad: Unit[]) {
  u.moving = false; u.hurt = Math.max(0, u.hurt - dt);
  const leader = [...squad].sort((a, b) => distance(u, a) - distance(u, b))[0];
  if (!leader) return;
  if (!sim.joined.has(u.id)) {
    const secure = sim.objectives.find(o => o.unit === u.id);
    if (!secure || distance(u, leader) > VIP_REACH) return;
    secure.progress = Math.min(1, secure.progress + dt / VIP_SECURE_SECONDS);
    if (secure.progress < 1) return;
    sim.joined.add(u.id);
    const left = sim.objectives.filter(o => o.kind === 'cell' && o.unit !== u.id && !sim.joined.has(o.unit!) && !o.lost).length;
    sim.message = u.id === 'vip' ? 'VIP secured. Escort them to extraction.'
      : `Prisoner ${cacheLetter(secure)} freed. ${left ? `Extraction is open; ${left === 1 ? 'one more cell' : `${left} more cells`} for a bonus.` : 'Bring everyone out.'}`;
  }
  // A follower walks with the nearest operative; under fire it ducks behind cover near that operative instead.
  // At an open extraction it walks into the zone.
  const extract = sim.objectives.at(-1)!;
  const refuge = u.hurt > 0 && sim.vipThreat ? shelter(sim, u, leader, sim.vipThreat) : null;
  const goal = sim.extractReady && distance(leader, extract) < 2 ? extract : refuge ?? leader;
  if (distance(u, goal) <= (goal === leader ? 1.6 : .3)) { u.path = []; return; }
  u.repath -= dt;
  const end = u.path.at(-1);
  if (u.repath <= 0 || !end || distance(end, goal) > 1) { u.repath = .5; u.path = sim.plan!.world.findPath(u, { x: goal.x, z: goal.z }); }
  sim.walk(u, VIP_SPEED, dt);
}

// The nearest spot behind a barrier, as seen from `threat`, within VIP_COVER_REACH of the operative.
function shelter(sim: Simulation, u: Unit, leader: Unit, threat: Point): Point | null {
  const world = sim.plan!.world;
  let best: Point | null = null;
  for (const r of world.cover) {
    if (distance(r, leader) > VIP_COVER_REACH) continue;
    const d = distance(r, threat) || 1;
    for (const depth of [Math.min(r.w, r.d) / 2 + .45, Math.max(r.w, r.d) / 2 + .45]) {
      const spot = { x: r.x + (r.x - threat.x) / d * depth, z: r.z + (r.z - threat.z) / d * depth };
      if (!world.walkable(spot) || !world.coverBetween(threat, spot)) continue;
      if (!best || distance(u, spot) < distance(u, best)) best = spot;
      break;
    }
  }
  return best;
}

// An unknown target is identified by Recon's mark, or once an operative has watched it, unaware, from IDENTIFY_RANGE
// or closer for IDENTIFY_SECONDS; the watch drains as fast while broken off.
export function watchForTarget(sim: Simulation, dt: number, squad: Unit[]) {
  const world = sim.plan!.world;
  for (const u of sim.units) {
    if (!u.guise || u.hp <= 0) continue;
    if (u.marked > 0) { identify(sim, u, 'Recon marked the target. Target identified.'); continue; }
    const eye = u.detect <= SUSPICIOUS && squad.find(s => distance(s, u) <= IDENTIFY_RANGE && world.sightClear(s, u));
    u.watched = eye ? u.watched + dt : Math.max(0, u.watched - dt);
    if (eye && u.watched >= IDENTIFY_SECONDS) identify(sim, u, `${eye.name} identified the target.`);
  }
}

export function identify(sim: Simulation, u: Unit, message: string) {
  u.guise = null; u.watched = 0; u.name = HOSTILE_STATS.target.name; sim.message = message;
  if (sim.targetArea) { sim.targetArea.x = u.x; sim.targetArea.z = u.z; }
  sim.emit();
}

// Surveillance: an operative tags an executive by keeping it, unaware, in sight within TAG_RANGE for TAG_SECONDS (the
// watch drains as fast while broken off); Recon's mark tags it at once.
export function watchExecutives(sim: Simulation, dt: number, squad: Unit[]) {
  if (mission(sim).target !== 'executive') return;
  const world = sim.plan!.world;
  for (const u of sim.units) {
    if (u.kind !== 'target' || u.tagged || u.hp <= 0) continue;
    if (u.marked > 0) { tag(sim, u, `Recon marked ${execName(sim, u).toLowerCase()}. Tagged.`); continue; }
    const eye = !sim.alarm && u.detect <= SUSPICIOUS && squad.find(s => distance(s, u) <= TAG_RANGE && world.sightClear(s, u));
    u.watched = eye ? u.watched + dt : Math.max(0, u.watched - dt);
    if (eye && u.watched >= TAG_SECONDS) tag(sim, u, `${eye.name} tagged ${execName(sim, u).toLowerCase()}.`);
  }
}

export function execName(sim: Simulation, u: Unit) { const o = sim.objectives.find(o => o.unit === u.id); return `Executive ${o ? cacheLetter(o) : ''}`.trim(); }

function tag(sim: Simulation, u: Unit, message: string) {
  u.tagged = true; u.watched = TAG_SECONDS; sim.message = message;
  // Counted from the executives, not the objectives: two tagged in one update (one mark over both) both count.
  const tags = sim.objectives.filter(o => o.kind === 'tag'), isTagged = (o: Objective) => !!sim.unit(o.unit!)?.tagged;
  if (tags.filter(isTagged).length === EXECUTIVES_NEEDED) {
    tags.forEach(o => { if (!isTagged(o) && !o.lost) { o.optional = true; o.label = `${o.label} (intel)`; } });
    if (tags.some(o => o.optional && !o.lost)) sim.message = `${message} Extraction open; tag the last for intel on the next contract.`;
  }
  sim.emit();
}

// A Surveillance executive killed or gone is lost; the contract fails once fewer than EXECUTIVES_NEEDED can still be tagged.
function updateTags(sim: Simulation) {
  const tags = sim.objectives.filter(o => o.kind === 'tag');
  if (!tags.length) return;
  for (const o of tags) {
    const u = sim.unit(o.unit!);
    if (o.done || o.lost) continue;
    if (u && u.hp > 0) {
      if (u.visible) { o.x = u.x; o.z = u.z; }
      o.progress = Math.min(1, u.watched / TAG_SECONDS); o.done = u.tagged;
      continue;
    }
    o.lost = true; o.optional = true; o.progress = 0; o.label = `Executive ${cacheLetter(o)} ${u ? 'killed' : 'got away'}`;
  }
  if (tags.filter(o => !o.lost).length < EXECUTIVES_NEEDED) sim.finish(false, 'Too many executives lost. The contract is blown.');
}

// Smash and grab: the first cache opened starts the lockdown clock and opens extraction; the others become optional.
function openedCache(sim: Simulation, o: Objective) {
  const caches = sim.objectives.filter(c => c.kind === 'cache'), open = caches.filter(c => c.done).length, letter = cacheLetter(o);
  if (open === 1) {
    sim.lockdownIn = smashSeconds(sim.plan!.contract.tier);
    caches.forEach(c => { if (!c.done) { c.optional = true; c.label = `${c.label} (+${CACHE_BONUS} cr)`; } });
    sim.message = `Cache ${letter} open. Lockdown: the exits seal in ${sim.lockdownIn} s.`;
  } else sim.message = `Cache ${letter} open (${open} of ${caches.length}).`;
}

// Jailbreak: a cell is done once its prisoner is freed and alive, and lost once that prisoner is killed. While a freed
// prisoner lives, the other cells are optional and pay a bonus; the contract fails once every prisoner is dead.
function updateCells(sim: Simulation) {
  const cells = sim.objectives.filter(o => o.kind === 'cell');
  if (!cells.length) return;
  const out = rescued(sim).length;
  for (const o of cells) {
    const u = sim.unit(o.unit!), base = `prisoner ${cacheLetter(o)}`;
    if (!u || u.hp <= 0) { o.lost = true; o.done = false; o.optional = true; o.progress = 0; o.label = `Prisoner ${cacheLetter(o)} killed`; continue; }
    o.done = sim.joined.has(u.id); o.optional = !o.done && out > 0;
    o.label = `Free ${base}${o.optional ? ` (+${PRISONER_BONUS} cr)` : ''}`;
  }
  if (cells.every(o => o.lost)) sim.finish(false, 'Every prisoner was killed.');
}

export function updateObjectives(sim: Simulation, dt: number, squad: Unit[]) {
  updateTags(sim);
  updateCells(sim);
  if (sim.phase !== 'mission') return;
  for (const o of sim.objectives) {
    if (o.done) continue;
    if (o.kind === 'target') o.done = sim.units.some(u => u.kind === 'target' && u.hp <= 0);
    if (o.kind === 'vip') o.done = sim.joined.has('vip');
    // Elimination counts the hostiles the district started with, as Purge does; reinforcements never count.
    if (o.kind === 'sweep') {
      const district = sim.units.filter(u => u.faction === 'hostile' && !isReinforcement(u)), left = district.filter(u => u.hp > 0).length;
      o.progress = district.length ? 1 - left / district.length : 1; o.label = sweepLabel(left);
      if (!left) { o.done = true; sim.message = 'District swept. Head for extraction.'; }
    }
    if (o.kind === 'terminal' || o.kind === 'charge' || o.kind === 'cache') {
      const seconds = o.kind === 'terminal' ? HACK_SECONDS : o.kind === 'cache' ? CACHE_SECONDS : PLANT_SECONDS, reach = o.kind === 'terminal' ? 1.5 : 1.2;
      if (squad.some(s => distance(s, o) <= reach)) o.progress = Math.min(1, o.progress + dt / seconds);
      if (o.progress >= 1) { o.done = true; sim.message = o.kind === 'terminal' ? 'Vault data secured. Head for extraction.' : `${o.label.replace('Plant', 'Planted')}.`; }
      if (o.done && o.kind === 'cache') openedCache(sim, o);
      // Under carry, the vault gives up a package instead, to the operative nearest the terminal.
      if (o.done && o.kind === 'terminal' && hasModifier(sim.plan?.contract, 'carry')) {
        const by = [...squad].sort((a, b) => distance(a, o) - distance(b, o))[0];
        sim.cargo = { x: by.x, z: by.z, carrier: null, to: null, hand: 0 };
        carry(sim, by, `${by.name} has the package. Carry it to extraction.`);
      }
    }
    if (o.kind === 'target' && o.done) sim.message = mission(sim).target === 'courier' ? 'Courier stopped. Return to the extraction zone.' : 'Target neutralized. Return to the extraction zone.';
  }
  // Extraction counts only with every deployed operative standing in the zone; the downed must be revived first.
  const extract = sim.objectives.at(-1)!, team = sim.units.filter(u => u.faction === 'squad');
  // A called pickup's zone is wider: it lands on an open street, where a squad sent to it lines up in single file.
  const reach = sim.calledExtraction ? PICKUP_RADIUS : 2, inZone = (s: Unit) => distance(s, extract) < reach;
  extract.progress = team.filter(s => s.hp > 0 && inZone(s)).length / team.length;
  if (!sim.extractReady) return;
  sim.reach('extractOpen');
  // A called pickup lifts off with the squad only once it has landed.
  if (sim.calledExtraction && !(sim.pickup && sim.pickup.in <= 0)) return;
  // Every freed follower still alive has to be in the zone too; a prisoner left in its cell stays behind.
  const followers = sim.units.filter(u => u.faction === 'vip' && u.hp > 0 && sim.joined.has(u.id));
  const vipIn = followers.every(u => distance(u, extract) < reach + .4), cargoIn = !sim.cargo || distance(sim.cargo, extract) < reach;
  if (extract.progress === 1 && vipIn && cargoIn) { extract.done = true; sim.finish(true); return; }
  const down = team.find(s => s.hp <= 0);
  const holdup = !squad.every(inZone) ? '' : down ? `${down.name} is down. Revive them before extracting.` : !vipIn ? (followers.some(u => u.id === 'vip') ? 'Bring the VIP into the zone.' : 'Bring the freed prisoners into the zone.') : cargoIn ? '' : 'Bring the package into the zone.';
  if (holdup && holdup !== sim.holdup) sim.message = holdup;
  sim.holdup = holdup;
}
