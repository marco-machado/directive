import { CLASSES, isClass } from './classes.ts';
import type { ClassId } from './classes.ts';
import { pick, shuffle } from './rng.ts';
import type { Rng } from './rng.ts';

export type Operative = { id: string; name: string; cls: ClassId };
export type ContractType = 'assassination' | 'heist' | 'sabotage' | 'escort' | 'elimination' | 'intercept' | 'smash' | 'surveillance' | 'jailbreak';
// `patrols` caps the guards that walk a route (the rest of the district is unchanged); only contract 01 sets it.
// `modifiers` change how a contract plays; the Worker deals them with the offer.
export type Contract = { id: string; type: ContractType; tier: number; seed: number; payout: number; district: string; sector: number; patrols?: number; modifiers?: Modifier[] };
// Contract modifiers: Lockdown seals the exits LOCKDOWN_SECONDS after the first alarm, and the contract fails unless the
// squad is out; under a no-kill clause each kill but a target cuts NO_KILL_CUT of the fee, down to NO_KILL_FLOOR of it;
// an unknown target passes as a guard until an operative watches it, unaware, within IDENTIFY_RANGE for IDENTIFY_SECONDS,
// or Recon marks it; under carry, a heist's prize is a package an operative carries out at CARRY_SPEED of a walk, hands
// full (no firing, no ability). Each offer after the opening carries one with MODIFIER_CHANCE, of those that fit its type and are
// open at its tier (MODIFIER_UNLOCK, from MODIFIER_TIER); each raises the fee by MODIFIER_PAY.
export type Modifier = 'lockdown' | 'nokill' | 'unknown' | 'carry' | 'through' | 'called';
export const MODIFIERS: readonly Modifier[] = ['lockdown', 'nokill', 'unknown', 'carry', 'through', 'called'];
export const MODIFIER_FITS: Record<Modifier, readonly ContractType[]> = {
  lockdown: ['assassination', 'heist', 'sabotage', 'escort', 'elimination', 'intercept', 'surveillance', 'jailbreak'],
  // Smash and grab runs a lockdown clock of its own.
  nokill: ['assassination', 'heist', 'sabotage', 'escort', 'intercept', 'smash', 'jailbreak'], // Elimination is all kills
  unknown: ['assassination'],
  carry: ['heist'],
  // Two endings: a through-run extracts at the corner opposite the start (an intercept's courier route is planned
  // around the start); a called extraction has none until the squad calls a pickup, PICKUP_SECONDS out.
  through: ['assassination', 'heist', 'sabotage', 'escort', 'elimination', 'smash', 'surveillance', 'jailbreak'],
  called: ['assassination', 'heist', 'sabotage', 'escort', 'elimination', 'intercept', 'smash', 'surveillance', 'jailbreak'],
};
export const MODIFIER_UNLOCK: Record<Modifier, number> = { lockdown: 2, nokill: 2, unknown: 3, carry: 2, through: 2, called: 2 };
export const IDENTIFY_RANGE = 5, IDENTIFY_SECONDS = 2;
// Carry: the carrier's share of a walk; a squadmate sent on its own to stand within HANDOVER_REACH of a standing carrier
// takes the package after HANDOVER_SECONDS; a dropped one is picked up by standing within PICKUP_REACH of it.
export const PICKUP_SECONDS = 10;
export const CARRY_SPEED = .75, HANDOVER_REACH = 1, HANDOVER_SECONDS = 1.5, PICKUP_REACH = .8;
export const MODIFIER_TIER = 2, MODIFIER_CHANCE = 1 / 3, MODIFIER_PAY = .2, MAX_MODIFIERS = 2;
export const LOCKDOWN_SECONDS = 45;
export const NO_KILL_CUT = .15, NO_KILL_FLOOR = .25;
export const isModifier = (v: unknown): v is Modifier => MODIFIERS.includes(v as Modifier);
export const hasModifier = (c: Pick<Contract, 'modifiers'> | null | undefined, m: Modifier) => !!c?.modifiers?.includes(m);
export type Gear = 'weapon' | 'armor';
export type Upgrade = Gear | ClassId;
// How the squad's gear levels are spent, switched freely at headquarters: weapons that pierce (damage), are suppressed
// (a hostile that survives a hit turns suspicious instead of raising the alarm) or extended (range); plating that is
// heavy (health) or light (hostiles take longer to notice the squad).
export type WeaponMode = 'piercing' | 'suppressed' | 'extended';
export type ArmorMode = 'heavy' | 'light';
export type Loadout = { weapon: WeaponMode; armor: ArmorMode };
export const WEAPON_MODES: readonly WeaponMode[] = ['piercing', 'suppressed', 'extended'];
export const ARMOR_MODES: readonly ArmorMode[] = ['heavy', 'light'];
export const DEFAULT_LOADOUT: Loadout = { weapon: 'piercing', armor: 'heavy' };
// Badges a completed contract can earn, each counting toward clearance: never raising the alarm (ghost), no operative
// downed (untouched), extracting under par time (swift), killing no hostile but an assassination target (bloodless), and
// downing every hostile the district started with (purge).
export type Badge = 'ghost' | 'untouched' | 'swift' | 'bloodless' | 'purge';
export const BADGES: readonly Badge[] = ['ghost', 'untouched', 'swift', 'bloodless', 'purge'];
export const isBadge = (v: unknown): v is Badge => BADGES.includes(v as Badge);
// The badges a contract type can earn. Elimination's goal is Purge, and it can never be Bloodless, so it has neither.
export const badgesFor = (type: ContractType): readonly Badge[] => type === 'elimination' ? BADGES.filter(b => b !== 'bloodless' && b !== 'purge') : BADGES;
// Per-contract results a won contract can report beyond the badges: caches taken, prisoners rescued, executives tagged.
export type ResultField = 'caches' | 'prisoners' | 'tagged';
export const RESULT_FIELDS: readonly ResultField[] = ['caches', 'prisoners', 'tagged'];
export type MissionResults = Partial<Record<ResultField, number>>;
// What the client reports when a contract is won.
// `kills` counts hostiles killed but a target, for a no-kill clause (an older client reports none).
export type MissionReport = { stealth: boolean; badges: Badge[]; results: MissionResults; kills?: number };
// What a contract type pays beyond its credits, from the one result it reports (`field`, at most `max(contract)`):
// `bonus` credits for each count past `free`, an operative who joins the roster once the count reaches `operative`
// (RECRUIT_COST credits instead when the roster is full), and intel on the next contract once it reaches `intel`.
// A threshold is a count, or one that depends on the contract (Jailbreak's operative waits in its last cell).
export type Threshold = number | ((c: Contract) => number);
export type RewardSpec = { field: ResultField; max: (c: Contract) => number; free?: number; bonus?: number; operative?: Threshold; intel?: Threshold };
export const thresholdFor = (t: Threshold, c: Contract) => typeof t === 'function' ? t(c) : t;
export type RewardTable = Partial<Record<ContractType, RewardSpec>>;
// Filled in by the contract types that report results. Smash and grab: one of its CACHES is the contract, and each
// one past it pays CACHE_BONUS.
export const CACHES = 3, CACHE_BONUS = 200;
// Surveillance: tag two of its EXECUTIVES (keep one, unaware, in sight within TAG_RANGE for TAG_SECONDS, or let Recon
// mark it); tagging all of them earns intel on the next contract.
export const EXECUTIVES = 3, EXECUTIVES_NEEDED = 2, TAG_RANGE = 8, TAG_SECONDS = 3;
// Jailbreak: prisoners in separate cells (two, three from tier 5); one brought out is the contract, each one past it
// pays PRISONER_BONUS, and the last cell holds an operative, who joins the roster when every prisoner gets out.
export const PRISONER_BONUS = 250;
export const prisonerCount = (tier: number) => tier >= 5 ? 3 : 2;
export const REWARDS: RewardTable = {
  jailbreak: { field: 'prisoners', max: c => prisonerCount(c.tier), free: 1, bonus: PRISONER_BONUS, operative: c => prisonerCount(c.tier) },
  smash: { field: 'caches', max: () => CACHES, free: 1, bonus: CACHE_BONUS },
  surveillance: { field: 'tagged', max: () => EXECUTIVES, intel: EXECUTIVES },
};
// Smash and grab's clock: opening the first cache seals the exits this many seconds later.
export const smashSeconds = (tier: number) => 30 + 5 * tier;
// What a won contract earned beyond its payout.
export type Reward = { credits: number; operative: boolean; intel: boolean };
export const NO_REWARD: Reward = { credits: 0, operative: false, intel: false };
// The campaign's shape; the Durable Object upgrades a ledger saved in an older one when it reads it (upgradeLedger).
export const CAMPAIGN_VERSION = 8;
export type Campaign = {
  version: typeof CAMPAIGN_VERSION; cash: number; weapon: number; armor: number; completed: number; loadout: Loadout; badges: Record<Badge, number>;
  countermeasures: number; // the highest Countermeasures level cleared with a badge
  abilities: Record<ClassId, number>; roster: Operative[]; recruits: Operative[]; offers: Contract[];
  dealt: ContractType[]; // the contract types that have appeared on a board, so a newly unlocked one is guaranteed a place
  intel: boolean; // a reward waiting for the next deployment: its district's patrol routes are known from the start
};
// `intel`: the deployment spent an intel reward, so a restart keeps the routes known.
export type ActiveMission = { id: string; startedAt: number; contract: Contract; countermeasures: number; intel?: boolean } | null;
export type Ledger = { campaign: Campaign; activeMission: ActiveMission };

