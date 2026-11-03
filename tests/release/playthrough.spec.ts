import type { JSHandle, Page } from '@playwright/test';
import type { Simulation } from '../../src/game/simulation.ts';
import type { RootState } from '@react-three/fiber';
import { test, expect, VIEWPORTS, devUrl, sleep, shot, note, gpu, canvasBackend, expectedBackend, home, frameTimes, goOffline, goOnline, expectLayoutFits } from './helpers.ts';

// A campaign on the dev server, through the mouse and keyboard: lose a contract, retry and win contract 01, buy an
// upgrade, lose the Worker and get it back, then deploy again. The page's own modules are read only to aim clicks at
// world points and to watch the simulation's state; every order is a real click or key press.
test.use({ baseURL: devUrl(), ...VIEWPORTS.desktop });
test.setTimeout(6 * 60_000);

type Game = { sim: Simulation; scene: () => RootState };

// The shared Simulation and the R3F store, from the same module instances the page runs.
const attach = (page: Page) => page.evaluateHandle(async () => {
  const fiberUrl = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/.vite/deps/@react-three_fiber.js'));
  const appUrl = '/src/app.ts';
  const [fiber, app] = await Promise.all([import(fiberUrl!), import(appUrl)]) as [typeof import('@react-three/fiber'), typeof import('../../src/app.ts')];
  const root = fiber._roots.get(document.querySelector('canvas')!)!;
  return { sim: app.sim, scene: () => root.store.getState() };
});

const state = (game: JSHandle<Game>) => game.evaluate(({ sim }) => {
  const s = sim.getSnapshot();
  return {
    phase: s.phase, time: +s.time.toFixed(1), alarm: s.alarm, stealth: s.stealth, paused: s.paused, result: s.result, failReason: s.failReason,
    pending: !!s.pending, saveUnavailable: s.saveUnavailable, syncing: s.syncing, cash: s.campaign.cash, completed: s.campaign.completed,
    contract: s.contract && { type: s.contract.type, tier: s.contract.tier },
    objectives: s.objectives.map(o => ({ kind: o.kind, done: o.done, x: o.x, z: o.z })),
    squad: s.units.filter(u => u.faction === 'squad').map(u => ({ id: u.id, hp: Math.round(u.hp), x: +u.x.toFixed(1), z: +u.z.toFixed(1) })),
  };
});
type State = Awaited<ReturnType<typeof state>>;

const clickWorld = async (page: Page, game: JSHandle<Game>, x: number, z: number) => {
  const p = await game.evaluate(({ scene }, [x, z]) => {
    const { camera, gl } = scene(), v = camera.position.clone().set(x, .04, z).project(camera), r = gl.domElement.getBoundingClientRect();
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
  }, [x, z] as const);
  await page.mouse.click(p.x, p.y);
};

// Polls until `done` holds, the mission ends, or `gameSeconds` of mission time pass.
async function until(game: JSHandle<Game>, done: (s: State) => boolean, gameSeconds: number, poll = 500) {
  const start = (await state(game)).time;
  for (;;) {
    const s = await state(game);
    if (done(s) || s.phase !== 'mission' || s.time - start > gameSeconds) return s;
    await sleep(poll);
  }
}

// Deploy stays disabled until the server's campaign is in and no save is in flight. Before that the board can be
// the client's own deal, which the server's replaces: a contract chosen from it falls back to the first offer.
const boardReady = (page: Page) => expect(page.locator('.deploy')).toBeEnabled({ timeout: 15_000 });

async function deploy(page: Page) {
  await boardReady(page);
  await page.locator('.deploy').click();
  await expect(page.locator('.tracker')).toBeVisible({ timeout: 15_000 });
  await sleep(1500);
  return attach(page);
}

// From the overview, select everyone and click the point; back to the tactical view.
async function orderSquad(page: Page, game: JSHandle<Game>, x: number, z: number) {
  await page.keyboard.press('KeyR'); await sleep(700);
  await page.keyboard.press('KeyA');
  await clickWorld(page, game, x, z);
  await page.keyboard.press('KeyR'); await sleep(500);
}

