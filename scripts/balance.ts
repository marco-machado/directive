// Headless balance check: two bots play every contract type and tier with three rosters and print win rate, quiet wins,
// alarm rate, median time and HP lost, then how each bot does against the balance targets.
// - no-tactics: select all, click the objective, then extraction (scripts/bots.ts).
// - tactical: routes around vision cones and clears blockers quietly, going loud only when it must (scripts/tactical.ts).
// Run: node --experimental-transform-types scripts/balance.ts [--seeds 12] [--bot both|no-tactics|tactical]
//      [--roster starters|four|four+max] [--tiers 1,3] [--types heist,escort] [--quiet-only] [--loadout suppressed/light]
// With --loadouts it instead plays the fully upgraded four with every loadout (tiers 4 and 5 unless --tiers says), and with
// --cm 0,1,2,3 it plays the fully upgraded four at those Countermeasures levels (tier 5 unless --tiers says).
import { Simulation } from '../src/game/simulation.ts';
import { ARMOR_MODES, BADGES, CONTRACT_TYPES, contractPayout, freshCampaign, isLoadout, MAX_COUNTERMEASURES, MAX_LEVEL, MAX_TIER, WEAPON_MODES } from '../src/game/campaign.ts';
import type { Badge, Campaign, ContractType, Loadout } from '../src/game/campaign.ts';
import { mulberry32 } from '../src/game/rng.ts';
import { noTactics } from './bots.ts';
import type { Bot } from './bots.ts';
import { tactical } from './tactical.ts';

const option = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const SEEDS = Number(option('seeds') ?? 12);
const TIERS = option('tiers')?.split(',').map(Number) ?? Array.from({ length: MAX_TIER }, (_, i) => i + 1);
const TYPES = (option('types')?.split(',') ?? CONTRACT_TYPES) as ContractType[];
const QUIET_ONLY = process.argv.includes('--quiet-only');
const [weapon, armor] = option('loadout')?.split('/') ?? [], LOADOUT = option('loadout') ? { weapon, armor } : null;
if (LOADOUT && !isLoadout(LOADOUT)) throw new Error(`Unknown loadout ${option('loadout')}: give weapon/armor, for example suppressed/light.`);
const TIME_LIMIT = 300; // seconds of mission time before the run counts as a loss
const DT = 1 / 30;
const THINK = .25;      // a bot looks at the field this often

const BOTS: Record<string, Bot> = { 'no-tactics': noTactics, tactical };
const BOT_NAMES = option('bot') && option('bot') !== 'both' ? [option('bot')!] : Object.keys(BOTS);
const four = (['assault', 'support', 'recon', 'tech'] as const).map((cls, i) => ({ id: `o${i}`, name: `OP${i}`, cls }));
const ROSTERS: { name: string; extra: Partial<Campaign> }[] = [
  { name: 'starters', extra: {} },
  { name: 'four', extra: { roster: four } },
  { name: 'four+max', extra: { roster: four, weapon: MAX_LEVEL, armor: MAX_LEVEL, abilities: { assault: MAX_LEVEL, support: MAX_LEVEL, recon: MAX_LEVEL, tech: MAX_LEVEL } } },
];
// Mean win rate over the contract types, in percent.
const TARGETS = [
  { bot: 'no-tactics', roster: 'four+max', tier: 5, min: 40, max: 60 },
  { bot: 'tactical', roster: 'four+max', tier: 5, min: 85, max: 100 },
  { bot: 'no-tactics', roster: 'starters', tier: 1, min: 78, max: 88 },
  { bot: 'tactical', roster: 'starters', tier: 1, min: 90, max: 100 },
];

type Run = { win: boolean; alarm: boolean; time: number; hpLost: number; reason: string; badges: Badge[] };

function play(bot: Bot, type: ContractType, tier: number, seed: number, extra: Partial<Campaign>, countermeasures = 0): Run {
  const contract = { id: 'c', type, tier, seed, payout: contractPayout(tier), district: 'GLASS DISTRICT', sector: 1 };
  const sim = new Simulation({ ...freshCampaign(mulberry32(1)), ...extra, offers: [contract] });
  sim.chooseCountermeasures(countermeasures);
  sim.deploy();
  const think = bot(sim, { quietOnly: QUIET_ONLY });
  let wait = 0;
  while (sim.phase === 'mission' && sim.time < TIME_LIMIT) {
    if ((wait -= DT) <= 0) { wait = THINK; think(); }
    sim.update(DT);
  }
  const team = sim.units.filter(u => u.faction === 'squad');
  const hpLost = 1 - team.reduce((s, u) => s + u.hp, 0) / team.reduce((s, u) => s + u.maxHp, 0);
  return { win: sim.result === 'success', alarm: sim.detected, time: sim.time, hpLost, reason: sim.result ? sim.failReason : 'timeout', badges: sim.getSnapshot().badges };
}

