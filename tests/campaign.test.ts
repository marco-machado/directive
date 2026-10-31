import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDismiss, applyPurchase, applyRecruit, baseTier, clampCampaign, completeMission, contractPayout, freshCampaign, MIN_MISSION_MS, RECRUIT_COST, ROSTER_CAP, startMission } from '../src/game/campaign.ts';
import type { Ledger } from '../src/game/campaign.ts';
import { mulberry32 } from '../src/game/rng.ts';
import { formatSaveCode, generateSaveCode, normalizeSaveCode } from '../src/game/saveCode.ts';

const rng = mulberry32(42);

test('purchases charge the listed cost and stop at the level cap', () => {
  const rich = { ...freshCampaign(rng), cash: 5000 };
  assert.deepEqual(applyPurchase(rich, 'weapon'), { ...rich, cash: 4700, weapon: 1 });
  assert.equal(applyPurchase({ ...rich, armor: 3 }, 'armor'), null);
  assert.equal(applyPurchase({ ...rich, cash: 249 }, 'armor'), null);
  assert.deepEqual(applyPurchase(rich, 'recon')!.abilities, { ...rich.abilities, recon: 1 });
  assert.equal(applyPurchase({ ...rich, abilities: { ...rich.abilities, tech: 3 } }, 'tech'), null);
});

test('offers bracket the base tier, which rises with completed contracts', () => {
  assert.deepEqual(freshCampaign(rng).offers.map(o => o.tier), [1, 2, 3]);
  const veteran = clampCampaign({ completed: 6 }, rng);
  assert.equal(baseTier(6), 4);
  assert.deepEqual(veteran.offers.map(o => o.tier), [3, 4, 5]);
  assert.deepEqual(veteran.offers.map(o => o.payout), [3, 4, 5].map(contractPayout));
  assert.equal(new Set(veteran.offers.map(o => o.type)).size, 3);
  assert.equal(contractPayout(5), 1500);
  assert.deepEqual(clampCampaign({ completed: 40 }, rng).offers.map(o => o.tier), [3, 4, 5]);
});

test('recruiting costs credits, respects the cap, and dismissal keeps one operative', () => {
  const c = { ...freshCampaign(rng), cash: 1000 };
  const hired = applyRecruit(c, c.recruits[0].id)!;
  assert.equal(hired.cash, 1000 - RECRUIT_COST); assert.equal(hired.roster.length, 3); assert.equal(hired.recruits.length, 1);
  assert.equal(applyRecruit({ ...c, cash: RECRUIT_COST - 1 }, c.recruits[0].id), null);
  const full = { ...c, roster: Array.from({ length: ROSTER_CAP }, (_, i) => ({ id: `o${i}`, name: 'KAI', cls: 'tech' as const })) };
  assert.equal(applyRecruit(full, c.recruits[0].id), null);
  const solo = applyDismiss(c, 'vex')!;
  assert.deepEqual(solo.roster.map(o => o.id), ['rook']);
  assert.equal(applyDismiss(solo, 'rook'), null);
});

test('a mission pays its stored contract once, only for the active id, and never too early', () => {
  const t0 = 1_000_000, campaign = freshCampaign(rng), offer = campaign.offers[2];
  const ledger = startMission({ campaign, activeMission: null }, 'm1', t0, offer.id, ['vex', 'rook'], rng)!;
  assert.ok(!ledger.campaign.offers.some(o => o.id === offer.id), 'deploying rerolls the board');
  assert.equal(completeMission(ledger, 'm1', t0 + MIN_MISSION_MS - 1, false), null);
  assert.equal(completeMission(ledger, 'other', t0 + MIN_MISSION_MS, false), null);
  const paid = completeMission(ledger, 'm1', t0 + MIN_MISSION_MS, false)!;
  assert.equal(paid.campaign.cash, offer.payout); assert.equal(paid.campaign.completed, 1); assert.equal(paid.activeMission, null);
  assert.equal(completeMission(paid, 'm1', t0 + MIN_MISSION_MS * 2, false), null);
  const sneaky = completeMission(ledger, 'm1', t0 + MIN_MISSION_MS, true)!;
  assert.equal(sneaky.campaign.cash, Math.round(offer.payout * 1.25));
});

test('deploys reject unknown contracts and invalid squads; restarts keep the board', () => {
  const campaign = freshCampaign(rng), offer = campaign.offers[0], base: Ledger = { campaign, activeMission: null };
  assert.equal(startMission(base, 'm', 0, 'forged', ['vex'], rng), null);
  assert.equal(startMission(base, 'm', 0, offer.id, [], rng), null);
  assert.equal(startMission(base, 'm', 0, offer.id, ['vex', 'vex'], rng), null);
  assert.equal(startMission(base, 'm', 0, offer.id, ['ghost'], rng), null);
  const started = startMission(base, 'm1', 0, offer.id, ['vex'], rng)!;
  const restarted = startMission(started, 'm2', 5, offer.id, ['vex', 'rook'], rng)!;
  assert.deepEqual(restarted.campaign, started.campaign);
  assert.equal(restarted.activeMission!.contract.id, offer.id);
});

test('imports are clamped and imported contracts never pay above their tier', () => {
  const c = clampCampaign({ cash: 1e12, weapon: 9, armor: -2, mission: 3, offers: [{ id: 'x', type: 'heist', tier: 99, payout: 1e9, seed: 1, district: 'X', sector: 1 }] }, rng);
  assert.equal(c.cash, 1e8); assert.equal(c.weapon, 3); assert.equal(c.armor, 0); assert.equal(c.completed, 2);
  assert.equal(c.offers[0].tier, 5); assert.equal(c.offers[0].payout, 1500);
  assert.equal(clampCampaign('nope', rng).version, 3);
  assert.equal(clampCampaign({ roster: [{ id: '<script>', name: 'x', cls: 'god' }] }, rng).roster.length, 2);
});

test('save codes round-trip through display formatting and common typos', () => {
  const code = generateSaveCode();
  assert.match(code, /^[0-9A-HJKMNP-TV-Z]{12}$/);
  assert.equal(normalizeSaveCode(formatSaveCode(code).toLowerCase()), code);
  assert.equal(normalizeSaveCode('7KQ2-M9XD-4TRO'), '7KQ2M9XD4TR0');
  assert.equal(normalizeSaveCode('short'), null);
});
