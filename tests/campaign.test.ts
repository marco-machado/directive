import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDismiss, applyPurchase, applyRecruit, baseTier, clampCampaign, completeMission, contractPayout, dealBoard, freshCampaign, MAX_TIER, MIN_MISSION_MS, nextUnlock, OPENING_CONTRACTS, RECRUIT_COST, ROSTER_CAP, SILENT_CLASSES, squadRating, startMission, threatFor, topTier } from '../src/game/campaign.ts';
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

test('until two contracts are complete, the board offers only the base tier and the one above', () => {
  assert.equal(OPENING_CONTRACTS, 2);
  assert.deepEqual(freshCampaign(rng).offers.map(o => o.tier), [1, 1, 2]);
  assert.deepEqual(clampCampaign({ completed: 1 }, rng).offers.map(o => o.tier), [1, 1, 2]);
  assert.deepEqual(clampCampaign({ completed: 2 }, rng).offers.map(o => o.tier), [1, 2, 3]);
  // The Worker deals boards through the same rule when a mission starts.
  const c = freshCampaign(rng), started = startMission({ campaign: c, activeMission: null }, 'm', 0, c.offers[0].id, ['vex'], rng)!;
  assert.ok(started.campaign.offers.every(o => o.tier <= 2));
});

test('the threat read weighs the tier against roster size and upgrades', () => {
  const starters = freshCampaign(rng);
  assert.deepEqual([1, 2, 3, 4].map(t => threatFor(starters, t)), ['low', 'moderate', 'high', 'extreme']);
  const four = { ...starters, roster: (['assault', 'support', 'recon', 'tech'] as const).map((cls, i) => ({ id: `o${i}`, name: `OP${i}`, cls })) };
  assert.deepEqual([2, 3, 4, 5].map(t => threatFor(four, t)), ['low', 'moderate', 'high', 'extreme']);
  const maxed = { ...four, weapon: 3, armor: 3, abilities: { assault: 3, support: 3, recon: 3, tech: 3 } };
  assert.equal(threatFor(maxed, 5), 'low');
  // Abilities count only for classes on the roster.
  assert.equal(squadRating({ ...starters, abilities: { ...starters.abilities, recon: 3, tech: 3 } }), squadRating(starters));
});

test('offers bracket the base tier, which rises with completed contracts', () => {
  const veteran = clampCampaign({ completed: 6 }, rng);
  assert.equal(baseTier(6), 4);
  assert.deepEqual(veteran.offers.map(o => o.tier), [3, 4, 5]);
  assert.deepEqual(veteran.offers.map(o => o.payout), [3, 4, 5].map(contractPayout));
  assert.equal(new Set(veteran.offers.map(o => o.type)).size, 3);
  assert.equal(contractPayout(5), 1500);
  assert.deepEqual(clampCampaign({ completed: 40 }, rng).offers.map(o => o.tier), [3, 4, 5]);
});

test('the next tier unlock counts the contracts left and stops at the top tier', () => {
  assert.deepEqual([0, 1, 2, 4, 6, 9].map(topTier), [2, 2, 3, 4, 5, 5]);
  assert.deepEqual(nextUnlock(0), { tier: 3, after: 2, progress: 0 });
  assert.deepEqual(nextUnlock(1), { tier: 3, after: 1, progress: .5 });
  assert.deepEqual(nextUnlock(5), { tier: 5, after: 1, progress: .5 });
  for (let c = 0; c < 6; c++) { const n = nextUnlock(c)!; assert.equal(topTier(c + n.after), n.tier); assert.equal(topTier(c + n.after - 1), n.tier - 1); }
  assert.equal(topTier(6), MAX_TIER); assert.equal(nextUnlock(6), null);
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

test('a new campaign always offers a Recon or Tech recruit until its first contract pays', () => {
  const silent = (c: { recruits: { cls: string }[] }) => c.recruits.some(r => SILENT_CLASSES.includes(r.cls as never));
  let later = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const r = mulberry32(seed), fresh = freshCampaign(r);
    assert.ok(silent(fresh), `seed ${seed}: first board`);
    // Deploying deals the next board before the payout, so the guarantee holds there too: that is the board the first payout can buy from.
    const ledger = startMission({ campaign: fresh, activeMission: null }, 'm', 0, fresh.offers[0].id, ['vex'], r)!;
    assert.ok(silent(ledger.campaign), `seed ${seed}: board dealt by the first deploy`);
    const paid = completeMission(ledger, 'm', MIN_MISSION_MS, true)!.campaign;
    assert.ok(paid.cash >= RECRUIT_COST && silent(paid));
    if (!silent(dealBoard(paid, r))) later++;
  }
  assert.ok(later > 0, 'after the first payout recruits are random again');
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
