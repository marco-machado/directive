import { clearLine, distance, EXTRACT, findPath } from './world.ts';
import type { Point } from './world.ts';
import { applyPayout, applyPurchase, freshCampaign } from './campaign.ts';
import type { Campaign, Upgrade } from './campaign.ts';
export { freshCampaign, parseCampaign } from './campaign.ts';
export type { Campaign, Upgrade } from './campaign.ts';

export type Unit = Point & { id: string; name: string; enemy: boolean; executive: boolean; hp: number; maxHp: number; cooldown: number; path: Point[]; targetId: string | null; heading: number; moving: boolean };
export type Shot = { id: number; from: Point; to: Point; enemy: boolean; ttl: number };
export type Phase = 'briefing' | 'mission' | 'headquarters';
export type Snapshot = { phase: Phase; paused: boolean; selected: string[]; units: Unit[]; campaign: Campaign; result: 'success' | 'failure' | null; targetDown: boolean; time: number; message: string; saveUnavailable: boolean };
// Reports campaign events to the server; the server answers through applyCampaign.
export type CampaignSync = { deployed(): void; completed(): void; bought(type: Upgrade): void };
export class Simulation {
  campaign: Campaign;
  phase: Phase = 'briefing';
  paused = false;
  selected = ['vex', 'rook'];
  units: Unit[] = [];
  shots: Shot[] = [];
  result: Snapshot['result'] = null;
  time = 0;
  message = 'Squad awaiting deployment.';
  saveUnavailable = false;
  commandPoint: Point | null = null;
  private listeners = new Set<() => void>();
  private snapshot!: Snapshot;
  private nextShot = 0;
  private uiTimer = 0;
  private sync: CampaignSync | undefined;

