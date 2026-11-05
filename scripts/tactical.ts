// A bot that plays for engagement control: it routes around vision cones, waits out patrols, and clears a blocker
// quietly (a sniper shot or a volley that kills, a takedown nobody sees, an EMP) before it ever fights. It only goes
// loud when the alarm sounds or when it has made no progress for STALL seconds. It knows only what bots.ts's
// Knowledge holds and acts only through Orders.
import { abilityPower, ABILITY_STATS, CLASS_STATS } from '../src/game/classes.ts';
import { COVER_FACTOR, gearRange, HOSTILE_STATS, posted, ROUTE_MAX, TAKEDOWN_REACH, watchedBy } from '../src/game/simulation.ts';
import type { AttackPreview, Objective } from '../src/game/simulation.ts';
import { distance } from '../src/game/world.ts';
import type { Point, World } from '../src/game/world.ts';
import { observer } from './bots.ts';
import type { Bot, Knowledge, Op, Orders, Seen } from './bots.ts';

const STALL = 45;      // s without progress before the bot goes loud
const PATIENCE = 8;    // s to wait for a patrol to walk out of the way before dealing with it
const REPLAN = 1;      // s a job keeps its spot before the bot looks for a better one
const SITE_REACH: Partial<Record<Objective['kind'], number>> = { terminal: 1.5, charge: 1.2 };

const angleDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const headingTo = (a: Point, b: Point) => Math.atan2(b.x - a.x, b.z - a.z);
const toward = (from: Point, angle: number, d: number): Point => ({ x: from.x + Math.sin(angle) * d, z: from.z + Math.cos(angle) * d });
// Whether `h` sees `p` with the cone it has right now (detection only fills inside it).
const seesNow = (world: World, h: Seen, p: Point) => {
  const s = HOSTILE_STATS[h.kind];
  return distance(h, p) <= s.vision && angleDiff(headingTo(h, p), h.heading) <= s.fov && world.sightClear(h, p);
};
// Points every `step` m along a route that starts at `from`.
function samples(from: Point, route: Point[], step = .4): Point[] {
  const out: Point[] = [];
  let a = from;
  for (const b of route) {
    const n = Math.max(1, Math.ceil(distance(a, b) / step));
    for (let i = 1; i <= n; i++) out.push({ x: a.x + (b.x - a.x) * i / n, z: a.z + (b.z - a.z) * i / n });
    a = b;
  }
  return out;
}
// A volley that kills, or with suppressed rifles one that only turns the hostile suspicious when a second finishes it.
const quietVolley = (p: AttackPreview | null) => p?.outcome === 'kill' || (p?.outcome === 'suspicious' && p.damage * 2 >= p.hp);
const pathLength = (from: Point, path: Point[]) => path.reduce((sum, p, i) => sum + distance(i ? path[i - 1] : from, p), 0);

// Any two points: a route that makes watchedBy draw one cone instead of a posted guard's whole look-around.
const ONE_CONE = [{ x: 0, z: 0 }, { x: 0, z: 0 }];
// What routes keep out of. For a posted guard that is the way it faces now and the way its post faces, not its whole
// look-around: the bot times the look-arounds, stepping out of sight when one turns its way.
function sight(world: World, h: Seen, margin: number) {
  if (!posted(h)) return watchedBy(world, h, margin);
  const now = watchedBy(world, { ...h, patrol: ONE_CONE }, margin), post = watchedBy(world, { ...h, heading: h.sweep, patrol: ONE_CONE }, margin);
  return (p: Point) => now(p) || post(p);
}
// Ground a hostile can see: `plan` widened for routes, `now` as it stands, `ever` wherever it looks (for takedowns,
// which hold still long enough for a look-around to come round).
type Watcher = { h: Seen; plan: (p: Point) => boolean; now: (p: Point) => boolean; ever: (p: Point) => boolean };
type Goal = { key: string; kind: Objective['kind'] | 'search'; point: Point; target?: Seen };
type Job =
  | { kind: 'volley'; target: string; spot: Point; at: number }
  | { kind: 'takedown'; target: string; crew: string[]; spots: Point[]; at: number }
  | { kind: 'emp'; target: string; tech: string; spot: Point; at: number };

