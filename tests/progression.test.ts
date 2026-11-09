import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, CALM_SECONDS, COUNTERMEASURES, EXTENDED_RANGE, HEAVY_HP, LIGHT_CONCEALMENT, PIERCING_BONUS, SUPPRESSOR_STEP, FIRST_WAVE_SECONDS, VIP_SECURE_SECONDS, detectSeconds, HACK_SECONDS, REINFORCE_CAP, REINFORCE_SECONDS } from '../src/game/simulation.ts';
import type { Unit } from '../src/game/simulation.ts';
import { MAX_LEVEL, parSeconds } from '../src/game/campaign.ts';
import type { ArmorMode, Campaign, MissionReport, WeaponMode } from '../src/game/campaign.ts';
import { CLASS_STATS } from '../src/game/classes.ts';
import { planMission } from '../src/game/mapgen.ts';
import { raiseAlarm } from '../src/game/alarm.ts';
import { recorder, contract, campaignWith, step, arena, alarmed } from './arena.ts';

// ---- Gear loadouts ----
const geared = (weapon: WeaponMode, armor: ArmorMode, level = MAX_LEVEL): Partial<Campaign> => ({ weapon: level, armor: level, loadout: { weapon, armor } });

test('piercing rounds add damage a level; suppressed and extended rifles trade it away', () => {
  const base = CLASS_STATS.assault.damage + CLASS_STATS.support.damage;
  for (const [mode, bonus] of [['piercing', MAX_LEVEL * PIERCING_BONUS], ['suppressed', 0], ['extended', 0]] as const) {
    const { sim, hostile } = arena('heist', geared(mode, 'heavy'));
    assert.equal(sim.attackPreview(hostile('guard', 3, 0, Math.PI / 2, 1e4).id)!.damage, base + 2 * bonus, mode);
  }
  const { sim, hostile } = arena('heist', geared('piercing', 'heavy', 0));
  assert.equal(sim.attackPreview(hostile('guard', 3, 0, Math.PI / 2, 1e4).id)!.damage, base);
});

test('extended barrels let the squad fire from farther away', () => {
  const far = CLASS_STATS.assault.range + MAX_LEVEL * EXTENDED_RANGE - .2;
  for (const [mode, hits] of [['extended', true], ['piercing', false]] as const) {
    const { sim, squad, hostile } = arena('heist', geared(mode, 'heavy'));
    squad[1].x = -15; squad[1].z = 15;
    const guard = hostile('guard', far, 0, Math.PI / 2, 1e6); // out of its own range, its back to VEX
    raiseAlarm(sim, guard, 'test');
    step(sim, .5);
    assert.equal(guard.hp < 1e6, hits, mode);
  }
});

test('heavy plating adds health a level; light plating trades it away', () => {
  const vex = (armor: ArmorMode) => arena('heist', geared('piercing', armor)).squad[0].maxHp;
  assert.equal(vex('heavy'), CLASS_STATS.assault.hp + MAX_LEVEL * HEAVY_HP);
  assert.equal(vex('light'), CLASS_STATS.assault.hp);
});

test('light plating makes hostiles slower to notice the squad, but not the VIP', () => {
  const squadSeen = (armor: ArmorMode) => {
    const { sim, hostile } = arena('heist', geared('piercing', armor));
    hostile('guard', 3, 0, -Math.PI / 2, 40).lookEvery = 1e9;
    step(sim, 20, () => sim.alarm); return sim.time;
  };
  const close = (t: number, want: number) => assert.ok(Math.abs(t - want) <= 1 / 60 + 1e-9, `${t} vs ${want}`);
  close(squadSeen('heavy'), detectSeconds('guard', 2));
  close(squadSeen('light'), detectSeconds('guard', 2) * (1 + MAX_LEVEL * LIGHT_CONCEALMENT));
  // Only the VIP is in the guard's sight: VEX stands just past its vision, ROOK far away.
  const vipSeen = (armor: ArmorMode) => {
    const { sim, squad, hostile } = arena('escort', geared('piercing', armor));
    const vip = sim.units.find(u => u.faction === 'vip')!;
    squad[0].x = 0; squad[0].z = 0; squad[1].x = 15; squad[1].z = 15; vip.x = -1.5; vip.z = 0;
    step(sim, VIP_SECURE_SECONDS + .1); assert.equal(sim.objectives[0].done, true);
    const start = sim.time;
    hostile('guard', -7.5, 0, Math.PI / 2, 40).lookEvery = 1e9;
    step(sim, 20, () => sim.alarm); return sim.time - start;
  };
  assert.equal(vipSeen('light'), vipSeen('heavy'));
});

