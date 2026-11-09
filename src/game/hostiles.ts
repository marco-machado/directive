// Hostiles: what they see and how they act (patrols, posts, the Intercept courier and its escorts, hunting during an
// alarm), and what the squad sees of them (fog of war). Functions over the Simulation, which holds the state.
import { COURIER_PAUSE, COURIER_SPEED } from './mapgen.ts';
import type { EnemyKind } from './mapgen.ts';
import { distance } from './world.ts';
import type { Point } from './world.ts';
import { COUNTERMEASURES, DETECT_DRAIN, EXECUTIVE_SPEED, GHOST_SECONDS, HOSTILE_STATS, LOOK_ANGLE, LOOK_EVERY, LOOK_PAUSE, LOOK_TURN, SEARCH_TURN, SIGHT_RANGE, SUSPICIOUS, SWEEP, angleDiff, concealment, detectSeconds, hashed, headingTo, seenAs, tierDamage, turnTo } from './rules.ts';
import type { Unit } from './rules.ts';
import { contact, raiseAlarm, suspicious } from './alarm.ts';
import { execName, identify, mission } from './missions.ts';
import type { Simulation } from './simulation.ts';

export function updateVisibility(sim: Simulation) {
  const eyes = sim.units.filter(u => u.faction === 'squad' && u.hp > 0), world = sim.plan?.world;
  for (const u of sim.units) {
    if (u.faction !== 'hostile') { u.visible = true; continue; }
    const was = u.visible;
    u.visible = u.marked > 0 || (!!world && eyes.some(e => distance(e, u) <= SIGHT_RANGE && world.sightClear(e, u)));
    if (u.visible && u.hp > 0) sim.reach('hostileSeen');
    if (u.kind === 'target' && !u.guise && u.visible && u.hp > 0 && sim.targetArea) { sim.targetArea.x = u.x; sim.targetArea.z = u.z; }
    if (u.visible || u.hp <= 0) sim.lastSeen.delete(u.id);
    else if (was) sim.lastSeen.set(u.id, { x: u.x, z: u.z, heading: u.heading, at: sim.time });
  }
  for (const [id, s] of sim.lastSeen) if (sim.time - s.at >= GHOST_SECONDS) sim.lastSeen.delete(id);
}

