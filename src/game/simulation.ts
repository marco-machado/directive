import { abilityCooldown, abilityPower, ABILITY_STATS, CLASS_STATS, effectScale, EMP_CAMERA_SECONDS, MARK_RADIUS, MARK_SECONDS } from './classes.ts';
import type { AbilityId, ClassId } from './classes.ts';
import { applyDismiss, applyPayout, applyPurchase, applyRecruit, dealBoard, freshCampaign, missionPayout, SQUAD_MAX } from './campaign.ts';
import type { Campaign, Contract, Upgrade } from './campaign.ts';
import { planMission } from './mapgen.ts';
import type { Area, EnemyKind, MissionPlan } from './mapgen.ts';
import { mulberry32 } from './rng.ts';
import type { Rng } from './rng.ts';
import { distance } from './world.ts';
import type { Point } from './world.ts';
export { freshCampaign, parseCampaign } from './campaign.ts';
export type { Campaign, Upgrade } from './campaign.ts';

export type Faction = 'squad' | 'hostile' | 'vip';
export type UnitKind = ClassId | EnemyKind | 'vip';
// A queued leg of an operative's move order: the path from the previous leg's end, and how long to hold at its own end.
export type Leg = { path: Point[]; wait: number };
// A stop on a planned route, as the scene numbers it.
export type Waypoint = Point & { wait: number };
export type Unit = Point & {
  id: string; name: string; kind: UnitKind; faction: Faction; hp: number; maxHp: number; cooldown: number;
  // `path` is the leg being walked. An operative holds `wait` seconds at its end, then takes the next leg of `route`.
  path: Point[]; route: Leg[]; targetId: string | null; heading: number; moving: boolean; repath: number;
  ability: AbilityId | null; abilityCd: number; reviveTarget: string | null; revive: number; hurt: number;
  patrol: Point[]; patrolIndex: number; exit: Point | null; wait: number; detect: number; stunned: number; marked: number; visible: boolean; hunting: boolean; sweep: number;
  // Takedowns: the hostile an operative is closing on, and how long a hostile has been held.
  takedownId: string | null; held: number;
  // A posted guard's look-around: seconds into the current cycle, that cycle's length, and its count.
  look: number; lookEvery: number; lookCycle: number;
};
// Where a hostile was, and which way it faced, when the squad lost sight of it (`at` is mission time).
export type Sighting = Point & { heading: number; at: number };
export type Shot = { id: number; from: Point; to: Point; faction: Faction; shooter: UnitKind; kind: 'bullet' | 'snipe'; ttl: number };
export type Blast = { id: number; kind: 'grenade' | 'heal' | 'emp'; x: number; z: number; radius: number; ttl: number };
export type Objective = Point & { kind: 'target' | 'terminal' | 'charge' | 'vip' | 'extract'; label: string; progress: number; done: boolean };
export type Phase = 'briefing' | 'mission' | 'headquarters';
export type Pending = { unitId: string; ability: AbilityId } | null;
// 'covered' when every threat fires into the barrier the unit crouches behind, 'flanked' when one of them has a clear shot.
export type Shield = 'covered' | 'flanked' | null;
export type CoverStatus = { threats: { id: string; covered: boolean }[]; shield: Shield };
export type CoverSnap = Point & { along: Point; span: { lo: number; hi: number } | null };
export type Snapshot = {
  phase: Phase; paused: boolean; selected: string[]; squad: string[]; squadPick: string[]; units: Unit[]; campaign: Campaign;
  contract: Contract | null; plan: MissionPlan | null; objectives: Objective[]; alarm: boolean; calmIn: number; reinforceIn: number; reinforced: number;
  result: 'success' | 'failure' | null; failReason: string; payout: number; stealth: boolean; time: number; message: string;
  saveUnavailable: boolean; syncing: boolean; pending: Pending; cover: Record<string, Shield>;
};
// Reports campaign events to the server; the server answers through applyCampaign.
export type CampaignSync = {
  deployed(contractId: string, squad: string[]): void; completed(stealth: boolean): void;
  bought(type: Upgrade): void; recruited(id: string): void; dismissed(id: string): void;
};

export type HostileStats = { name: string; hp: number; damage: number; range: number; fireCooldown: number; speed: number; alertSpeed: number; vision: number; fov: number };
export const HOSTILE_STATS: Record<EnemyKind, HostileStats> = {
  guard: { name: 'SECURITY', hp: 75, damage: 14, range: 5.5, fireCooldown: 1.25, speed: 1.8, alertSpeed: 3, vision: 7, fov: .87 },
  heavy: { name: 'HEAVY', hp: 180, damage: 16, range: 5, fireCooldown: 1.4, speed: 1.5, alertSpeed: 2.2, vision: 6, fov: .87 },
  camera: { name: 'CAMERA', hp: 40, damage: 0, range: 0, fireCooldown: 0, speed: 0, alertSpeed: 0, vision: 8, fov: .61 },
  turret: { name: 'TURRET', hp: 140, damage: 18, range: 7, fireCooldown: 1.1, speed: 0, alertSpeed: 0, vision: 7, fov: .79 },
  target: { name: 'TARGET', hp: 110, damage: 0, range: 0, fireCooldown: 0, speed: 0, alertSpeed: 1.8, vision: 6, fov: .87 },
};
// Hostiles grow 5% tougher and 4% deadlier per tier up to tier 3, then a further 10% and 15% per tier.
export const tierHp = (tier: number) => 1 + .05 * (tier - 1) + .1 * Math.max(0, tier - 3);
export const tierDamage = (tier: number) => 1 + .04 * (tier - 1) + .15 * Math.max(0, tier - 3);
export const SQUAD_SPEED = 3.4;
export const VIP_SPEED = 3.2;
export const VIP_HP = 160;
export const VIP_REACH = 3;           // an operative this close to the VIP
export const VIP_SECURE_SECONDS = 5; // takes this long to free them
export const VIP_DAMAGE_TAKEN = .5; // the VIP wears body armor: hostile fire does half damage
export const VIP_COVER_REACH = 4;   // under fire, the VIP ducks behind cover this close to its operative
export const FLEE_DELAY = 5;        // the target hesitates before running for an exit
export const FLEE_MIN_EXIT = 16;    // and picks an exit at least this far away
export const SIGHT_RANGE = 10;      // fog of war: hostiles beyond this or behind buildings are hidden
export const GHOST_SECONDS = 12;    // a hostile that drops out of sight leaves a last-seen marker this long
export const CONVERGE_RADIUS = 14;  // guards this close to the alarm hunt the squad
export const SUSPICIOUS = .3;       // detection above this makes a guard stop and stare
// Detection fills in DETECT_BASE + DETECT_PER_METER × distance seconds: 1.5 s at 2 m, 4 s at a guard's full 7 m.
export const DETECT_BASE = .5;
export const DETECT_PER_METER = .5;
export const CAMERA_DETECT = .75;   // a camera fills in this share of a guard's time at the same distance
export const DETECT_DRAIN = .25;    // per second, with nobody in sight
export const detectSeconds = (kind: EnemyKind, d: number) => (DETECT_BASE + DETECT_PER_METER * d) * (kind === 'camera' ? CAMERA_DETECT : 1);
export const FIRST_WAVE_SECONDS = 5; // the first reinforcement wave follows the alarm this quickly
export const REINFORCE_SECONDS = 20; // and later waves this far apart
export const CALM_SECONDS = 25;     // the alarm stands down after this long without contact
export const SEARCH_TURN = 1.5;     // a hunter at the last known position turns this fast (rad/s)
export const REINFORCE_CAP = 8;
export const REVIVE_SECONDS = 3;
export const REVIVE_HP = .4;
export const HACK_SECONDS = 12;
export const PLANT_SECONDS = 3;
export const COVER_FACTOR = .5;
export const WEAPON_BONUS = 12, ARMOR_BONUS = 40;
export const QUEUE_SPACING = .9;    // gap between operatives, side by side or in single file
export const ROUTE_MAX = 8;         // waypoints an operative's route can hold, the one it is walking to included
export const WAIT_STEP = 2;         // each wait order adds this many seconds at the last waypoint
export const WAIT_MAX = 10;         // and one past this clears the wait
export const TAKEDOWN_REACH = 1.2;  // an operative this close to an unaware hostile starts the takedown
export const TAKEDOWN_SECONDS = 1.5;
const TAKEDOWN_STANDOFF = .9;       // where the approach route ends, behind the hostile
export const LOOK_ANGLE = Math.PI / 3; // posted guards look this far to either side of their post
export const LOOK_PAUSE = 2;        // and hold that look this long
export const LOOK_EVERY = [6, 8] as const; // seconds between the starts of two look-arounds
export const LOOK_TURN = 1.5;       // rad/s while looking around

const angleDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
// Turns `u` toward `heading` by at most `step` radians, the short way round.
const turnTo = (u: Unit, heading: number, step: number) => {
  const d = Math.atan2(Math.sin(heading - u.heading), Math.cos(heading - u.heading));
  u.heading = Math.abs(d) <= step ? heading : u.heading + Math.sign(d) * step;
};
// A number in [0, 1) fixed by the contract seed, a unit id and a counter, so look-arounds replay exactly.
const hashed = (seed: number, id: string, n: number) => {
  let h = seed ^ 0x2545f491;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return mulberry32((h ^ Math.imul(n + 1, 0x9e3779b1)) >>> 0)();
};
const takedownable = (u: Unit) => u.kind === 'guard' || u.kind === 'heavy' || u.kind === 'target';
const posted = (u: Unit) => (u.kind === 'guard' || u.kind === 'heavy') && u.patrol.length < 2;
const headingTo = (a: Point, b: Point) => Math.atan2(b.x - a.x, b.z - a.z);
const routeLength = (from: Point, path: Point[]) => path.reduce((sum, p, i) => sum + distance(i ? path[i - 1] : from, p), 0);
// The point `d` back from the end of a route, walking toward its start.
const pointBack = (route: Point[], d: number): Point => {
  for (let i = route.length - 1; i > 0; i--) {
    const a = route[i], b = route[i - 1], len = distance(a, b);
    if (!len || len < d) { d -= len; continue; }
    return { x: a.x + (b.x - a.x) * d / len, z: a.z + (b.z - a.z) * d / len };
  }
  return { x: route[0].x, z: route[0].z };
};

export class Simulation {
  campaign: Campaign;
  phase: Phase = 'briefing';
  paused = false;
  selected: string[] = [];
  squad: string[] = [];
  squadPick: string[] = [];
  units: Unit[] = [];
  shots: Shot[] = [];
  blasts: Blast[] = [];
  objectives: Objective[] = [];
  plan: MissionPlan | null = null;
  // Where the squad last knew the target to be: the briefing's intel, then wherever the target was last seen.
  targetArea: Area | null = null;
  contract: Contract | null = null;
  alarm = false;
  detected = false; // stays set once the alarm has sounded, even after it stands down
  calmIn = 0;
  reinforceIn = 0;
  result: Snapshot['result'] = null;
  failReason = '';
  payout = 0;
  time = 0;
  message = 'Choose a contract and a squad.';
  saveUnavailable = false;
  syncing = false;
  commandPoint: Point | null = null;
  pending: Pending = null;
  autoPause = false; // pause the first time each hostile turns suspicious
  // Fog-of-war memory, by hostile id: the last sighting of each hostile now out of sight, and the full patrol
  // route of each guard the squad has watched finish a leg. Both are replaced with each mission.
  lastSeen = new Map<string, Sighting>();
  intel = new Map<string, Point[]>();
  private reinforced = 0;
  private vipJoined = false;
  private vipThreat: Point | null = null; // where the last shot at the VIP came from
  private lastKnown: Point | null = null;
  private holdup = '';
  private casts: { unitId: string; ability: AbilityId; point: Point; targetId: string | null }[] = [];
  private hitThisFrame = new Set<Unit>();
  private volleyReady = new Set<Unit>();
  private autoPaused = new Set<string>();
  private rng: Rng = Math.random;
  private nextId = 0;
  private listeners = new Set<() => void>();
  private snapshot!: Snapshot;
  private uiTimer = 0;
  private sync: CampaignSync | undefined;

  constructor(campaign = freshCampaign(), sync?: CampaignSync) {
    this.campaign = campaign; this.sync = sync; this.refreshBoard(); this.emit();
  }
  subscribe = (callback: () => void) => { this.listeners.add(callback); return () => { this.listeners.delete(callback); }; };
  getSnapshot = () => this.snapshot;
  private emit() {
    this.snapshot = {
      phase: this.phase, paused: this.paused, selected: [...this.selected], squad: [...this.squad], squadPick: [...this.squadPick],
      units: this.units.map(u => ({ ...u })), campaign: this.campaign, contract: this.contract, plan: this.plan,
      objectives: this.objectives.map(o => ({ ...o })), alarm: this.alarm, calmIn: this.calmIn, reinforceIn: this.reinforceIn, reinforced: this.reinforced, result: this.result,
      failReason: this.failReason, payout: this.payout, stealth: !this.detected, time: this.time, message: this.message,
      saveUnavailable: this.saveUnavailable, syncing: this.syncing, pending: this.pending,
      cover: Object.fromEntries(this.phase === 'mission' && this.plan ? this.livingSquad().map(u => [u.id, this.coverStatus(u).shield]) : []),
    };
    this.listeners.forEach(fn => fn());
  }
  private report(send: (sync: CampaignSync) => void) { if (this.sync) try { send(this.sync); } catch { this.saveUnavailable = true; } }
  applyCampaign(campaign: Campaign) { this.campaign = campaign; if (this.phase !== 'mission') this.refreshBoard(); this.emit(); }
  setSaveUnavailable(unavailable: boolean) { if (this.saveUnavailable !== unavailable) { this.saveUnavailable = unavailable; this.emit(); } }
  setSyncing(syncing: boolean) { if (this.syncing !== syncing) { this.syncing = syncing; this.emit(); } }

  // ---- Contract board and headquarters ----
  private refreshBoard() {
    const offers = this.campaign.offers;
    const keep = offers.find(o => o.id === this.contract?.id);
    this.squadPick = this.squadPick.filter(id => this.campaign.roster.some(o => o.id === id));
    if (!this.squadPick.length) this.squadPick = this.campaign.roster.slice(0, SQUAD_MAX).map(o => o.id);
    if (this.phase === 'briefing') this.preview(keep ?? offers[0] ?? null);
  }
  private preview(contract: Contract | null) {
    if (contract && contract.id === this.contract?.id && this.plan) return;
    this.contract = contract; this.plan = contract ? planMission(contract) : null;
    this.resetUnits();
  }
  chooseContract(id: string) {
    if (this.phase !== 'briefing') return;
    const offer = this.campaign.offers.find(o => o.id === id); if (!offer) return;
    this.preview(offer); this.emit();
  }
  toggleSquad(id: string) {
    if (this.phase === 'mission' || !this.campaign.roster.some(o => o.id === id)) return;
    if (this.squadPick.includes(id)) { if (this.squadPick.length > 1) this.squadPick = this.squadPick.filter(s => s !== id); }
    else if (this.squadPick.length < SQUAD_MAX) this.squadPick = [...this.squadPick, id];
    if (this.phase === 'briefing') this.resetUnits();
    this.emit();
  }
  openBoard = () => { if (this.phase !== 'headquarters') return; this.phase = 'briefing'; this.result = null; this.contract = null; this.refreshBoard(); this.emit(); };
  buy(type: Upgrade): boolean { return this.trade(applyPurchase(this.campaign, type), s => s.bought(type)); }
  recruit(id: string): boolean { return this.trade(applyRecruit(this.campaign, id), s => s.recruited(id)); }
  dismiss(id: string): boolean {
    const ok = this.trade(applyDismiss(this.campaign, id), s => s.dismissed(id));
    if (ok) { this.refreshBoard(); if (this.phase === 'briefing') this.resetUnits(); this.emit(); }
    return ok;
  }
  private trade(next: Campaign | null, send: (s: CampaignSync) => void) {
    if (this.phase === 'mission' || !next) return false;
    this.campaign = next; this.report(send); this.emit(); return true;
  }

