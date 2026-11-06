import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDismiss, applyLoadout, applyPayout, applyPurchase, applyRecruit, BADGE_POINTS, baseTier, CAMPAIGN_VERSION, clampCampaign, clearancePoints, CONTRACT_POINTS, completeMission, contractPayout, dealBoard, DEFAULT_LOADOUT, FIRST_CONTRACT, freshCampaign, isLoadout, MAX_TIER, MAX_COUNTERMEASURES, MAX_LEVEL, MIN_MISSION_MS, missionReport, nextUnlock, offerTiers, OPENING_CONTRACTS, PAR_PER_TIER, PAR_SECONDS, parSeconds, RECRUIT_COST, ROSTER_CAP, SILENT_CLASSES, squadRating, startMission, threatFor, topTier, unlockedCountermeasures, upgradeLedger, UNLOCK_TIER, unlockedTypes, nextTypeUnlock } from '../src/game/campaign.ts';
import type { Ledger, MissionReport, UnlockTiers } from '../src/game/campaign.ts';
import { mulberry32 } from '../src/game/rng.ts';
import { formatSaveCode, generateSaveCode, normalizeSaveCode } from '../src/game/saveCode.ts';

const rng = mulberry32(42);
const QUIET: MissionReport = { stealth: true, badges: ['ghost'] }, LOUD: MissionReport = { stealth: false, badges: [] };
// Campaign progress: completed contracts, and badges (all counted as Ghosts).
const done = (completed: number, badges = 0) => ({ completed, badges: { ghost: badges, untouched: 0, swift: 0, bloodless: 0, purge: 0 } });

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
  const c = freshCampaign(rng), started = startMission({ campaign: c, activeMission: null }, 'm', 0, c.offers[0].id, ['vex'], 0, rng)!;
  assert.ok(started.campaign.offers.every(o => o.tier <= 2));
});

test('the threat read weighs the tier against roster size and upgrades', () => {
  const starters = freshCampaign(rng);
  assert.deepEqual([1, 2, 3, 4].map(t => threatFor(starters, t)), ['low', 'moderate', 'high', 'extreme']);
  const four = { ...starters, roster: (['assault', 'support', 'recon', 'tech'] as const).map((cls, i) => ({ id: `o${i}`, name: `OP${i}`, cls })) };
  assert.deepEqual([2, 3, 4, 5].map(t => threatFor(four, t)), ['low', 'moderate', 'high', 'extreme']);
  const maxed = { ...four, weapon: 3, armor: 3, abilities: { assault: 3, support: 3, recon: 3, tech: 3 } };
  // Gear and abilities take a tier off, but no upgrade makes the top tier easy.
  assert.deepEqual([4, 5].map(t => threatFor(maxed, t)), ['low', 'moderate']);
  // Abilities count only for classes on the roster.
  assert.equal(squadRating({ ...starters, abilities: { ...starters.abilities, recon: 3, tech: 3 } }), squadRating(starters));
});

test('offers bracket the base tier, which rises with completed contracts', () => {
  const veteran = clampCampaign({ completed: 6 }, rng);
  assert.equal(baseTier(CONTRACT_POINTS * 6), 4);
  assert.deepEqual(veteran.offers.map(o => o.tier), [3, 4, 5]);
  assert.deepEqual(veteran.offers.map(o => o.payout), [3, 4, 5].map(contractPayout));
  assert.equal(new Set(veteran.offers.map(o => o.type)).size, 3);
  assert.equal(contractPayout(5), 1500);
  assert.deepEqual(clampCampaign({ completed: 40 }, rng).offers.map(o => o.tier), [3, 4, 5]);
});

test('the next tier unlock counts the contracts left and stops at the top tier', () => {
  assert.deepEqual([0, 1, 2, 4, 6, 9].map(c => topTier(done(c))), [2, 2, 3, 4, 5, 5]);
  assert.deepEqual(nextUnlock(done(0)), { tier: 3, points: 4, contracts: 2, progress: 0 });
  assert.deepEqual(nextUnlock(done(1)), { tier: 3, points: 2, contracts: 1, progress: .5 });
  assert.deepEqual(nextUnlock(done(5)), { tier: 5, points: 2, contracts: 1, progress: .5 });
  for (let c = 0; c < 6; c++) { const n = nextUnlock(done(c))!; assert.equal(topTier(done(c + n.contracts)), n.tier); assert.equal(topTier(done(c + n.contracts - 1)), n.tier - 1); }
  assert.equal(topTier(done(6)), MAX_TIER); assert.equal(nextUnlock(done(6)), null);
});