export function updateHostile(sim: Simulation, u: Unit, dt: number, intruders: Unit[]) {
  const world = sim.plan!.world, stats = HOSTILE_STATS[u.kind as EnemyKind];
  u.marked = Math.max(0, u.marked - dt);
  u.moving = false;
  if (u.held > 0) return; // pinned by a takedown
  if (u.stunned > 0) { u.stunned -= dt; return; }
  u.cooldown -= dt;
  const mobile = u.kind === 'guard' || u.kind === 'heavy' || !!u.guise;
  if (u.kind === 'camera' || u.kind === 'turret') u.heading = u.sweep + Math.sin(sim.time * .6 + u.x) * SWEEP[u.kind];
  // An unknown target sees as the guard it passes for.
  const eyes = seenAs(u);
  const seen = intruders.filter(v => distance(u, v) <= eyes.vision && angleDiff(headingTo(u, v), u.heading) <= eyes.fov && world.sightClear(u, v))
    .sort((a, b) => distance(u, a) - distance(u, b))[0];
  if (sim.alarm) { if (seen) contact(sim, seen); }
  else if (seen) {
    const was = u.detect;
    const time = detectSeconds(u.kind as EnemyKind, distance(u, seen)) * (seen.faction === 'squad' ? concealment(sim.campaign) : 1) * COUNTERMEASURES[sim.countermeasures].detect;
    u.detect = Math.min(1, u.detect + dt / time);
    if (u.detect >= 1) { raiseAlarm(sim, u, `${eyes.name} spotted the squad`, seen, { trigger: 'sighting', by: u, culprit: seen }); return; }
    if (was <= SUSPICIOUS && u.detect > SUSPICIOUS) { sim.reach('suspicious'); suspicious(sim, u); }
  } else u.detect = Math.max(0, u.detect - DETECT_DRAIN * dt);
  if (!sim.alarm && !(u.kind === 'target' && u.exit)) {
    // A suspicious guard stops and stares instead of walking on.
    if (seen && u.detect > SUSPICIOUS && mobile) { u.heading = headingTo(u, seen); return; }
    if (u.kind === 'target' && mission(sim).target === 'executive') patrol(sim, u, EXECUTIVE_SPEED, dt);
    else if (u.kind === 'target' && u.patrol.length) courier(sim, u, dt);
    else if (u.escort) follow(sim, u, dt);
    else if (mobile) patrol(sim, u, stats.speed, dt);
    return;
  }
  if (u.kind === 'target') {
    if (u.wait > 0 || !u.exit) { u.wait -= dt; return; }
    // An unknown target gives itself away by running.
    if (u.guise) identify(sim, u, 'The target broke from its post. Target identified.');
    // Re-plan after anything (an EMP) cleared the route.
    if (!u.path.length) u.path = world.findPath(u, u.exit);
    sim.walk(u, stats.alertSpeed, dt);
    if (distance(u, u.exit) >= 1) return;
    // An executive that gets away leaves the district; Surveillance fails only once too few are left to tag.
    if (mission(sim).target === 'executive') { sim.escaped.add(u.id); sim.message = `${execName(sim, u)} got away.`; return; }
    sim.finish(false, mission(sim).target === 'courier' ? 'The courier got away.' : 'The target escaped.');
    return;
  }
  if (u.kind === 'camera') return;
  // Operatives draw fire before the VIP does.
  const inRange = intruders.filter(v => distance(u, v) <= stats.range && world.sightClear(u, v))
    .sort((a, b) => (a.faction === 'vip' ? 1 : 0) - (b.faction === 'vip' ? 1 : 0) || distance(u, a) - distance(u, b))[0];
  if (inRange) {
    u.heading = headingTo(u, inRange);
    if (u.cooldown <= 0) { sim.shoot(u, inRange, stats.damage * tierDamage(sim.plan!.contract.tier)); u.cooldown = stats.fireCooldown; }
    return;
  }
  if (!mobile) return;
  // Hunters close on where the squad was last seen, then turn on the spot to search.
  const goal = sim.lastKnown;
  if (u.hunting && goal) {
    if (distance(u, goal) <= 1) { u.path = []; u.heading += SEARCH_TURN * dt; return; }
    const end = u.path.at(-1);
    u.repath -= dt;
    if (u.repath <= 0 && !(end && end.x === goal.x && end.z === goal.z)) { u.repath = 1; u.path = world.findPath(u, goal); }
    sim.walk(u, stats.alertSpeed, dt);
  } else if (u.escort) follow(sim, u, dt);
  else patrol(sim, u, stats.speed, dt);
}

// An Intercept courier: waits out its delay, then walks its route corner to corner, pausing at each, and leaves at the
// last one. Watching it stand at a corner it walked to gives its whole route away, as a patrol's.
function courier(sim: Simulation, u: Unit, dt: number) {
  if (!u.path.length) {
    if (u.wait > 0) {
      if (u.visible && u.patrolIndex > 0 && !sim.intel.has(u.id)) sim.intel.set(u.id, oneWay(sim, u.patrol));
      u.wait -= dt; return;
    }
    // A leg cut short (an EMP clears the path) is walked to its end before the next one starts.
    const corner = u.patrol[u.patrolIndex];
    if (distance(u, corner) > .05) u.path = sim.plan!.world.findPath(u, corner);
    else if (u.patrolIndex >= u.patrol.length - 1) { sim.finish(false, 'The courier got away.'); return; }
    else { u.patrolIndex++; u.path = sim.plan!.world.findPath(u, u.patrol[u.patrolIndex]); u.wait = COURIER_PAUSE; }
  }
  sim.walk(u, COURIER_SPEED, dt);
}