  // ---- Mission setup ----
  private makeUnit(id: string, name: string, kind: UnitKind, faction: Faction, p: Point, maxHp: number, heading = 0): Unit {
    return {
      id, name, kind, faction, x: p.x, z: p.z, hp: maxHp, maxHp, cooldown: faction === 'hostile' ? 1 : 0, path: [], route: [], targetId: null, heading, moving: false, repath: 0,
      ability: null, abilityCd: 0, reviveTarget: null, revive: 0, hurt: 0, patrol: [], patrolIndex: 0, exit: null, wait: 0, detect: 0, stunned: 0, marked: 0, visible: false, hunting: false, sweep: heading,
      takedownId: null, held: 0, look: 0, lookEvery: 0, lookCycle: 0,
    };
  }
  private resetUnits() {
    const plan = this.plan;
    this.units = []; this.objectives = []; this.shots = []; this.blasts = []; this.casts = []; this.hitThisFrame.clear(); this.volleyReady.clear(); this.autoPaused.clear();
    this.alarm = false; this.detected = false; this.calmIn = 0; this.lastKnown = null; this.lastSeen = new Map(); this.intel = new Map();
    this.reinforceIn = 0; this.reinforced = 0; this.vipJoined = false; this.vipThreat = null; this.holdup = ''; this.pending = null; this.commandPoint = null;
    this.targetArea = plan?.targetArea ? { ...plan.targetArea } : null;
    if (!plan) { this.squad = []; this.selected = []; return; }
    this.rng = mulberry32(plan.contract.seed ^ 0x5bd1e995);
    this.squad = this.squadPick.filter(id => this.campaign.roster.some(o => o.id === id));
    this.squad.forEach((id, i) => {
      const op = this.campaign.roster.find(o => o.id === id)!, stats = CLASS_STATS[op.cls];
      const u = this.makeUnit(id, op.name, op.cls, 'squad', plan.spawn[i % plan.spawn.length], stats.hp + this.campaign.armor * ARMOR_BONUS, headingTo(plan.extract, { x: 0, z: 0 }));
      u.ability = stats.ability; this.units.push(u);
    });
    plan.enemies.forEach((e, i) => {
      const stats = HOSTILE_STATS[e.kind];
      const u = this.makeUnit(`h${i}`, stats.name, e.kind, 'hostile', e, Math.round(stats.hp * tierHp(plan.contract.tier)), e.heading);
      u.patrol = e.patrol; this.units.push(u);
    });
    if (plan.vip) this.units.push(this.makeUnit('vip', 'VIP', 'vip', 'vip', plan.vip, VIP_HP, headingTo(plan.vip, plan.extract)));
    this.selected = [...this.squad];
    const o = (kind: Objective['kind'], label: string, p: Point): Objective => ({ kind, label, x: p.x, z: p.z, progress: 0, done: false });
    const t = plan.contract.type, target = plan.enemies.find(e => e.kind === 'target');
    if (t === 'assassination' && target) this.objectives.push(o('target', 'Neutralize the target', target));
    if (t === 'heist') this.objectives.push(o('terminal', 'Download the vault data', plan.sites[0]));
    if (t === 'sabotage') plan.sites.forEach((s, i) => this.objectives.push(o('charge', `Plant charge ${'AB'[i]}`, s)));
    if (t === 'escort' && plan.vip) this.objectives.push(o('vip', 'Free the VIP', plan.vip));
    this.objectives.push(o('extract', t === 'escort' ? 'Escort the VIP and the whole squad to extraction' : 'Get the whole squad to extraction', plan.extract));
    this.updateVisibility();
  }
  deploy = () => {
    if (this.phase !== 'briefing' || !this.contract || !this.campaign.offers.some(o => o.id === this.contract!.id)) return;
    const contract = this.contract;
    // Mirrors the server: deploying deals the next board, so offers reroll whatever the outcome.
    this.campaign = dealBoard(this.campaign, Math.random);
    this.begin(contract);
  };
  restart = () => { if (this.phase === 'mission' && this.contract) this.begin(this.contract); };
  private begin(contract: Contract) {
    this.phase = 'mission'; this.result = null; this.failReason = ''; this.payout = 0; this.paused = false; this.time = 0;
    this.resetUnits();
    this.message = `Squad deployed. ${this.objectives[0].label}.`;
    this.report(s => s.deployed(contract.id, [...this.squad])); this.emit();
  }