export const CONTRACT_TYPES: readonly ContractType[] = ['assassination', 'heist', 'sabotage', 'escort', 'elimination', 'intercept', 'smash', 'surveillance', 'jailbreak'];
// The base tier at which the board starts dealing each contract type. The first board dealt after a type unlocks always
// includes it.
export type UnlockTiers = Record<ContractType, number>;
export const UNLOCK_TIER: UnlockTiers = { assassination: 1, heist: 1, sabotage: 1, escort: 1, elimination: 2, intercept: 2, smash: 3, surveillance: 3, jailbreak: 4 };
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
export const isLoadout = (v: unknown): v is Loadout => {
  const l = v as Partial<Loadout> | null;
  return !!l && typeof l === 'object' && WEAPON_MODES.includes(l.weapon!) && ARMOR_MODES.includes(l.armor!);
};
export const isContractType = (v: unknown): v is ContractType => CONTRACT_TYPES.includes(v as ContractType);
// Whether a report's results fit the contract: only its type's field, and never more than the contract holds.
export function resultsFit(contract: Contract, results: MissionResults, rewards: RewardTable = REWARDS) {
  const spec = rewards[contract.type];
  return RESULT_FIELDS.every(f => results[f] === undefined || (spec?.field === f && results[f]! <= spec.max(contract)));
}
// What the results earn (nothing for a type without rewards, or an older client that sends none).
export function rewardFor(contract: Contract, results: MissionResults, rewards: RewardTable = REWARDS): Reward {
  const spec = rewards[contract.type], count = spec ? results[spec.field] ?? 0 : 0;
  if (!spec) return NO_REWARD;
  return {
    credits: Math.max(0, count - (spec.free ?? 0)) * (spec.bonus ?? 0),
    operative: spec.operative !== undefined && count >= thresholdFor(spec.operative, contract), intel: spec.intel !== undefined && count >= thresholdFor(spec.intel, contract),
  };
}

