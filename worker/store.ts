import { applyDismiss, applyLoadout, applyPurchase, applyRecruit, CAMPAIGN_VERSION, completeMission, freshCampaign, importLegacy, reportConsistent, resultsFit, startMission, upgradeLedger } from '../src/game/campaign.ts';
import type { Campaign, Ledger, Loadout, MissionReport, Upgrade } from '../src/game/campaign.ts';
import type { Rng } from '../src/game/rng.ts';

export type Result = { ok: true; campaign: Campaign } | { ok: false; status: 400 | 404 | 409; error: string };
type Started = { ok: true; missionId: string; campaign: Campaign } | Extract<Result, { ok: false }>;
// The storage one player's ledger needs. A Durable Object's storage fits it; the tests use a Map.
export type LedgerStorage = {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  deleteAll(): Promise<void>;
  getAlarm(): Promise<number | null>;
  setAlarm(time: number): Promise<void>;
};
// A save that never deployed holds nothing a new one would not, so it is deleted this long after it was created. The
// browser keeps its code and creates the save again on its next visit.
export const UNPLAYED_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const KEY = 'ledger';
const unknown = { ok: false, status: 404, error: 'Unknown save code.' } as const;
const unplayed = (l: Ledger) => l.campaign.completed === 0 && !l.activeMission;

// One player's campaign. Every write goes through the pure rules in src/game/campaign.ts.
export class CampaignStore {
  private readonly storage: LedgerStorage;
  private readonly random: Rng;
  private readonly now: () => number;
  constructor(storage: LedgerStorage, random: Rng, now: () => number = Date.now) { this.storage = storage; this.random = random; this.now = now; }

  // A ledger saved in an older campaign shape is upgraded on first read; a mission in flight keeps its payout claim.
  private async load(): Promise<Ledger | undefined> {
    const ledger = await this.storage.get<Ledger>(KEY);
    if (!ledger || ledger.campaign.version === CAMPAIGN_VERSION) return ledger;
    const upgraded = upgradeLedger(ledger, this.random);
    await this.storage.put(KEY, upgraded);
    return upgraded;
  }
  private async save(ledger: Ledger): Promise<Extract<Result, { ok: true }>> { await this.storage.put(KEY, ledger); return { ok: true, campaign: ledger.campaign }; }
  private async update(change: (c: Campaign) => Campaign | null, error: string): Promise<Result> {
    const ledger = await this.load(); if (!ledger) return unknown;
    const campaign = change(ledger.campaign);
    return campaign ? this.save({ ...ledger, campaign }) : { ok: false, status: 409, error };
  }

  // Creating a player that already exists returns it unchanged, so a retried create is harmless.
  async init(legacy?: unknown): Promise<Extract<Result, { ok: true }>> {
    const existing = await this.load();
    if (existing) return { ok: true, campaign: existing.campaign };
    const created = await this.save({ campaign: importLegacy(legacy, this.random) ?? freshCampaign(this.random), activeMission: null });
    await this.storage.setAlarm(this.now() + UNPLAYED_TTL_MS);
    return created;
  }
  async get(): Promise<Result> {
    const ledger = await this.load(); if (!ledger) return unknown;
    // A save from before saves expired has no alarm yet.
    if (unplayed(ledger) && await this.storage.getAlarm() === null) await this.storage.setAlarm(this.now() + UNPLAYED_TTL_MS);
    return { ok: true, campaign: ledger.campaign };
  }
  // The alarm set at creation: deletes the save if it still never deployed. True when it did.
  async expire(): Promise<boolean> {
    const ledger = await this.storage.get<Ledger>(KEY);
    if (!ledger || !unplayed(ledger)) return false;
    await this.storage.deleteAll();
    return true;
  }
  async startMission(contractId: string, squad: string[], countermeasures: number): Promise<Started> {
    const ledger = await this.load(); if (!ledger) return unknown;
    const missionId = crypto.randomUUID();
    const next = startMission(ledger, missionId, this.now(), contractId, squad, countermeasures, this.random);
    if (!next) return { ok: false, status: 409, error: 'That contract is not on offer, the squad is invalid, or that countermeasures level is locked.' };
    await this.storage.put(KEY, next);
    return { ok: true, missionId, campaign: next.campaign };
  }
  async completeMission(missionId: string, report: MissionReport): Promise<Result> {
    const ledger = await this.load(); if (!ledger) return unknown;
    // Results the active contract cannot hold (another type's field, or more than it has) and badges that contradict
    // the report's own kill count are a bad request.
    const active = ledger.activeMission?.id === missionId ? ledger.activeMission.contract : null;
    if (active && !resultsFit(active, report.results)) return { ok: false, status: 400, error: 'Those results do not fit the contract.' };
    if (active && !reportConsistent(active, report)) return { ok: false, status: 400, error: 'Those badges do not fit the kill count.' };
    const next = completeMission(ledger, missionId, this.now(), report, this.random);
    return next ? this.save(next) : { ok: false, status: 409, error: 'Mission is not active or ended too soon.' };
  }
  async buy(type: Upgrade) { return this.update(c => applyPurchase(c, type), 'Not enough credits or upgrade maxed.'); }
  async equip(loadout: Loadout) { return this.update(c => applyLoadout(c, loadout), 'Unknown loadout.'); }
  async recruit(id: string) { return this.update(c => applyRecruit(c, id), 'Recruit unavailable, roster full, or not enough credits.'); }
  async dismiss(id: string) { return this.update(c => applyDismiss(c, id), 'Unknown operative, or the last one on the roster.'); }
}
