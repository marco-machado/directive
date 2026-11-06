import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contractPayout, FIRST_CONTRACT, freshCampaign } from '../src/game/campaign.ts';
import type { Contract } from '../src/game/campaign.ts';
import { mulberry32 } from '../src/game/rng.ts';
import { GHOST_SECONDS, Simulation } from '../src/game/simulation.ts';
import { observer } from '../scripts/bots.ts';
import type { Knowledge } from '../scripts/bots.ts';
import { tactical } from '../scripts/tactical.ts';

// Plays a mission as scripts/balance.ts does: the bot thinks every quarter second.
function play(contract: Contract, each?: (sim: Simulation) => void) {
  const sim = new Simulation({ ...freshCampaign(mulberry32(7)), offers: [contract] });
  sim.deploy();
  const think = tactical(sim, { quietOnly: false });
  for (let wait = 0; sim.phase === 'mission' && sim.time < 300; sim.update(1 / 30)) {
    if ((wait -= 1 / 30) <= 0) { wait = .25; think(); each?.(sim); }
  }
  return sim;
}

test('the tactical bot clears contract 01 with the starters without raising the alarm', () => {
  const sim = play({ ...FIRST_CONTRACT, id: 'c01', payout: contractPayout(1) });
  assert.equal(sim.result, 'success');
  assert.equal(sim.detected, false);
});

test('a bot only knows hostiles the squad has seen, and a walking one only while its last-seen marker lasts', () => {
  const seen = new Set<string>();
  let checks = 0, see: (() => Knowledge) | null = null;
  play({ id: 'c', type: 'heist', tier: 3, seed: 4242, payout: contractPayout(3), district: 'GLASS DISTRICT', sector: 1 }, sim => {
    for (const u of sim.units) if (u.faction === 'hostile' && u.visible) seen.add(u.id);
    see ??= observer(sim);
    const k = see();
    for (const h of k.hostiles) {
      checks++;
      assert.ok(seen.has(h.id), `${h.id} was never in sight`);
      const u = sim.units.find(v => v.id === h.id)!;
      assert.equal(h.visible, u.visible);
      if (!h.visible) assert.ok(h.patrol.length < 2 || k.time - h.at < GHOST_SECONDS, `${h.id} is remembered after its marker faded`);
    }
  });
  assert.ok(checks > 0);
});

test('a bot counts down a remembered stun while the stunned hostile is out of sight', () => {
  const sim = new Simulation({ ...freshCampaign(mulberry32(7)), offers: [{ ...FIRST_CONTRACT, id: 'c01', payout: contractPayout(1) }] });
  sim.deploy();
  const see = observer(sim), u = sim.units.find(v => v.faction === 'hostile' && v.patrol.length < 2)!;
  const remembered = () => see().hostiles.find(h => h.id === u.id)!.stunned;
  u.visible = true; u.stunned = 5;
  assert.equal(remembered(), 5);
  u.visible = false;
  sim.time += 3;
  assert.equal(remembered(), 2);
  sim.time += 3;
  assert.equal(remembered(), 0);
});

test('the tactical bot finds and downs every hostile on an Elimination contract it has no positions for', () => {
  const sim = play({ id: 'e', type: 'elimination', tier: 1, seed: 2, payout: contractPayout(1), district: 'GLASS DISTRICT', sector: 1 });
  assert.equal(sim.result, 'success', sim.failReason);
  assert.ok(sim.objectives.find(o => o.kind === 'sweep')!.done);
});
