import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPurchase, clampCampaign, completeMission, freshCampaign, MIN_MISSION_MS, PAYOUT, startMission } from '../src/game/campaign.ts';
import { formatSaveCode, generateSaveCode, normalizeSaveCode } from '../src/game/saveCode.ts';

test('purchases charge the listed cost and stop at the level cap', () => {
  const rich = { ...freshCampaign(), cash: 5000 };
  assert.deepEqual(applyPurchase(rich, 'weapon'), { ...rich, cash: 4700, weapon: 1 });
  assert.equal(applyPurchase({ ...rich, armor: 3 }, 'armor'), null);
  assert.equal(applyPurchase({ ...rich, cash: 249 }, 'armor'), null);
});

test('a mission pays once, only for the active id, and never too early', () => {
  const t0 = 1_000_000;
  const ledger = startMission({ campaign: freshCampaign(), activeMission: null }, 'm1', t0);
  assert.equal(completeMission(ledger, 'm1', t0 + MIN_MISSION_MS - 1), null);
  assert.equal(completeMission(ledger, 'other', t0 + MIN_MISSION_MS), null);
  const paid = completeMission(ledger, 'm1', t0 + MIN_MISSION_MS)!;
  assert.equal(paid.campaign.cash, PAYOUT); assert.equal(paid.campaign.completed, 1); assert.equal(paid.activeMission, null);
  assert.equal(completeMission(paid, 'm1', t0 + MIN_MISSION_MS * 2), null);
});

test('legacy imports are clamped', () => {
  assert.deepEqual(clampCampaign({ cash: 1e12, weapon: 9, armor: -2, mission: 3 }), { version: 2, cash: 1e8, weapon: 3, armor: 0, completed: 2 });
  assert.deepEqual(clampCampaign('nope'), freshCampaign());
});

test('save codes round-trip through display formatting and common typos', () => {
  const code = generateSaveCode();
  assert.match(code, /^[0-9A-HJKMNP-TV-Z]{12}$/);
  assert.equal(normalizeSaveCode(formatSaveCode(code).toLowerCase()), code);
  assert.equal(normalizeSaveCode('7KQ2-M9XD-4TRO'), '7KQ2M9XD4TR0');
  assert.equal(normalizeSaveCode('short'), null);
});
