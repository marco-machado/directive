export type Campaign = { version: 2; cash: number; weapon: number; armor: number; completed: number };
export type Upgrade = 'weapon' | 'armor';
export type ActiveMission = { id: string; startedAt: number } | null;
export type Ledger = { campaign: Campaign; activeMission: ActiveMission };

export const PAYOUT = 500;
export const UPGRADE_COST: Record<Upgrade, number> = { weapon: 300, armor: 250 };
export const MAX_LEVEL = 3;
// A contract cannot be cleared faster than this; blocks instant or replayed payout claims.
export const MIN_MISSION_MS = 15_000;

export const freshCampaign = (): Campaign => ({ version: 2, cash: 0, weapon: 0, armor: 0, completed: 0 });
export const isUpgrade = (v: unknown): v is Upgrade => v === 'weapon' || v === 'armor';

export function parseCampaign(text: string | null): Campaign {
  try { return clampCampaign(JSON.parse(text || '{}')); } catch { return freshCampaign(); }
}
export function clampCampaign(data: any): Campaign {
  if (!data || typeof data !== 'object') return freshCampaign();
  const n = (v: unknown, max: number) => typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.floor(v))) : 0;
  return { version: 2, cash: n(data.cash, 1e8), weapon: n(data.weapon, MAX_LEVEL), armor: n(data.armor, MAX_LEVEL), completed: n(data.completed ?? ((data.mission || 1) - 1), 1e6) };
}

export function applyPurchase(c: Campaign, type: Upgrade): Campaign | null {
  const cost = UPGRADE_COST[type];
  if (c[type] >= MAX_LEVEL || c.cash < cost) return null;
  return { ...c, cash: c.cash - cost, [type]: c[type] + 1 };
}
export const applyPayout = (c: Campaign): Campaign => ({ ...c, cash: c.cash + PAYOUT, completed: c.completed + 1 });

export const startMission = (state: Ledger, id: string, now: number): Ledger => ({ ...state, activeMission: { id, startedAt: now } });
export function completeMission(state: Ledger, id: string, now: number): Ledger | null {
  const m = state.activeMission;
  if (!m || m.id !== id || now - m.startedAt < MIN_MISSION_MS) return null;
  return { campaign: applyPayout(state.campaign), activeMission: null };
}