class Tactician {
  private k!: Knowledge;
  private living: Op[] = [];
  private watchers: Watcher[] = [];
  private loud = false;
  private progress = ''; private best = Infinity; private progressAt = 0;
  private waiting: { id: string; since: number } | null = null;
  private job: Job | null = null;
  private fightTarget = ''; private fightGoal = '';
  private retreat: Point | null = null; private retreatAt = -Infinity;

  constructor(private readonly o: Orders, private readonly quietOnly: boolean) {}

  think(k: Knowledge) {
    this.k = k;
    // A targeted ability whose aim failed is still waiting for a click; drop it.
    if (k.pending) this.o.cancelAbility();
    this.living = k.squad.filter(op => op.hp > 0);
    if (!this.living.length) return;
    this.watchers = k.hostiles.filter(h => h.stunned < 1 && h.held <= 0)
      .map(h => ({ h, plan: sight(k.world, h, 1), now: sight(k.world, h, 0), ever: watchedBy(k.world, h, 0) }));
    const goal = this.goal();
    this.track(goal);
    const down = k.squad.find(op => op.hp <= 0);
    if (down) {
      if (!this.living.some(op => op.reviveTarget)) { this.o.selectAll(); this.o.revive(down.id); }
      return;
    }
    if (!k.alarm) this.retreat = null;
    if (k.alarm || this.loud) this.fight(goal); else this.sneak(goal);
  }

