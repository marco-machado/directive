// The alarm: what raises it, how each one in a mission escalates, how it stands down, and the reinforcements it brings.
// Functions over the Simulation, which holds the state.
import { LOCKDOWN_SECONDS, hasModifier } from './campaign.ts';
import type { EnemyKind } from './mapgen.ts';
import { distance } from './world.ts';
import type { Point } from './world.ts';
import { CONVERGE_RADIUS, COUNTERMEASURES, FIRST_WAVE_SECONDS, FLEE_DELAY, FLEE_MIN_EXIT, HOSTILE_STATS, LANDMARK, REINFORCE_SECONDS, REPEAT_REINFORCEMENTS, cacheLetter, escalation, posted, tierHp, waveSize } from './rules.ts';
import type { AlarmTrigger, Escalation, Unit } from './rules.ts';
import { mission } from './missions.ts';
import type { Simulation } from './simulation.ts';

// `by` is the hostile that raised it and `culprit` the operative that gave the squad away, when there is one.
export function raiseAlarm(sim: Simulation, at: Point, reason: string, seen?: Point, cause: { trigger?: AlarmTrigger; by?: Unit; culprit?: Unit } = {}) {
  if (!sim.plan) return;
  // A fresh trigger during the alarm only restarts the stand-down countdown.
  contact(sim, null);
  if (sim.alarm) return;
  sim.alarm = true; sim.detected = true; sim.reach('alarm');
  if (hasModifier(sim.plan.contract, 'lockdown') && sim.lockdownIn === null) sim.lockdownIn = LOCKDOWN_SECONDS;
  // Every alarm sends its first wave as quickly; a later one sends more, and takes longer to stand down.
  const e = escalate(sim, ++sim.alarms);
  sim.reinforceCap = e.cap; sim.calmFor = sim.calmIn = e.calm; sim.waves = 0; sim.reinforceIn = FIRST_WAVE_SECONDS;
  const known = seen ?? at; sim.lastKnown = { x: known.x, z: known.z };
  sim.alarmCause ??= { x: known.x, z: known.z, trigger: cause.trigger ?? null, hostile: (cause.by?.kind as EnemyKind | undefined) ?? null, operative: cause.culprit?.name ?? null, near: landmarkNear(sim, known), at: sim.time };
  for (const u of sim.units) {
    if (u.faction !== 'hostile' || u.hp <= 0) continue;
    u.detect = 1;
    if ((u.kind === 'guard' || u.kind === 'heavy') && distance(u, at) <= CONVERGE_RADIUS) { u.hunting = true; u.repath = 0; }
    // A target already running from an earlier alarm keeps its exit and does not hesitate again.
    // An Intercept courier runs on for its own exit, at once.
    if (u.kind === 'target' && !u.exit && mission(sim).target === 'courier') { u.exit = u.patrol.at(-1)!; u.wait = 0; u.path = []; }
    if (u.kind === 'target' && !u.exit && !u.tagged) {
      const exits = [...sim.plan.exits].sort((a, b) => distance(u, a) - distance(u, b));
      u.exit = [...exits.filter(e => distance(u, e) >= FLEE_MIN_EXIT), ...exits].find(e => sim.plan!.world.findPath(u, e).length) ?? null;
      u.wait = FLEE_DELAY;
    }
  }
  sim.message = `ALARM: ${reason}. Weapons free.`;
}

// The objective closest to a point, named for the debrief.
function landmarkNear(sim: Simulation, p: Point) {
  const o = sim.objectives.filter(o => o.kind !== 'sweep').sort((a, b) => distance(a, p) - distance(b, p))[0];
  if (!o) return 'the district';
  return o.kind === 'charge' ? o.label.replace('Plant charge', 'Charge') : o.kind === 'cache' ? `Cache ${cacheLetter(o)}` : LANDMARK[o.kind];
}

// While alarmed, anything that gives the squad away restarts the countdown; a sighting or gunfire also updates where hunters search.
export function contact(sim: Simulation, seen: Point | null) {
  if (!sim.alarm) return;
  sim.calmIn = sim.calmFor;
  if (seen) sim.lastKnown = { x: seen.x, z: seen.z };
}

export function standDown(sim: Simulation) {
  sim.alarm = false; sim.calmIn = 0; sim.lastKnown = null;
  // A fleeing target keeps running for its exit.
  // A posted guard that left its post to hunt keeps watch where it ends up.
  for (const u of sim.units) if (u.faction === 'hostile' && u.hp > 0) { if (u.hunting && posted(u)) u.sweep = u.heading; u.detect = 0; u.hunting = false; if (!u.exit) u.path = []; }
  const next = escalate(sim, sim.alarms + 1), more = Number.isFinite(next.cap) ? `${REPEAT_REINFORCEMENTS} more reinforcements` : 'reinforcements without end';
  sim.message = `Contact lost. Alarm standing down. Holding fire. Next alarm: ${more}, ${next.heavies} ${next.heavies === 1 ? 'heavy' : 'heavies'} leading each wave, ${next.calm} s to stand down.`;
}

// A mission's `n`th alarm, as its Countermeasures level hardens it.
export function escalate(sim: Simulation, n: number): Escalation {
  const e = escalation(n, sim.plan?.contract.tier ?? 1), cm = COUNTERMEASURES[sim.countermeasures];
  return { ...e, calm: e.calm + cm.calm, cap: cm.uncapped ? Infinity : e.cap };
}

// With auto-pause on, the first time a hostile turns suspicious pauses the mission so the player can react.
export function suspicious(sim: Simulation, u: Unit) {
  if (!sim.autoPause || sim.autoPaused.has(u.id)) return;
  sim.autoPaused.add(u.id); sim.paused = true;
  sim.message = `${u.name} is suspicious. Auto-paused.`;
}

export function reinforce(sim: Simulation, dt: number) {
  if (!sim.alarm || sim.reinforced >= sim.reinforceCap || !sim.plan) return;
  sim.reinforceIn -= dt;
  if (sim.reinforceIn > 0) return;
  sim.reinforceIn = REINFORCE_SECONDS;
  // An alarm's first wave flanks: it enters at the exit nearest extraction, between the squad and its way out; later
  // waves enter at a random edge exit. A called extraction has no way out to flank until the pickup is called, so
  // every wave until then enters at a random exit, and every wave after it comes in nearest the pickup.
  const exits = sim.plan.exits, extract = sim.pickup ?? sim.plan.extract, tier = sim.plan.contract.tier;
  const nearest = () => exits.reduce((a, b) => distance(b, extract) < distance(a, extract) ? b : a);
  const first = sim.waves++ === 0, random = () => exits[Math.floor(sim.rng() * exits.length)];
  const exit = sim.pickup ? nearest() : sim.calledExtraction || !first ? random() : nearest();
  const count = Math.min(waveSize(tier), sim.reinforceCap - sim.reinforced), heavies = escalate(sim, sim.alarms).heavies;
  for (let k = 0; k < count; k++) {
    const kind = k < heavies ? 'heavy' : 'guard', stats = HOSTILE_STATS[kind];
    const u = sim.makeUnit(`r${sim.reinforced++}`, stats.name, kind, 'hostile', { x: exit.x + (k - 1) * .6, z: exit.z }, Math.round(stats.hp * tierHp(tier)));
    if (!sim.plan.world.walkable(u)) { u.x = exit.x; u.z = exit.z; }
    u.hunting = true; u.detect = 1; sim.units.push(u);
  }
  sim.message = `Reinforcements entering the district (${sim.reinforced}${Number.isFinite(sim.reinforceCap) ? `/${sim.reinforceCap}` : ''}).`;
}
