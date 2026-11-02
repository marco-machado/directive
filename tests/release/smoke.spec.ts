import type { Page } from '@playwright/test';
import { test, expect, VIEWPORTS, previewUrl, sleep, shot, note, gpu, frameTimes, expectLayoutFits } from './helpers.ts';

// The production build on each supported viewport, through real mouse, keyboard and touch input: title, contract
// board, deploy, a move order, pause, the mission menu and its dialogs, restart, and (on touch) a long-press waypoint.
test.use({ baseURL: previewUrl() });

const { phone, ...supported } = VIEWPORTS;
const status = (page: Page) => page.getByRole('status');
const clock = async (page: Page) => {
  const [m, s] = (await page.locator('.status-clock').innerText()).split(':').map(Number);
  return m * 60 + s;
};

for (const [name, device] of Object.entries(supported)) {
  test.describe(name, () => {
    test.use(device);

    test('title to mission and back through every menu', async ({ page }, testInfo) => {
      const touch = 'hasTouch' in device && device.hasTouch;
      const press = (selector: string) => touch ? page.locator(selector).tap() : page.locator(selector).click();
      // The top bar's pause button names the state on every layout; the pause banner and badge each show only on some.
      const paused = page.locator('.topbar button[aria-label="Resume"]');
      const togglePause = () => touch ? press('.topbar :is(button[aria-label="Pause"], button[aria-label="Resume"])') : page.keyboard.press('Space');

      await page.goto('/');
      await expect(page.locator('canvas')).toBeAttached({ timeout: 15_000 });
      note(testInfo, 'GPU', await gpu(page));

      await test.step('title', async () => {
        await expect(page.locator('.title-menu .menu-item.primary')).toBeEnabled({ timeout: 15_000 });
        await sleep(1000);
        await shot(page, testInfo, '1-title');
        await expectLayoutFits(page, testInfo, 'the title');
      });

      await test.step('start campaign', async () => {
        await press('.title-menu .menu-item.primary');
        await expect(page.locator('.select-offers')).toBeVisible();
        await expect(page.locator('.offer')).toHaveCount(3);
        await sleep(1200);
        await shot(page, testInfo, '2-board');
        await expectLayoutFits(page, testInfo, 'the contract board');
      });

      await test.step('deploy', async () => {
        await expect(page.locator('.deploy')).toBeEnabled({ timeout: 15_000 });
        await press('.deploy');
        await expect(page.locator('.tracker')).toBeVisible({ timeout: 15_000 });
        await expect(status(page)).toContainText('Squad deployed');
        await sleep(2500);
        await shot(page, testInfo, '3-mission-start');
        await expectLayoutFits(page, testInfo, 'the mission HUD');
      });

      // Up and right of the free frame's center: open street in contract 01's opening view on every viewport.
      const street = async () => {
        const frame = (await page.locator('.view-frame').boundingBox())!;
        return { x: frame.x + frame.width * .62, y: frame.y + frame.height * .38 };
      };

      // Select (all on a keyboard, the first operative on touch), then order a move.
      await test.step('select and move', async () => {
        if (touch) await press('.agent:nth-child(1) .agent-select'); else await page.keyboard.press('KeyA');
        const { x, y } = await street();
        if (touch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
        await expect(status(page)).toContainText('Move order confirmed');
        await sleep(2500);
        await shot(page, testInfo, '4-moving');
      });

      if (!touch) await test.step('frame time in active play', async () => { note(testInfo, 'frame time', await frameTimes(page, 5000)); });

      await test.step('pause', async () => {
        await expect(paused).toHaveCount(0);
        await togglePause();
        await expect(paused).toBeVisible({ timeout: 3000 });
        await shot(page, testInfo, '5-paused');
      });

      await test.step('mission menu', async () => {
        await press('button[aria-label="Mission menu"]');
        await expect(page.locator('dialog[open].menu-dialog')).toBeVisible({ timeout: 3000 });
        await sleep(300);
        await shot(page, testInfo, '6-menu');
        await expectLayoutFits(page, testInfo, 'the mission menu');
      });

      await test.step('audio dialog from the menu', async () => {
        await press('.menu-dialog .menu-item:has-text("Audio")');
        await expect(page.locator('dialog[open].audio-dialog')).toBeVisible({ timeout: 3000 });
        await sleep(300);
        await shot(page, testInfo, '7-audio');
        await expectLayoutFits(page, testInfo, 'the audio dialog');
        await page.keyboard.press('Escape');
        await expect(page.locator('dialog[open].audio-dialog')).toHaveCount(0);
        await expect(page.locator('dialog[open].menu-dialog')).toBeVisible();
      });

      await test.step('manual from the menu', async () => {
        await press('.menu-dialog .menu-item:has-text("Operator manual")');
        await expect(page.locator('dialog[open].manual')).toBeVisible({ timeout: 3000 });
        await sleep(500);
        await shot(page, testInfo, '8-manual');
        await expectLayoutFits(page, testInfo, 'the operator manual');
        await page.keyboard.press('Escape');
        await expect(page.locator('dialog[open]')).toHaveCount(0);
      });

      await test.step('restart contract', async () => {
        await press('button[aria-label="Mission menu"]');
        await press('.menu-dialog .menu-item:has-text("Restart contract")');
        await expect(page.locator('dialog[open].confirm')).toBeVisible();
        await press('.confirm .btn.primary');
        await expect(page.locator('dialog[open]')).toHaveCount(0);
        await expect(status(page)).toContainText('Squad deployed');
        expect(await clock(page)).toBeLessThanOrEqual(2);
      });

      await test.step('mission clock runs after the restart', async () => {
        if (await paused.count()) await togglePause();
        const before = await clock(page);
        await expect.poll(() => clock(page), { timeout: 5000 }).toBeGreaterThan(before);
      });

      // The restart put the camera back on the opening view.
      if (touch) await test.step('long press adds a waypoint', async () => {
        await press('.agent:nth-child(1) .agent-select');
        const { x, y } = await street();
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        await sleep(700);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await expect(status(page)).toContainText('Waypoint added');
        await sleep(800);
        await shot(page, testInfo, '9-long-press');
      });
    });
  });
}

test.describe('phone', () => {
  test.use(phone);

  test('shows the too-small notice', async ({ page }, testInfo) => {
    await page.goto('/');
    await expect(page.locator('canvas')).toBeAttached({ timeout: 15_000 });
    const notice = page.locator('dialog[open].too-small');
    await expect(notice).toBeVisible();
    await expect(notice.getByRole('heading')).toHaveText('Directive needs a larger screen');
    await sleep(1500);
    await shot(page, testInfo, 'too-small');
  });
});