  // ---- Orders ----
  private livingSquad() { return this.units.filter(u => u.faction === 'squad' && u.hp > 0); }
  private unit(id: string) { return this.units.find(u => u.id === id); }
  select(id: string, additive = false) {
    const u = this.unit(id);
    if (!u || u.faction !== 'squad' || u.hp <= 0) return;
    this.selected = additive ? (this.selected.includes(id) ? this.selected.filter(s => s !== id) : [...this.selected, id]) : [id]; this.emit();
  }
  selectSlot(slot: number) { const id = this.squad[slot]; if (id) this.select(id); }
  selectAll = () => { this.selected = this.livingSquad().map(u => u.id); this.emit(); };
  togglePause = () => { if (this.phase === 'mission') { this.paused = !this.paused; this.emit(); } };
  pause = () => { if (this.phase === 'mission' && !this.paused) { this.paused = true; this.emit(); } };
  setAutoPause(on: boolean) { this.autoPause = on; }
  private orderable() { return this.selected.map(id => this.unit(id)).filter((u): u is Unit => !!u && u.hp > 0); }
  private clearOrders(u: Unit) { u.targetId = null; u.reviveTarget = null; u.revive = 0; u.takedownId = null; u.route = []; u.wait = 0; }
  // On a move order: walking a leg, holding at a waypoint, or with legs still queued.
  private planned(u: Unit) { return !u.targetId && !u.reviveTarget && !u.takedownId && (u.path.length > 0 || u.wait > 0 || u.route.length > 0); }
  // Where an operative's move order ends: its last queued leg, else the leg it is on, else where it stands.
  private planEnd(u: Unit): Point {
    for (let i = u.route.length - 1; i >= 0; i--) { const end = u.route[i].path.at(-1); if (end) return end; }
    return u.path.at(-1) ?? { x: u.x, z: u.z };
  }
  // The stops of an operative's move order: the end of the leg it is on (where it stands while it holds there),
  // then the end of each queued leg. Empty without a move order.
  waypoints(u: Unit): Waypoint[] {
    if (u.faction !== 'squad' || !this.planned(u)) return [];
    let at: Point = u.path.at(-1) ?? u;
    const stops = [{ x: at.x, z: at.z, wait: u.wait }];
    for (const leg of u.route) { at = leg.path.at(-1) ?? at; stops.push({ x: at.x, z: at.z, wait: leg.wait }); }
    return stops;
  }
  // Operatives line up side by side; where the street is too narrow for that, they queue in single file.
  // An order next to a barrier ends on its sheltered side (see coverSnap), the line running along the barrier and
  // packed closer, if it has to, to stay within the stretch the barrier shelters.
  // A plain order replaces each operative's route. An appended one becomes the next leg of every route on a move
  // order, the line forming from where those routes end; an operative without one sets off from where it stands.
  move(click: Point, append = false) {
    if (this.phase !== 'mission' || !this.plan) return;
    const selection = this.orderable(), units = append ? selection.filter(u => this.waypoints(u).length < ROUTE_MAX) : selection, n = units.length;
    if (!n && selection.length) { this.message = `Route full: ${ROUTE_MAX} waypoints per operative.`; this.emit(); return; }
    const world = this.plan.world, from = new Map(units.map(u => [u, append && this.planned(u) ? this.planEnd(u) : { x: u.x, z: u.z }])), at = (u: Unit) => from.get(u)!;
    const snap = this.coverSnap(click), point = { x: snap?.x ?? click.x, z: snap?.z ?? click.z }, along = snap?.along ?? { x: 1, z: 0 }, span = snap?.span;
    const gap = span && n > 1 ? Math.min(QUEUE_SPACING, (span.hi - span.lo) / (n - 1)) : QUEUE_SPACING, half = gap * (n - 1) / 2;
    const middle = span ? Math.min(Math.max(0, span.lo + half), span.hi - half) : 0;
    const line = units.map((u, i) => {
      // A formation slot off the map (extraction sits by the edge) falls back to the clicked point itself.
      const k = middle + (i - (n - 1) / 2) * gap, slot = { x: point.x + along.x * k, z: point.z + along.z * k }, path = world.findPath(at(u), slot);
      return path.length || world.inBounds(slot) ? path : world.findPath(at(u), point);
    });
    const orders = line.every(path => path.length) ? new Map(units.map((u, i) => [u, line[i]])) : this.queue(units, point, at);
    orders.forEach((path, u) => {
      if (append && this.planned(u)) u.route.push({ path, wait: 0 });
      else { this.clearOrders(u); u.path = path; }
    });
    const moved = orders.size > 0, fire = this.alarm ? 'Weapons free.' : 'Holding fire until ordered.';
    this.commandPoint = moved ? point : null;
    this.message = !moved ? 'Route blocked. Choose an open street.' : append ? `Waypoint added. ${fire}` : `Move order confirmed. ${fire}`; this.emit();
  }
  // The first to arrive takes the point; the rest take slots back along the longest approach route.
  // Units do not collide, so the queue forms on arrival; followers that run out of route stack on the point.
  // `at` is where each unit sets off from: where it stands, or where its route ends.
  private queue(units: Unit[], point: Point, at: (u: Unit) => Point) {
    const world = this.plan!.world, orders = new Map<Unit, Point[]>();
    const reach = units.map(u => ({ u, from: at(u), path: world.findPath(at(u), point) })).filter(r => r.path.length).map(r => ({ ...r, length: routeLength(r.from, r.path) }));
    if (!reach.length) return orders;
    const leader = [...reach].sort((a, b) => a.length - b.length)[0];
    const approach = reach.reduce((a, b) => b.length > a.length ? b : a);
    const route = [{ x: approach.from.x, z: approach.from.z }, ...approach.path], slots = [point];
    let free = reach.filter(r => r !== leader);
    orders.set(leader.u, leader.path);
    for (let d = QUEUE_SPACING; free.length && d <= approach.length; d += .3) {
      const slot = pointBack(route, d);
      if (!world.walkable(slot) || slots.some(s => distance(s, slot) < QUEUE_SPACING - 1e-3)) continue;
      const best = free.map(f => ({ f, path: world.findPath(f.from, slot) })).filter(c => c.path.length)
        .map(c => ({ ...c, length: routeLength(c.f.from, c.path) })).sort((a, b) => a.length - b.length)[0];
      if (!best) continue;
      orders.set(best.f.u, best.path); slots.push(slot); free = free.filter(f => f !== best.f);
      d += QUEUE_SPACING - .3;
    }
    free.forEach(f => orders.set(f.u, f.path));
    return orders;
  }
  // An unaware guard, heavy or target that the selection's volley would not kill gets a takedown instead:
  // the nearest operative (two for a heavy) circles out of its sight and finishes it up close.
  // Otherwise every selected operative closes in and, before the alarm, they fire together.
  private firepower(u: Unit) { return CLASS_STATS[u.kind as ClassId].damage + this.campaign.weapon * WEAPON_BONUS; }
  private attackPlan(target: Unit, units: Unit[]) {
    const world = this.plan!.world;
    const damage = units.reduce((sum, u) => sum + this.firepower(u) * (world.coverBetween(u, target) ? COVER_FACTOR : 1), 0), kills = damage >= target.hp;
    const quiet = !this.alarm && target.detect < SUSPICIOUS && takedownable(target) && !kills, need = target.kind === 'heavy' ? 2 : 1;
    const takedown = quiet && units.length >= need ? [...units].sort((a, b) => distance(a, target) - distance(b, target)).slice(0, need) : [];
    return { takedown, short: quiet && units.length < need ? need : 0, damage: Math.round(damage), hp: Math.ceil(target.hp), alerts: !this.alarm && !kills };
  }
  private attackable(id: string) {
    const target = this.unit(id), units = this.orderable();
    return this.phase === 'mission' && this.plan && target && target.faction === 'hostile' && target.hp > 0 && target.visible && units.length ? { target, units } : null;
  }
  // What an attack order on `id` would do with the current selection, for the hover hint: "48 / 75 · will alert".
  attackHint(id: string): string | null {
    const order = this.attackable(id); if (!order) return null;
    const p = this.attackPlan(order.target, order.units);
    if (p.takedown.length) return `Takedown · ${p.takedown.map(u => u.name).join(' + ')}`;
    const volley = `${p.damage} / ${p.hp}`;
    return this.alarm ? volley : `${volley} · ${p.alerts ? 'will alert' : 'silent kill'}${p.short ? ` · takedown needs ${p.short}` : ''}`;
  }
  attack(id: string) {
    const order = this.attackable(id); if (!order) return;
    const { target, units } = order, p = this.attackPlan(target, units), world = this.plan!.world;
    const who = target.kind === 'target' ? 'Target' : target.name;
    if (p.takedown.length) {
      for (const u of this.units) if (u.takedownId === id) { u.takedownId = null; u.path = []; }
      p.takedown.forEach(u => { this.clearOrders(u); u.takedownId = id; u.repath = .3; });
      p.takedown.forEach(u => { u.path = this.approach(u, target); });
      const names = p.takedown.map(u => u.name).join(' and ');
      this.commandPoint = null;
      this.message = p.takedown.every(u => u.path.length || distance(u, target) <= TAKEDOWN_REACH)
        ? `${names} circling out of sight for a takedown on ${who}.` : `${names} waiting for a way past ${who}'s line of sight.`;
      this.emit(); return;
    }
    units.forEach(u => { this.clearOrders(u); u.targetId = id; u.path = world.findPath(u, target); });
    const fire = units.length > 1 ? 'Firing together once all can hit' : 'Firing once in range';
    this.message = this.alarm ? (target.kind === 'target' ? 'Target marked. Eliminate the target.' : `${target.name} marked. Concentrate fire.`)
      : `${who} marked. Volley ${p.damage} / ${p.hp}, ${p.alerts ? 'will alert' : 'silent kill'}. ${fire}.${p.short ? ` A takedown needs ${p.short} operatives.` : ''}`;
    this.emit();
  }
  // Ground the hostile can see, widened by `margin` for planning; a posted guard's whole look-around counts.
  private watched(v: Unit, margin = 1) {
    const world = this.plan!.world, stats = HOSTILE_STATS[v.kind as EnemyKind], range = stats.vision + .8 * margin, fov = stats.fov + .25 * margin, wide = posted(v);
    return (p: Point) => {
      if (distance(v, p) > range) return false;
      const a = headingTo(v, p);
      if (angleDiff(a, v.heading) > fov && !(wide && angleDiff(a, v.sweep) <= LOOK_ANGLE + fov)) return false;
      return world.sightClear(v, p);
    };
  }
  // A route to a spot just behind the hostile that never crosses its sight. Two operatives on a heavy take either shoulder.
  private approach(u: Unit, v: Unit): Point[] {
    const slot = this.units.filter(o => o.takedownId === v.id).indexOf(u);
    const world = this.plan!.world, avoid = this.watched(v), back = (posted(v) ? v.sweep : v.heading) + Math.PI + (v.kind === 'heavy' ? (slot ? .45 : -.45) : 0);
    let tries = 0;
    for (const turn of [0, .3, -.3, .6, -.6, .9, -.9, 1.2, -1.2]) {
      const a = back + turn, goal = { x: v.x + Math.sin(a) * TAKEDOWN_STANDOFF, z: v.z + Math.cos(a) * TAKEDOWN_STANDOFF };
      if (!world.walkable(goal) || avoid(goal)) continue;
      const path = world.findPath(u, goal, avoid);
      if (path.length || ++tries >= 3) return path;
    }
    return [];
  }
  revive(id: string) {
    if (this.phase !== 'mission' || !this.plan) return;
    const down = this.unit(id);
    if (!down || down.faction !== 'squad' || down.hp > 0) return;
    const medic = this.orderable().sort((a, b) => distance(a, down) - distance(b, down))[0];
    if (!medic) { this.message = 'Select a living operative to revive.'; this.emit(); return; }
    this.clearOrders(medic); medic.reviveTarget = id; medic.path = this.plan.world.findPath(medic, down);
    this.message = `${medic.name} moving to revive ${down.name}.`; this.emit();
  }
  hold = () => {
    this.orderable().forEach(u => { u.path = []; this.clearOrders(u); });
    this.commandPoint = null;
    this.message = this.alarm ? 'Holding position. Weapons free.' : 'Holding position. Holding fire.'; this.emit();
  };
  // A wait order adds WAIT_STEP seconds at the last waypoint of each selected operative's route, or where it
  // stands without a move order (dropping any other order). One past WAIT_MAX clears the wait.
  addWait = () => {
    if (this.phase !== 'mission') return;
    const units = this.orderable(), step = (w: number) => w + WAIT_STEP > WAIT_MAX ? 0 : w + WAIT_STEP;
    if (!units.length) return;
    let wait = 0;
    for (const u of units) {
      if (!this.planned(u)) { this.clearOrders(u); u.path = []; }
      const leg = u.route.at(-1);
      if (leg) wait = leg.wait = step(leg.wait); else wait = u.wait = step(u.wait);
    }
    this.message = wait ? `Holding ${Math.ceil(wait)} s at the last waypoint.` : 'Wait cleared.'; this.emit();
  };
  ability(slot: number) {
    if (this.phase !== 'mission') return;
    const u = this.unit(this.squad[slot] ?? '');
    if (!u || u.hp <= 0 || !u.ability) return;
    const stats = ABILITY_STATS[u.ability];
    if (u.abilityCd > 0) { this.message = `${u.name}: ${stats.name} recharging (${Math.ceil(u.abilityCd)} s).`; this.emit(); return; }
    if (!stats.targeted) { this.casts.push({ unitId: u.id, ability: u.ability, point: { x: u.x, z: u.z }, targetId: null }); u.abilityCd = this.cooldownFor(u); this.pending = null; this.message = `${u.name}: ${stats.name}.`; this.emit(); return; }
    this.pending = { unitId: u.id, ability: u.ability };
    this.message = u.ability === 'snipe' ? `${u.name}: choose a visible hostile within ${stats.reach} m. Esc cancels.` : `${u.name}: choose where to throw the ${stats.name.toLowerCase()} (${stats.reach} m). Esc cancels.`;
    this.emit();
  }
  cancelAbility(): boolean {
    if (!this.pending) return false;
    this.pending = null; this.message = 'Ability canceled.'; this.emit(); return true;
  }
  private cooldownFor(u: Unit) { return abilityCooldown(u.ability!, this.campaign.abilities[u.kind as ClassId]); }
  private aim(point: Point, targetId: string | null) {
    const p = this.pending!, caster = this.unit(p.unitId), stats = ABILITY_STATS[p.ability];
    if (!caster || caster.hp <= 0 || !this.plan) { this.pending = null; this.emit(); return; }
    const target = targetId ? this.unit(targetId) : undefined;
    if (p.ability === 'snipe' && (!target || target.faction !== 'hostile' || !target.visible)) { this.message = 'The sniper shot needs a visible hostile.'; this.emit(); return; }
    const at = target ?? point;
    if (distance(caster, at) > stats.reach || !this.plan.world.sightClear(caster, at)) { this.message = `Out of reach: ${caster.name} needs a clear line within ${stats.reach} m.`; this.emit(); return; }
    this.casts.push({ unitId: caster.id, ability: p.ability, point: { x: at.x, z: at.z }, targetId: target?.id ?? null });
    caster.abilityCd = this.cooldownFor(caster);
    this.pending = null; this.message = `${caster.name}: ${stats.name} away.`; this.emit();
  }
  // Extraction opens once every other objective is done.
  get extractReady() { return this.objectives.every(o => o.kind === 'extract' || o.done); }
  // Pointer entry points for the scene. `additive` (Shift, or a long press on touch) appends a waypoint on the
  // street and toggles an operative in the selection.
  groundClick(point: Point, additive = false) { if (this.pending) this.aim(point, null); else this.move(point, additive); }
  unitClick(id: string, additive = false) {
    const u = this.unit(id); if (!u) return;
    if (this.pending) { if (u.faction === 'hostile') this.aim(u, id); else { this.cancelAbility(); this.select(id, additive); } return; }
    if (u.faction === 'hostile') this.attack(id);
    else if (u.faction === 'squad' && u.hp <= 0) this.revive(id);
    else if (u.faction === 'squad') this.select(id, additive);
    else this.move(u, additive); // the VIP stands on the street, so a click on it is a move order
  }

