// Headless balance check: a no-tactics bot (select all, click the objective, then extraction) plays every
// contract type and tier with three rosters and prints win rate, alarm rate, median time and HP lost.
// Run: node --experimental-transform-types scripts/balance.ts [--seeds 12] [--roster starters] [--tiers 1,3]
import { Simulation } from '../src/game/simulation.ts';
import type { Unit } from '../src/game/simulation.ts';
import { CONTRACT_TYPES, contractPayout, freshCampaign, MAX_LEVEL, MAX_TIER } from '../src/game/campaign.ts';
import type { Campaign, ContractType } from '../src/game/campaign.ts';
import { mulberry32 } from '../src/game/rng.ts';
import { distance } from '../src/game/world.ts';
import type { Point } from '../src/game/world.ts';

const option = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const SEEDS = Number(option('seeds') ?? 12);
const TIERS = option('tiers')?.split(',').map(Number) ?? Array.from({ length: MAX_TIER }, (_, i) => i + 1);
const TIME_LIMIT = 300; // seconds of mission time before the run counts as a loss
const DT = 1 / 30;
const THINK = .25;      // the bot looks at the field this often

const four = (['assault', 'support', 'recon', 'tech'] as const).map((cls, i) => ({ id: `o${i}`, name: `OP${i}`, cls }));
const ROSTERS: { name: string; extra: Partial<Campaign> }[] = [
  { name: 'starters', extra: {} },
  { name: 'four', extra: { roster: four } },
  { name: 'four+max', extra: { roster: four, weapon: MAX_LEVEL, armor: MAX_LEVEL, abilities: { assault: MAX_LEVEL, support: MAX_LEVEL, recon: MAX_LEVEL, tech: MAX_LEVEL } } },
];

type Run = { win: boolean; alarm: boolean; time: number; hpLost: number; reason: string };

function play(type: ContractType, tier: number, seed: number, extra: Partial<Campaign>): Run {
  const contract = { id: 'c', type, tier, seed, payout: contractPayout(tier), district: 'GLASS DISTRICT', sector: 1 };
  const sim = new Simulation({ ...freshCampaign(mulberry32(1)), ...extra, offers: [contract] });
  sim.deploy();
  let order = '', point: Point | null = null, think = 0;
  const squad = () => sim.units.filter(u => u.faction === 'squad');
  const go = (key: string, p: Point) => { order = key; point = { x: p.x, z: p.z }; sim.selectAll(); sim.move(p); };
  while (sim.phase === 'mission' && sim.time < TIME_LIMIT) {
    if ((think -= DT) <= 0) {
      think = THINK;
      const living = squad().filter(u => u.hp > 0), idle = living.every(u => !u.path.length && !u.targetId && !u.takedownId && !u.reviveTarget);
      const down = squad().find(u => u.hp <= 0);
      const goal = sim.objectives.find(o => !o.done)!;
      // A downed operative is revived before anything else; a move order would cancel the revive.
      if (down) { if (!living.some(u => u.reviveTarget)) { sim.selectAll(); sim.revive(down.id); order = ''; } }
      else if (goal.kind === 'target') {
        const target = sim.units.find(u => u.kind === 'target') as Unit;
        if (target.visible) { if (order !== 'attack' || idle) { order = 'attack'; sim.selectAll(); sim.attack(target.id); } }
        else if (order !== 'hunt' || idle || distance(point!, target) > 3) go('hunt', target);
      } else {
        const p = goal.kind === 'vip' ? sim.units.find(u => u.faction === 'vip')! : goal;
        const key = `${goal.kind}:${goal.label}`;
        // A player clicks again when the squad has stopped short of the objective.
        if (order !== key || (idle && living.some(u => distance(u, p) > 2))) go(key, p);
      }
    }
    sim.update(DT);
  }
  const team = squad();
  const hpLost = 1 - team.reduce((s, u) => s + u.hp, 0) / team.reduce((s, u) => s + u.maxHp, 0);
  return { win: sim.result === 'success', alarm: sim.detected, time: sim.time, hpLost, reason: sim.result ? sim.failReason : 'timeout' };
}

const pct = (n: number, of: number) => `${Math.round(100 * n / of)}%`.padStart(4);
const median = (xs: number[]) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const seeds = Array.from({ length: SEEDS }, (_, k) => 1000 + k * 7919);

console.log(`Balance: no-tactics bot, ${SEEDS} seeds per cell, ${TIME_LIMIT} s limit.`);
console.log('win = contracts won, alarm = runs that raised the alarm, time = median seconds of the wins, hp = mean squad HP lost in the wins, fails = loss reasons.\n');
for (const roster of ROSTERS.filter(r => !option('roster') || r.name === option('roster'))) {
  console.log(`## ${roster.name}`);
  console.log('type           tier   win  alarm  time    hp  fails');
  for (const type of CONTRACT_TYPES) for (const tier of TIERS) {
    const runs = seeds.map(seed => play(type, tier, seed, roster.extra)), wins = runs.filter(r => r.win);
    const reasons = new Map<string, number>();
    for (const r of runs) if (!r.win) reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1);
    const time = median(wins.map(r => r.time)), hp = wins.length ? wins.reduce((s, r) => s + r.hpLost, 0) / wins.length : NaN;
    console.log(`${type.padEnd(14)} ${String(tier).padStart(4)}  ${pct(wins.length, runs.length)}  ${pct(runs.filter(r => r.alarm).length, runs.length)}  ${Number.isNaN(time) ? '   -' : time.toFixed(0).padStart(4)}  ${Number.isNaN(hp) ? '   -' : pct(hp * 100, 100)}  ${[...reasons].map(([r, n]) => `${n}× ${r}`).join('; ')}`);
  }
  console.log('');
}
