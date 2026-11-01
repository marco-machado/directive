import { CLASSES, isClass } from './classes.ts';
import type { ClassId } from './classes.ts';
import { pick, shuffle } from './rng.ts';
import type { Rng } from './rng.ts';

export type Operative = { id: string; name: string; cls: ClassId };
export type ContractType = 'assassination' | 'heist' | 'sabotage' | 'escort';
export type Contract = { id: string; type: ContractType; tier: number; seed: number; payout: number; district: string; sector: number };
export type Gear = 'weapon' | 'armor';
export type Upgrade = Gear | ClassId;
export type Campaign = {
  version: 3; cash: number; weapon: number; armor: number; completed: number;
  abilities: Record<ClassId, number>; roster: Operative[]; recruits: Operative[]; offers: Contract[];
};
export type ActiveMission = { id: string; startedAt: number; contract: Contract } | null;
export type Ledger = { campaign: Campaign; activeMission: ActiveMission };

export const CONTRACT_TYPES: readonly ContractType[] = ['assassination', 'heist', 'sabotage', 'escort'];
export const GEAR_COST: Record<Gear, number> = { weapon: 300, armor: 250 };
export const ABILITY_UPGRADE_COST = 200;
export const RECRUIT_COST = 400;
export const MAX_LEVEL = 3;
export const MAX_TIER = 5;
export const ROSTER_CAP = 6;
export const SQUAD_MAX = 4;
export const OFFER_COUNT = 3;
export const RECRUIT_OFFERS = 2;
export const STEALTH_BONUS = .25;
// A contract cannot be cleared faster than this; blocks instant or replayed payout claims.
export const MIN_MISSION_MS = 15_000;

export const upgradeCost = (type: Upgrade) => type === 'weapon' || type === 'armor' ? GEAR_COST[type] : ABILITY_UPGRADE_COST;
export const upgradeLevel = (c: Campaign, type: Upgrade) => type === 'weapon' || type === 'armor' ? c[type] : c.abilities[type];
export const isUpgrade = (v: unknown): v is Upgrade => v === 'weapon' || v === 'armor' || isClass(v);
export const isContractType = (v: unknown): v is ContractType => CONTRACT_TYPES.includes(v as ContractType);

export const contractPayout = (tier: number) => 500 + (tier - 1) * 250;
export const baseTier = (completed: number) => Math.min(MAX_TIER, 1 + Math.floor(completed / 2));
// How hard a tier is for this campaign's squad. Four operatives count for about one tier and the six
// weapon and armor levels for about two more (see scripts/balance.ts); ability levels of the classes on the
// roster add a little. The margin is how many tiers the contract sits above what the squad handles easily.
export type Threat = 'low' | 'moderate' | 'high' | 'extreme';
export function squadRating(c: Campaign) {
  const size = Math.min(SQUAD_MAX, c.roster.length), classes = new Set(c.roster.map(o => o.cls));
  const abilities = [...classes].reduce((sum, cls) => sum + c.abilities[cls], 0);
  return (size - 2) * .5 + (c.weapon + c.armor) / 3 + abilities * .05;
}
export function threatFor(c: Campaign, tier: number): Threat {
  const margin = tier - 1 - squadRating(c);
  return margin <= .5 ? 'low' : margin <= 1.5 ? 'moderate' : margin <= 2.5 ? 'high' : 'extreme';
}
export const missionPayout = (contract: Contract, stealth: boolean) => Math.round(contract.payout * (stealth ? 1 + STEALTH_BONUS : 1));

const DISTRICTS = ['GLASS DISTRICT', 'CHROME QUARTER', 'NEON VERGE', 'KESSLER YARDS', 'DATA WARRENS', 'HALCYON ROW', 'IRON MARKET', 'ORBITAL DOCKS', 'VANTA HEIGHTS', 'SILT CANAL'];
const NAMES = ['KAI', 'NOVA', 'SABLE', 'ORIN', 'JUNO', 'HEX', 'MIRA', 'DACE', 'RIO', 'LUX', 'TALON', 'ECHO', 'IVY', 'CROW', 'ZETA', 'PIKE', 'WREN', 'ONYX', 'SKYE', 'BRAM'];
const STARTERS: Operative[] = [{ id: 'vex', name: 'VEX', cls: 'assault' }, { id: 'rook', name: 'ROOK', cls: 'support' }];
const token = (rng: Rng) => Array.from({ length: 8 }, () => '0123456789abcdefghijklmnopqrstuvwxyz'[Math.floor(rng() * 36)]).join('');

