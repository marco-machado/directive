import { ABILITY_STATS, CLASS_STATS, EMP_CAMERA_SECONDS, MARK_RADIUS, MARK_SECONDS, SQUAD_SPEED, abilityCooldown, abilityPower, effectScale } from './classes.ts';
import type { AbilityId, ClassId } from './classes.ts';
import { CARRY_SPEED, NO_REWARD, PICKUP_SECONDS, SQUAD_MAX, applyDismiss, applyLoadout, applyPayout, applyPurchase, applyRecruit, dealBoard, freshCampaign, hasModifier, missionPayout, rewardFor, unlockedCountermeasures } from './campaign.ts';
import type { Badge, Campaign, Contract, Loadout, MissionReport, Reward, Upgrade } from './campaign.ts';
import { COURIER_DELAY, planMission } from './mapgen.ts';
import type { Area, MissionPlan } from './mapgen.ts';
import { mulberry32 } from './rng.ts';
import type { Rng } from './rng.ts';
import { distance } from './world.ts';
import type { Point } from './world.ts';
import { CALM_SECONDS, COVER_FACTOR, HOSTILE_STATS, PRISONER_HP, QUEUE_SPACING, REINFORCE_CAP, REVIVE_HP, REVIVE_SECONDS, ROUTE_MAX, SUSPICIOUS, TAKEDOWN_REACH, TAKEDOWN_SECONDS, TAKEDOWN_STANDOFF, VIP_DAMAGE_TAKEN, VIP_HP, WAIT_MAX, WAIT_STEP, angleDiff, apparentHealth, gearDamage, gearHp, gearRange, headingTo, objectivesMet, pointBack, posted, routeLength, seenAs, suppressedAlert, takedownable, tierHp, watchedBy } from './rules.ts';
import type { AlarmCause, AttackPreview, Blast, CampaignSync, Cargo, CoverSnap, CoverStatus, Faction, Milestone, Objective, Pending, Phase, Pickup, Shot, Sighting, Snapshot, Unit, UnitKind, Waypoint } from './rules.ts';
import { contact, escalate, raiseAlarm, reinforce, standDown, suspicious } from './alarm.ts';
import { oneWay, route, updateHostile, updateVisibility } from './hostiles.ts';
import { MISSIONS, countsAsKill, earnedBadges, earnedReward, mission, objectivesFor, results, updateCargo, updateFollower, updateObjectives, watchExecutives, watchForTarget } from './missions.ts';

export { freshCampaign, parseCampaign } from './campaign.ts';
export type { Campaign, Upgrade } from './campaign.ts';

export * from './rules.ts';