test('each badge counts as half a contract toward clearance, but not during the opening', () => {
  assert.equal(clearancePoints(done(3, 2)), 3 * CONTRACT_POINTS + 2 * BADGE_POINTS);
  assert.deepEqual(offerTiers(done(1, 5)), [1, 1, 2]);
  assert.equal(topTier(done(2)), 3); assert.equal(topTier(done(2, 4)), 4);
  assert.deepEqual(nextUnlock(done(2, 1)), { tier: 4, points: 3, contracts: 2, progress: .25 });
  // Two badges do what one more contract would.
  assert.equal(topTier(done(3, 2)), topTier(done(4)));
});

test('a mission report keeps known badges, ties Ghost to stealth, and rejects anything else', () => {
  assert.deepEqual(missionReport(true, ['swift', 'swift']), { stealth: true, badges: ['ghost', 'swift'] });
  assert.deepEqual(missionReport(false, ['ghost', 'purge']), { stealth: false, badges: ['purge'] });
  assert.deepEqual(missionReport(true), { stealth: true, badges: ['ghost'] });
  assert.equal(missionReport(true, ['medal']), null);
  assert.equal(missionReport(true, 'swift'), null);
  assert.equal(parSeconds('heist', 3), PAR_SECONDS.heist + 2 * PAR_PER_TIER);
});

test('a payout counts the badges earned', () => {
  const c = freshCampaign(rng), contract = c.offers[1];
  const paid = applyPayout(c, contract, 0, { stealth: false, badges: ['untouched', 'swift'] }, rng);
  assert.equal(paid.badges.untouched, 1); assert.equal(paid.badges.swift, 1); assert.equal(paid.badges.ghost, 0);
  assert.equal(clearancePoints(paid), CONTRACT_POINTS + 2 * BADGE_POINTS);
  assert.deepEqual(clampCampaign({ ...paid, badges: { swift: 2, bogus: 9 } }, rng).badges, { ghost: 0, untouched: 0, swift: 2, bloodless: 0, purge: 0 });
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
    const ledger = startMission({ campaign: fresh, activeMission: null }, 'm', 0, fresh.offers[0].id, ['vex'], 0, r)!;
    assert.ok(silent(ledger.campaign), `seed ${seed}: board dealt by the first deploy`);
    const paid = completeMission(ledger, 'm', MIN_MISSION_MS, QUIET, rng)!.campaign;
    assert.ok(paid.cash >= RECRUIT_COST && silent(paid));
    if (!silent(dealBoard(paid, r))) later++;
  }
  assert.ok(later > 0, 'after the first payout recruits are random again');
});

test('a mission pays its stored contract once, only for the active id, and never too early', () => {
  const t0 = 1_000_000, campaign = freshCampaign(rng), offer = campaign.offers[2];
  const ledger = startMission({ campaign, activeMission: null }, 'm1', t0, offer.id, ['vex', 'rook'], 0, rng)!;
  assert.ok(!ledger.campaign.offers.some(o => o.id === offer.id), 'deploying rerolls the board');
  assert.equal(completeMission(ledger, 'm1', t0 + MIN_MISSION_MS - 1, LOUD, rng), null);
  assert.equal(completeMission(ledger, 'other', t0 + MIN_MISSION_MS, LOUD, rng), null);
  const paid = completeMission(ledger, 'm1', t0 + MIN_MISSION_MS, LOUD, rng)!;
  assert.equal(paid.campaign.cash, offer.payout); assert.equal(paid.campaign.completed, 1); assert.equal(paid.activeMission, null);
  assert.equal(completeMission(paid, 'm1', t0 + MIN_MISSION_MS * 2, LOUD, rng), null);
  const sneaky = completeMission(ledger, 'm1', t0 + MIN_MISSION_MS, QUIET, rng)!;
  assert.equal(sneaky.campaign.cash, Math.round(offer.payout * 1.25));
});

test('deploys reject unknown contracts and invalid squads; restarts keep the board', () => {
  const campaign = freshCampaign(rng), offer = campaign.offers[0], base: Ledger = { campaign, activeMission: null };
  assert.equal(startMission(base, 'm', 0, 'forged', ['vex'], 0, rng), null);
  assert.equal(startMission(base, 'm', 0, offer.id, [], 0, rng), null);
  assert.equal(startMission(base, 'm', 0, offer.id, ['vex', 'vex'], 0, rng), null);
  assert.equal(startMission(base, 'm', 0, offer.id, ['ghost'], 0, rng), null);
  const started = startMission(base, 'm1', 0, offer.id, ['vex'], 0, rng)!;
  const restarted = startMission(started, 'm2', 5, offer.id, ['vex', 'rook'], 0, rng)!;
  assert.deepEqual(restarted.campaign, started.campaign);
  assert.equal(restarted.activeMission!.contract.id, offer.id);
});