  // ---- Combat rules ----
  private raiseAlarm(at: Point, reason: string, seen?: Point) {
    if (!this.plan) return;
    // A fresh trigger during the alarm only restarts the stand-down countdown.
    this.contact(null);
    if (this.alarm) return;
    this.alarm = true; this.detected = true; this.reinforceIn = this.reinforced ? REINFORCE_SECONDS : FIRST_WAVE_SECONDS; this.calmIn = CALM_SECONDS;
    const known = seen ?? at; this.lastKnown = { x: known.x, z: known.z };
    for (const u of this.units) {
      if (u.faction !== 'hostile' || u.hp <= 0) continue;
      u.detect = 1;
      if ((u.kind === 'guard' || u.kind === 'heavy') && distance(u, at) <= CONVERGE_RADIUS) { u.hunting = true; u.repath = 0; }
      // A target already running from an earlier alarm keeps its exit and does not hesitate again.
      if (u.kind === 'target' && !u.exit) {
        const exits = [...this.plan.exits].sort((a, b) => distance(u, a) - distance(u, b));
        u.exit = [...exits.filter(e => distance(u, e) >= FLEE_MIN_EXIT), ...exits].find(e => this.plan!.world.findPath(u, e).length) ?? null;
        u.wait = FLEE_DELAY;
      }
    }
    this.message = `ALARM: ${reason}. Weapons free.`;
  }
  // While alarmed, anything that gives the squad away restarts the countdown; a sighting or gunfire also updates where hunters search.
  private contact(seen: Point | null) {
    if (!this.alarm) return;
    this.calmIn = CALM_SECONDS;
    if (seen) this.lastKnown = { x: seen.x, z: seen.z };
  }
  private standDown() {
    this.alarm = false; this.calmIn = 0; this.lastKnown = null;
    // A fleeing target keeps running for its exit.
    // A posted guard that left its post to hunt keeps watch where it ends up.
    for (const u of this.units) if (u.faction === 'hostile' && u.hp > 0) { if (u.hunting && posted(u)) u.sweep = u.heading; u.detect = 0; u.hunting = false; if (!u.exit) u.path = []; }
    this.message = 'Contact lost. Alarm standing down. Holding fire.';
  }
  // With auto-pause on, the first time a hostile turns suspicious pauses the mission so the player can react.
  private suspicious(u: Unit) {
    if (!this.autoPause || this.autoPaused.has(u.id)) return;
    this.autoPaused.add(u.id); this.paused = true;
    this.message = `${u.name} is suspicious. Auto-paused.`;
  }
  private damage(target: Unit, amount: number, from: Point | null) {
    if (target.hp <= 0) return;
    const covered = from && this.plan?.world.coverBetween(from, target);
    if (target.faction === 'vip') { amount *= VIP_DAMAGE_TAKEN; if (from) this.vipThreat = { x: from.x, z: from.z }; }
    target.hp = Math.max(0, target.hp - amount * (covered ? COVER_FACTOR : 1));
    if (target.faction === 'hostile') this.hitThisFrame.add(target);
    else {
      target.hurt = 1.5; target.revive = 0;
      // A downed operative drops its orders; once revived it stays where it fell.
      if (target.hp <= 0) { target.path = []; this.clearOrders(target); }
    }
  }
  private shoot(from: Unit, to: Unit, amount: number, kind: Shot['kind'] = 'bullet') {
    this.damage(to, amount, from);
    this.contact(from.faction === 'hostile' ? to : from);
    this.shots.push({ id: this.nextId++, from: { x: from.x, z: from.z }, to: { x: to.x, z: to.z }, faction: from.faction, shooter: from.kind, kind, ttl: kind === 'snipe' ? .35 : .12 });
  }
  private resolveCast(c: Simulation['casts'][number]) {
    const caster = this.unit(c.unitId);
    if (!caster || caster.hp <= 0) return;
    const level = this.campaign.abilities[caster.kind as ClassId], power = abilityPower(c.ability, level), stats = ABILITY_STATS[c.ability];
    const hostiles = this.units.filter(u => u.faction === 'hostile' && u.hp > 0);
    caster.heading = headingTo(caster, c.point);
    if (c.ability === 'grenade') {
      hostiles.filter(u => distance(u, c.point) <= stats.radius).forEach(u => this.damage(u, power, null));
      this.blasts.push({ id: this.nextId++, kind: 'grenade', ...c.point, radius: stats.radius, ttl: .7 });
      this.raiseAlarm(c.point, 'Grenade detonation');
    } else if (c.ability === 'heal') {
      this.units.filter(u => u.faction !== 'hostile' && u.hp > 0 && distance(u, caster) <= stats.radius).forEach(u => { u.hp = Math.min(u.maxHp, u.hp + power); });
      this.blasts.push({ id: this.nextId++, kind: 'heal', x: caster.x, z: caster.z, radius: stats.radius, ttl: .8 });
    } else if (c.ability === 'snipe') {
      const target = this.unit(c.targetId ?? '');
      if (!target || target.hp <= 0) return;
      // Silent: only a target that survives the round raises the alarm.
      this.shoot(caster, target, power, 'snipe');
      hostiles.filter(u => distance(u, target) <= MARK_RADIUS).forEach(u => { u.marked = Math.max(u.marked, MARK_SECONDS); });
    } else {
      hostiles.filter(u => distance(u, c.point) <= stats.radius).forEach(u => { u.stunned = u.kind === 'camera' ? EMP_CAMERA_SECONDS * effectScale(level) : power; u.path = []; u.moving = false; });
      this.blasts.push({ id: this.nextId++, kind: 'emp', ...c.point, radius: stats.radius, ttl: .8 });
    }
  }