export function oneWay(sim: Simulation, points: Point[]): Point[] {
  const world = sim.plan!.world, route = [{ x: points[0].x, z: points[0].z }];
  points.slice(1).forEach((p, i) => route.push(...world.findPath(points[i], p)));
  return route;
}

// An escort keeps a step behind the courier and to one side, catching up at its own pace; it holds where the courier
// fell, or stood until it sets off.
function follow(sim: Simulation, u: Unit, dt: number) {
  const c = sim.unit(u.escort!), world = sim.plan!.world;
  if (!c || c.hp <= 0 || !c.moving && !c.path.length && c.patrolIndex === 0) return lookAround(sim, u, dt);
  const side = Number(u.id.slice(1)) % 2 ? 1 : -1;
  const spot = { x: c.x - Math.sin(c.heading) * .9 + Math.cos(c.heading) * side * .8, z: c.z - Math.cos(c.heading) * .9 - Math.sin(c.heading) * side * .8 };
  const goal = world.walkable(spot, .3) ? spot : { x: c.x, z: c.z };
  if (distance(u, goal) < .3) { u.path = []; turnTo(u, c.heading, 4 * dt); u.sweep = u.heading; return; }
  u.repath -= dt;
  if (u.repath <= 0 || !u.path.length) { u.repath = .5; u.path = world.findPath(u, goal); }
  sim.walk(u, distance(u, goal) > 1.5 ? HOSTILE_STATS.guard.speed : COURIER_SPEED, dt);
  u.sweep = u.heading;
}

function patrol(sim: Simulation, u: Unit, speed: number, dt: number) {
  if (u.patrol.length < 2) return lookAround(sim, u, dt);
  if (!u.path.length) {
    // Watching a guard stand at the end of a leg it just walked (its pause there is still running) gives away its whole route.
    const end = u.patrol[u.patrolIndex];
    if (u.visible && u.wait > 0 && u.x === end.x && u.z === end.z && !sim.intel.has(u.id)) sim.intel.set(u.id, route(sim, u.patrol));
    if (u.wait > 0) { u.wait -= dt; return; }
    u.patrolIndex = (u.patrolIndex + 1) % u.patrol.length;
    u.path = sim.plan!.world.findPath(u, u.patrol[u.patrolIndex]); u.wait = 1.2;
  }
  sim.walk(u, speed, dt);
}

// The loop a patrol walks, leg by leg, as the paths the guard takes between its points.
export function route(sim: Simulation, patrol: Point[]): Point[] {
  const world = sim.plan!.world, route = [{ x: patrol[0].x, z: patrol[0].z }];
  patrol.forEach((p, i) => route.push(...world.findPath(p, patrol[(i + 1) % patrol.length])));
  return route;
}

// A posted guard faces its post, and every 6 to 8 s turns 60° to one side (alternating), holds that look
// for 2 s and turns back. The schedule follows the contract seed; a guard pulled off it turns back to it.
function lookAround(sim: Simulation, u: Unit, dt: number) {
  const seed = sim.plan!.contract.seed, every = (n: number) => LOOK_EVERY[0] + (LOOK_EVERY[1] - LOOK_EVERY[0]) * hashed(seed, u.id, n);
  if (!u.lookEvery) { u.lookEvery = every(0); u.look = hashed(seed, u.id, -1) * u.lookEvery; }
  u.look += dt;
  if (u.look >= u.lookEvery) { u.look -= u.lookEvery; u.lookEvery = every(++u.lookCycle); }
  const turn = LOOK_ANGLE / LOOK_TURN, t = u.look - (u.lookEvery - 2 * turn - LOOK_PAUSE);
  const offset = t <= 0 ? 0 : t < turn ? t * LOOK_TURN : t < turn + LOOK_PAUSE ? LOOK_ANGLE : Math.max(0, LOOK_ANGLE - (t - turn - LOOK_PAUSE) * LOOK_TURN);
  turnTo(u, u.sweep + (u.lookCycle % 2 ? -1 : 1) * offset, 2 * LOOK_TURN * dt);
}