export const contractPayout = (tier: number, modifiers = 0) => Math.round((500 + (tier - 1) * 250) * (1 + MODIFIER_PAY * modifiers));
// Clearance: each completed contract earns CONTRACT_POINTS and each badge BADGE_POINTS (half a contract); the base
// tier rises every TIER_POINTS, so every two contracts without badges.
export const CONTRACT_POINTS = 2, BADGE_POINTS = 1, TIER_POINTS = 4;
export type Progress = Pick<Campaign, 'completed' | 'badges'>;
export const clearancePoints = (p: Progress) => CONTRACT_POINTS * p.completed + BADGE_POINTS * BADGES.reduce((sum, b) => sum + p.badges[b], 0);
export const baseTier = (points: number) => Math.min(MAX_TIER, 1 + Math.floor(points / TIER_POINTS));
// Swift: extract within this many seconds of mission time, by contract type, plus PAR_PER_TIER for each tier above the first.
export const PAR_SECONDS: Record<ContractType, number> = { assassination: 18, heist: 28, sabotage: 32, escort: 28, elimination: 45, intercept: 20, smash: 30, surveillance: 30, jailbreak: 40 };
export const PAR_PER_TIER = 12;
export const parSeconds = (type: ContractType, tier: number) => PAR_SECONDS[type] + PAR_PER_TIER * (tier - 1);
// A client's report of a won contract, checked: only known badges, and Ghost exactly when the alarm never sounded (so an
// older client that reports no badges still earns it); results only in known fields, as whole counts. Null when it is
// malformed. Whether the results fit the contract is checked against it (resultsFit).
export function missionReport(stealth: unknown, badges: unknown = [], results: unknown = {}, kills: unknown = 0): MissionReport | null {
  if (!Array.isArray(badges) || !badges.every(isBadge)) return null;
  if (!Number.isInteger(kills) || (kills as number) < 0 || (kills as number) > 999) return null;
  if (!results || typeof results !== 'object' || Array.isArray(results)) return null;
  const entries = Object.entries(results);
  if (!entries.every(([k, v]) => RESULT_FIELDS.includes(k as ResultField) && Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 99)) return null;
  const quiet = stealth === true;
  const report: MissionReport = { stealth: quiet, badges: BADGES.filter(b => b === 'ghost' ? quiet : badges.includes(b)), results: Object.fromEntries(entries) as MissionResults };
  return kills ? { ...report, kills: kills as number } : report;
}
// How hard a tier is for this campaign's squad. Four operatives count for about one tier and the six
// weapon and armor levels for a little over one more (see scripts/balance.ts); ability levels of the classes on the
// roster add a little. The margin is how many tiers the contract sits above what the squad handles easily.
export type Threat = 'low' | 'moderate' | 'high' | 'extreme';
export function squadRating(c: Campaign) {
  const size = Math.min(SQUAD_MAX, c.roster.length), classes = new Set(c.roster.map(o => o.cls));
  const abilities = [...classes].reduce((sum, cls) => sum + c.abilities[cls], 0);
  return (size - 2) * .5 + (c.weapon + c.armor) / 5 + abilities * .05;
}
export function threatFor(c: Campaign, tier: number): Threat {
  const margin = tier - 1 - squadRating(c);
  return margin <= .5 ? 'low' : margin <= 1.5 ? 'moderate' : margin <= 2.5 ? 'high' : 'extreme';
}
// Countermeasures: an opt-in difficulty ladder for a squad with nothing left to buy. Level 1 opens once every upgrade is
// maxed; clearing the highest open level with at least one badge opens the next. It pays no credits.
export const MAX_COUNTERMEASURES = 3;
export const fullyUpgraded = (c: Campaign) => c.weapon >= MAX_LEVEL && c.armor >= MAX_LEVEL && CLASSES.every(k => c.abilities[k] >= MAX_LEVEL);
export const unlockedCountermeasures = (c: Campaign) => fullyUpgraded(c) ? Math.min(MAX_COUNTERMEASURES, c.countermeasures + 1) : 0;
export const noKillShare = (contract: Contract, kills = 0) => hasModifier(contract, 'nokill') ? Math.max(NO_KILL_FLOOR, 1 - NO_KILL_CUT * kills) : 1;
export const missionPayout = (contract: Contract, stealth: boolean, kills = 0) => Math.round(contract.payout * noKillShare(contract, kills) * (stealth ? 1 + STEALTH_BONUS : 1));