  private finish(success: boolean, reason = '') {
    if (this.phase !== 'mission' || !this.contract) return;
    this.phase = 'headquarters'; this.result = success ? 'success' : 'failure'; this.failReason = reason; this.pending = null;
    if (success) {
      const stealth = !this.detected;
      this.payout = missionPayout(this.contract, stealth);
      this.campaign = applyPayout(this.campaign, this.contract, stealth); this.report(s => s.completed(stealth));
    }
    this.emit();
  }
  private intruders() { return this.units.filter(u => u.hp > 0 && (u.faction === 'squad' || (u.faction === 'vip' && this.vipJoined))); }
  private walk(u: Unit, speed: number, dt: number) {
    const next = u.path[0]; if (!next) return;
    const d = distance(u, next);
    u.heading = headingTo(u, next);
    if (d <= speed * dt) { u.x = next.x; u.z = next.z; u.path.shift(); }
    else { u.x += (next.x - u.x) / d * speed * dt; u.z += (next.z - u.z) / d * speed * dt; }
    u.moving = true;
  }
  private updateVisibility() {
    const eyes = this.units.filter(u => u.faction === 'squad' && u.hp > 0), world = this.plan?.world;
    for (const u of this.units) {
      if (u.faction !== 'hostile') { u.visible = true; continue; }
      const was = u.visible;
      u.visible = u.marked > 0 || (!!world && eyes.some(e => distance(e, u) <= SIGHT_RANGE && world.sightClear(e, u)));
      if (u.kind === 'target' && u.visible && u.hp > 0 && this.targetArea) { this.targetArea.x = u.x; this.targetArea.z = u.z; }
      if (u.visible || u.hp <= 0) this.lastSeen.delete(u.id);
      else if (was) this.lastSeen.set(u.id, { x: u.x, z: u.z, heading: u.heading, at: this.time });
    }
    for (const [id, s] of this.lastSeen) if (this.time - s.at >= GHOST_SECONDS) this.lastSeen.delete(id);
  }

  private updateHostile(u: Unit, dt: number, intruders: Unit[]) {
    const world = this.plan!.world, stats = HOSTILE_STATS[u.kind as EnemyKind];
    u.marked = Math.max(0, u.marked - dt);
    u.moving = false;
    if (u.held > 0) return; // pinned by a takedown
    if (u.stunned > 0) { u.stunned -= dt; return; }
    u.cooldown -= dt;
    const mobile = u.kind === 'guard' || u.kind === 'heavy';
    if (u.kind === 'camera' || u.kind === 'turret') u.heading = u.sweep + Math.sin(this.time * .6 + u.x) * (u.kind === 'camera' ? .7 : 1);
    const seen = intruders.filter(v => distance(u, v) <= stats.vision && angleDiff(headingTo(u, v), u.heading) <= stats.fov && world.sightClear(u, v))
      .sort((a, b) => distance(u, a) - distance(u, b))[0];
    if (this.alarm) { if (seen) this.contact(seen); }
    else if (seen) {
      const was = u.detect;
      u.detect = Math.min(1, u.detect + dt / detectSeconds(u.kind as EnemyKind, distance(u, seen)));
      if (u.detect >= 1) { this.raiseAlarm(u, `${stats.name} spotted the squad`, seen); return; }
      if (was <= SUSPICIOUS && u.detect > SUSPICIOUS) this.suspicious(u);
    } else u.detect = Math.max(0, u.detect - DETECT_DRAIN * dt);
    if (!this.alarm && !(u.kind === 'target' && u.exit)) {
      // A suspicious guard stops and stares instead of walking on.
      if (seen && u.detect > SUSPICIOUS && mobile) { u.heading = headingTo(u, seen); return; }
      if (mobile) this.patrol(u, stats.speed, dt);
      return;
    }
    if (u.kind === 'target') {
      if (u.wait > 0 || !u.exit) { u.wait -= dt; return; }
      // Re-plan after anything (an EMP) cleared the route.
      if (!u.path.length) u.path = world.findPath(u, u.exit);
      this.walk(u, stats.alertSpeed, dt);
      if (distance(u, u.exit) < 1) this.finish(false, 'The target escaped.');
      return;
    }
    if (u.kind === 'camera') return;
    // Operatives draw fire before the VIP does.
    const inRange = intruders.filter(v => distance(u, v) <= stats.range && world.sightClear(u, v))
      .sort((a, b) => (a.faction === 'vip' ? 1 : 0) - (b.faction === 'vip' ? 1 : 0) || distance(u, a) - distance(u, b))[0];
    if (inRange) {
      u.heading = headingTo(u, inRange);
      if (u.cooldown <= 0) { this.shoot(u, inRange, stats.damage * tierDamage(this.plan!.contract.tier)); u.cooldown = stats.fireCooldown; }
      return;
    }
    if (!mobile) return;
    // Hunters close on where the squad was last seen, then turn on the spot to search.
    const goal = this.lastKnown;
    if (u.hunting && goal) {
      if (distance(u, goal) <= 1) { u.path = []; u.heading += SEARCH_TURN * dt; return; }
      const end = u.path.at(-1);
      u.repath -= dt;
      if (u.repath <= 0 && !(end && end.x === goal.x && end.z === goal.z)) { u.repath = 1; u.path = world.findPath(u, goal); }
      this.walk(u, stats.alertSpeed, dt);
    } else this.patrol(u, stats.speed, dt);
  }
  private patrol(u: Unit, speed: number, dt: number) {
    if (u.patrol.length < 2) return this.lookAround(u, dt);
    if (!u.path.length) {
      // Watching a guard stand at the end of a leg it just walked (its pause there is still running) gives away its whole route.
      const end = u.patrol[u.patrolIndex];
      if (u.visible && u.wait > 0 && u.x === end.x && u.z === end.z && !this.intel.has(u.id)) this.intel.set(u.id, this.route(u.patrol));
      if (u.wait > 0) { u.wait -= dt; return; }
      u.patrolIndex = (u.patrolIndex + 1) % u.patrol.length;
      u.path = this.plan!.world.findPath(u, u.patrol[u.patrolIndex]); u.wait = 1.2;
    }
    this.walk(u, speed, dt);
  }
  // The loop a patrol walks, leg by leg, as the paths the guard takes between its points.
  private route(patrol: Point[]): Point[] {
    const world = this.plan!.world, route = [{ x: patrol[0].x, z: patrol[0].z }];
    patrol.forEach((p, i) => route.push(...world.findPath(p, patrol[(i + 1) % patrol.length])));
    return route;
  }

  // A posted guard faces its post, and every 6 to 8 s turns 60° to one side (alternating), holds that look
  // for 2 s and turns back. The schedule follows the contract seed; a guard pulled off it turns back to it.
  private lookAround(u: Unit, dt: number) {
    const seed = this.plan!.contract.seed, every = (n: number) => LOOK_EVERY[0] + (LOOK_EVERY[1] - LOOK_EVERY[0]) * hashed(seed, u.id, n);
    if (!u.lookEvery) { u.lookEvery = every(0); u.look = hashed(seed, u.id, -1) * u.lookEvery; }
    u.look += dt;
    if (u.look >= u.lookEvery) { u.look -= u.lookEvery; u.lookEvery = every(++u.lookCycle); }
    const turn = LOOK_ANGLE / LOOK_TURN, t = u.look - (u.lookEvery - 2 * turn - LOOK_PAUSE);
    const offset = t <= 0 ? 0 : t < turn ? t * LOOK_TURN : t < turn + LOOK_PAUSE ? LOOK_ANGLE : Math.max(0, LOOK_ANGLE - (t - turn - LOOK_PAUSE) * LOOK_TURN);
    turnTo(u, u.sweep + (u.lookCycle % 2 ? -1 : 1) * offset, 2 * LOOK_TURN * dt);
  }

