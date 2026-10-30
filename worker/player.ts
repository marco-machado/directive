import { DurableObject } from 'cloudflare:workers';
import { applyPurchase, clampCampaign, completeMission, freshCampaign, startMission } from '../src/game/campaign.ts';
import type { Campaign, Ledger, Upgrade } from '../src/game/campaign.ts';

export type Result = { ok: true; campaign: Campaign } | { ok: false; status: 404 | 409; error: string };
const KEY = 'ledger';

// One instance per save code. Every write goes through the pure rules in src/game/campaign.ts.
export class PlayerCampaign extends DurableObject<Env> {
  private load() { return this.ctx.storage.get<Ledger>(KEY); }
  private async save(ledger: Ledger): Promise<Result> { await this.ctx.storage.put(KEY, ledger); return { ok: true, campaign: ledger.campaign }; }

  async init(legacy?: unknown): Promise<Result> {
    if (await this.load()) return { ok: false, status: 409, error: 'Save code already in use.' };
    return this.save({ campaign: legacy === undefined ? freshCampaign() : clampCampaign(legacy), activeMission: null });
  }
  async get(): Promise<Result> {
    const ledger = await this.load();
    return ledger ? { ok: true, campaign: ledger.campaign } : { ok: false, status: 404, error: 'Unknown save code.' };
  }
  async startMission(): Promise<{ ok: true; missionId: string } | Extract<Result, { ok: false }>> {
    const ledger = await this.load(); if (!ledger) return { ok: false, status: 404, error: 'Unknown save code.' };
    const missionId = crypto.randomUUID();
    await this.ctx.storage.put(KEY, startMission(ledger, missionId, Date.now()));
    return { ok: true, missionId };
  }
  async completeMission(missionId: string): Promise<Result> {
    const ledger = await this.load(); if (!ledger) return { ok: false, status: 404, error: 'Unknown save code.' };
    const next = completeMission(ledger, missionId, Date.now());
    return next ? this.save(next) : { ok: false, status: 409, error: 'Mission is not active or ended too soon.' };
  }
  async buy(type: Upgrade): Promise<Result> {
    const ledger = await this.load(); if (!ledger) return { ok: false, status: 404, error: 'Unknown save code.' };
    const campaign = applyPurchase(ledger.campaign, type);
    return campaign ? this.save({ ...ledger, campaign }) : { ok: false, status: 409, error: 'Not enough credits or upgrade maxed.' };
  }
}
