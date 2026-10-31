import { test, mock } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { freshCampaign, MIN_MISSION_MS } from '../src/game/campaign.ts';
import type { Simulation } from '../src/game/simulation.ts';
import { CampaignClient, connectPlayer, fetchCampaign } from '../src/net/campaignClient.ts';

const settle = () => new Promise(resolve => setImmediate(resolve));

test('a fast win waits for the minimum mission time after the server registers the mission', async t => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  t.after(() => mock.timers.reset());
  t.mock.method(performance, 'now', () => Date.now());
  const startLatency = 3000;
  const calls: string[] = [];
  const started = freshCampaign();
  const paid = { ...started, cash: 500, completed: 1 };
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    calls.push(url);
    if (url.endsWith('/missions')) {
      await new Promise(resolve => setTimeout(resolve, startLatency));
      return { ok: true, status: 201, json: async () => ({ missionId: 'm1', campaign: started }) };
    }
    return { ok: true, status: 200, json: async () => ({ campaign: paid }) };
  });
  const applied: unknown[] = [], unavailable: boolean[] = [];
  const sim = { applyCampaign: (c: unknown) => applied.push(c), setSaveUnavailable: (u: boolean) => unavailable.push(u), setSyncing: () => {} } as unknown as Simulation;
  const client = new CampaignClient();
  client.attach(sim, 'CODE');

  client.deployed('c1', ['vex']);
  client.completed(false);
  await settle();
  mock.timers.tick(startLatency);
  await settle();
  // Counting from deployed() would claim here; the server only started its clock when it answered.
  mock.timers.tick(MIN_MISSION_MS - startLatency);
  await settle();
  assert.deepEqual(calls, ['/api/campaign/CODE/missions']);

  mock.timers.tick(startLatency);
  await settle();
  assert.deepEqual(calls, ['/api/campaign/CODE/missions', '/api/campaign/CODE/missions/m1/complete']);
  assert.deepEqual(applied, [paid]);
  assert.ok(!unavailable.includes(true));
});

test('the client reports syncing until a held payout claim lands, so a save code cannot be loaded over it', async t => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  t.after(() => mock.timers.reset());
  t.mock.method(performance, 'now', () => Date.now());
  t.mock.method(globalThis, 'fetch', async (url: string) => url.endsWith('/missions')
    ? { ok: true, status: 201, json: async () => ({ missionId: 'm1', campaign: freshCampaign() }) }
    : { ok: true, status: 200, json: async () => ({ campaign: freshCampaign() }) });
  let syncing = false;
  const sim = { applyCampaign: () => {}, setSaveUnavailable: () => {}, setSyncing: (s: boolean) => { syncing = s; } } as unknown as Simulation;
  const client = new CampaignClient();
  client.attach(sim, 'CODE');

  client.deployed('c1', ['vex']);
  client.completed(false);
  await settle();
  assert.equal(syncing, true);

  mock.timers.tick(MIN_MISSION_MS);
  await settle();
  assert.equal(syncing, false);
});

test('a failed sync stops reporting syncing, so a save code can still be loaded to recover', async t => {
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 500, json: async () => ({ error: 'down' }) }));
  let syncing = false;
  const unavailable: boolean[] = [];
  const sim = { applyCampaign: () => {}, setSaveUnavailable: (u: boolean) => unavailable.push(u), setSyncing: (s: boolean) => { syncing = s; } } as unknown as Simulation;
  const client = new CampaignClient();
  client.attach(sim, 'CODE');

  client.bought('weapon');
  assert.equal(syncing, true);
  await settle();
  assert.equal(syncing, false);
  assert.deepEqual(unavailable, [true]);
});

test('loading a save code clears syncing, and a run from the old save cannot clear the new one', async t => {
  const replies: Array<(res: unknown) => void> = [];
  t.mock.method(globalThis, 'fetch', () => new Promise(resolve => replies.push(resolve)));
  const ok = { ok: true, status: 200, json: async () => ({ campaign: freshCampaign() }) };
  let syncing = false;
  const sim = { applyCampaign: () => {}, setSaveUnavailable: () => {}, setSyncing: (s: boolean) => { syncing = s; } } as unknown as Simulation;
  const client = new CampaignClient();
  client.attach(sim, 'OLD');

  client.bought('weapon');
  assert.equal(syncing, true);
  client.attach(sim, 'NEW');
  assert.equal(syncing, false);

  client.bought('armor');
  replies[0](ok);
  await settle();
  assert.equal(syncing, true);
  replies[1](ok);
  await settle();
  assert.equal(syncing, false);
});

test('a request the server never answers times out after 10 s, so the queue stops syncing', async t => {
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  const expire = new AbortController();
  const timeout = t.mock.method(AbortSignal, 'timeout', () => expire.signal);
  t.mock.method(globalThis, 'fetch', (_url: string, init: RequestInit) =>
    new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason))));
  let syncing = false;
  const unavailable: boolean[] = [];
  const sim = { applyCampaign: () => {}, setSaveUnavailable: (u: boolean) => unavailable.push(u), setSyncing: (s: boolean) => { syncing = s; } } as unknown as Simulation;
  const client = new CampaignClient();
  client.attach(sim, 'CODE');

  client.bought('weapon');
  await settle();
  assert.equal(syncing, true);
  assert.deepEqual(timeout.mock.calls[0].arguments, [10_000]);

  expire.abort();
  await settle();
  assert.equal(syncing, false);
  assert.deepEqual(unavailable, [true]);
});