// Until this many contracts are complete, the board offers only the base tier and the one above it.
export const OPENING_CONTRACTS = 2;
export function offerTiers(completed: number): number[] {
  const base = baseTier(completed);
  if (completed < OPENING_CONTRACTS) return [base, base, base + 1];
  // Three consecutive tiers around the base, shifted inward at either end so every offer differs.
  const low = Math.min(MAX_TIER - 2, Math.max(1, base - 1));
  return [low, low + 1, low + 2];
}
// The highest tier on a board dealt after `completed` contracts. Boards are dealt at each deployment.
export const topTier = (completed: number) => Math.max(...offerTiers(completed));
// The next tier a board will add, how many more completed contracts that takes, and how far the campaign is from the
// last unlock to it (0 to 1); null once boards reach MAX_TIER.
export function nextUnlock(completed: number): { tier: number; after: number; progress: number } | null {
  const top = topTier(completed);
  if (top >= MAX_TIER) return null;
  let after = 1, since = completed;
  while (topTier(completed + after) <= top) after++;
  while (since > 0 && topTier(since - 1) === top) since--;
  return { tier: topTier(completed + after), after, progress: (completed - since) / (completed + after - since) };
}
function dealOffers(completed: number, rng: Rng): Contract[] {
  const tiers = offerTiers(completed);
  const types = shuffle(rng, CONTRACT_TYPES);
  return tiers.map((tier, i) => ({ id: token(rng), type: types[i], tier, seed: Math.floor(rng() * 2 ** 31), payout: contractPayout(tier), district: pick(rng, DISTRICTS), sector: 1 + Math.floor(rng() * 99) }));
}
// Recon and Tech carry the only silent tools (sniper shot, EMP).
export const SILENT_CLASSES: readonly ClassId[] = ['recon', 'tech'];
// Until the first contract is completed, the first recruit is always a Recon or a Tech. That covers the
// new campaign's board and the boards dealt by its first deployments, the first ones a payout can afford.
function dealRecruits(c: Campaign, rng: Rng): Operative[] {
  const free = shuffle(rng, NAMES.filter(n => !c.roster.some(o => o.name === n)));
  return free.slice(0, RECRUIT_OFFERS).map((name, i) => ({ id: `r-${token(rng)}`, name, cls: pick(rng, i === 0 && !c.completed ? SILENT_CLASSES : CLASSES) }));
}
// New contract offers and recruits; dealt for a new campaign and after every deployment.
export const dealBoard = (c: Campaign, rng: Rng): Campaign => ({ ...c, offers: dealOffers(c.completed, rng), recruits: dealRecruits(c, rng) });

export function freshCampaign(rng: Rng = Math.random): Campaign {
  return dealBoard({ version: 3, cash: 0, weapon: 0, armor: 0, completed: 0, abilities: { assault: 0, support: 0, recon: 0, tech: 0 }, roster: STARTERS.map(o => ({ ...o })), recruits: [], offers: [] }, rng);
}

