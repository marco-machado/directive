import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GEAR_COST, LEGACY_MAX_COMPLETED, LEGACY_PAYOUT, MAX_LEVEL, MIN_MISSION_MS, missionPayout } from '../src/game/campaign.ts';
import type { Campaign } from '../src/game/campaign.ts';
import { mulberry32 } from '../src/game/rng.ts';
import { handleApi } from '../worker/routes.ts';
import { CampaignStore, UNPLAYED_TTL_MS } from '../worker/store.ts';
import type { LedgerStorage } from '../worker/store.ts';

const CODE = '0123456789AB';
// One Map per save code stands in for each Durable Object's storage; `state.now` is the server's time.
function server() {
  const players = new Map<string, { data: Map<string, unknown>; alarm: number | null; dropAlarm(): void; store: CampaignStore }>();
  const state = { now: 1_000_000, mayCreate: true };
  const player = (code: string) => {
    let p = players.get(code);
    if (!p) {
      const data = new Map<string, unknown>(), held: { alarm: number | null } = { alarm: null };
      const storage: LedgerStorage = {
        get: async <T>(key: string) => data.get(key) as T | undefined,
        put: async (key, value) => { data.set(key, structuredClone(value)); },
        deleteAll: async () => { data.clear(); held.alarm = null; },
        getAlarm: async () => held.alarm,
        setAlarm: async time => { held.alarm = time; },
      };
      p = { data, get alarm() { return held.alarm; }, dropAlarm() { held.alarm = null; }, store: new CampaignStore(storage, mulberry32(7), () => state.now) };
      players.set(code, p);
    }
    return p;
  };
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await handleApi(method, `/api/${path}`, body === undefined ? '' : JSON.stringify(body), { player: code => player(code).store, mayCreate: async () => state.mayCreate });
    return { status: res.status, body: await res.json() as { campaign: Campaign; code?: string; missionId?: string; error?: string } };
  };
  return { state, player, call };
}
// A created player with its first contract deployed.
async function deployed(s = server()) {
  const { body: { campaign } } = await s.call('POST', 'players', { code: CODE });
  const contract = campaign.offers[0];
  const start = await s.call('POST', `campaign/${CODE}/missions`, { contractId: contract.id, squad: [campaign.roster[0].id] });
  return { ...s, campaign, contract, missionId: start.body.missionId!, start };
}

test('creating a player answers 201 with its normalized code, and a retry returns the same campaign', async () => {
  const s = server();
  const first = await s.call('POST', 'players', { code: 'o123-4567-89ab' });
  assert.equal(first.status, 201);
  assert.equal(first.body.code, CODE);
  const again = await s.call('POST', 'players', { code: CODE, legacy: { cash: 9999, completed: 9 } });
  assert.deepEqual(again.body.campaign, first.body.campaign);
  assert.deepEqual((await s.call('GET', `campaign/${CODE}`)).body.campaign, first.body.campaign);
});

test('a create needs a valid code and room under the create limit', async () => {
  const s = server();
  assert.equal((await s.call('POST', 'players', { code: 'nope' })).status, 400);
  assert.equal((await s.call('POST', 'players')).status, 400);
  s.state.mayCreate = false;
  assert.equal((await s.call('POST', 'players', { code: CODE })).status, 429);
  assert.equal(s.player(CODE).data.size, 0);
});

test('unknown codes, malformed codes and unknown routes are refused', async () => {
  const s = server();
  assert.equal((await s.call('GET', `campaign/${CODE}`)).status, 404);
  assert.equal((await s.call('GET', 'campaign/not-a-code')).status, 400);
  assert.equal((await s.call('GET', 'nothing')).status, 404);
  await s.call('POST', 'players', { code: CODE });
  assert.equal((await s.call('PUT', `campaign/${CODE}`)).status, 404);
  assert.equal((await s.call('POST', `campaign/${CODE}/upgrades/laser`)).status, 400);
  assert.equal((await s.call('POST', `campaign/${CODE}/loadout`, { weapon: 'piercing', armor: 'paper' })).status, 400);
  assert.equal((await s.call('POST', `campaign/${CODE}/recruits/NOT_AN_ID`)).status, 400);
});

test('a legacy import is held to what its contract count could have paid', async () => {
  const s = server();
  const { body: { campaign } } = await s.call('POST', 'players', { code: CODE, legacy: { cash: 1e12, weapon: 9, armor: 9, completed: 1e9 } });
  const gear = MAX_LEVEL * (GEAR_COST.weapon + GEAR_COST.armor);
  assert.equal(campaign.completed, LEGACY_MAX_COMPLETED);
  assert.deepEqual([campaign.weapon, campaign.armor], [MAX_LEVEL, MAX_LEVEL]);
  assert.equal(campaign.cash, LEGACY_MAX_COMPLETED * LEGACY_PAYOUT - gear);
});