test('imports are clamped and imported contracts never pay above their tier', () => {
  const c = clampCampaign({ cash: 1e12, weapon: 9, armor: -2, mission: 3, offers: [{ id: 'x', type: 'heist', tier: 99, payout: 1e9, seed: 1, district: 'X', sector: 1 }] }, rng);
  assert.equal(c.cash, 1e8); assert.equal(c.weapon, 3); assert.equal(c.armor, 0); assert.equal(c.completed, 2);
  assert.equal(c.offers[0].tier, 5); assert.equal(c.offers[0].payout, 1500);
  assert.equal(clampCampaign('nope', rng).version, CAMPAIGN_VERSION);
  assert.equal(clampCampaign({ roster: [{ id: '<script>', name: 'x', cls: 'god' }] }, rng).roster.length, 2);
});

test('save codes round-trip through display formatting and common typos', () => {
  const code = generateSaveCode();
  assert.match(code, /^[0-9A-HJKMNP-TV-Z]{12}$/);
  assert.equal(normalizeSaveCode(formatSaveCode(code).toLowerCase()), code);
  assert.equal(normalizeSaveCode('7KQ2-M9XD-4TRO'), '7KQ2M9XD4TR0');
  assert.equal(normalizeSaveCode('short'), null);
});

test('contract 01 is the same hand-checked heist until a contract is completed', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const fresh = freshCampaign(mulberry32(seed)), first = fresh.offers[0];
    assert.deepEqual({ ...first, id: '' }, { ...FIRST_CONTRACT, id: '', payout: contractPayout(1) });
    assert.equal(new Set(fresh.offers.map(o => o.type)).size, 3);
    assert.ok(fresh.offers.slice(1).every(o => o.patrols === undefined));
    // A failed or abandoned first run deals it again; the first payout deals a board without it.
    const ledger = startMission({ campaign: fresh, activeMission: null }, 'm', 0, first.id, ['vex'], 0, mulberry32(seed))!;
    assert.equal(ledger.campaign.offers[0].seed, FIRST_CONTRACT.seed);
    const paid = completeMission(ledger, 'm', MIN_MISSION_MS, QUIET, rng)!.campaign;
    assert.deepEqual(paid.offers.map(o => o.tier), [1, 1, 2]);
    assert.deepEqual(paid.recruits, ledger.campaign.recruits);
    assert.ok(paid.offers.every(o => o.seed !== FIRST_CONTRACT.seed && o.patrols === undefined));
  }
  // Saved boards keep the patrol cap through the clamp, within bounds.
  assert.equal(clampCampaign({ offers: [{ ...FIRST_CONTRACT, id: 'a' }] }, rng).offers[0].patrols, 1);
  assert.equal(clampCampaign({ offers: [{ ...FIRST_CONTRACT, id: 'a', patrols: 99 }] }, rng).offers[0].patrols, 8);
});

test('loadouts switch for free and are clamped on import', () => {
  const c = freshCampaign(rng);
  assert.deepEqual(c.loadout, DEFAULT_LOADOUT);
  assert.deepEqual(applyLoadout(c, { weapon: 'extended', armor: 'light' }), { ...c, loadout: { weapon: 'extended', armor: 'light' } });
  assert.equal(isLoadout({ weapon: 'laser', armor: 'heavy' }), false);
  assert.equal(isLoadout({ weapon: 'suppressed', armor: 'light' }), true);
  assert.deepEqual(clampCampaign({ ...c, loadout: { weapon: 'laser', armor: 'light' } }, rng).loadout, { weapon: 'piercing', armor: 'light' });
});

test('upgrading an older ledger keeps the mission in flight and its payout claim', () => {
  const c = freshCampaign(rng), offer = c.offers[0];
  const old = { campaign: { ...c, version: 3, loadout: undefined }, activeMission: { id: 'm1', startedAt: 5, contract: offer } } as unknown as Ledger;
  const up = upgradeLedger(old, rng);
  assert.equal(up.campaign.version, CAMPAIGN_VERSION); assert.deepEqual(up.campaign.loadout, DEFAULT_LOADOUT);
  assert.deepEqual(up.activeMission, { id: 'm1', startedAt: 5, contract: offer, countermeasures: 0 });
  assert.ok(completeMission(up, 'm1', 5 + MIN_MISSION_MS, QUIET, rng));
  assert.equal(upgradeLedger({ ...old, activeMission: { id: 7 } } as unknown as Ledger, rng).activeMission, null);
});