const DISTRICTS = ['GLASS DISTRICT', 'CHROME QUARTER', 'NEON VERGE', 'KESSLER YARDS', 'DATA WARRENS', 'HALCYON ROW', 'IRON MARKET', 'ORBITAL DOCKS', 'VANTA HEIGHTS', 'SILT CANAL'];
const NAMES = ['KAI', 'NOVA', 'SABLE', 'ORIN', 'JUNO', 'HEX', 'MIRA', 'DACE', 'RIO', 'LUX', 'TALON', 'ECHO', 'IVY', 'CROW', 'ZETA', 'PIKE', 'WREN', 'ONYX', 'SKYE', 'BRAM'];
const STARTERS: Operative[] = [{ id: 'vex', name: 'VEX', cls: 'assault' }, { id: 'rook', name: 'ROOK', cls: 'support' }];
const token = (rng: Rng) => Array.from({ length: 8 }, () => '0123456789abcdefghijklmnopqrstuvwxyz'[Math.floor(rng() * 36)]).join('');

// Until this many contracts are complete, the board offers only the first two tiers, whatever badges were earned.
export const OPENING_CONTRACTS = 2;
export function offerTiers(p: Progress): number[] {
  if (p.completed < OPENING_CONTRACTS) return [1, 1, 2];
  const base = baseTier(clearancePoints(p));
  // Three consecutive tiers around the base, shifted inward at either end so every offer differs.
  const low = Math.min(MAX_TIER - 2, Math.max(1, base - 1));
  return [low, low + 1, low + 2];
}
// Contract 01 is the same hand-checked district for every campaign: one patrol to read and a quiet way round it.
// It stays first on the board until a contract is completed, so a failed first run can try it again.
export const FIRST_CONTRACT = { type: 'heist', tier: 1, seed: 10492675, district: 'GLASS DISTRICT', sector: 1, patrols: 1 } as const satisfies Omit<Contract, 'id' | 'payout'>;
// The highest tier on a board dealt with this progress. Boards are dealt at each deployment.
export const topTier = (p: Progress) => Math.max(...offerTiers(p));
// The next tier a board will add: during the opening, once the contracts left in it are done; after it, once the
// clearance points reach the next threshold, `points` more (`contracts` contracts without badges). `progress` (0 to 1)
// is how far the campaign has come from the last unlock. Null once boards reach MAX_TIER.
export function nextUnlock(p: Progress): { tier: number; points: number; contracts: number; progress: number } | null {
  const top = topTier(p);
  if (top >= MAX_TIER) return null;
  if (p.completed < OPENING_CONTRACTS) {
    const contracts = OPENING_CONTRACTS - p.completed;
    return { tier: topTier({ ...p, completed: OPENING_CONTRACTS }), points: CONTRACT_POINTS * contracts, contracts, progress: p.completed / OPENING_CONTRACTS };
  }
  // After the opening the top tier is the base tier plus one, so the next one comes with the next base tier.
  const now = clearancePoints(p), points = TIER_POINTS * baseTier(now) - now;
  return { tier: top + 1, points, contracts: Math.ceil(points / CONTRACT_POINTS), progress: 1 - points / TIER_POINTS };
}
// The contract types the board deals at this progress, and the next type to unlock: its tier, the clearance points
// left (`contracts` contracts without badges) and how far the campaign has come since the last tier (0 to 1). Null once
// every type is unlocked.
export const unlockedTypes = (p: Progress, unlock: UnlockTiers = UNLOCK_TIER) => {
  const base = baseTier(clearancePoints(p));
  return CONTRACT_TYPES.filter(t => unlock[t] <= base);
};
export function nextTypeUnlock(p: Progress, unlock: UnlockTiers = UNLOCK_TIER): { type: ContractType; tier: number; points: number; contracts: number; progress: number } | null {
  const now = clearancePoints(p), base = baseTier(now);
  const locked = CONTRACT_TYPES.filter(t => unlock[t] > base).sort((a, b) => unlock[a] - unlock[b]);
  if (!locked.length) return null;
  const type = locked[0], tier = unlock[type], goal = TIER_POINTS * (tier - 1), points = goal - now;
  // Progress runs from the tier that unlocked the last type (or the start of the campaign).
  const start = TIER_POINTS * (Math.max(1, ...CONTRACT_TYPES.map(t => unlock[t]).filter(u => u <= base)) - 1);
  return { type, tier, points, contracts: Math.ceil(points / CONTRACT_POINTS), progress: (now - start) / (goal - start) };
}
type Dealing = Progress & Pick<Campaign, 'dealt'>;
// Each offer gets a different unlocked type where there are enough; unlocked types never dealt before come first.
function dealOffers(p: Dealing, rng: Rng, unlock: UnlockTiers = UNLOCK_TIER): Contract[] {
  const tiers = offerTiers(p), first = p.completed ? null : FIRST_CONTRACT;
  const open = unlockedTypes(p, unlock).filter(t => t !== first?.type), fresh = open.filter(t => !p.dealt.includes(t));
  const pool = [...shuffle(rng, fresh), ...shuffle(rng, open.filter(t => !fresh.includes(t)))];
  const need = tiers.length - (first ? 1 : 0), types = shuffle(rng, pool.slice(0, need));
  while (types.length < need) types.push(pick(rng, open));
  return tiers.map((tier, i) => {
    const id = token(rng);
    if (first && i === 0) return { id, ...first, payout: contractPayout(first.tier) };
    const type = types[first ? i - 1 : i], seed = Math.floor(rng() * 2 ** 31), district = pick(rng, DISTRICTS), sector = 1 + Math.floor(rng() * 99);
    const fits = MODIFIERS.filter(m => MODIFIER_FITS[m].includes(type) && tier >= MODIFIER_UNLOCK[m]);
    const modifiers = p.completed >= OPENING_CONTRACTS && fits.length && rng() < MODIFIER_CHANCE ? [pick(rng, fits)] : [];
    const contract: Contract = { id, type, tier, seed, payout: contractPayout(tier, modifiers.length), district, sector };
    return modifiers.length ? { ...contract, modifiers } : contract;
  });
}
// Recon and Tech carry the only silent tools (sniper shot, EMP).
export const SILENT_CLASSES: readonly ClassId[] = ['recon', 'tech'];
// Until the first contract is completed, the first recruit is always a Recon or a Tech. That covers the
// new campaign's board and the boards dealt by its first deployments, the first ones a payout can afford.
// An operative who joins without being hired (a rescued prisoner), with a name nobody on the roster or the board has.
function freeOperative(c: Campaign, rng: Rng): Operative {
  const taken = [...c.roster, ...c.recruits].map(o => o.name), name = pick(rng, NAMES.filter(n => !taken.includes(n))) ?? pick(rng, NAMES);
  return { id: `p-${token(rng)}`, name, cls: pick(rng, CLASSES) };
}
function dealRecruits(c: Campaign, rng: Rng): Operative[] {
  const free = shuffle(rng, NAMES.filter(n => !c.roster.some(o => o.name === n)));
  return free.slice(0, RECRUIT_OFFERS).map((name, i) => ({ id: `r-${token(rng)}`, name, cls: pick(rng, i === 0 && !c.completed ? SILENT_CLASSES : CLASSES) }));
}
const withDealt = (c: Campaign, offers: Contract[]): Campaign => ({ ...c, offers, dealt: CONTRACT_TYPES.filter(t => c.dealt.includes(t) || offers.some(o => o.type === t)) });
// New contract offers and recruits; dealt for a new campaign and after every deployment.
export const dealBoard = (c: Campaign, rng: Rng, unlock: UnlockTiers = UNLOCK_TIER): Campaign => ({ ...withDealt(c, dealOffers(c, rng, unlock)), recruits: dealRecruits(c, rng) });