test('a legacy import with no contracts behind it brings nothing', async () => {
  const s = server();
  const { body: { campaign } } = await s.call('POST', 'players', { code: CODE, legacy: { cash: 5000, weapon: 3, armor: 3 } });
  assert.deepEqual([campaign.cash, campaign.weapon, campaign.armor, campaign.completed], [0, 0, 0, 0]);
});

test('an honest legacy save is imported as it was', async () => {
  const s = server();
  const { body: { campaign } } = await s.call('POST', 'players', { code: CODE, legacy: { cash: 420, weapon: 2, armor: 1, mission: 4 } });
  assert.deepEqual([campaign.cash, campaign.weapon, campaign.armor, campaign.completed], [420, 2, 1, 3]);
});

test('a deploy needs an offered contract and a squad from the roster', async () => {
  const s = server();
  const { body: { campaign } } = await s.call('POST', 'players', { code: CODE });
  const missions = `campaign/${CODE}/missions`, squad = [campaign.roster[0].id];
  assert.equal((await s.call('POST', missions, { contractId: campaign.offers[0].id })).status, 400);
  assert.equal((await s.call('POST', missions, { contractId: 'never-dealt', squad })).status, 409);
  assert.equal((await s.call('POST', missions, { contractId: campaign.offers[0].id, squad: ['stranger'] })).status, 409);
  assert.equal((await s.call('POST', missions, { contractId: campaign.offers[0].id, squad, countermeasures: 1 })).status, 409);
  assert.equal((await s.call('POST', missions, { contractId: campaign.offers[0].id, squad, countermeasures: 9 })).status, 400);
  assert.equal((await s.call('POST', missions, { contractId: campaign.offers[0].id, squad })).status, 201);
});

test('a contract pays once, and no sooner than the minimum mission time', async () => {
  const s = await deployed(), complete = `campaign/${CODE}/missions/${s.missionId}/complete`;
  s.state.now += MIN_MISSION_MS - 1;
  assert.equal((await s.call('POST', complete, { stealth: true })).status, 409);
  s.state.now += 1;
  const paid = await s.call('POST', complete, { stealth: true });
  assert.equal(paid.status, 200);
  assert.equal(paid.body.campaign.cash, missionPayout(s.contract, true));
  assert.equal(paid.body.campaign.completed, 1);
  assert.equal((await s.call('POST', complete, { stealth: true })).status, 409);
  assert.equal((await s.call('POST', `campaign/${CODE}/missions/another/complete`, { stealth: true })).status, 409);
});

test('a report the simulation could not have produced is a bad request, and pays nothing', async () => {
  const s = await deployed(), complete = `campaign/${CODE}/missions/${s.missionId}/complete`;
  s.state.now += MIN_MISSION_MS;
  assert.equal((await s.call('POST', complete, { stealth: true, badges: ['bloodless'], kills: 2 })).status, 400);
  assert.equal((await s.call('POST', complete, { stealth: true, badges: ['bloodless', 'purge'] })).status, 400);
  assert.equal((await s.call('POST', complete, { stealth: true, badges: ['medal'] })).status, 400);
  assert.equal((await s.call('POST', complete, { stealth: true, kills: -1 })).status, 400);
  assert.equal((await s.call('POST', complete, { stealth: true, results: { caches: 3 } })).status, 400);
  assert.equal((await s.call('GET', `campaign/${CODE}`)).body.campaign.cash, 0);
  assert.equal((await s.call('POST', complete, { stealth: false, badges: ['purge'], kills: 4 })).status, 200);
});

test('purchases are refused without the credits', async () => {
  const s = server();
  await s.call('POST', 'players', { code: CODE });
  const refused = await s.call('POST', `campaign/${CODE}/upgrades/weapon`);
  assert.equal(refused.status, 409);
  assert.equal((await s.call('GET', `campaign/${CODE}`)).body.campaign.weapon, 0);
});

test('a save that never deployed expires, and the same code can be created again', async () => {
  const s = server();
  await s.call('POST', 'players', { code: CODE });
  assert.equal(s.player(CODE).alarm, s.state.now + UNPLAYED_TTL_MS);
  assert.equal(await s.player(CODE).store.expire(), true);
  assert.equal((await s.call('GET', `campaign/${CODE}`)).status, 404);
  assert.equal((await s.call('POST', 'players', { code: CODE })).status, 201);
});

test('a save that has deployed never expires', async () => {
  const s = await deployed();
  assert.equal(await s.player(CODE).store.expire(), false);
  assert.equal((await s.call('GET', `campaign/${CODE}`)).status, 200);
});

test('reading an unplayed save from before saves expired starts its clock', async () => {
  const s = server();
  await s.call('POST', 'players', { code: CODE });
  const p = s.player(CODE);
  p.dropAlarm(); // as on a save created before this rule
  s.state.now += 5000;
  await s.call('GET', `campaign/${CODE}`);
  assert.equal(p.alarm, s.state.now + UNPLAYED_TTL_MS);
});