test('Countermeasures open once fully upgraded, refuse a locked level, and a badge on the top open level opens the next', () => {
  const base = freshCampaign(rng), maxed = { ...base, weapon: MAX_LEVEL, armor: MAX_LEVEL, abilities: { assault: MAX_LEVEL, support: MAX_LEVEL, recon: MAX_LEVEL, tech: MAX_LEVEL } };
  assert.equal(unlockedCountermeasures(base), 0); assert.equal(unlockedCountermeasures(maxed), 1);
  assert.equal(unlockedCountermeasures({ ...maxed, abilities: { ...maxed.abilities, tech: 2 } }), 0);
  const offer = maxed.offers[0], ledger: Ledger = { campaign: maxed, activeMission: null };
  assert.equal(startMission(ledger, 'm', 0, offer.id, ['vex'], 2, rng), null);
  const started = startMission(ledger, 'm', 0, offer.id, ['vex'], 1, rng)!;
  assert.equal(started.activeMission!.countermeasures, 1);
  assert.equal(startMission(started, 'm2', 0, offer.id, ['vex'], 2, rng), null); // a restart is held to the open levels too
  assert.equal(completeMission(started, 'm', MIN_MISSION_MS, LOUD, rng)!.campaign.countermeasures, 0); // no badge, no unlock
  const cleared = completeMission(started, 'm', MIN_MISSION_MS, QUIET, rng)!.campaign;
  assert.equal(cleared.countermeasures, 1); assert.equal(unlockedCountermeasures(cleared), 2);
  assert.equal(unlockedCountermeasures({ ...cleared, countermeasures: MAX_COUNTERMEASURES }), MAX_COUNTERMEASURES);
  assert.equal(clampCampaign({ ...cleared, countermeasures: 9 }, rng).countermeasures, MAX_COUNTERMEASURES);
  // Clearing a lower level than the top open one unlocks nothing.
  const low = startMission({ campaign: { ...maxed, countermeasures: 1 }, activeMission: null }, 'm', 0, offer.id, ['vex'], 1, rng)!;
  assert.equal(completeMission(low, 'm', MIN_MISSION_MS, QUIET, rng)!.campaign.countermeasures, 1);
});

test('contract types join the board as clearance rises, each guaranteed on the first board after it unlocks', () => {
  // A table with later types, as new types will have; the four current types all deal from tier 1.
  assert.deepEqual(Object.values(UNLOCK_TIER), [1, 1, 1, 1]);
  const unlock: UnlockTiers = { assassination: 1, heist: 1, sabotage: 2, escort: 3 };
  assert.deepEqual(unlockedTypes(done(0), unlock), ['assassination', 'heist']);
  assert.deepEqual(unlockedTypes(done(2), unlock), ['assassination', 'heist', 'sabotage']);
  assert.deepEqual(nextTypeUnlock(done(1), unlock), { type: 'sabotage', tier: 2, points: 2, contracts: 1, progress: .5 });
  assert.deepEqual(nextTypeUnlock(done(2), unlock), { type: 'escort', tier: 3, points: 4, contracts: 2, progress: 0 });
  assert.equal(nextTypeUnlock(done(4), unlock), null);
  assert.equal(nextTypeUnlock(done(0)), null);
  for (let seed = 1; seed <= 30; seed++) {
    const r = mulberry32(seed);
    // Only unlocked types are dealt, with repeats once there are fewer types than offers.
    const early = dealBoard({ ...freshCampaign(r), completed: 1, dealt: [] }, r, unlock);
    assert.ok(early.offers.every(o => o.type === 'assassination' || o.type === 'heist'));
    // The first board after an unlock includes the new type, and later boards deal it like any other.
    const veteran = { ...early, completed: 2, dealt: early.dealt };
    assert.ok(!veteran.dealt.includes('sabotage'));
    const after = dealBoard(veteran, r, unlock);
    assert.ok(after.offers.some(o => o.type === 'sabotage'), `seed ${seed}`);
    assert.ok(after.dealt.includes('sabotage'));
    // Contract 01 stays first until the first win, whatever unlocks.
    const fresh = dealBoard({ ...freshCampaign(r), dealt: [], badges: { ...freshCampaign(r).badges, ghost: 8 } }, r, unlock);
    assert.equal(fresh.offers[0].seed, FIRST_CONTRACT.seed);
    assert.ok(fresh.offers.slice(1).every(o => o.type !== 'heist'));
  }
  // A save from before types unlocked counts what its progress unlocks as already dealt.
  assert.deepEqual(clampCampaign({ completed: 3, offers: [] }, rng).dealt.length, 4);
  assert.deepEqual(clampCampaign({ dealt: ['heist', 'nope'] }, rng).dealt.includes('nope' as never), false);
});