const noBadges = () => Object.fromEntries(BADGES.map(b => [b, 0])) as Record<Badge, number>;
export function freshCampaign(rng: Rng = Math.random): Campaign {
  return dealBoard({ version: CAMPAIGN_VERSION, cash: 0, weapon: 0, armor: 0, completed: 0, loadout: { ...DEFAULT_LOADOUT }, badges: noBadges(), countermeasures: 0, abilities: { assault: 0, support: 0, recon: 0, tech: 0 }, roster: STARTERS.map(o => ({ ...o })), recruits: [], offers: [], dealt: [], intel: false }, rng);
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
  // Payout always follows the tier and the modifiers, so an imported save cannot carry a richer contract. Modifiers are
  // only known ones that fit the type and are open at its tier, at most MAX_MODIFIERS.
  const modifiers = Array.isArray(c.modifiers) ? MODIFIERS.filter(m => c.modifiers.includes(m) && MODIFIER_FITS[m].includes(c.type) && tier >= MODIFIER_UNLOCK[m]).slice(0, MAX_MODIFIERS) : [];
  let contract: Contract = { id, type: c.type, tier, seed: n(c.seed, 2 ** 31), payout: contractPayout(tier, modifiers.length), district, sector: Math.max(1, n(c.sector, 99)) };
  if (modifiers.length) contract = { ...contract, modifiers };
  return c.patrols === undefined ? contract : { ...contract, patrols: n(c.patrols, 3 + MAX_TIER) };
}
// Accepts v1 (`mission`) to v8 saves. A save from before v7 has no `dealt`, so the types its progress unlocks count as
// dealt: only a type unlocked later is guaranteed a place on a board.
export function clampCampaign(data: any, rng: Rng = Math.random): Campaign {
  if (!data || typeof data !== 'object') return freshCampaign(rng);
  const abilities = Object.fromEntries(CLASSES.map(k => [k, n(data.abilities?.[k], MAX_LEVEL)])) as Record<ClassId, number>;
  const roster = clampOperatives(data.roster, ROSTER_CAP);
  const offers = Array.isArray(data.offers) ? data.offers.map(clampContract).filter((c: Contract | null): c is Contract => !!c).slice(0, OFFER_COUNT) : [];
  const loadout: Loadout = {
    weapon: WEAPON_MODES.includes(data.loadout?.weapon) ? data.loadout.weapon : DEFAULT_LOADOUT.weapon,
    armor: ARMOR_MODES.includes(data.loadout?.armor) ? data.loadout.armor : DEFAULT_LOADOUT.armor,
  };
  const progress = { completed: n(data.completed ?? ((data.mission || 1) - 1), 1e6), badges: Object.fromEntries(BADGES.map(b => [b, n(data.badges?.[b], 1e6)])) as Record<Badge, number> };
  const dealt = Array.isArray(data.dealt) ? CONTRACT_TYPES.filter(t => data.dealt.includes(t)) : unlockedTypes(progress);
  const campaign: Campaign = {
    version: CAMPAIGN_VERSION, cash: n(data.cash, 1e8), weapon: n(data.weapon, MAX_LEVEL), armor: n(data.armor, MAX_LEVEL), loadout,
    badges: progress.badges, countermeasures: n(data.countermeasures, MAX_COUNTERMEASURES), completed: progress.completed, abilities,
    roster: roster.length ? roster : STARTERS.map(o => ({ ...o })), recruits: clampOperatives(data.recruits, RECRUIT_OFFERS), offers, dealt, intel: data.intel === true,
  };
  return offers.length ? campaign : dealBoard(campaign, rng);
}