// The single source of game state: the campaign, the contract board and the mission in play. The class keeps orders,
// combat and the update loop; alarm.ts, hostiles.ts and missions.ts hold the rest of the rules as functions over it,
// which is why the mission state they read and write is public here. Nothing outside src/game writes it.
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
  alarmCause: AlarmCause | null = null;
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
  countermeasures = 0; // the Countermeasures level picked on the board; begin() fixes it for the mission
  // Fog-of-war memory, by hostile id: the last sighting of each hostile now out of sight, and the full patrol
  // route of each guard the squad has watched finish a leg. Both are replaced with each mission.
  lastSeen = new Map<string, Sighting>();
  intel = new Map<string, Point[]>();
  milestones: Milestone[] = [];
  reinforced = 0;
  private badges: Badge[] = [];
  private reward: Reward = NO_REWARD;
  // Seconds until a Lockdown contract's exits seal; null until its first alarm (and on any other contract).
  lockdownIn: number | null = null;
  escaped = new Set<string>(); // Surveillance executives that got away, taken off the map
  cargo: Cargo | null = null;
  pickup: Pickup | null = null;
  calling = false;
  private intelReward = false;
  downs = 0;
  alarms = 0;
  reinforceCap = REINFORCE_CAP;
  calmFor = CALM_SECONDS;
  waves = 0; // waves the current alarm has sent
  // Followers: the escort VIP and Jailbreak's prisoners (faction 'vip'), freed one by one; `joined` holds the freed.
  joined = new Set<string>();
  vipThreat: Point | null = null; // where the last shot at a follower came from
  lastKnown: Point | null = null;
  holdup = '';
  private casts: { unitId: string; ability: AbilityId; point: Point; targetId: string | null }[] = [];
  private hitThisFrame = new Map<Unit, { by: Unit | null; rifle: boolean }>(); // hostiles hit this frame, by whom, and whether only by the squad's rifles
  private volleyReady = new Set<Unit>();
  autoPaused = new Set<string>();
  rng: Rng = Math.random;
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
  emit() {
    this.snapshot = {
      phase: this.phase, paused: this.paused, selected: [...this.selected], squad: [...this.squad], squadPick: [...this.squadPick],
      units: this.units.map(u => ({ ...u })), campaign: this.campaign, contract: this.contract, plan: this.plan,
      objectives: this.objectives.map(o => ({ ...o })), alarm: this.alarm, calmIn: this.calmIn, reinforceIn: this.reinforceIn, reinforced: this.reinforced, result: this.result,
      alarms: this.alarms, reinforceCap: this.reinforceCap, calmFor: this.calmFor, nextAlarm: escalate(this, this.alarms + 1),
      failReason: this.failReason, payout: this.payout, stealth: !this.detected, alarmCause: this.alarmCause, time: this.time, message: this.message,
      saveUnavailable: this.saveUnavailable, syncing: this.syncing, pending: this.pending, badges: this.badges, reward: this.reward, intelReward: this.intelReward, lockdownIn: this.lockdownIn, cargo: this.cargo && { ...this.cargo }, pickup: this.pickup && { ...this.pickup }, calling: this.calling, downs: this.downs, countermeasures: this.countermeasures, countermeasuresOpen: unlockedCountermeasures(this.campaign),
      milestones: this.milestones,
      cover: Object.fromEntries(this.phase === 'mission' && this.plan ? this.livingSquad().map(u => [u.id, this.coverStatus(u).shield]) : []),
    };
    this.listeners.forEach(fn => fn());
  }
  reach(m: Milestone) { if (this.phase === 'mission' && !this.milestones.includes(m)) this.milestones = [...this.milestones, m]; }
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
    this.countermeasures = Math.min(this.countermeasures, unlockedCountermeasures(this.campaign));
    if (this.phase === 'briefing') this.preview(keep ?? offers[0] ?? null);
  }
  chooseCountermeasures(level: number) {
    if (this.phase === 'mission' || level < 0 || level > unlockedCountermeasures(this.campaign)) return;
    this.countermeasures = level; this.emit();
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
    this.report(s => s.picked([...this.squadPick]));
    if (this.phase === 'briefing') this.resetUnits();
    this.emit();
  }
  // Brings back a pick saved before a reload, keeping only operatives still on the roster.
  restoreSquadPick(ids: readonly string[]) {
    if (this.phase === 'mission') return;
    const pick = [...new Set(ids)].filter(id => this.campaign.roster.some(o => o.id === id)).slice(0, SQUAD_MAX);
    if (!pick.length) return;
    this.squadPick = pick;
    if (this.phase === 'briefing') this.resetUnits();
    this.emit();
  }
  openBoard = () => { if (this.phase !== 'headquarters') return; this.phase = 'briefing'; this.result = null; this.contract = null; this.refreshBoard(); this.emit(); };
  buy(type: Upgrade): boolean { return this.trade(applyPurchase(this.campaign, type), s => s.bought(type)); }
  equip(loadout: Loadout): boolean { return this.trade(applyLoadout(this.campaign, loadout), s => s.equipped(loadout)); }
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
  makeUnit(id: string, name: string, kind: UnitKind, faction: Faction, p: Point, maxHp: number, heading = 0): Unit {
    return {
      id, name, kind, faction, x: p.x, z: p.z, hp: maxHp, maxHp, cooldown: faction === 'hostile' ? 1 : 0, path: [], route: [], targetId: null, heading, moving: false, repath: 0,
      ability: null, abilityCd: 0, reviveTarget: null, revive: 0, hurt: 0, patrol: [], patrolIndex: 0, exit: null, wait: 0, detect: 0, stunned: 0, marked: 0, visible: false, hunting: false, sweep: heading,
      takedownId: null, held: 0, escort: null, look: 0, lookEvery: 0, lookCycle: 0, guise: null, watched: 0, tagged: false, solo: false,
    };
  }
  private resetUnits() {
    const plan = this.plan;
    this.units = []; this.objectives = []; this.shots = []; this.blasts = []; this.casts = []; this.hitThisFrame.clear(); this.volleyReady.clear(); this.autoPaused.clear();
    this.alarm = false; this.detected = false; this.alarmCause = null; this.calmIn = 0; this.lastKnown = null; this.lastSeen = new Map(); this.intel = new Map(); this.milestones = [];
    this.reinforceIn = 0; this.reinforced = 0; this.badges = []; this.reward = NO_REWARD; this.lockdownIn = null; this.escaped = new Set(); this.cargo = null; this.pickup = null; this.calling = false; this.downs = 0; this.alarms = 0; this.reinforceCap = REINFORCE_CAP; this.calmFor = CALM_SECONDS; this.waves = 0; this.joined = new Set(); this.vipThreat = null; this.holdup = ''; this.pending = null; this.commandPoint = null;
    this.targetArea = plan?.targetArea ? { ...plan.targetArea } : null;
    if (!plan) { this.squad = []; this.selected = []; return; }
    this.rng = mulberry32(plan.contract.seed ^ 0x5bd1e995);
    this.squad = this.squadPick.filter(id => this.campaign.roster.some(o => o.id === id));
    this.squad.forEach((id, i) => {
      const op = this.campaign.roster.find(o => o.id === id)!, stats = CLASS_STATS[op.cls];
      const u = this.makeUnit(id, op.name, op.cls, 'squad', plan.spawn[i % plan.spawn.length], stats.hp + gearHp(this.campaign), headingTo(plan.start, { x: 0, z: 0 }));
      u.ability = stats.ability; this.units.push(u);
    });
    const rules = MISSIONS[plan.contract.type], courier = rules.target === 'courier' ? plan.enemies.findIndex(e => e.kind === 'target') : -1;
    plan.enemies.forEach((e, i) => {
      const stats = HOSTILE_STATS[e.kind];
      const u = this.makeUnit(`h${i}`, e.kind === 'target' && rules.target ? rules.target.toUpperCase() : stats.name, e.kind, 'hostile', e, Math.round(stats.hp * tierHp(plan.contract.tier)), e.heading);
      u.patrol = e.patrol; this.units.push(u);
      if (i === courier) u.wait = COURIER_DELAY;
      // An escort walks the courier's route, so it reads as a walker, not a posted guard.
      if (e.escort) u.escort = `h${courier}`;
      // An unknown target holds its post as a guard would, under a guard's name, until it is identified.
      if (e.kind === 'target' && !rules.target && hasModifier(plan.contract, 'unknown')) { u.guise = 'guard'; u.name = HOSTILE_STATS.guard.name; }
    });
    if (plan.vip) this.units.push(this.makeUnit('vip', 'VIP', 'vip', 'vip', plan.vip, VIP_HP, headingTo(plan.vip, plan.extract)));
    plan.sites.filter(s => s.kind === 'cell').forEach((s, i) => this.units.push(this.makeUnit(`p${i}`, 'PRISONER', 'vip', 'vip', s, PRISONER_HP, headingTo(s, plan.extract))));
    this.selected = [...this.squad];
    this.objectives = objectivesFor(plan, this.units);
    // An intel reward spent on this deployment: every route is known from the start, as if each had been watched.
    if (this.intelReward) for (const u of this.units) {
      if (u.faction !== 'hostile' || u.patrol.length < 2 || u.escort) continue;
      this.intel.set(u.id, u.kind === 'target' && rules.target === 'courier' ? oneWay(this, u.patrol) : route(this, u.patrol));
    }
    updateVisibility(this);
  }
  // While a save is in flight the board may be one the client dealt itself (the first payout replaces contract 01),
  // so a deploy waits for the server's offers: the server would reject an id it never dealt.
  deploy = () => {
    if (this.phase !== 'briefing' || this.syncing || !this.contract || !this.campaign.offers.some(o => o.id === this.contract!.id)) return;
    const contract = this.contract;
    // Mirrors the server: deploying deals the next board, so offers reroll whatever the outcome, and spends an intel reward.
    this.intelReward = this.campaign.intel;
    this.campaign = { ...dealBoard(this.campaign, Math.random), intel: false };
    this.begin(contract);
  };
  restart = () => { if (this.phase === 'mission' && this.contract) this.begin(this.contract); };
  private begin(contract: Contract) {
    this.phase = 'mission'; this.result = null; this.failReason = ''; this.payout = 0; this.paused = false; this.time = 0;
    this.resetUnits();
    this.message = `Squad deployed. ${this.objectives[0].label}.`;
    this.report(s => s.deployed(contract.id, [...this.squad], this.countermeasures)); this.emit();
  }

  // ---- Orders ----
  private livingSquad() { return this.units.filter(u => u.faction === 'squad' && u.hp > 0); }
  unit(id: string) { return this.units.find(u => u.id === id); }
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
    units.forEach(u => { u.solo = n === 1; });
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
  private firepower(u: Unit) { return CLASS_STATS[u.kind as ClassId].damage + gearDamage(this.campaign); }
  private attackPlan(target: Unit, units: Unit[]) {
    const world = this.plan!.world, hp = this.apparentHp(target);
    const damage = units.reduce((sum, u) => sum + this.firepower(u) * (world.coverBetween(u, target) ? COVER_FACTOR : 1), 0), kills = damage >= hp;
    const quiet = !this.alarm && target.detect < SUSPICIOUS && takedownable(target) && !kills, need = target.kind === 'heavy' ? 2 : 1;
    const takedown = quiet && units.length >= need ? [...units].sort((a, b) => distance(a, target) - distance(b, target)).slice(0, need) : [];
    const survives = !this.alarm && !kills, alerts = survives && target.detect + suppressedAlert(this.campaign) >= 1;
    return { takedown, short: quiet && units.length < need ? need : 0, damage: Math.round(damage), hp: Math.ceil(hp), alerts, suspicious: survives && !alerts };
  }
  // The health the squad reads off a hostile: an unknown target reads as the guard it passes for (at the same share of
  // its health), so an order planned on that, a volley meant to kill a guard, can leave the target standing.
  private apparentHp(u: Unit) { return apparentHealth(u, this.plan!.contract.tier).hp; }
  private attackable(id: string) {
    // A carrier's hands are full: it takes no part in attacks.
    const target = this.unit(id), units = this.orderable().filter(u => !this.carrying(u));
    return this.phase === 'mission' && this.plan && target && target.faction === 'hostile' && target.hp > 0 && target.visible && units.length ? { target, units } : null;
  }
  // What an attack order on `id` would do with the current selection.
  attackPreview(id: string): AttackPreview | null {
    const order = this.attackable(id); if (!order) return null;
    const p = this.attackPlan(order.target, order.units);
    const outcome = p.takedown.length ? 'takedown' : this.alarm ? 'volley' : p.alerts ? 'alert' : p.suspicious ? 'suspicious' : 'kill';
    return { outcome, takedown: p.takedown.map(u => u.id), damage: p.damage, hp: p.hp, short: p.short };
  }
  // The hover hint for a preview: "Takedown · ROOK" or "48 / 75 · will alert".
  describeAttack(p: AttackPreview): string {
    if (p.outcome === 'takedown') return `Takedown · ${p.takedown.map(id => this.unit(id)?.name).join(' + ')}`;
    const volley = `${p.damage} / ${p.hp}`;
    if (p.outcome === 'volley') return volley;
    const effect = p.outcome === 'alert' ? 'will alert' : p.outcome === 'suspicious' ? 'turns suspicious' : 'silent kill';
    return `${volley} · ${effect}${p.short ? ` · takedown needs ${p.short}` : ''}`;
  }
  attackHint(id: string): string | null {
    const p = this.attackPreview(id);
    return p && this.describeAttack(p);
  }
  attack(id: string) {
    const order = this.attackable(id); if (!order) return;
    const { target, units } = order, p = this.attackPlan(target, units), world = this.plan!.world;
    const who = target.kind === 'target' && !target.guise ? 'Target' : target.name;
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
    this.message = this.alarm ? (target.kind === 'target' && !target.guise ? 'Target marked. Eliminate the target.' : `${target.name} marked. Concentrate fire.`)
      : `${who} marked. Volley ${p.damage} / ${p.hp}, ${p.alerts ? 'will alert' : 'silent kill'}. ${fire}.${p.short ? ` A takedown needs ${p.short} operatives.` : ''}`;
    this.emit();
  }
  private watched(v: Unit, margin = 1) { return watchedBy(this.plan!.world, v, margin); }
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
    if (this.carrying(u)) { this.message = `${u.name} has their hands full with the package.`; this.emit(); return; }
    this.calling = false;
    if (u.abilityCd > 0) { this.message = `${u.name}: ${stats.name} recharging (${Math.ceil(u.abilityCd)} s).`; this.emit(); return; }
    if (!stats.targeted) { this.casts.push({ unitId: u.id, ability: u.ability, point: { x: u.x, z: u.z }, targetId: null }); u.abilityCd = this.cooldownFor(u); this.pending = null; this.message = `${u.name}: ${stats.name}.`; this.emit(); return; }
    this.pending = { unitId: u.id, ability: u.ability };
    this.message = u.ability === 'snipe' ? `${u.name}: choose a visible hostile within ${stats.reach} m. Esc cancels.` : `${u.name}: choose where to throw the ${stats.name.toLowerCase()} (${stats.reach} m). Esc cancels.`;
    this.emit();
  }
  // A called extraction: once the objectives are done, the next ground click (or tap) calls the pickup there.
  get calledExtraction() { return !!this.plan && hasModifier(this.plan.contract, 'called'); }
  armPickup = () => {
    if (this.phase !== 'mission' || !this.calledExtraction || !this.extractReady || this.pickup) return;
    this.pending = null; this.calling = true; this.message = 'Choose an open street for the pickup. Esc cancels.'; this.emit();
  };
  private callPickup(p: Point) {
    const world = this.plan!.world;
    if (!world.inBounds(p) || !world.walkable(p, .6)) { this.message = 'The pickup needs open street.'; this.emit(); return; }
    this.calling = false; this.pickup = { x: p.x, z: p.z, in: PICKUP_SECONDS };
    const zone = this.objectives.at(-1)!; zone.x = p.x; zone.z = p.z;
    this.message = `Pickup called. It lands in ${PICKUP_SECONDS} s; get everyone into the zone.`; this.emit();
  }
  cancelAbility(): boolean {
    if (this.calling) { this.calling = false; this.message = 'Pickup call canceled.'; this.emit(); return true; }
    if (!this.pending) return false;
    this.pending = null; this.message = 'Ability canceled.'; this.emit(); return true;
  }
  private cooldownFor(u: Unit) { return abilityCooldown(u.ability!, this.campaign.abilities[u.kind as ClassId]); }
  private aim(point: Point, targetId: string | null) {
    const p = this.pending!, caster = this.unit(p.unitId), stats = ABILITY_STATS[p.ability];
    if (!caster || caster.hp <= 0 || !this.plan || this.carrying(caster)) { this.pending = null; this.emit(); return; }
    const target = targetId ? this.unit(targetId) : undefined;
    if (p.ability === 'snipe' && (!target || target.faction !== 'hostile' || !target.visible)) { this.message = 'The sniper shot needs a visible hostile.'; this.emit(); return; }
    const at = target ?? point;
    if (distance(caster, at) > stats.reach || !this.plan.world.sightClear(caster, at)) { this.message = `Out of reach: ${caster.name} needs a clear line within ${stats.reach} m.`; this.emit(); return; }
    this.casts.push({ unitId: caster.id, ability: p.ability, point: { x: at.x, z: at.z }, targetId: target?.id ?? null });
    caster.abilityCd = this.cooldownFor(caster);
    this.pending = null; this.message = `${caster.name}: ${stats.name} away.`; this.emit();
  }
  // Extraction opens once every other objective is done.
  get extractReady() { return objectivesMet(this.objectives); }
  // Pointer entry points for the scene. `additive` (Shift, or a long press on touch) appends a waypoint on the
  // street and toggles an operative in the selection.
  groundClick(point: Point, additive = false) { if (this.calling) this.callPickup(point); else if (this.pending) this.aim(point, null); else this.move(point, additive); }
  unitClick(id: string, additive = false) {
    const u = this.unit(id); if (!u) return;
    if (this.calling) { this.callPickup(u); return; }
    if (this.pending) { if (u.faction === 'hostile') this.aim(u, id); else { this.cancelAbility(); this.select(id, additive); } return; }
    if (u.faction === 'hostile') this.attack(id);
    else if (u.faction === 'squad' && u.hp <= 0) this.revive(id);
    else if (u.faction === 'squad') this.select(id, additive);
    else this.move(u, additive); // the VIP stands on the street, so a click on it is a move order
  }

  // `rifle`: a squad rifle round, which suppressors quieten (sniper shots and grenades are never quiet).
  private damage(target: Unit, amount: number, from: Unit | null, rifle = false) {
    if (target.hp <= 0) return;
    const covered = from && this.plan?.world.coverBetween(from, target);
    if (target.faction === 'vip') { if (target.id === 'vip') amount *= VIP_DAMAGE_TAKEN; if (from) this.vipThreat = { x: from.x, z: from.z }; }
    target.hp = Math.max(0, target.hp - amount * (covered ? COVER_FACTOR : 1));
    if (target.faction === 'hostile') this.hitThisFrame.set(target, { by: from, rifle: rifle && (this.hitThisFrame.get(target)?.rifle ?? true) });
    else {
      target.hurt = 1.5; target.revive = 0;
      // A downed operative drops its orders; once revived it stays where it fell.
      if (target.hp <= 0) { target.path = []; this.clearOrders(target); if (target.faction === 'squad') { this.reach('downed'); this.downs++; this.message = `${target.name} is down.`; } }
    }
  }
  shoot(from: Unit, to: Unit, amount: number, kind: Shot['kind'] = 'bullet') {
    this.damage(to, amount, from, kind === 'bullet' && from.faction === 'squad');
    contact(this, from.faction === 'hostile' ? to : from);
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
      raiseAlarm(this, c.point, 'Grenade detonation', undefined, { trigger: 'grenade', culprit: caster });
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

  finish(success: boolean, reason = '') {
    if (this.phase !== 'mission' || !this.contract) return;
    this.phase = 'headquarters'; this.result = success ? 'success' : 'failure'; this.failReason = reason; this.pending = null;
    if (success) {
      const kills = this.units.filter(u => u.faction === 'hostile' && u.hp <= 0 && countsAsKill(u, this.contract!.type)).length;
      const report: MissionReport = { stealth: !this.detected, badges: earnedBadges(this), results: results(this), ...(kills ? { kills } : {}) };
      this.badges = report.badges; this.payout = missionPayout(this.contract, report.stealth, kills); this.reward = earnedReward(this, rewardFor(this.contract, report.results));
      this.campaign = applyPayout(this.campaign, this.contract, this.countermeasures, report, Math.random); this.report(s => s.completed(report));
    }
    this.emit();
  }
  private intruders() { return this.units.filter(u => u.hp > 0 && (u.faction === 'squad' || (u.faction === 'vip' && this.joined.has(u.id)))); }
  // Whether a follower (the VIP or a prisoner) has been freed and walks with the squad.
  following(u: Pick<Unit, 'id'>) { return this.joined.has(u.id); }
  walk(u: Unit, speed: number, dt: number) {
    const next = u.path[0]; if (!next) return;
    const d = distance(u, next);
    u.heading = headingTo(u, next);
    if (d <= speed * dt) { u.x = next.x; u.z = next.z; u.path.shift(); }
    else { u.x += (next.x - u.x) / d * speed * dt; u.z += (next.z - u.z) / d * speed * dt; }
    u.moving = true;
  }



  private carrying(u: Unit) { return !!this.cargo && this.cargo.carrier === u.id; }
  private speedOf(u: Unit) { return SQUAD_SPEED * (this.carrying(u) ? CARRY_SPEED : 1); }
  private updateOperative(u: Unit, dt: number, hostiles: Unit[]) {
    const world = this.plan!.world, stats = CLASS_STATS[u.kind as ClassId];
    u.moving = false;
    u.cooldown -= dt; u.abilityCd = Math.max(0, u.abilityCd - dt); u.hurt = Math.max(0, u.hurt - dt);
    if (u.ability && u.abilityCd <= 0) this.reach('abilityReady');
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
    const canHit = (v: Unit) => v.visible && distance(u, v) <= stats.range + gearRange(this.campaign) && world.sightClear(u, v);
    const ordered = hostiles.find(v => v.id === u.targetId);
    if (!ordered) u.targetId = null;
    else if (!canHit(ordered) && !u.path.length) { u.repath -= dt; if (u.repath <= 0) { u.repath = .75; u.path = world.findPath(u, ordered); } }
    // Before the alarm the squad holds fire except at ordered targets. It never fires on a Surveillance executive unordered.
    const watchOnly = mission(this).target === 'executive', free = (h: Unit) => canHit(h) && !(watchOnly && h.kind === 'target');
    const target = this.carrying(u) ? undefined : ordered && canHit(ordered) ? ordered : this.alarm ? hostiles.filter(free).sort((a, b) => distance(u, a) - distance(u, b))[0] : undefined;
    if (u.path.length && !(target && target === ordered)) this.walk(u, this.speedOf(u), dt);
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
    if (u.path.length) this.walk(u, this.speedOf(u), dt);
    return true;
  }
  private unseen(a: Point, b: Point, avoid: (p: Point) => boolean) {
    const steps = Math.ceil(distance(a, b) * 3);
    for (let n = 1; n <= steps; n++) if (avoid({ x: a.x + (b.x - a.x) * n / steps, z: a.z + (b.z - a.z) * n / steps })) return false;
    return true;
  }
  private sees(h: Unit, p: Point) {
    const stats = seenAs(h);
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
      if (witness && !this.alarm) raiseAlarm(this, witness, `${witness.name} saw the takedown`, crew[0], { trigger: 'takedown', by: witness, culprit: crew[0] });
      if (v.held >= TAKEDOWN_SECONDS) {
        v.hp = 0; v.held = 0; crew.forEach(u => { u.takedownId = null; });
        this.message = `${crew.map(u => u.name).join(' and ')} took down ${v.kind === 'target' ? 'the target' : v.name}.`;
      }
    }
  }
  // ---- Cover ----
  // Who can shoot at `u`: during the alarm, armed hostiles with `u` in range and in sight; before it, every armed
  // hostile the squad can see. Cameras and the target carry no weapon, so cover means nothing against them.
  private threats(u: Unit) {
    const world = this.plan!.world;
    return this.units.filter(h => {
      if (h.faction !== 'hostile' || h.hp <= 0) return false;
      const stats = seenAs(h);
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
    const known: Point[] = this.units.filter(h => h.faction === 'hostile' && h.hp > 0 && h.visible && seenAs(h).damage > 0);
    if (!known.length) for (const [id, s] of this.lastSeen) { const h = this.unit(id); if (h && seenAs(h).damage) known.push(s); }
    const threat = known.sort((a, b) => distance(a, p) - distance(b, p))[0];
    const spot = threat && this.plan.world.coverSpot(p, threat);
    return spot ? { ...spot.point, along: spot.along, span: spot.span } : null;
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
    for (const u of this.units) if (u.faction === 'hostile' && u.hp > 0 && this.phase === 'mission') updateHostile(this, u, dt, intruders);
    if (this.escaped.size) this.units = this.units.filter(u => !this.escaped.has(u.id));
    if (this.phase !== 'mission') return;
    const hostiles = this.units.filter(u => u.faction === 'hostile' && u.hp > 0);
    for (const u of this.units) if (u.faction === 'squad') { if (u.hp > 0) this.updateOperative(u, dt, hostiles); else u.moving = false; }
    this.fireVolleys();
    this.resolveTakedowns(dt);
    // A volley that kills its target stays quiet; any hostile left standing after being hit raises the alarm.
    // With suppressed rifles a survivor only grows more suspicious, until that tips it into the alarm.
    for (const [u, hit] of this.hitThisFrame) {
      if (u.hp <= 0) continue;
      const jump = hit.rifle ? suppressedAlert(this.campaign) : 1;
      if (this.alarm || u.detect + jump >= 1) { raiseAlarm(this, u, `${u.name} returned fire`, undefined, { trigger: 'gunfire', by: u, culprit: hit.by ?? undefined }); break; }
      const was = u.detect;
      u.detect += jump;
      if (was <= SUSPICIOUS && u.detect > SUSPICIOUS) { this.reach('suspicious'); suspicious(this, u); }
      this.message = `${u.name} hit and suspicious.`;
    }
    for (const u of this.units) if (u.faction === 'hostile' && u.hp <= 0) { u.path = []; u.moving = false; }
    const squad = this.livingSquad();
    for (const f of this.units.filter(u => u.faction === 'vip')) {
      if (f.hp <= 0) { if (f.id === 'vip') return this.finish(false, 'The VIP was killed.'); continue; }
      updateFollower(this, f, dt, squad);
    }
    this.selected = this.selected.filter(id => squad.some(u => u.id === id));
    if (this.pending && !squad.some(u => u.id === this.pending!.unitId)) this.pending = null;
    if (!squad.length) return this.finish(false, 'The squad was wiped out.');
    watchForTarget(this, dt, squad);
    watchExecutives(this, dt, squad);
    updateCargo(this, dt, squad);
    updateObjectives(this, dt, squad);
    if (this.phase !== 'mission') return;
    // Lockdown: once the first alarm sounds the exits seal after LOCKDOWN_SECONDS, stood down or not.
    if (this.lockdownIn !== null && (this.lockdownIn -= dt) <= 0) return this.finish(false, mission(this).trapped ?? 'Lockdown. The exits sealed with the squad inside.');
    reinforce(this, dt);
    if (this.alarm && (this.calmIn -= dt) <= 0) standDown(this);
    updateVisibility(this);
    if (this.pickup && this.pickup.in > 0 && (this.pickup.in -= dt) <= 0) { this.pickup.in = 0; this.message = 'Pickup on the ground. Everyone into the zone.'; this.emit(); }
    this.uiTimer += dt;
    if (this.uiTimer >= .1 || this.alarm !== wasAlarm || this.paused) { this.uiTimer = 0; this.emit(); }
  }
}
