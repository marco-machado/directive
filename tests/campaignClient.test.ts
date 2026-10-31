import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { freshCampaign, MIN_MISSION_MS } from '../src/game/campaign.ts';
import type { Simulation } from '../src/game/simulation.ts';
import { CampaignClient } from '../src/net/campaignClient.ts';

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
  const sim = { applyCampaign: (c: unknown) => applied.push(c), setSaveUnavailable: (u: boolean) => unavailable.push(u) } as unknown as Simulation;
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
