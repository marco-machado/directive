// Headless balance check: two bots play every contract type and tier with three rosters and print win rate, quiet wins,
// alarm rate, median time and HP lost, then how each bot does against the balance targets.
// - no-tactics: select all, click the objective, then extraction (scripts/bots.ts).
// - tactical: routes around vision cones and clears blockers quietly, going loud only when it must (scripts/tactical.ts).
// Run: node --experimental-transform-types scripts/balance.ts [--seeds 12] [--bot both|no-tactics|tactical]
//      [--roster starters|four|four+max] [--tiers 1,3] [--types heist,escort] [--quiet-only]
import { Simulation } from '../src/game/simulation.ts';
import { CONTRACT_TYPES, contractPayout, freshCampaign, MAX_LEVEL, MAX_TIER } from '../src/game/campaign.ts';
import type { Campaign, ContractType } from '../src/game/campaign.ts';
import { mulberry32 } from '../src/game/rng.ts';
import { noTactics } from './bots.ts';
import type { Bot } from './bots.ts';
import { tactical } from './tactical.ts';

const option = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const SEEDS = Number(option('seeds') ?? 12);
const TIERS = option('tiers')?.split(',').map(Number) ?? Array.from({ length: MAX_TIER }, (_, i) => i + 1);
const TYPES = (option('types')?.split(',') ?? CONTRACT_TYPES) as ContractType[];
const QUIET_ONLY = process.argv.includes('--quiet-only');
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

type Run = { win: boolean; alarm: boolean; time: number; hpLost: number; reason: string };

function play(bot: Bot, type: ContractType, tier: number, seed: number, extra: Partial<Campaign>): Run {
  const contract = { id: 'c', type, tier, seed, payout: contractPayout(tier), district: 'GLASS DISTRICT', sector: 1 };
  const sim = new Simulation({ ...freshCampaign(mulberry32(1)), ...extra, offers: [contract] });
  sim.deploy();
  const think = bot(sim, { quietOnly: QUIET_ONLY });
  let wait = 0;
  while (sim.phase === 'mission' && sim.time < TIME_LIMIT) {
    if ((wait -= DT) <= 0) { wait = THINK; think(); }
    sim.update(DT);
  }
  const team = sim.units.filter(u => u.faction === 'squad');
  const hpLost = 1 - team.reduce((s, u) => s + u.hp, 0) / team.reduce((s, u) => s + u.maxHp, 0);
  return { win: sim.result === 'success', alarm: sim.detected, time: sim.time, hpLost, reason: sim.result ? sim.failReason : 'timeout' };
}

const pct = (n: number, of: number) => `${Math.round(100 * n / of)}%`.padStart(4);
const median = (xs: number[]) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const seeds = Array.from({ length: SEEDS }, (_, k) => 1000 + k * 7919);
const wins = new Map<string, number[]>(); // `${bot}|${roster}|${tier}` → win rate per contract type

console.log(`Balance: ${BOT_NAMES.join(' and ')} bots, ${SEEDS} seeds per cell, ${TIME_LIMIT} s limit${QUIET_ONLY ? ', tactical bot never goes loud on its own' : ''}.`);
console.log('win = contracts won, quiet = won without an alarm, alarm = runs that raised the alarm, time = median seconds of the wins, hp = mean squad HP lost in the wins, fails = loss reasons.\n');
const started = performance.now();
for (const roster of ROSTERS.filter(r => !option('roster') || r.name === option('roster'))) for (const name of BOT_NAMES) {
  console.log(`## ${roster.name} · ${name}`);
  console.log('type           tier   win quiet alarm  time    hp  fails');
  for (const type of TYPES) for (const tier of TIERS) {
    const runs = seeds.map(seed => play(BOTS[name], type, tier, seed, roster.extra)), won = runs.filter(r => r.win);
    const reasons = new Map<string, number>();
    for (const r of runs) if (!r.win) reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1);
    const time = median(won.map(r => r.time)), hp = won.length ? won.reduce((s, r) => s + r.hpLost, 0) / won.length : NaN;
    const key = `${name}|${roster.name}|${tier}`;
    wins.set(key, [...wins.get(key) ?? [], 100 * won.length / runs.length]);
    console.log(`${type.padEnd(14)} ${String(tier).padStart(4)}  ${pct(won.length, runs.length)}  ${pct(won.filter(r => !r.alarm).length, runs.length)}  ${pct(runs.filter(r => r.alarm).length, runs.length)}  ${Number.isNaN(time) ? '   -' : time.toFixed(0).padStart(4)}  ${Number.isNaN(hp) ? '   -' : pct(hp * 100, 100)}  ${[...reasons].map(([r, n]) => `${n}× ${r}`).join('; ')}`);
  }
  console.log('');
}

const mean = (key: string) => { const xs = wins.get(key); return xs ? xs.reduce((s, x) => s + x, 0) / xs.length : null; };
console.log(`## Mean win rate over ${TYPES.length === CONTRACT_TYPES.length ? 'the four contract types' : TYPES.join(', ')}`);
console.log(`roster      bot          ${TIERS.map(t => `T${t}`.padStart(5)).join('')}`);
for (const roster of ROSTERS) for (const name of BOT_NAMES) {
  const row = TIERS.map(t => mean(`${name}|${roster.name}|${t}`));
  if (row.every(v => v === null)) continue;
  console.log(`${roster.name.padEnd(11)} ${name.padEnd(12)} ${row.map(v => v === null ? '    -' : `${Math.round(v)}%`.padStart(5)).join('')}`);
}
console.log('\n## Targets');
for (const t of TARGETS) {
  const v = mean(`${t.bot}|${t.roster}|${t.tier}`);
  if (v === null || TYPES.length !== CONTRACT_TYPES.length || QUIET_ONLY) continue;
  const pass = v >= t.min && v <= t.max;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${t.bot.padEnd(11)} ${t.roster.padEnd(9)} tier ${t.tier}: ${Math.round(v)}% (target ${t.max >= 100 ? `${t.min}% or more` : `${t.min}–${t.max}%`})`);
}
// Run time goes to stderr, so the saved results stay identical between runs.
console.error(`${((performance.now() - started) / 1000).toFixed(0)} s`);
