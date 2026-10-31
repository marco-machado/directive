import { abilityCooldown, abilityPower, ABILITY_STATS, CLASS_STATS, effectScale, EMP_CAMERA_SECONDS, MARK_RADIUS, MARK_SECONDS } from './classes.ts';
import type { AbilityId, ClassId } from './classes.ts';
import { applyDismiss, applyPayout, applyPurchase, applyRecruit, dealBoard, freshCampaign, missionPayout, SQUAD_MAX } from './campaign.ts';
import type { Campaign, Contract, Upgrade } from './campaign.ts';
import { planMission } from './mapgen.ts';
import type { EnemyKind, MissionPlan } from './mapgen.ts';
import { mulberry32 } from './rng.ts';
import type { Rng } from './rng.ts';
import { distance } from './world.ts';
import type { Point } from './world.ts';
export { freshCampaign, parseCampaign } from './campaign.ts';
export type { Campaign, Upgrade } from './campaign.ts';

export type Faction = 'squad' | 'hostile' | 'vip';
export type UnitKind = ClassId | EnemyKind | 'vip';
export type Unit = Point & {
  id: string; name: string; kind: UnitKind; faction: Faction; hp: number; maxHp: number; cooldown: number;
  path: Point[]; targetId: string | null; heading: number; moving: boolean; repath: number;
  ability: AbilityId | null; abilityCd: number; reviveTarget: string | null; revive: number; hurt: number;
  patrol: Point[]; patrolIndex: number; exit: Point | null; wait: number; detect: number; stunned: number; marked: number; visible: boolean; hunting: boolean; sweep: number;
};
export type Shot = { id: number; from: Point; to: Point; faction: Faction; kind: 'bullet' | 'snipe'; ttl: number };
export type Blast = { id: number; kind: 'grenade' | 'heal' | 'emp'; x: number; z: number; radius: number; ttl: number };
export type Objective = Point & { kind: 'target' | 'terminal' | 'charge' | 'vip' | 'extract'; label: string; progress: number; done: boolean };
export type Phase = 'briefing' | 'mission' | 'headquarters';
export type Pending = { unitId: string; ability: AbilityId } | null;
export type Snapshot = {
  phase: Phase; paused: boolean; selected: string[]; squad: string[]; squadPick: string[]; units: Unit[]; campaign: Campaign;
  contract: Contract | null; plan: MissionPlan | null; objectives: Objective[]; alarm: boolean; reinforceIn: number; reinforced: number;
  result: 'success' | 'failure' | null; failReason: string; payout: number; stealth: boolean; time: number; message: string;
  saveUnavailable: boolean; pending: Pending;
};
// Reports campaign events to the server; the server answers through applyCampaign.
export type CampaignSync = {
  deployed(contractId: string, squad: string[]): void; completed(stealth: boolean): void;
  bought(type: Upgrade): void; recruited(id: string): void; dismissed(id: string): void;
};

export type HostileStats = { name: string; hp: number; damage: number; range: number; fireCooldown: number; speed: number; alertSpeed: number; vision: number; fov: number };
export const HOSTILE_STATS: Record<EnemyKind, HostileStats> = {
  guard: { name: 'SECURITY', hp: 75, damage: 10, range: 5.5, fireCooldown: 1.25, speed: 1.8, alertSpeed: 3, vision: 7, fov: .87 },
  heavy: { name: 'HEAVY', hp: 180, damage: 16, range: 5, fireCooldown: 1.4, speed: 1.5, alertSpeed: 2.2, vision: 6, fov: .87 },
  camera: { name: 'CAMERA', hp: 40, damage: 0, range: 0, fireCooldown: 0, speed: 0, alertSpeed: 0, vision: 8, fov: .61 },
  turret: { name: 'TURRET', hp: 140, damage: 18, range: 7, fireCooldown: 1.1, speed: 0, alertSpeed: 0, vision: 7, fov: .79 },
  target: { name: 'TARGET', hp: 110, damage: 0, range: 0, fireCooldown: 0, speed: 0, alertSpeed: 1.8, vision: 6, fov: .87 },
};
// Each tier above the first makes hostiles 10% tougher and 15% deadlier.
export const tierHp = (tier: number) => 1 + .1 * (tier - 1);
export const tierDamage = (tier: number) => 1 + .15 * (tier - 1);
export const SQUAD_SPEED = 3.4;
export const VIP_SPEED = 3.2;
export const VIP_HP = 160;
export const FLEE_DELAY = 5;        // the target hesitates before running for an exit
export const FLEE_MIN_EXIT = 16;    // and picks an exit at least this far away
export const SIGHT_RANGE = 10;      // fog of war: hostiles beyond this or behind buildings are hidden
export const CONVERGE_RADIUS = 14;  // guards this close to the alarm hunt the squad
export const REINFORCE_SECONDS = 20;
export const REINFORCE_CAP = 8;
export const REVIVE_SECONDS = 3;
export const REVIVE_HP = .4;
export const HACK_SECONDS = 12;
export const PLANT_SECONDS = 3;
export const COVER_FACTOR = .5;
export const WEAPON_BONUS = 12, ARMOR_BONUS = 40;

const angleDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const headingTo = (a: Point, b: Point) => Math.atan2(b.x - a.x, b.z - a.z);

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
  contract: Contract | null = null;
  alarm = false;
  reinforceIn = 0;
  result: Snapshot['result'] = null;
  failReason = '';
  payout = 0;
  time = 0;
  message = 'Choose a contract and a squad.';
  saveUnavailable = false;
  commandPoint: Point | null = null;
  pending: Pending = null;
  private reinforced = 0;
  private vipJoined = false;
  private casts: { unitId: string; ability: AbilityId; point: Point; targetId: string | null }[] = [];
  private hitThisFrame = new Set<Unit>();
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
      objectives: this.objectives.map(o => ({ ...o })), alarm: this.alarm, reinforceIn: this.reinforceIn, reinforced: this.reinforced, result: this.result,
      failReason: this.failReason, payout: this.payout, stealth: !this.alarm, time: this.time, message: this.message,
      saveUnavailable: this.saveUnavailable, pending: this.pending,
    };
    this.listeners.forEach(fn => fn());
  }
  private report(send: (sync: CampaignSync) => void) { if (this.sync) try { send(this.sync); } catch { this.saveUnavailable = true; } }
  applyCampaign(campaign: Campaign) { this.campaign = campaign; if (this.phase !== 'mission') this.refreshBoard(); this.emit(); }
  setSaveUnavailable(unavailable: boolean) { if (this.saveUnavailable !== unavailable) { this.saveUnavailable = unavailable; this.emit(); } }

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
      id, name, kind, faction, x: p.x, z: p.z, hp: maxHp, maxHp, cooldown: faction === 'hostile' ? 1 : 0, path: [], targetId: null, heading, moving: false, repath: 0,
      ability: null, abilityCd: 0, reviveTarget: null, revive: 0, hurt: 0, patrol: [], patrolIndex: 0, exit: null, wait: 0, detect: 0, stunned: 0, marked: 0, visible: false, hunting: false, sweep: heading,
    };
  }
  private resetUnits() {
    const plan = this.plan;
    this.units = []; this.objectives = []; this.shots = []; this.blasts = []; this.casts = []; this.hitThisFrame.clear();
    this.alarm = false; this.reinforceIn = 0; this.reinforced = 0; this.vipJoined = false; this.pending = null; this.commandPoint = null;
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
    if (t === 'escort' && plan.vip) this.objectives.push(o('vip', 'Reach the VIP', plan.vip));
    this.objectives.push(o('extract', t === 'escort' ? 'Escort the VIP to extraction' : 'Reach extraction', plan.extract));
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
  private orderable() { return this.selected.map(id => this.unit(id)).filter((u): u is Unit => !!u && u.hp > 0); }
  move(point: Point) {
    if (this.phase !== 'mission' || !this.plan) return;
    let moved = false;
    const units = this.orderable();
    units.forEach((u, i) => {
      const path = this.plan!.world.findPath(u, { x: point.x + (i - (units.length - 1) / 2) * .9, z: point.z });
      if (path.length) { u.path = path; u.targetId = null; u.reviveTarget = null; u.revive = 0; moved = true; }
    });
    this.commandPoint = moved ? { x: point.x, z: point.z } : null;
    this.message = moved ? (this.alarm ? 'Move order confirmed. Weapons free.' : 'Move order confirmed. Holding fire until ordered.') : 'Route blocked. Choose an open street.'; this.emit();
  }
  attack(id: string) {
    if (this.phase !== 'mission' || !this.plan) return;
    const target = this.unit(id);
    if (!target || target.faction !== 'hostile' || target.hp <= 0 || !target.visible) return;
    this.orderable().forEach(u => { u.targetId = id; u.reviveTarget = null; u.revive = 0; u.path = this.plan!.world.findPath(u, target); });
    this.message = target.kind === 'target' ? 'Target marked. Eliminate the target.' : `${target.name} marked. Concentrate fire.`; this.emit();
  }
  revive(id: string) {
    if (this.phase !== 'mission' || !this.plan) return;
    const down = this.unit(id);
    if (!down || down.faction !== 'squad' || down.hp > 0) return;
    const medic = this.orderable().sort((a, b) => distance(a, down) - distance(b, down))[0];
    if (!medic) { this.message = 'Select a living operative to revive.'; this.emit(); return; }
    medic.reviveTarget = id; medic.revive = 0; medic.targetId = null; medic.path = this.plan.world.findPath(medic, down);
    this.message = `${medic.name} moving to revive ${down.name}.`; this.emit();
  }
  hold = () => {
    this.orderable().forEach(u => { u.path = []; u.targetId = null; u.reviveTarget = null; u.revive = 0; });
    this.message = this.alarm ? 'Holding position. Weapons free.' : 'Holding position. Holding fire.'; this.emit();
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
  // Pointer entry points for the scene.
  groundClick(point: Point) { if (this.pending) this.aim(point, null); else this.move(point); }
  unitClick(id: string, additive = false) {
    const u = this.unit(id); if (!u) return;
    if (this.pending) { if (u.faction === 'hostile') this.aim(u, id); else { this.cancelAbility(); this.select(id, additive); } return; }
    if (u.faction === 'hostile') this.attack(id);
    else if (u.faction === 'squad' && u.hp <= 0) this.revive(id);
    else if (u.faction === 'squad') this.select(id, additive);
    else this.move(u); // the VIP stands on the street, so a click on it is a move order
  }

  // ---- Combat rules ----
  private raiseAlarm(at: Point, reason: string) {
    if (this.alarm || !this.plan) return;
    this.alarm = true; this.reinforceIn = REINFORCE_SECONDS;
    for (const u of this.units) {
      if (u.faction !== 'hostile' || u.hp <= 0) continue;
      u.detect = 1;
      if ((u.kind === 'guard' || u.kind === 'heavy') && distance(u, at) <= CONVERGE_RADIUS) { u.hunting = true; u.repath = 0; }
      if (u.kind === 'target') {
        const exits = [...this.plan.exits].sort((a, b) => distance(u, a) - distance(u, b));
        u.exit = [...exits.filter(e => distance(u, e) >= FLEE_MIN_EXIT), ...exits].find(e => this.plan!.world.findPath(u, e).length) ?? null;
        u.wait = FLEE_DELAY;
      }
    }
    this.message = `ALARM: ${reason}. Weapons free.`;
  }
  private damage(target: Unit, amount: number, from: Point | null) {
    if (target.hp <= 0) return;
    const covered = from && this.plan?.world.coverBetween(from, target);
    target.hp = Math.max(0, target.hp - amount * (covered ? COVER_FACTOR : 1));
    if (target.faction === 'hostile') this.hitThisFrame.add(target);
    else {
      target.hurt = 1.5; target.revive = 0;
      // A downed operative drops its orders; once revived it stays where it fell.
      if (target.hp <= 0) { target.path = []; target.targetId = null; target.reviveTarget = null; }
    }
  }
  private shoot(from: Unit, to: Unit, amount: number, kind: Shot['kind'] = 'bullet') {
    this.damage(to, amount, from);
    this.shots.push({ id: this.nextId++, from: { x: from.x, z: from.z }, to: { x: to.x, z: to.z }, faction: from.faction, kind, ttl: kind === 'snipe' ? .35 : .12 });
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
      const stealth = !this.alarm;
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
      u.visible = u.marked > 0 || (!!world && eyes.some(e => distance(e, u) <= SIGHT_RANGE && world.sightClear(e, u)));
    }
  }

  private updateHostile(u: Unit, dt: number, intruders: Unit[]) {
    const world = this.plan!.world, stats = HOSTILE_STATS[u.kind as EnemyKind];
    u.marked = Math.max(0, u.marked - dt);
    u.moving = false;
    if (u.stunned > 0) { u.stunned -= dt; return; }
    u.cooldown -= dt;
    const mobile = u.kind === 'guard' || u.kind === 'heavy';
    if (!this.alarm) {
      if (u.kind === 'camera' || u.kind === 'turret') u.heading = u.sweep + Math.sin(this.time * .6 + u.x) * (u.kind === 'camera' ? .7 : 1);
      const seen = intruders.filter(v => distance(u, v) <= stats.vision && angleDiff(headingTo(u, v), u.heading) <= stats.fov && world.sightClear(u, v))
        .sort((a, b) => distance(u, a) - distance(u, b))[0];
      if (seen) {
        u.detect = Math.min(1, u.detect + dt / (.35 + .12 * distance(u, seen)));
        if (u.detect >= 1) { this.raiseAlarm(u, `${stats.name} spotted the squad`); return; }
        // A suspicious guard stops and stares instead of walking on.
        if (u.detect > .3 && mobile) { u.heading = headingTo(u, seen); return; }
      } else u.detect = Math.max(0, u.detect - .25 * dt);
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
    if (u.hunting) {
      u.repath -= dt;
      if (u.repath <= 0) {
        u.repath = 1;
        const prey = [...intruders].sort((a, b) => distance(u, a) - distance(u, b))[0];
        if (prey) u.path = world.findPath(u, prey);
      }
      this.walk(u, stats.alertSpeed, dt);
    } else this.patrol(u, stats.speed, dt);
  }
  private patrol(u: Unit, speed: number, dt: number) {
    if (u.patrol.length < 2) return;
    if (!u.path.length) {
      if (u.wait > 0) { u.wait -= dt; return; }
      u.patrolIndex = (u.patrolIndex + 1) % u.patrol.length;
      u.path = this.plan!.world.findPath(u, u.patrol[u.patrolIndex]); u.wait = 1.2;
    }
    this.walk(u, speed, dt);
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
    const canHit = (v: Unit) => v.visible && distance(u, v) <= stats.range && world.sightClear(u, v);
    const ordered = hostiles.find(v => v.id === u.targetId);
    if (!ordered) u.targetId = null;
    else if (!canHit(ordered) && !u.path.length) { u.repath -= dt; if (u.repath <= 0) { u.repath = .75; u.path = world.findPath(u, ordered); } }
    // Before the alarm the squad holds fire except at ordered targets.
    const target = ordered && canHit(ordered) ? ordered : this.alarm ? hostiles.filter(canHit).sort((a, b) => distance(u, a) - distance(u, b))[0] : undefined;
    if (u.path.length && !(ordered && canHit(ordered))) this.walk(u, SQUAD_SPEED, dt);
    if (target && u.cooldown <= 0) {
      u.heading = headingTo(u, target);
      this.shoot(u, target, stats.damage + this.campaign.weapon * WEAPON_BONUS);
      u.cooldown = stats.fireCooldown;
    }
  }
  private updateVip(u: Unit, dt: number, squad: Unit[]) {
    u.moving = false; u.hurt = Math.max(0, u.hurt - dt);
    const leader = [...squad].sort((a, b) => distance(u, a) - distance(u, b))[0];
    if (!leader) return;
    if (!this.vipJoined) {
      if (distance(u, leader) > 3) return;
      this.vipJoined = true; this.message = 'VIP secured. Escort them to extraction.';
    }
    // The VIP follows the nearest operative but freezes while under fire.
    if (u.hurt > 0 || distance(u, leader) <= 1.6) { u.path = []; return; }
    u.repath -= dt;
    if (u.repath <= 0 || !u.path.length) { u.repath = .5; u.path = this.plan!.world.findPath(u, leader); }
    this.walk(u, VIP_SPEED, dt);
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
    const extract = this.objectives.at(-1)!;
    if (this.extractReady && squad.some(s => distance(s, extract) < 2) && (!vip || distance(vip, extract) < 2.4)) { extract.done = true; this.finish(true); }
  }
  private reinforce(dt: number) {
    if (!this.alarm || this.reinforced >= REINFORCE_CAP || !this.plan) return;
    this.reinforceIn -= dt;
    if (this.reinforceIn > 0) return;
    this.reinforceIn = REINFORCE_SECONDS;
    const exit = this.plan.exits[Math.floor(this.rng() * this.plan.exits.length)];
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
    this.updateVisibility();
    this.uiTimer += dt;
    if (this.uiTimer >= .1 || this.alarm !== wasAlarm) { this.uiTimer = 0; this.emit(); }
  }
}