const withLoadout = (extra: Partial<Campaign>, loadout: Loadout | null = LOADOUT as Loadout | null) => loadout ? { ...extra, loadout } : extra;
const pct = (n: number, of: number) => `${Math.round(100 * n / of)}%`.padStart(4);
const median = (xs: number[]) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const seeds = Array.from({ length: SEEDS }, (_, k) => 1000 + k * 7919);
const wins = new Map<string, number[]>(); // `${bot}|${roster}|${tier}` → win rate per contract type
const earned = new Map<string, Run[]>(); // `${bot}|${roster}` → its wins, for the badge rates

const typesLabel = TYPES.length === CONTRACT_TYPES.length ? 'the four contract types' : TYPES.join(', ');
const average = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const checkTarget = (t: typeof TARGETS[number], v: number, note = '') =>
  console.log(`${v >= t.min && v <= t.max ? 'PASS' : 'FAIL'}  ${t.bot.padEnd(11)} ${t.roster.padEnd(9)} tier ${t.tier}: ${Math.round(v)}%${note} (target ${t.max >= 100 ? `${t.min}% or more` : `${t.min}–${t.max}%`})`);

function report() {
  console.log(`Balance: ${BOT_NAMES.join(' and ')} bots, ${SEEDS} seeds per cell, ${TIME_LIMIT} s limit${LOADOUT ? `, loadout ${LOADOUT.weapon}/${LOADOUT.armor}` : ''}${QUIET_ONLY ? ', tactical bot never goes loud on its own' : ''}.`);
  console.log('win = contracts won, quiet = won without an alarm, alarm = runs that raised the alarm, time = median seconds of the wins, swift = wins under par, hp = mean squad HP lost in the wins, fails = loss reasons.\n');
  for (const roster of ROSTERS.filter(r => !option('roster') || r.name === option('roster'))) for (const name of BOT_NAMES) {
    console.log(`## ${roster.name} · ${name}`);
    console.log('type           tier   win quiet alarm  time swift    hp  fails');
    for (const type of TYPES) for (const tier of TIERS) {
      const runs = seeds.map(seed => play(BOTS[name], type, tier, seed, withLoadout(roster.extra))), won = runs.filter(r => r.win);
      const reasons = new Map<string, number>();
      for (const r of runs) if (!r.win) reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1);
      const time = median(won.map(r => r.time)), hp = won.length ? won.reduce((s, r) => s + r.hpLost, 0) / won.length : NaN;
      const key = `${name}|${roster.name}|${tier}`;
      wins.set(key, [...wins.get(key) ?? [], 100 * won.length / runs.length]);
      earned.set(`${name}|${roster.name}`, [...earned.get(`${name}|${roster.name}`) ?? [], ...won]);
      console.log(`${type.padEnd(14)} ${String(tier).padStart(4)}  ${pct(won.length, runs.length)}  ${pct(won.filter(r => !r.alarm).length, runs.length)}  ${pct(runs.filter(r => r.alarm).length, runs.length)}  ${Number.isNaN(time) ? '   -' : time.toFixed(0).padStart(4)}  ${won.length ? pct(won.filter(r => r.badges.includes('swift')).length, won.length) : '   -'}  ${Number.isNaN(hp) ? '   -' : pct(hp * 100, 100)}  ${[...reasons].map(([r, n]) => `${n}× ${r}`).join('; ')}`);
    }
    console.log('');
  }
  const mean = (key: string) => { const xs = wins.get(key); return xs ? average(xs) : null; };
  console.log(`## Mean win rate over ${typesLabel}`);
  console.log(`roster      bot          ${TIERS.map(t => `T${t}`.padStart(5)).join('')}`);
  for (const roster of ROSTERS) for (const name of BOT_NAMES) {
    const row = TIERS.map(t => mean(`${name}|${roster.name}|${t}`));
    if (row.every(v => v === null)) continue;
    console.log(`${roster.name.padEnd(11)} ${name.padEnd(12)} ${row.map(v => v === null ? '    -' : `${Math.round(v)}%`.padStart(5)).join('')}`);
  }
  console.log(`\n## Badges (share of wins over the tiers played)`);
  console.log(`roster      bot          ${BADGES.map(b => b.padStart(10)).join('')}`);
  for (const roster of ROSTERS) for (const name of BOT_NAMES) {
    const won = earned.get(`${name}|${roster.name}`);
    if (!won?.length) continue;
    console.log(`${roster.name.padEnd(11)} ${name.padEnd(12)} ${BADGES.map(b => pct(won.filter(r => r.badges.includes(b)).length, won.length).padStart(10)).join('')}`);
  }
  if (TYPES.length !== CONTRACT_TYPES.length || QUIET_ONLY) return;
  console.log(`\n## Targets${LOADOUT ? '' : ' (default loadout; --loadouts checks each bot\'s best one for the fully upgraded four)'}`);
  for (const t of TARGETS) { const v = mean(`${t.bot}|${t.roster}|${t.tier}`); if (v !== null) checkTarget(t, v); }
}

