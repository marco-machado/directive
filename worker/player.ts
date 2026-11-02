import { DurableObject } from 'cloudflare:workers';
import { applyDismiss, applyPurchase, applyRecruit, clampCampaign, completeMission, freshCampaign, startMission } from '../src/game/campaign.ts';
import type { Campaign, Ledger, Upgrade } from '../src/game/campaign.ts';
import type { Rng } from '../src/game/rng.ts';

export type Result = { ok: true; campaign: Campaign } | { ok: false; status: 404 | 409; error: string };
const KEY = 'ledger';
const random: Rng = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
const unknown = { ok: false, status: 404, error: 'Unknown save code.' } as const;

// One instance per save code. Every write goes through the pure rules in src/game/campaign.ts.
export class PlayerCampaign extends DurableObject<Env> {
  // Ledgers written before contracts existed (v2) are upgraded on first read.
  private async load(): Promise<Ledger | undefined> {
    const ledger = await this.ctx.storage.get<Ledger>(KEY);
    if (!ledger || ledger.campaign.version === 3) return ledger;
    const upgraded: Ledger = { campaign: clampCampaign(ledger.campaign, random), activeMission: null };
    await this.ctx.storage.put(KEY, upgraded);
    return upgraded;
  }
  private async save(ledger: Ledger): Promise<Extract<Result, { ok: true }>> { await this.ctx.storage.put(KEY, ledger); return { ok: true, campaign: ledger.campaign }; }
  private async update(change: (c: Campaign) => Campaign | null, error: string): Promise<Result> {
    const ledger = await this.load(); if (!ledger) return unknown;
    const campaign = change(ledger.campaign);
    return campaign ? this.save({ ...ledger, campaign }) : { ok: false, status: 409, error };
  }

  // Creating a player that already exists returns it unchanged, so a retried create is harmless.
  async init(legacy?: unknown): Promise<Extract<Result, { ok: true }>> {
    const existing = await this.load();
    if (existing) return { ok: true, campaign: existing.campaign };
    // Browser saves predate rosters and contracts, so only their v1/v2 fields are imported.
    const old = legacy && typeof legacy === 'object' ? legacy as Record<string, unknown> : null;
    const imported = old ? clampCampaign({ cash: old.cash, weapon: old.weapon, armor: old.armor, completed: old.completed, mission: old.mission }, random) : null;
    return this.save({ campaign: imported ?? freshCampaign(random), activeMission: null });
  }
  async get(): Promise<Result> {
    const ledger = await this.load();
    return ledger ? { ok: true, campaign: ledger.campaign } : unknown;
  }
  async startMission(contractId: string, squad: string[]): Promise<{ ok: true; missionId: string; campaign: Campaign } | Extract<Result, { ok: false }>> {
    const ledger = await this.load(); if (!ledger) return unknown;
    const missionId = crypto.randomUUID();
    const next = startMission(ledger, missionId, Date.now(), contractId, squad, random);
    if (!next) return { ok: false, status: 409, error: 'That contract is not on offer, or the squad is invalid.' };
    await this.ctx.storage.put(KEY, next);
    return { ok: true, missionId, campaign: next.campaign };
  }
  async completeMission(missionId: string, stealth: boolean): Promise<Result> {
    const ledger = await this.load(); if (!ledger) return unknown;
    const next = completeMission(ledger, missionId, Date.now(), stealth, random);
    return next ? this.save(next) : { ok: false, status: 409, error: 'Mission is not active or ended too soon.' };
  }
  buy(type: Upgrade) { return this.update(c => applyPurchase(c, type), 'Not enough credits or upgrade maxed.'); }
  recruit(id: string) { return this.update(c => applyRecruit(c, id), 'Recruit unavailable, roster full, or not enough credits.'); }
  dismiss(id: string) { return this.update(c => applyDismiss(c, id), 'Unknown operative, or the last one on the roster.'); }
}