test('suppressed rifles leave a hostile that survives a hit suspicious, until hits tip it into the alarm', () => {
  const { sim, hostile } = arena('heist', geared('suppressed', 'heavy'));
  const heavy = hostile('heavy', 4, 0, Math.PI / 2, 180); // its back to the squad
  heavy.lookEvery = 1e9;
  sim.select('vex'); // a heavy needs two for a takedown, so one operative fires instead
  assert.equal(sim.attackPreview(heavy.id)!.outcome, 'suspicious');
  assert.match(sim.attackHint(heavy.id)!, /turns suspicious/);
  sim.attack(heavy.id); step(sim, 1, () => heavy.hp < 180);
  assert.ok(heavy.hp < 180); assert.equal(sim.alarm, false);
  assert.ok(Math.abs(heavy.detect - (1 - MAX_LEVEL * SUPPRESSOR_STEP)) < .02, String(heavy.detect));
  step(sim, 6, () => sim.alarm);
  assert.equal(sim.alarm, true); assert.ok(heavy.hp > 0);
  // Without suppressor levels, the first hit raises the alarm as before.
  const plain = arena('heist', geared('suppressed', 'heavy', 0));
  const other = plain.hostile('heavy', 4, 0, Math.PI / 2, 180);
  plain.sim.select('vex'); assert.equal(plain.sim.attackPreview(other.id)!.outcome, 'alert');
  plain.sim.attack(other.id); step(plain.sim, 1, () => other.hp < 180);
  assert.equal(plain.sim.alarm, true);
});

test('switching the loadout is free, reported to the server, and refused mid-mission', () => {
  const { events, sync } = recorder();
  const sim = new Simulation(campaignWith('heist'), sync), cash = sim.campaign.cash;
  assert.ok(sim.equip({ weapon: 'suppressed', armor: 'light' }));
  assert.deepEqual(sim.campaign.loadout, { weapon: 'suppressed', armor: 'light' }); assert.equal(sim.campaign.cash, cash);
  assert.equal(events.at(-1), 'equipped:suppressed/light');
  sim.deploy();
  assert.equal(sim.equip({ weapon: 'piercing', armor: 'heavy' }), false);
});

// ---- Badges ----
// Wins an arena contract once its objectives are done: the whole squad steps into extraction.
const extractAll = (sim: Simulation, squad: Unit[]) => { squad.forEach(u => { u.x = -18; u.z = -18; u.path = []; }); sim.update(1 / 60); };

const hack = (sim: Simulation, squad: Unit[]) => { const t = sim.objectives[0]; squad.forEach(u => { u.x = t.x; u.z = t.z; u.path = []; }); step(sim, HACK_SECONDS + .5); };

test('a quiet, clean, quick win earns Ghost, Untouched, Swift and Bloodless, and reports them', () => {
  const reports: MissionReport[] = [];
  const sync = { ...recorder().sync, completed: (r: MissionReport) => { reports.push(r); } };
  const { sim, squad } = arena('heist', {}, sync);
  hack(sim, squad); extractAll(sim, squad);
  assert.equal(sim.result, 'success');
  assert.deepEqual(sim.getSnapshot().badges, ['ghost', 'untouched', 'swift', 'bloodless']); // no hostiles, so nothing to purge
  assert.deepEqual(reports, [{ stealth: true, badges: ['ghost', 'untouched', 'swift', 'bloodless'], results: {} }]);
  assert.equal(sim.campaign.badges.swift, 1);
});

test('an alarm, a downed operative, a slow finish and a kill each cost their badge', () => {
  const { sim, squad, hostile, raise } = alarmed();
  squad.forEach(u => { u.hp = u.maxHp = 1e6; });
  hostile('guard', 15, 15, 0).hp = 0;
  hostile('guard', 15, 12, 0, 1e6).cooldown = 1e9;
  raise({ x: 15, z: 15 });
  (sim as unknown as { damage(t: Unit, n: number, from: null): void }).damage(squad[1], 2e6, null);
  squad[1].hp = 50; // revived
  hack(sim, squad); step(sim, parSeconds('heist', 1));
  extractAll(sim, squad);
  assert.equal(sim.result, 'success');
  assert.deepEqual(sim.getSnapshot().badges, []);
  assert.equal(sim.getSnapshot().downs, 1);
});

test('Bloodless spares only the assassination target; Purge counts the district, not reinforcements', () => {
  const play = (killGuard: boolean) => {
    const { sim, squad, hostile } = arena('assassination');
    hostile('target', 10, 10, 0).hp = 0;
    hostile('guard', 12, 10, 0).hp = killGuard ? 0 : 75;
    hostile('guard', 14, 10, 0).id = 'r0'; // a reinforcement, left standing
    step(sim, .1); extractAll(sim, squad);
    assert.equal(sim.result, 'success');
    return sim.getSnapshot().badges;
  };
  const spared = play(false), swept = play(true);
  assert.ok(spared.includes('bloodless') && !spared.includes('purge'), spared.join());
  assert.ok(swept.includes('purge') && !swept.includes('bloodless'), swept.join());
});