// A ledger saved in an older campaign shape, brought up to date. A mission in flight keeps its claim on the payout.
export function upgradeLedger(ledger: Ledger, rng: Rng): Ledger {
  const m = ledger.activeMission as any, contract = m && clampContract(m.contract);
  const keep = contract && typeof m.id === 'string' && Number.isFinite(m.startedAt);
  const active = keep ? { id: m.id, startedAt: m.startedAt, contract, countermeasures: n(m.countermeasures, MAX_COUNTERMEASURES) } : null;
  return { campaign: clampCampaign(ledger.campaign, rng), activeMission: active && m.intel === true ? { ...active, intel: true } : active };
}

// Switching how the gear is spent is free.
export const applyLoadout = (c: Campaign, l: Loadout): Campaign => ({ ...c, loadout: { weapon: l.weapon, armor: l.armor } });
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
const isFirstContract = (o: Contract) => o.seed === FIRST_CONTRACT.seed && o.patrols === FIRST_CONTRACT.patrols;
// The board was dealt at deploy, before this payout counted, so the first payout deals new offers in place of one that
// still holds contract 01. Recruits stay: they are what the first payout can buy.
// Clearing the highest open Countermeasures level (`countermeasures`, 0 for none) with a badge opens the next.
// Rewards beyond credits come from the report's results (rewardFor); an operative is a new recruit, or RECRUIT_COST
// credits when the roster is full.
export function applyPayout(c: Campaign, contract: Contract, countermeasures: number, report: MissionReport, rng: Rng, rewards: RewardTable = REWARDS): Campaign {
  const reward = rewardFor(contract, report.results, rewards), full = c.roster.length >= ROSTER_CAP;
  const joined = reward.operative && !full ? freeOperative(c, rng) : null;
  c = { ...c, cash: c.cash + reward.credits + (reward.operative && full ? RECRUIT_COST : 0), roster: joined ? [...c.roster, joined] : c.roster, intel: c.intel || reward.intel };
  const badges = { ...c.badges };
  const earned = report.badges.filter(b => badgesFor(contract.type).includes(b));
  for (const b of earned) badges[b]++;
  const cleared = countermeasures > c.countermeasures && countermeasures === unlockedCountermeasures(c) && earned.length > 0;
  const paid = { ...c, cash: c.cash + missionPayout(contract, report.stealth, report.kills), completed: c.completed + 1, badges, countermeasures: cleared ? countermeasures : c.countermeasures };
  return c.offers.some(isFirstContract) ? withDealt(paid, dealOffers(paid, rng)) : paid;
}