  constructor(campaign = freshCampaign(), sync?: CampaignSync) {
    this.campaign = campaign; this.sync = sync; this.resetUnits(); this.emit();
  }
  subscribe = (callback: () => void) => { this.listeners.add(callback); return () => { this.listeners.delete(callback); }; };
  getSnapshot = () => this.snapshot;
  get targetDown() { return this.units.some(u => u.executive && u.hp <= 0); }
  private emit() {
    this.snapshot = { phase: this.phase, paused: this.paused, selected: [...this.selected], units: this.units.map(u => ({ ...u })), campaign: { ...this.campaign }, result: this.result, targetDown: this.targetDown, time: this.time, message: this.message, saveUnavailable: this.saveUnavailable };
    this.listeners.forEach(fn => fn());
  }
  private report(send: (sync: CampaignSync) => void) { if (this.sync) try { send(this.sync); } catch { this.saveUnavailable = true; } }
  applyCampaign(campaign: Campaign) { this.campaign = campaign; if (this.phase !== 'mission') this.resetUnits(); this.emit(); }
  setSaveUnavailable(unavailable: boolean) { if (this.saveUnavailable !== unavailable) { this.saveUnavailable = unavailable; this.emit(); } }
  private resetUnits() {
    const unit = (id: string, name: string, x: number, z: number, enemy = false, executive = false): Unit => {
      const maxHp = enemy ? (executive ? 110 : 75) : 120 + this.campaign.armor * 40;
      return { id, name, x, z, enemy, executive, hp: maxHp, maxHp, cooldown: enemy ? 1 : 0, path: [], targetId: null, heading: 0, moving: false };
    };
    this.units = [unit('vex', 'VEX', -12.5, 7), unit('rook', 'ROOK', -11, 8), unit('g1', 'SECURITY', -8, 3), unit('g2', 'SECURITY', 0, -2), unit('g3', 'SECURITY', 10, -3), unit('target', 'EXECUTIVE', 11.5, -8, true, true)];
    this.units.slice(2).forEach(u => { u.enemy = true; u.hp = u.maxHp = u.executive ? 110 : 75; });
  }
  deploy = () => {
    this.phase = 'mission'; this.result = null; this.paused = false; this.time = 0;
    this.selected = ['vex', 'rook']; this.shots = []; this.commandPoint = null;
    this.resetUnits(); this.message = 'Squad deployed. Locate and neutralize the executive.';
    this.report(s => s.deployed()); this.emit();
  };
  select(id: string, additive = false) {
    const unit = this.units.find(u => u.id === id);
    if (!unit || unit.enemy || unit.hp <= 0) return;
    this.selected = additive ? (this.selected.includes(id) ? this.selected.filter(s => s !== id) : [...this.selected, id]) : [id]; this.emit();
  }
  selectAll = () => { this.selected = this.units.filter(u => !u.enemy && u.hp > 0).map(u => u.id); this.emit(); };
  togglePause = () => { if (this.phase === 'mission') { this.paused = !this.paused; this.emit(); } };
  pause = () => { if (this.phase === 'mission' && !this.paused) { this.paused = true; this.emit(); } };
  move(point: Point) {
    if (this.phase !== 'mission') return;
    let moved = false;
    this.selected.forEach((id, i) => {
      const u = this.units.find(v => v.id === id && v.hp > 0); if (!u) return;
      const path = findPath(u, { x: point.x + (i - (this.selected.length - 1) / 2) * .9, z: point.z });
      if (path.length) { u.path = path; u.targetId = null; moved = true; }
    });
    this.commandPoint = moved ? point : null;
    this.message = moved ? 'Move order confirmed. Weapons free.' : 'Route blocked. Choose an open street.'; this.emit();
  }
  attack(id: string) {
    if (this.phase !== 'mission') return;
    const target = this.units.find(u => u.id === id && u.enemy && u.hp > 0); if (!target) return;
    this.selected.forEach(uid => { const u = this.units.find(v => v.id === uid && v.hp > 0); if (u) { u.targetId = id; u.path = findPath(u, target); } });
    this.message = target.executive ? 'Executive marked. Eliminate the target.' : 'Hostile marked. Concentrate fire.'; this.emit();
  }
  hold = () => { this.units.filter(u => this.selected.includes(u.id)).forEach(u => { u.path = []; u.targetId = null; }); this.message = 'Holding position. Weapons free.'; this.emit(); };
  buy(type: Upgrade): boolean {
    if (this.phase !== 'headquarters') return false;
    const next = applyPurchase(this.campaign, type); if (!next) return false;
    this.campaign = next; this.report(s => s.bought(type)); this.emit(); return true;
  }
  private finish(success: boolean) {
    if (this.phase !== 'mission') return;
    this.phase = 'headquarters'; this.result = success ? 'success' : 'failure';
    if (success) { this.campaign = applyPayout(this.campaign); this.report(s => s.completed()); }
    this.emit();
  }
  update(dt: number) {
    if (this.phase !== 'mission' || this.paused) return;
    dt = Math.min(.05, Math.max(0, dt)); this.time += dt;
    this.shots = this.shots.filter(s => (s.ttl -= dt) > 0);
    for (const u of this.units) {
      if (u.hp <= 0) { u.moving = false; continue; }
      u.cooldown -= dt;
      const opponent = this.units.filter(v => v.hp > 0 && v.enemy !== u.enemy);
      let target = opponent.find(v => v.id === u.targetId);
      if (!target) u.targetId = null;
      const range = u.enemy ? 5.5 : 6.2;
      const canHit = (v: Unit) => distance(u, v) <= range && clearLine(u, v);
      if (!target || !canHit(target)) target = opponent.filter(canHit).sort((a, b) => distance(u, a) - distance(u, b))[0];
      const orderedTarget = opponent.find(v => v.id === u.targetId);
      const stopToFire = orderedTarget && canHit(orderedTarget);
      u.moving = false;
      if (u.path.length && !stopToFire) {
        const next = u.path[0], d = distance(u, next), speed = 3.4;
        u.heading = Math.atan2(next.x - u.x, next.z - u.z);
        if (d <= speed * dt) { u.x = next.x; u.z = next.z; u.path.shift(); }
        else { u.x += (next.x - u.x) / d * speed * dt; u.z += (next.z - u.z) / d * speed * dt; }
        u.moving = true;
      }
      if (target && u.cooldown <= 0) {
        u.heading = Math.atan2(target.x - u.x, target.z - u.z);
        target.hp = Math.max(0, target.hp - (u.enemy ? (u.executive ? 7 : 10) : 24 + this.campaign.weapon * 12));
        u.cooldown = u.enemy ? 1.25 : .65;
        this.shots.push({ id: this.nextShot++, from: { x: u.x, z: u.z }, to: { x: target.x, z: target.z }, enemy: u.enemy, ttl: .12 });
        if (target.hp === 0 && target.executive) this.message = 'Target neutralized. Return to the extraction zone.';
      }
    }
    const squad = this.units.filter(u => !u.enemy && u.hp > 0);
    this.selected = this.selected.filter(id => squad.some(u => u.id === id));
    if (!squad.length) this.finish(false);
    else if (this.targetDown && squad.some(u => distance(u, EXTRACT) < 2)) this.finish(true);
    this.uiTimer += dt;
    if (this.uiTimer >= .1) { this.uiTimer = 0; this.emit(); }
  }
}