// A new campaign's board holds contract 01 and two of assassination, sabotage and escort. A loud squad loses an
// assassination every time (the target escapes within about 20 s), so new campaigns are started until one is offered.
// Contract 01 stays first on the board until a contract is completed, so the retry after the loss is contract 01.
test('lose a contract, retry and win contract 01, buy, drop the Worker, deploy again', async ({ page, errors, renderer }, testInfo) => {
  const report: Record<string, unknown> = {};
  const offers = page.locator('.offer');
  try {
    await test.step('start a campaign that offers an assassination', async () => {
      const boards: string[][] = [];
      report.boards = boards;
      for (;;) {
        await page.goto(home(renderer));
        await page.locator('.title-menu .menu-item.primary:not([disabled])').click({ timeout: 20_000 });
        if (!boards.length) {
          const offered = await gpu(page);
          note(testInfo, 'GPU', offered);
          expect(await canvasBackend(page), 'renderer backend').toBe(expectedBackend(renderer, offered));
        }
        await boardReady(page);
        const types = (await offers.allInnerTexts()).map(t => t.split('\n')[0]);
        boards.push(types);
        const i = types.findIndex(t => /assassination/i.test(t));
        if (i >= 0) { await offers.nth(i).click(); return; }
        expect(boards.length, `an assassination within 8 new campaigns: ${JSON.stringify(boards)}`).toBeLessThan(8);
        await page.evaluate(() => localStorage.clear());
      }
    });

    await test.step('go loud on the assassination and lose it', async () => {
      const game = await deploy(page);
      const start = await state(game);
      expect(start.contract?.type).toBe('assassination');
      // Assault grenade on the street around the first operative, at the first angle with a clear line.
      await page.keyboard.press('Shift+Digit1'); await sleep(300);
      const lead = start.squad[0];
      for (let a = 0; a < 12; a++) {
        await clickWorld(page, game, lead.x + Math.cos(a * Math.PI / 6) * 5, lead.z + Math.sin(a * Math.PI / 6) * 5);
        await sleep(200);
        if (!(await state(game)).pending) break;
      }
      await expect.poll(async () => (await state(game)).alarm, { timeout: 5000 }).toBe(true);
      note(testInfo, 'frame time in combat', await frameTimes(page, 3000));
      await shot(page, testInfo, 'loss-loud');
      await page.keyboard.press('KeyS');
      const end = await until(game, () => false, 120, 1000);
      report.loss = end;
      expect(end).toMatchObject({ phase: 'headquarters', result: 'failure', failReason: 'The target escaped.' });
      await expect(page.locator('.debrief')).toBeVisible();
      await sleep(1500);
      await shot(page, testInfo, 'loss-debrief');
      await expectLayoutFits(page, testInfo, 'the after-action report (loss)');
    });

    const game = await test.step('retry: contract 01 is still first on the board', async () => {
      await page.locator('.debrief-actions .btn.primary').click();
      await boardReady(page);
      await offers.first().click();
      const game = await deploy(page);
      expect((await state(game)).contract).toEqual({ type: 'heist', tier: 1 });
      note(testInfo, 'frame time at contract 01 start', await frameTimes(page, 3000));
      return game;
    });

    await test.step('win contract 01: each objective in turn, then extraction', async () => {
      const start = await state(game);
      await shot(page, testInfo, 'c01-start');
      for (const [i, o] of start.objectives.entries()) {
        if (o.kind === 'extract') continue;
        await orderSquad(page, game, o.x, o.z);
        let s = await until(game, s => s.objectives[i].done || s.alarm, 150);
        // Weapons are free after an alarm; keep pushing onto the objective.
        if (s.alarm && !s.objectives[i].done) {
          report.c01Alarm = s.time;
          await orderSquad(page, game, o.x, o.z);
          s = await until(game, s => s.objectives[i].done, 180);
        }
        expect(s.objectives[i].done, `${o.kind} objective done`).toBe(true);
      }
      const extract = start.objectives.at(-1)!;
      await orderSquad(page, game, extract.x, extract.z);
      const end = await until(game, () => false, 200);
      report.c01 = end;
      expect(end).toMatchObject({ phase: 'headquarters', result: 'success' });
      await expect(page.locator('.debrief')).toBeVisible();
      await sleep(1500);
      await shot(page, testInfo, 'c01-debrief');
      await expectLayoutFits(page, testInfo, 'the after-action report (win)');
    });

    await test.step('buy an upgrade at headquarters', async () => {
      await page.locator('.debrief-actions .btn:has-text("Headquarters")').click();
      const buy = page.locator('button[aria-label^="Upgrade Smart ammunition"]');
      await expect(buy).toBeEnabled();
      await sleep(800);
      const before = (await state(game)).cash;
      await buy.click();
      await expect.poll(async () => (await state(game)).cash).toBeLessThan(before);
      await expect.poll(async () => (await state(game)).syncing).toBe(false);
      await shot(page, testInfo, 'hq');
      await expectLayoutFits(page, testInfo, 'headquarters');
    });

    await test.step('Worker offline: warns that progress is not saved, then resyncs', async () => {
      await goOffline(page, errors);
      await page.locator('.btn.buy:not([disabled])').first().click();
      await expect(page.locator('.uplink')).toContainText('OFFLINE', { ignoreCase: true });
      expect((await state(game)).saveUnavailable).toBe(true);
      expect(errors.blocked.size, 'requests dropped while offline').toBeGreaterThan(0);
      await shot(page, testInfo, 'offline');
      await goOnline(page);
      await expect.poll(async () => (await state(game)).saveUnavailable, { timeout: 15_000 }).toBe(false);
      await expect(page.locator('.uplink')).not.toContainText('OFFLINE', { ignoreCase: true });
    });

    await test.step('deploy the next contract', async () => {
      await page.locator('.tabs button:has-text("Missions")').click();
      await expect(offers).toHaveCount(3);
      const next = await deploy(page);
      expect((await state(next)).phase).toBe('mission');
      await shot(page, testInfo, 'next-mission');
    });
  } finally {
    await testInfo.attach('playthrough.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  }
});