test('Elimination counts down the district it started with; reinforcements never count, and it offers no Purge or Bloodless', () => {
  const plan = planMission(contract('elimination', 2, 77));
  assert.ok(plan.enemies.length > 0 && !plan.sites.length && !plan.vip && !plan.enemies.some(e => e.kind === 'target'));
  const reports: MissionReport[] = [];
  const sync = { ...recorder().sync, completed: (r: MissionReport) => { reports.push(r); } };
  const { sim, squad, hostile } = arena('elimination', {}, sync);
  const a = hostile('guard', 12, 10, 0), b = hostile('camera', 14, 10, 0, 40), r = hostile('guard', 16, 10, 0);
  r.id = 'r0'; // a reinforcement, left standing
  const sweep = sim.objectives[0];
  assert.equal(sweep.kind, 'sweep');
  step(sim, .1);
  assert.equal(sweep.label, 'Down every hostile (2 left)'); assert.equal(sim.extractReady, false);
  a.hp = 0; step(sim, .1);
  assert.equal(sweep.label, 'Down every hostile (1 left)'); assert.equal(sweep.progress, .5);
  extractAll(sim, squad);
  assert.equal(sim.phase, 'mission', 'extraction waits for the sweep');
  b.hp = 0; step(sim, .1);
  assert.ok(sweep.done && sim.extractReady, 'the standing reinforcement does not hold up the sweep');
  extractAll(sim, squad);
  assert.equal(sim.result, 'success');
  assert.deepEqual(sim.getSnapshot().badges, ['ghost', 'untouched', 'swift']);
  assert.deepEqual(reports, [{ stealth: true, badges: ['ghost', 'untouched', 'swift'], results: {}, kills: 2 }]);
  assert.equal(sim.campaign.badges.purge, 0);
});

test('a restart clears the downs a run had counted', () => {
  const { sim, squad } = arena('heist');
  (sim as unknown as { damage(t: Unit, n: number, from: null): void }).damage(squad[0], 1e6, null);
  step(sim, .2); assert.equal(sim.getSnapshot().downs, 1);
  sim.restart();
  assert.equal(sim.getSnapshot().downs, 0); assert.deepEqual(sim.getSnapshot().badges, []);
});

// ---- Countermeasures ----
const MAXED: Partial<Campaign> = { weapon: MAX_LEVEL, armor: MAX_LEVEL, abilities: { assault: MAX_LEVEL, support: MAX_LEVEL, recon: MAX_LEVEL, tech: MAX_LEVEL } };

const within = (t: number, want: number) => assert.ok(Math.abs(t - want) <= 1 / 60 + 1e-9, `${t} vs ${want}`);

test('Countermeasures quicken detection, then lengthen the stand-down, then lift the reinforcement cap', () => {
  const open = { ...MAXED, countermeasures: 2 };
  const seen = (level: number) => {
    const { sim, hostile } = arena('heist', open, undefined, level);
    hostile('guard', 3, 0, -Math.PI / 2, 40).lookEvery = 1e9;
    step(sim, 20, () => sim.alarm); return sim.time;
  };
  within(seen(0), detectSeconds('guard', 2));
  within(seen(1), detectSeconds('guard', 2) * COUNTERMEASURES[1].detect);
  const two = alarmed('heist', open, undefined, 2);
  two.raise(); step(two.sim, .2);
  assert.equal(two.sim.getSnapshot().calmFor, CALM_SECONDS + COUNTERMEASURES[2].calm);
  const three = arena('heist', open, undefined, 3);
  three.squad.forEach(u => { u.hp = u.maxHp = 1e6; });
  raiseAlarm(three.sim, { x: 0, z: 0 }, 'test');
  step(three.sim, FIRST_WAVE_SECONDS + REINFORCE_SECONDS * 5);
  assert.ok(three.sim.getSnapshot().reinforced > REINFORCE_CAP, String(three.sim.getSnapshot().reinforced));
  assert.equal(three.sim.getSnapshot().reinforceCap, Infinity);
});

test('the board refuses a locked Countermeasures level, reports the pick on deploy, and a restart keeps it', () => {
  const levels: number[] = [];
  const sync = { ...recorder().sync, deployed: (_: string, __: string[], countermeasures: number) => { levels.push(countermeasures); } };
  const sim = new Simulation(campaignWith('heist', MAXED), sync);
  assert.equal(sim.getSnapshot().countermeasuresOpen, 1);
  sim.chooseCountermeasures(2); assert.equal(sim.countermeasures, 0);
  sim.chooseCountermeasures(1); assert.equal(sim.countermeasures, 1);
  sim.deploy(); sim.restart();
  assert.deepEqual(levels, [1, 1]);
  sim.chooseCountermeasures(0); assert.equal(sim.countermeasures, 1); // fixed for the mission
  // A campaign that no longer opens the level drops the pick back to what it opens.
  const plain = new Simulation(campaignWith('heist', MAXED));
  plain.chooseCountermeasures(1);
  plain.applyCampaign({ ...plain.campaign, armor: 2 });
  assert.equal(plain.countermeasures, 0);
});