export function parseCampaign(text: string | null): Campaign {
  try { return clampCampaign(JSON.parse(text || '{}')); } catch { return freshCampaign(); }
}
const n = (v: unknown, max: number) => typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.floor(v))) : 0;
const label = (v: unknown) => typeof v === 'string' && /^[A-Z0-9 /-]{1,24}$/.test(v) ? v : null;
const ident = (v: unknown) => typeof v === 'string' && /^[a-z0-9-]{1,24}$/.test(v) ? v : null;
function clampOperatives(list: unknown, max: number): Operative[] {
  if (!Array.isArray(list)) return [];
  const out: Operative[] = [];
  for (const o of list) {
    const id = ident(o?.id), name = label(o?.name);
    if (id && name && isClass(o?.cls) && !out.some(p => p.id === id)) out.push({ id, name, cls: o.cls });
  }
  return out.slice(0, max);
}
function clampContract(c: any): Contract | null {
  const id = ident(c?.id), district = label(c?.district);
  if (!id || !district || !isContractType(c?.type)) return null;
  const tier = Math.max(1, n(c.tier, MAX_TIER));
  // Payout always follows the tier, so an imported save cannot carry a richer contract.
  return { id, type: c.type, tier, seed: n(c.seed, 2 ** 31), payout: contractPayout(tier), district, sector: Math.max(1, n(c.sector, 99)) };
}
// Accepts v1 (`mission`), v2 and v3 saves.
export function clampCampaign(data: any, rng: Rng = Math.random): Campaign {
  if (!data || typeof data !== 'object') return freshCampaign(rng);
  const abilities = Object.fromEntries(CLASSES.map(k => [k, n(data.abilities?.[k], MAX_LEVEL)])) as Record<ClassId, number>;
  const roster = clampOperatives(data.roster, ROSTER_CAP);
  const offers = Array.isArray(data.offers) ? data.offers.map(clampContract).filter((c: Contract | null): c is Contract => !!c).slice(0, OFFER_COUNT) : [];
  const campaign: Campaign = {
    version: 3, cash: n(data.cash, 1e8), weapon: n(data.weapon, MAX_LEVEL), armor: n(data.armor, MAX_LEVEL),
    completed: n(data.completed ?? ((data.mission || 1) - 1), 1e6), abilities,
    roster: roster.length ? roster : STARTERS.map(o => ({ ...o })), recruits: clampOperatives(data.recruits, RECRUIT_OFFERS), offers,
  };
  return offers.length ? campaign : dealBoard(campaign, rng);
}

export function applyPurchase(c: Campaign, type: Upgrade): Campaign | null {
  const cost = upgradeCost(type);
  if (upgradeLevel(c, type) >= MAX_LEVEL || c.cash < cost) return null;
  if (type === 'weapon' || type === 'armor') return { ...c, cash: c.cash - cost, [type]: c[type] + 1 };
  return { ...c, cash: c.cash - cost, abilities: { ...c.abilities, [type]: c.abilities[type] + 1 } };
}
export function applyRecruit(c: Campaign, id: string): Campaign | null {
  const recruit = c.recruits.find(r => r.id === id);
  if (!recruit || c.roster.length >= ROSTER_CAP || c.cash < RECRUIT_COST) return null;
  return { ...c, cash: c.cash - RECRUIT_COST, roster: [...c.roster, recruit], recruits: c.recruits.filter(r => r.id !== id) };
}
export function applyDismiss(c: Campaign, id: string): Campaign | null {
  if (c.roster.length <= 1 || !c.roster.some(o => o.id === id)) return null;
  return { ...c, roster: c.roster.filter(o => o.id !== id) };
}
export const applyPayout = (c: Campaign, contract: Contract, stealth: boolean): Campaign => ({ ...c, cash: c.cash + missionPayout(contract, stealth), completed: c.completed + 1 });

export const validSquad = (c: Campaign, squad: readonly string[]) =>
  squad.length >= 1 && squad.length <= SQUAD_MAX && new Set(squad).size === squad.length && squad.every(id => c.roster.some(o => o.id === id));

// Deploying an offer deals a new board, so offers reroll whether the mission is won or lost.
// Restarting the active contract keeps the board as it is.
export function startMission(state: Ledger, id: string, now: number, contractId: string, squad: readonly string[], rng: Rng): Ledger | null {
  if (!validSquad(state.campaign, squad)) return null;
  const offer = state.campaign.offers.find(o => o.id === contractId);
  if (offer) return { campaign: dealBoard(state.campaign, rng), activeMission: { id, startedAt: now, contract: offer } };
  const active = state.activeMission?.contract;
  if (active?.id === contractId) return { ...state, activeMission: { id, startedAt: now, contract: active } };
  return null;
}
export function completeMission(state: Ledger, id: string, now: number, stealth: boolean): Ledger | null {
  const m = state.activeMission;
  if (!m || m.id !== id || now - m.startedAt < MIN_MISSION_MS) return null;
  return { campaign: applyPayout(state.campaign, m.contract, stealth), activeMission: null };
}