  private updateOperative(u: Unit, dt: number, hostiles: Unit[]) {
    const world = this.plan!.world, stats = CLASS_STATS[u.kind as ClassId];
    u.moving = false;
    u.cooldown -= dt; u.abilityCd = Math.max(0, u.abilityCd - dt); u.hurt = Math.max(0, u.hurt - dt);
    if (u.reviveTarget) {
      const down = this.unit(u.reviveTarget);
      if (!down || down.hp > 0) { u.reviveTarget = null; u.revive = 0; }
      else if (distance(u, down) <= 1.3) {
        u.path = []; u.heading = headingTo(u, down); u.revive += dt;
        if (u.revive >= REVIVE_SECONDS) {
          down.hp = Math.round(down.maxHp * REVIVE_HP); u.reviveTarget = null; u.revive = 0;
          this.message = `${down.name} is back on their feet.`;
          if (!this.selected.includes(down.id)) this.selected.push(down.id);
        }
        return;
      } else if (!u.path.length) u.path = world.findPath(u, down);
    }
    if (u.takedownId && this.closeIn(u, dt)) return;
    const canHit = (v: Unit) => v.visible && distance(u, v) <= stats.range && world.sightClear(u, v);
    const ordered = hostiles.find(v => v.id === u.targetId);
    if (!ordered) u.targetId = null;
    else if (!canHit(ordered) && !u.path.length) { u.repath -= dt; if (u.repath <= 0) { u.repath = .75; u.path = world.findPath(u, ordered); } }
    // Before the alarm the squad holds fire except at ordered targets.
    const target = ordered && canHit(ordered) ? ordered : this.alarm ? hostiles.filter(canHit).sort((a, b) => distance(u, a) - distance(u, b))[0] : undefined;
    if (u.path.length && !(ordered && canHit(ordered))) this.walk(u, SQUAD_SPEED, dt);
    else if (!u.path.length) this.nextLeg(u, dt);
    if (!target || u.cooldown > 0) return;
    // Before the alarm an ordered operative waits for the rest of its volley (see fireVolleys).
    if (!this.alarm) { u.heading = headingTo(u, target); this.volleyReady.add(u); return; }
    this.fire(u, target);
  }
  // At the end of a leg an operative holds for its wait, then sets off on the next queued leg.
  private nextLeg(u: Unit, dt: number) {
    if (u.wait > 0 && (u.wait = Math.max(0, u.wait - dt)) > 0) return;
    const leg = u.route.shift();
    if (leg) { u.path = leg.path; u.wait = leg.wait; }
  }
  private fire(u: Unit, target: Unit) {
    u.heading = headingTo(u, target);
    this.shoot(u, target, this.firepower(u));
    u.cooldown = CLASS_STATS[u.kind as ClassId].fireCooldown;
  }
  // Operatives ordered onto the same hostile fire on the same frame, once every one of them can hit it.
  private fireVolleys() {
    const groups = new Map<string, Unit[]>();
    for (const u of this.livingSquad()) if (u.targetId) groups.set(u.targetId, [...groups.get(u.targetId) ?? [], u]);
    for (const [id, group] of groups) {
      const target = this.unit(id);
      if (target && group.every(u => this.volleyReady.has(u))) group.forEach(u => this.fire(u, target));
    }
    this.volleyReady.clear();
  }
  // Closing on a takedown; false hands the operative back to the normal attack rules.
  private closeIn(u: Unit, dt: number): boolean {
    const v = this.unit(u.takedownId!);
    if (!v || v.hp <= 0) { u.takedownId = null; return false; }
    if (v.held > 0) { u.path = []; u.heading = headingTo(u, v); return true; }
    // Spotted before the hold starts, even within reach: the alarm turns it into a firefight; a suspicious guard calls it off.
    if (this.alarm) { u.takedownId = null; u.targetId = v.id; u.path = []; return false; }
    if (v.detect > SUSPICIOUS) { u.takedownId = null; u.path = []; this.message = `${v.name} turned suspicious. ${u.name} holding.`; return true; }
    if (distance(u, v) <= TAKEDOWN_REACH) { u.path = []; u.heading = headingTo(u, v); return true; }
    // The hostile walks and turns while the operative closes in: re-route once the route no longer ends
    // in reach or crosses its sight.
    u.repath -= dt;
    if (u.repath <= 0 || !u.path.length) {
      u.repath = .3;
      const end = u.path.at(-1), avoid = this.watched(v, 0), world = this.plan!.world;
      const stale = !end || distance(end, v) > TAKEDOWN_REACH - .1 || avoid(end) || u.path.some((p, i) => !world.passable(i ? u.path[i - 1] : u, p, 0) || !this.unseen(i ? u.path[i - 1] : u, p, avoid));
      if (stale) u.path = this.approach(u, v);
    }
    if (u.path.length) this.walk(u, SQUAD_SPEED, dt);
    return true;
  }
  private unseen(a: Point, b: Point, avoid: (p: Point) => boolean) {
    const steps = Math.ceil(distance(a, b) * 3);
    for (let n = 1; n <= steps; n++) if (avoid({ x: a.x + (b.x - a.x) * n / steps, z: a.z + (b.z - a.z) * n / steps })) return false;
    return true;
  }
  private sees(h: Unit, p: Point) {
    const stats = HOSTILE_STATS[h.kind as EnemyKind];
    return distance(h, p) <= stats.vision && angleDiff(headingTo(h, p), h.heading) <= stats.fov && this.plan!.world.sightClear(h, p);
  }
  // A takedown starts once its operatives (two for a heavy) all stand in reach and finishes after TAKEDOWN_SECONDS.
  // It pins the hostile; any other hostile that sees the struggle raises the alarm.
  private resolveTakedowns(dt: number) {
    const crews = new Map<Unit, Unit[]>();
    for (const u of this.livingSquad()) if (u.takedownId) { const v = this.unit(u.takedownId); if (v) crews.set(v, [...crews.get(v) ?? [], u]); }
    for (const v of this.units) {
      if (v.faction !== 'hostile') continue;
      const crew = crews.get(v) ?? [], need = v.kind === 'heavy' ? 2 : 1;
      if (v.hp <= 0 || crew.length < need) {
        if (v.hp > 0 && crew.length) { crew.forEach(u => { u.takedownId = null; u.path = []; }); this.message = `Takedown on ${v.name} called off.`; }
        v.held = 0; continue;
      }
      // Pinned operatives stand still, so only a re-ordered crew can be out of reach mid-hold; that starts over.
      if (crew.some(u => distance(u, v) > TAKEDOWN_REACH)) { v.held = 0; continue; }
      // A hold only starts on an unaware hostile (an earlier takedown's witness may have raised the alarm this frame).
      if (!v.held && (this.alarm || v.detect > SUSPICIOUS)) continue;
      v.held += dt; v.moving = false; v.path = [];
      const witness = this.units.find(h => h !== v && h.faction === 'hostile' && h.hp > 0 && h.stunned <= 0 && !h.held && [v, ...crew].some(p => this.sees(h, p)));
      if (witness && !this.alarm) this.raiseAlarm(witness, `${witness.name} saw the takedown`, crew[0]);
      if (v.held >= TAKEDOWN_SECONDS) {
        v.hp = 0; v.held = 0; crew.forEach(u => { u.takedownId = null; });
        this.message = `${crew.map(u => u.name).join(' and ')} took down ${v.kind === 'target' ? 'the target' : v.name}.`;
      }
    }
  }
  private updateVip(u: Unit, dt: number, squad: Unit[]) {
    u.moving = false; u.hurt = Math.max(0, u.hurt - dt);
    const leader = [...squad].sort((a, b) => distance(u, a) - distance(u, b))[0];
    if (!leader) return;
    if (!this.vipJoined) {
      const secure = this.objectives.find(o => o.kind === 'vip')!;
      if (distance(u, leader) > VIP_REACH) return;
      secure.progress = Math.min(1, secure.progress + dt / VIP_SECURE_SECONDS);
      if (secure.progress < 1) return;
      this.vipJoined = true; this.message = 'VIP secured. Escort them to extraction.';
    }
    // The VIP follows the nearest operative; under fire it ducks behind cover near that operative instead.
    // At an open extraction it walks into the zone.
    const extract = this.objectives.at(-1)!;
    const shelter = u.hurt > 0 && this.vipThreat ? this.shelter(u, leader, this.vipThreat) : null;
    const goal = this.extractReady && distance(leader, extract) < 2 ? extract : shelter ?? leader;
    if (distance(u, goal) <= (goal === leader ? 1.6 : .3)) { u.path = []; return; }
    u.repath -= dt;
    const end = u.path.at(-1);
    if (u.repath <= 0 || !end || distance(end, goal) > 1) { u.repath = .5; u.path = this.plan!.world.findPath(u, { x: goal.x, z: goal.z }); }
    this.walk(u, VIP_SPEED, dt);
  }
  // ---- Cover ----
  // Who can shoot at `u`: during the alarm, armed hostiles with `u` in range and in sight; before it, every armed
  // hostile the squad can see. Cameras and the target carry no weapon, so cover means nothing against them.
  private threats(u: Unit) {
    const world = this.plan!.world;
    return this.units.filter(h => {
      if (h.faction !== 'hostile' || h.hp <= 0) return false;
      const stats = HOSTILE_STATS[h.kind as EnemyKind];
      if (!stats.damage) return false;
      return this.alarm ? distance(h, u) <= stats.range && world.sightClear(h, u) : h.visible;
    });
  }
  // Whether `u` is behind cover against each current threat. The shield shows only beside a barrier, with a threat about.
  coverStatus(u: Unit): CoverStatus {
    const world = this.plan?.world;
    if (!world || u.hp <= 0) return { threats: [], shield: null };
    const threats = this.threats(u).map(h => ({ id: h.id, covered: world.coverBetween(h, u) }));
    const shield = !threats.length || !world.besideCover(u) ? null : threats.every(t => t.covered) ? 'covered' : 'flanked';
    return { threats, shield };
  }
  // Where a move order at `p` ends when `p` lies within 1 m of a barrier: on the barrier's side away from the
  // nearest known threat (an armed hostile in sight, else a last-seen marker). Null with no barrier near or no threat known.
  coverSnap(p: Point): CoverSnap | null {
    if (!this.plan) return null;
    const known: Point[] = this.units.filter(h => h.faction === 'hostile' && h.hp > 0 && h.visible && HOSTILE_STATS[h.kind as EnemyKind].damage > 0);
    if (!known.length) for (const [id, s] of this.lastSeen) if (HOSTILE_STATS[this.unit(id)?.kind as EnemyKind]?.damage) known.push(s);
    const threat = known.sort((a, b) => distance(a, p) - distance(b, p))[0];
    const spot = threat && this.plan.world.coverSpot(p, threat);
    return spot ? { ...spot.point, along: spot.along, span: spot.span } : null;
  }
  // The nearest spot behind a barrier, as seen from `threat`, within VIP_COVER_REACH of the operative.
  private shelter(u: Unit, leader: Unit, threat: Point): Point | null {
    const world = this.plan!.world;
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
  private updateObjectives(dt: number, squad: Unit[]) {
    const vip = this.unit('vip');
    for (const o of this.objectives) {
      if (o.done) continue;
      if (o.kind === 'target') o.done = this.units.some(u => u.kind === 'target' && u.hp <= 0);
      if (o.kind === 'vip') o.done = this.vipJoined;
      if (o.kind === 'terminal' || o.kind === 'charge') {
        const seconds = o.kind === 'terminal' ? HACK_SECONDS : PLANT_SECONDS, reach = o.kind === 'terminal' ? 1.5 : 1.2;
        if (squad.some(s => distance(s, o) <= reach)) o.progress = Math.min(1, o.progress + dt / seconds);
        if (o.progress >= 1) { o.done = true; this.message = o.kind === 'terminal' ? 'Vault data secured. Head for extraction.' : `${o.label.replace('Plant', 'Planted')}.`; }
      }
      if (o.kind === 'target' && o.done) this.message = 'Target neutralized. Return to the extraction zone.';
    }
    // Extraction counts only with every deployed operative standing in the zone; the downed must be revived first.
    const extract = this.objectives.at(-1)!, team = this.units.filter(u => u.faction === 'squad');
    const inZone = (s: Unit) => distance(s, extract) < 2;
    extract.progress = team.filter(s => s.hp > 0 && inZone(s)).length / team.length;
    if (!this.extractReady) return;
    const vipIn = !vip || distance(vip, extract) < 2.4;
    if (extract.progress === 1 && vipIn) { extract.done = true; this.finish(true); return; }
    const down = team.find(s => s.hp <= 0);
    const holdup = !squad.every(inZone) ? '' : down ? `${down.name} is down. Revive them before extracting.` : vipIn ? '' : 'Bring the VIP into the zone.';
    if (holdup && holdup !== this.holdup) this.message = holdup;
    this.holdup = holdup;
  }
  private reinforce(dt: number) {
    if (!this.alarm || this.reinforced >= REINFORCE_CAP || !this.plan) return;
    this.reinforceIn -= dt;
    if (this.reinforceIn > 0) return;
    this.reinforceIn = REINFORCE_SECONDS;
    // The first wave flanks: it enters at the exit nearest extraction, between the squad and its way out.
    const exits = this.plan.exits, extract = this.plan.extract;
    const exit = this.reinforced ? exits[Math.floor(this.rng() * exits.length)] : exits.reduce((a, b) => distance(b, extract) < distance(a, extract) ? b : a);
    const count = Math.min(this.plan.contract.tier >= 4 ? 3 : 2, REINFORCE_CAP - this.reinforced);
    for (let k = 0; k < count; k++) {
      const u = this.makeUnit(`r${this.reinforced++}`, 'SECURITY', 'guard', 'hostile', { x: exit.x + (k - 1) * .6, z: exit.z }, Math.round(HOSTILE_STATS.guard.hp * tierHp(this.plan.contract.tier)));
      if (!this.plan.world.walkable(u)) { u.x = exit.x; u.z = exit.z; }
      u.hunting = true; u.detect = 1; this.units.push(u);
    }
    this.message = `Reinforcements entering the district (${this.reinforced}/${REINFORCE_CAP}).`;
  }

  update(dt: number) {
    if (this.phase !== 'mission' || this.paused || !this.plan) return;
    dt = Math.min(.05, Math.max(0, dt)); this.time += dt;
    const wasAlarm = this.alarm;
    this.shots = this.shots.filter(s => (s.ttl -= dt) > 0);
    this.blasts = this.blasts.filter(b => (b.ttl -= dt) > 0);
    this.hitThisFrame.clear();
    this.casts.splice(0).forEach(c => this.resolveCast(c));
    const intruders = this.intruders();
    for (const u of this.units) if (u.faction === 'hostile' && u.hp > 0 && this.phase === 'mission') this.updateHostile(u, dt, intruders);
    if (this.phase !== 'mission') return;
    const hostiles = this.units.filter(u => u.faction === 'hostile' && u.hp > 0);
    for (const u of this.units) if (u.faction === 'squad') { if (u.hp > 0) this.updateOperative(u, dt, hostiles); else u.moving = false; }
    this.fireVolleys();
    this.resolveTakedowns(dt);
    // A volley that kills its target stays quiet; any hostile left standing after being hit raises the alarm.
    for (const u of this.hitThisFrame) if (u.hp > 0) { this.raiseAlarm(u, `${u.name} returned fire`); break; }
    for (const u of this.units) if (u.faction === 'hostile' && u.hp <= 0) { u.path = []; u.moving = false; }
    const squad = this.livingSquad();
    const vip = this.unit('vip');
    if (vip) { if (vip.hp <= 0) return this.finish(false, 'The VIP was killed.'); this.updateVip(vip, dt, squad); }
    this.selected = this.selected.filter(id => squad.some(u => u.id === id));
    if (this.pending && !squad.some(u => u.id === this.pending!.unitId)) this.pending = null;
    if (!squad.length) return this.finish(false, 'The squad was wiped out.');
    this.updateObjectives(dt, squad);
    this.reinforce(dt);
    if (this.alarm && (this.calmIn -= dt) <= 0) this.standDown();
    this.updateVisibility();
    this.uiTimer += dt;
    if (this.uiTimer >= .1 || this.alarm !== wasAlarm || this.paused) { this.uiTimer = 0; this.emit(); }
  }
}