export const validSquad = (c: Campaign, squad: readonly string[]) =>
  squad.length >= 1 && squad.length <= SQUAD_MAX && new Set(squad).size === squad.length && squad.every(id => c.roster.some(o => o.id === id));

// Deploying an offer deals a new board, so offers reroll whether the mission is won or lost.
// Restarting the active contract keeps the board as it is. Either way the Countermeasures level must be open.
// An intel reward is spent by the next deployment, and a restart of it keeps the intel.
export function startMission(state: Ledger, id: string, now: number, contractId: string, squad: readonly string[], countermeasures: number, rng: Rng): Ledger | null {
  if (!validSquad(state.campaign, squad) || countermeasures > unlockedCountermeasures(state.campaign)) return null;
  const offer = state.campaign.offers.find(o => o.id === contractId), intel = (on: boolean) => on ? { intel: true } : {};
  if (offer) return { campaign: { ...dealBoard(state.campaign, rng), intel: false }, activeMission: { id, startedAt: now, contract: offer, countermeasures, ...intel(state.campaign.intel) } };
  const active = state.activeMission?.contract;
  if (active?.id === contractId) return { ...state, activeMission: { id, startedAt: now, contract: active, countermeasures, ...intel(!!state.activeMission?.intel) } };
  return null;
}
export function completeMission(state: Ledger, id: string, now: number, report: MissionReport, rng: Rng, rewards: RewardTable = REWARDS): Ledger | null {
  const m = state.activeMission;
  if (!m || m.id !== id || now - m.startedAt < MIN_MISSION_MS || !resultsFit(m.contract, report.results, rewards)) return null;
  return { campaign: applyPayout(state.campaign, m.contract, m.countermeasures, report, rng, rewards), activeMission: null };
}