  // ---- Where the squad is going ----
  private goal(): Goal {
    const k = this.k, o = k.objectives.find(o => !o.done)!;
    if (o.kind === 'target') {
      const target = k.hostiles.find(h => h.kind === 'target');
      return target ? { key: 'target', kind: 'target', point: target, target } : { key: 'search', kind: 'search', point: this.street(k.targetArea ?? k.extract) };
    }
    if (o.kind === 'vip') return { key: 'vip', kind: 'vip', point: k.vip! };
    return { key: `${o.kind}:${o.label}`, kind: o.kind, point: o };
  }
  // The nearest walkable point to `p` (the target area's center can lie inside a building).
  private street(p: Point): Point {
    const w = this.k.world;
    if (w.walkable(p)) return p;
    let best = p, bestD = Infinity;
    for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
      const q = { x: Math.round(p.x) + dx, z: Math.round(p.z) + dz }, d = distance(p, q);
      if (d < bestD && w.walkable(q)) { best = q; bestD = d; }
    }
    return best;
  }
  // Progress is an objective advancing, a goal reached for, or the squad 2 m closer to its goal.
  private track(goal: Goal) {
    const k = this.k, d = Math.min(...this.living.map(op => distance(op, goal.point)));
    const key = `${goal.key}|${k.objectives.map(o => o.done ? 'done' : Math.floor(o.progress * 4)).join(',')}|${k.kills}`;
    if (key !== this.progress) { this.progress = key; this.best = d; this.progressAt = k.time; }
    else if (d < this.best - 2) { this.best = d; this.progressAt = k.time; }
    if (!this.quietOnly && k.time - this.progressAt > STALL) this.loud = true;
  }

  // ---- Quiet ----
  private danger(which: 'plan' | 'now', skip?: string) { return (p: Point) => this.watchers.some(w => w.h.id !== skip && w[which](p)); }
  private sneak(goal: Goal) {
    const k = this.k;
    // Anyone a hostile is looking at right now steps out of its sight first, unless that hostile can be dealt with at once.
    let escaped = false;
    for (const op of this.living) {
      if (op.takedownId) continue;
      const spotter = this.watchers.find(w => w.h.visible && seesNow(k.world, w.h, op));
      if (!spotter) continue;
      if (this.quick(spotter.h)) return;
      this.escape(op); escaped = true;
    }
    if (escaped) return;
    if (this.job && this.continueJob()) return;
    if (goal.target) { this.neutralize(goal.target); return; }
    // With the VIP in tow the route keeps a wider berth, so the VIP trailing behind stays out of sight too.
    const wide = k.vip?.joined ? this.watchers.map(w => sight(k.world, w.h, 2)) : null;
    const avoid = wide ? (p: Point) => wide.some(sees => sees(p)) : this.danger('plan');
    // A goal inside someone's sight is cleared first.
    const guard = this.watchers.find(w => w.plan(goal.point));
    if (guard) { this.unblock(guard.h); return; }
    const reach = SITE_REACH[goal.kind as Objective['kind']] ?? 1;
    for (const op of this.living) {
      if (op.targetId || op.takedownId || op.reviveTarget) continue;
      if (distance(op, goal.point) <= reach && !op.route.length) continue;
      if (this.onCourse(op, goal.point, reach)) continue;
      const path = k.world.findPath(op, goal.point, avoid);
      if (path.length) { this.send(op, path); continue; }
      const blocker = this.blocker(op, goal.point);
      if (blocker) { this.unblock(blocker); return; }
      this.send(op, k.world.findPath(op, goal.point));
    }
  }
  // Whether the operative's current route still ends at `point` and stays out of sight.
  private onCourse(op: Op, point: Point, reach: number) {
    const end = op.route.at(-1);
    return !!end && distance(end, point) <= Math.max(1, reach) && !samples(op, op.route).some(this.danger('now'));
  }
  private send(op: Op, path: Point[]) {
    if (!path.length) return;
    this.o.select(op.id);
    this.o.move(path[0]);
    for (const p of path.slice(1, ROUTE_MAX)) this.o.move(p, true);
  }
  private stop(ops: Op[]) {
    for (const op of ops) if (op.route.length) { this.o.select(op.id); this.o.hold(); }
  }
  // The first hostile whose sight the direct route crosses.
  private blocker(op: Op, point: Point): Seen | null {
    for (const p of samples(op, this.k.world.findPath(op, point))) {
      const w = this.watchers.find(w => w.plan(p));
      if (w) return w.h;
    }
    return null;
  }
  // A walking blocker gets PATIENCE seconds to walk off; anyone else is dealt with.
  private unblock(h: Seen) {
    const k = this.k;
    if (h.patrol.length >= 2) {
      if (this.waiting?.id !== h.id) this.waiting = { id: h.id, since: k.time };
      if (k.time - this.waiting.since < PATIENCE) { this.stop(this.living.filter(op => samples(op, op.route).some(this.danger('now')))); return; }
    }
    this.neutralize(h);
  }
  // Leaves the sight of every hostile, to the nearest spot within 6 m that nobody watches.
  private escape(op: Op) {
    const k = this.k, avoid = this.danger('plan');
    const spots: Point[] = [];
    for (let dx = -6; dx <= 6; dx++) for (let dz = -6; dz <= 6; dz++) spots.push({ x: Math.round(op.x) + dx, z: Math.round(op.z) + dz });
    spots.sort((a, b) => distance(a, op) - distance(b, op));
    for (const s of spots) {
      if (!k.world.walkable(s) || avoid(s)) continue;
      const path = k.world.findPath(op, s);
      if (path.length) { this.send(op, path); return; }
    }
  }

  // ---- Dealing with one hostile, quietly ----
  // What can be done right now, without moving: a sniper shot or a volley that kills.
  private quick(h: Seen): boolean {
    if (this.snipe(h)) return true;
    if (!h.visible) return false;
    this.o.selectAll();
    const p = this.o.attackPreview(h.id);
    if (!quietVolley(p) || !this.living.every(op => this.canHit(op, h))) return false;
    this.o.attack(h.id); this.job = null;
    return true;
  }
  // Rifle range, with extended barrels' reach.
  private range(op: Op) { return CLASS_STATS[op.cls].range + gearRange(this.k.campaign); }
  private canHit(op: Op, h: Point) {
    const w = this.k.world;
    return distance(op, h) <= this.range(op) - .2 && w.sightClear(op, h) && !w.coverBetween(op, h);
  }
  private snipe(h: Seen): boolean {
    const k = this.k, recon = this.living.find(op => op.ability === 'snipe' && op.abilityCd <= 0);
    if (!recon || !h.visible || distance(recon, h) > ABILITY_STATS.snipe.reach || !k.world.sightClear(recon, h)) return false;
    // A barrier between them halves the shot, as it does any fire; only a shot that kills is quiet.
    if (abilityPower('snipe', recon.level) * (k.world.coverBetween(recon, h) ? COVER_FACTOR : 1) < h.hp) return false;
    this.o.ability(recon.slot); this.o.unitClick(h.id); this.job = null;
    return true;
  }
  // Other hostiles that would see a takedown on `h` (or the crew behind it).
  private witnesses(h: Seen, at: Point[] = []): Seen[] {
    return this.watchers.filter(w => w.h.id !== h.id && [h, ...at].some(p => w.ever(p))).map(w => w.h);
  }
  private neutralize(h: Seen, depth = 0) {
    const k = this.k;
    if (this.snipe(h)) return;
    if (!h.visible) { this.approach(h); return; }
    this.o.selectAll();
    const p = this.o.attackPreview(h.id);
    if (quietVolley(p)) { this.job = { kind: 'volley', target: h.id, spot: h, at: -Infinity }; this.continueJob(); return; }
    const tech = this.living.find(op => op.ability === 'emp' && op.abilityCd <= 0);
    if (p?.outcome === 'takedown') {
      const spots = this.strikeSpots(h);
      if (!this.witnesses(h, spots).length) { this.job = { kind: 'takedown', target: h.id, crew: p.takedown, spots, at: k.time }; this.continueJob(); return; }
    }
    if (tech) { this.job = { kind: 'emp', target: h.id, tech: tech.id, spot: h, at: -Infinity }; this.continueJob(); return; }
    // A witness that can be dealt with alone goes first.
    const witness = depth < 1 ? this.witnesses(h).find(w => w.visible) : undefined;
    if (witness) { this.neutralize(witness, depth + 1); return; }
    this.stop(this.living);
  }
  // Gets close enough to see a remembered hostile again, without being seen.
  private approach(h: Seen) {
    const spot = this.spotNear(h, 7, 5, this.living);
    if (spot) for (const op of this.living) if (!this.onCourse(op, spot, 1)) this.send(op, this.k.world.findPath(op, spot, this.danger('plan')));
  }
  // Behind the hostile, where a takedown ends: one spot, or one at either shoulder of a heavy.
  private strikeSpots(h: Seen): Point[] {
    const back = (posted(h) ? h.sweep : h.heading) + Math.PI;
    return (h.kind === 'heavy' ? [-.45, .45] : [0]).map(turn => toward(h, back + turn, TAKEDOWN_REACH - .25));
  }
  // A spot `lo`–`hi` m from `h` with a clear, uncovered line to it, that no hostile watches and every one of `ops` can
  // reach unseen; the one with the shortest longest walk.
  private spotNear(h: Point, hi: number, lo: number, ops: Op[]): Point | null {
    const k = this.k, avoid = this.danger('plan');
    const candidates: Point[] = [];
    for (const r of [hi, (hi + lo) / 2, lo]) for (let i = 0; i < 16; i++) {
      const p = toward(h, i * Math.PI / 8, r);
      if (k.world.walkable(p) && k.world.sightClear(p, h) && !k.world.coverBetween(p, h) && !avoid(p)) candidates.push(p);
    }
    const centroid = { x: ops.reduce((s, op) => s + op.x, 0) / ops.length, z: ops.reduce((s, op) => s + op.z, 0) / ops.length };
    candidates.sort((a, b) => distance(a, centroid) - distance(b, centroid));
    let best: Point | null = null, bestLength = Infinity;
    for (const c of candidates.slice(0, 6)) {
      const lengths = ops.map(op => { const path = k.world.findPath(op, c, avoid); return path.length || distance(op, c) < .5 ? pathLength(op, path) : Infinity; });
      const worst = Math.max(...lengths);
      if (worst < bestLength) { best = c; bestLength = worst; }
    }
    return bestLength < Infinity ? best : null;
  }

  // Carries the current job a step further; false when there is none left to carry.
  private continueJob(): boolean {
    const k = this.k, job = this.job!;
    const h = k.hostiles.find(s => s.id === job.target);
    if (!h || h.hp <= 0) { this.job = null; return false; }
    if (job.kind === 'volley') {
      const shooters = this.living, range = Math.min(...shooters.map(op => this.range(op)));
      if (k.time - job.at > REPLAN || distance(job.spot, h) > range - .5) {
        const spot = this.spotNear(h, range - .6, range - 2, shooters);
        if (!spot) { this.job = null; return false; }
        job.spot = spot; job.at = k.time;
      }
      if (shooters.every(op => this.canHit(op, h))) {
        this.o.selectAll();
        if (quietVolley(this.o.attackPreview(h.id))) { this.o.attack(h.id); this.job = null; return true; }
      }
      for (const op of shooters) if (!this.onCourse(op, job.spot, .5) && distance(op, job.spot) > .5) this.send(op, k.world.findPath(op, job.spot, this.danger('plan')));
      return true;
    }
    if (job.kind === 'takedown') {
      const crew = job.crew.map(id => this.living.find(op => op.id === id)).filter((op): op is Op => !!op);
      if (crew.length < job.crew.length || h.detect > .3) { this.job = null; return false; }
      if (crew.some(op => op.takedownId === h.id)) return true; // the sim has it from here
      // A walking hostile is followed from behind; the sim's own approach keeps out of its sight.
      const walking = h.patrol.length >= 2;
      if (crew.every(op => distance(op, h) <= (walking ? 4 : TAKEDOWN_REACH))) {
        if (this.witnesses(h, crew).length) { this.stop(crew); return true; }
        this.o.select(crew[0].id); for (const op of crew.slice(1)) this.o.select(op.id, true);
        this.o.attack(h.id);
        return true;
      }
      job.spots = this.strikeSpots(h);
      crew.forEach((op, i) => {
        const spot = job.spots[i] ?? job.spots[0];
        if (this.onCourse(op, spot, .4)) return;
        const path = k.world.findPath(op, spot, this.danger('plan'));
        if (path.length) this.send(op, path); else this.job = null;
      });
      return !!this.job;
    }
    // EMP: the Tech walks to where it can throw, then the stunned hostile is just out of the way (or taken down).
    const tech = this.living.find(op => op.id === job.tech);
    if (!tech || tech.abilityCd > 0) { this.job = null; return false; }
    if (distance(tech, h) <= ABILITY_STATS.emp.reach - .3 && k.world.sightClear(tech, h)) {
      this.o.ability(tech.slot); this.o.groundClick({ x: h.x, z: h.z }); this.job = null;
      return true;
    }
    if (k.time - job.at > REPLAN) {
      const spot = this.spotNear(h, ABILITY_STATS.emp.reach - .5, 4, [tech]);
      if (!spot) { this.job = null; return false; }
      job.spot = spot; job.at = k.time;
    }
    if (!this.onCourse(tech, job.spot, .5)) this.send(tech, k.world.findPath(tech, job.spot, this.danger('plan')));
    return true;
  }

  // ---- Loud ----
  private fight(goal: Goal) {
    const k = this.k;
    this.job = null;
    this.abilities();
    if (k.alarm && this.withdraw()) return;
    const visible = k.hostiles.filter(h => h.visible && h.hp > 0);
    const near = visible.filter(h => this.living.some(op => distance(op, h) <= this.range(op) + 3) && (HOSTILE_STATS[h.kind].damage > 0 || h.kind === 'target'));
    const target = near.find(h => h.kind === 'target') ?? [...near].sort((a, b) => a.hp - b.hp)[0] ?? (goal.target?.visible ? goal.target : undefined);
    if (target && k.alarm) {
      if (this.fightTarget !== target.id || this.living.every(op => op.targetId !== target.id)) { this.o.selectAll(); this.o.attack(target.id); this.fightTarget = target.id; this.fightGoal = ''; }
      return;
    }
    this.fightTarget = '';
    // Gone loud with no alarm yet: walk at the goal in plain sight rather than order takedowns that cannot be reached.
    const idle = this.living.every(op => !op.route.length && !op.targetId && !op.takedownId);
    if (this.fightGoal !== goal.key || (idle && this.living.some(op => distance(op, goal.point) > 2))) {
      this.fightGoal = goal.key; this.o.selectAll(); this.o.move(goal.point);
    }
  }
  // A squad losing a firefight (under 35% of its health, or with four armed hostiles in sight) breaks contact: it pulls
  // back to the nearest spot within 20 m that no hostile it knows of can see, and holds there for the alarm to stand
  // down. Not while an assassination target lives, which would get away meanwhile.
  private withdraw(): boolean {
    const k = this.k;
    if (k.objectives.some(o => o.kind === 'target' && !o.done)) return false;
    const hp = this.living.reduce((s, op) => s + op.hp, 0) / this.living.reduce((s, op) => s + op.maxHp, 0);
    const armed = k.hostiles.filter(h => h.visible && HOSTILE_STATS[h.kind].damage > 0).length;
    if (!this.retreat && hp >= .35 && armed < 4) return false;
    const exposed = (p: Point) => k.hostiles.some(h => distance(h, p) <= HOSTILE_STATS[h.kind].vision + 2 && k.world.sightClear(h, p));
    if (!this.retreat || (k.time - this.retreatAt > 2 && exposed(this.retreat))) {
      this.retreat = this.hideout(exposed); this.retreatAt = k.time;
      if (!this.retreat) return false;
    }
    for (const op of this.living) {
      const end = op.route.at(-1);
      if ((!end || distance(end, this.retreat) > 1) && distance(op, this.retreat) > 1) this.send(op, k.world.findPath(op, this.retreat));
    }
    return true;
  }
  private hideout(exposed: (p: Point) => boolean): Point | null {
    const k = this.k, n = this.living.length;
    const c = { x: Math.round(this.living.reduce((s, op) => s + op.x, 0) / n), z: Math.round(this.living.reduce((s, op) => s + op.z, 0) / n) };
    const cells: Point[] = [];
    for (let dx = -20; dx <= 20; dx++) for (let dz = -20; dz <= 20; dz++) {
      const p = { x: c.x + dx, z: c.z + dz };
      if (distance(p, c) <= 20 && k.world.walkable(p)) cells.push(p);
    }
    cells.sort((a, b) => distance(a, c) - distance(b, c));
    for (const p of cells) if (!exposed(p) && k.world.findPath(this.living[0], p).length) return p;
    return null;
  }
  private abilities() {
    const k = this.k, visible = k.hostiles.filter(h => h.visible && h.hp > 0);
    for (const op of this.living) {
      if (op.abilityCd > 0 || !op.ability) continue;
      const stats = ABILITY_STATS[op.ability], inReach = (p: Point) => distance(op, p) <= stats.reach - .2 && k.world.sightClear(op, p);
      if (op.ability === 'heal') {
        if (this.living.some(m => m.hp < m.maxHp * .5 && distance(m, op) <= stats.radius)) this.o.ability(op.slot);
      } else if (op.ability === 'snipe') {
        const h = visible.filter(inReach).sort((a, b) => b.hp - a.hp)[0];
        if (h) { this.o.ability(op.slot); this.o.unitClick(h.id); }
      } else if (op.ability === 'grenade') {
        const h = visible.filter(inReach).find(c => visible.filter(v => distance(v, c) <= stats.radius).length >= 2);
        if (h) { this.o.ability(op.slot); this.o.groundClick({ x: h.x, z: h.z }); }
      } else {
        const h = visible.filter(inReach).find(v => v.kind === 'turret' || v.kind === 'heavy');
        if (h) { this.o.ability(op.slot); this.o.groundClick({ x: h.x, z: h.z }); }
      }
    }
  }
}

export const tactical: Bot = (sim, { quietOnly }) => {
  const see = observer(sim), bot = new Tactician(sim, quietOnly);
  return () => bot.think(see());
};