// The fully upgraded four with every loadout: each bot's mean win rate and quiet-win rate per tier, its best loadout for
// each, and how its best loadout for winning meets the targets.
function loadouts() {
  const tiers = option('tiers') ? TIERS : [4, 5], roster = ROSTERS.find(r => r.name === 'four+max')!;
  const best = new Map<string, { v: number; loadout: string }>(), better = (key: string, v: number, loadout: string) => { if (v > (best.get(key)?.v ?? -1)) best.set(key, { v, loadout }); };
  console.log(`Loadouts: ${BOT_NAMES.join(' and ')} bots with the fully upgraded four, ${SEEDS} seeds per cell; mean over ${typesLabel} of contracts won / won without an alarm.\n`);
  console.log(`loadout              bot          ${tiers.map(t => `T${t}`.padStart(10)).join('')}`);
  for (const weapon of WEAPON_MODES) for (const armor of ARMOR_MODES) for (const name of BOT_NAMES) {
    const loadout = `${weapon}/${armor}`;
    const row = tiers.map(tier => {
      const runs = TYPES.map(type => seeds.map(seed => play(BOTS[name], type, tier, seed, withLoadout(roster.extra, { weapon, armor }))));
      const won = average(runs.map(rs => 100 * rs.filter(r => r.win).length / rs.length)), quiet = average(runs.map(rs => 100 * rs.filter(r => r.win && !r.alarm).length / rs.length));
      better(`${name}|${tier}|won`, won, loadout); better(`${name}|${tier}|quiet`, quiet, loadout);
      return `${Math.round(won)}%/${Math.round(quiet)}%`;
    });
    console.log(`${loadout.padEnd(20)} ${name.padEnd(12)} ${row.map(v => v.padStart(10)).join('')}`);
  }
  console.log('\n## Best loadout');
  for (const name of BOT_NAMES) for (const tier of tiers) for (const by of ['won', 'quiet']) {
    const b = best.get(`${name}|${tier}|${by}`)!;
    console.log(`${name.padEnd(12)} T${tier} ${by === 'won' ? 'wins ' : 'quiet'}: ${`${Math.round(b.v)}%`.padStart(4)} with ${b.loadout}`);
  }
  if (TYPES.length !== CONTRACT_TYPES.length || QUIET_ONLY) return;
  console.log('\n## Targets (each bot\'s best loadout for winning)');
  for (const t of TARGETS.filter(t => t.roster === 'four+max')) { const b = best.get(`${t.bot}|${t.tier}|won`); if (b) checkTarget(t, b.v, ` with ${b.loadout}`); }
}

// The fully upgraded four (with every Countermeasures level open) at each level asked for: wins / quiet wins per bot.
function countermeasures(levels: number[]) {
  const tiers = option('tiers') ? TIERS : [5], roster = ROSTERS.find(r => r.name === 'four+max')!, extra = withLoadout({ ...roster.extra, countermeasures: MAX_COUNTERMEASURES - 1 });
  console.log(`Countermeasures: ${BOT_NAMES.join(' and ')} bots with the fully upgraded four, ${SEEDS} seeds per cell; mean over ${typesLabel} of contracts won / won without an alarm.\n`);
  console.log(`level  bot          ${tiers.map(t => `T${t}`.padStart(10)).join('')}`);
  for (const level of levels) for (const name of BOT_NAMES) {
    const row = tiers.map(tier => {
      const runs = TYPES.map(type => seeds.map(seed => play(BOTS[name], type, tier, seed, extra, level)));
      return `${Math.round(average(runs.map(rs => 100 * rs.filter(r => r.win).length / rs.length)))}%/${Math.round(average(runs.map(rs => 100 * rs.filter(r => r.win && !r.alarm).length / rs.length)))}%`;
    });
    console.log(`${String(level).padEnd(6)} ${name.padEnd(12)} ${row.map(v => v.padStart(10)).join('')}`);
  }
}

const started = performance.now();
if (option('cm')) countermeasures(option('cm')!.split(',').map(Number));
else if (process.argv.includes('--loadouts')) loadouts(); else report();
// Run time goes to stderr, so the saved results stay identical between runs.
console.error(`${((performance.now() - started) / 1000).toFixed(0)} s`);