test('a success reply whose body times out mid-read rejects instead of passing as an empty reply', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, status: 200, json: async () => { throw new DOMException('Timed out.', 'TimeoutError'); } }));
  await assert.rejects(fetchCampaign('CODE'), { name: 'TimeoutError' });
});

test('after a failed sync the server is checked every 5 s, and its campaign replaces the unsynced progress', async t => {
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  const server = { ...freshCampaign(), cash: 900 };
  const calls: string[] = [];
  let up = false;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    calls.push(`${init.method} ${url}`);
    return up ? { ok: true, status: 200, json: async () => ({ campaign: server }) } : { ok: false, status: 503, json: async () => ({}) };
  });
  const applied: unknown[] = [], unavailable: boolean[] = [];
  const sim = { applyCampaign: (c: unknown) => applied.push(c), setSaveUnavailable: (u: boolean) => unavailable.push(u), setSyncing: () => {} } as unknown as Simulation;
  const client = new CampaignClient();
  client.attach(sim, 'CODE');

  client.bought('weapon');
  await settle();
  client.recruited('r1');
  mock.timers.tick(5000);
  await settle();
  assert.deepEqual(calls, ['POST /api/campaign/CODE/upgrades/weapon', 'GET /api/campaign/CODE']);

  up = true;
  mock.timers.tick(5000);
  await settle();
  // The recruit queued while offline is dropped with the rest of the unsynced progress.
  assert.deepEqual(calls.slice(2), ['GET /api/campaign/CODE']);
  assert.deepEqual(applied, [server]);
  assert.deepEqual(unavailable, [true, false]);

  client.bought('armor');
  await settle();
  assert.equal(calls.at(-1), 'POST /api/campaign/CODE/upgrades/armor');
});

// A browser with localStorage and an old pre-server save, against a fake Worker whose create replies can be lost.
function firstVisit(t: TestContext, { createReaches }: { createReaches: boolean }) {
  const stored = new Map([['ndSave', JSON.stringify({ cash: 300 })]]);
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => stored.set(k, v), removeItem: (k: string) => stored.delete(k),
  } });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'localStorage', original); else delete (globalThis as { localStorage?: unknown }).localStorage; });
  const players = new Map<string, unknown>(), creates: { code: string; legacy?: unknown }[] = [];
  let lose = true;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    if (init.method === 'POST') {
      const request = JSON.parse(init.body as string) as { code: string; legacy?: unknown };
      creates.push(request);
      if (lose && !createReaches) throw new DOMException('Timed out.', 'TimeoutError');
      if (!players.has(request.code)) players.set(request.code, freshCampaign());
      if (lose) throw new DOMException('Timed out.', 'TimeoutError');
      return { ok: true, status: 201, json: async () => ({ code: request.code, campaign: players.get(request.code) }) };
    }
    const campaign = players.get(url.split('/').at(-1)!);
    return campaign ? { ok: true, status: 200, json: async () => ({ campaign }) } : { ok: false, status: 404, json: async () => ({ error: 'Unknown save code.' }) };
  });
  return { stored, creates, players, answer: () => { lose = false; } };
}

test('a player create lost on the way is retried with the same stored code and the old save', async t => {
  const visit = firstVisit(t, { createReaches: false });
  await assert.rejects(connectPlayer(), { name: 'TimeoutError' });
  assert.equal(visit.stored.has('ndSave'), true);

  visit.answer();
  const { code } = await connectPlayer();
  assert.equal(visit.creates.length, 2);
  assert.equal(visit.creates[1].code, visit.creates[0].code);
  assert.equal(code, visit.creates[0].code);
  assert.ok(visit.creates[1].legacy);
  assert.equal(visit.stored.has('ndSave'), false);
});

test('a player create whose reply is lost after it landed is found again, and the old save is removed', async t => {
  const visit = firstVisit(t, { createReaches: true });
  await assert.rejects(connectPlayer(), { name: 'TimeoutError' });

  const { code } = await connectPlayer();
  assert.ok(visit.creates[0].legacy);
  assert.equal(visit.creates.length, 1);
  assert.equal(code, visit.creates[0].code);
  assert.equal(visit.players.size, 1);
  assert.equal(visit.stored.has('ndSave'), false);
});

test('a resync drops the old mission id, so winning the next mission cannot claim one that was lost', async t => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  t.after(() => mock.timers.reset());
  t.mock.method(performance, 'now', () => Date.now());
  const calls: string[] = [];
  let deploys = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    calls.push(`${init.method} ${url}`);
    if (url.endsWith('/missions') && ++deploys === 2) return { ok: false, status: 503, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ missionId: 'A', campaign: freshCampaign() }) };
  });
  const sim = { applyCampaign: () => {}, setSaveUnavailable: () => {}, setSyncing: () => {} } as unknown as Simulation;
  const client = new CampaignClient();
  client.attach(sim, 'CODE');

  // Mission A is lost, so it is never claimed; the deploy of mission B then fails.
  client.deployed('a', ['vex']);
  await settle();
  client.deployed('b', ['vex']);
  await settle();
  mock.timers.tick(5000);
  await settle();

  client.completed(true);
  await settle();
  mock.timers.tick(MIN_MISSION_MS);
  await settle();
  assert.ok(!calls.some(c => c.includes('/missions/A/complete')));
});
