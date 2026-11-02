import { test as base, expect, type Page, type PlaywrightTestOptions, type TestInfo } from '@playwright/test';

export { expect };

export const previewUrl = () => `http://localhost:${process.env.PREVIEW_PORT}`;
export const devUrl = () => `http://localhost:${process.env.DEV_PORT}`;
export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

type Device = Partial<Pick<PlaywrightTestOptions, 'viewport' | 'deviceScaleFactor' | 'hasTouch' | 'isMobile'>>;
// The phone is below the supported size and expects the too-small notice.
export const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  laptop: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
  tablet: { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  tabletPortrait: { viewport: { width: 744, height: 1133 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true },
} satisfies Record<string, Device>;

// Every console error or warning, uncaught page error, failed request and HTTP status >= 400 the page produces.
// Requests a test drops on purpose (see goOffline) are kept out, along with the browser's console line for each.
export type Errors = { console: string[]; page: string[]; network: string[]; blocked: Set<string> };

export const test = base.extend<{ errors: Errors }>({
  errors: [async ({ page }, use) => {
    const log: Errors = { console: [], page: [], network: [], blocked: new Set() };
    page.on('console', m => {
      if (m.type() !== 'error' && m.type() !== 'warning') return;
      if (log.blocked.has(m.location().url) && m.text().startsWith('Failed to load resource')) return;
      log.console.push(`${m.type()}: ${m.text()}`.slice(0, 400));
    });
    page.on('pageerror', e => log.page.push(e.message.slice(0, 400)));
    page.on('requestfailed', r => { if (!log.blocked.has(r.url())) log.network.push(`FAILED ${r.method()} ${r.url()} ${r.failure()?.errorText}`); });
    page.on('response', r => { if (r.status() >= 400) log.network.push(`${r.status()} ${r.request().method()} ${r.url()}`); });
    await use(log);
    expect.soft(log.console, 'console errors and warnings').toEqual([]);
    expect.soft(log.page, 'uncaught page errors').toEqual([]);
    expect.soft(log.network, 'failed requests and HTTP errors').toEqual([]);
  }, { auto: true }],
});

// Drops every /api/ request, as if the Worker were unreachable, until the route is removed.
export const goOffline = (page: Page, errors: Errors) =>
  page.route('**/api/**', route => { errors.blocked.add(route.request().url()); return route.abort(); });
export const goOnline = (page: Page) => page.unroute('**/api/**');

export async function shot(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(name, { body: await page.screenshot({ type: 'jpeg', quality: 82 }), contentType: 'image/jpeg' });
}
export const note = (testInfo: TestInfo, type: string, value: unknown) =>
  testInfo.annotations.push({ type, description: typeof value === 'string' ? value : JSON.stringify(value) });

export const gpu = (page: Page) => page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2'), info = gl?.getExtension('WEBGL_debug_renderer_info');
  return info ? String(gl!.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown';
});

// rAF deltas over `ms` of real time.
export const frameTimes = (page: Page, ms: number) => page.evaluate(ms => new Promise<Record<string, number>>(resolve => {
  const deltas: number[] = [];
  let last = 0;
  const end = performance.now() + ms;
  const tick = (now: number) => {
    deltas.push(now - last); last = now;
    if (now < end) { requestAnimationFrame(tick); return; }
    deltas.shift(); deltas.sort((a, b) => a - b);
    const q = (p: number) => +deltas[Math.min(deltas.length - 1, Math.floor(deltas.length * p))].toFixed(2);
    const mean = deltas.reduce((s, d) => s + d, 0) / deltas.length;
    resolve({ frames: deltas.length, meanMs: +mean.toFixed(2), fps: +(1000 / mean).toFixed(1), p50: q(.5), p95: q(.95), p99: q(.99), max: q(1), over33ms: deltas.filter(d => d > 33.4).length });
  };
  requestAnimationFrame(t => { last = t; requestAnimationFrame(tick); });
}), ms);

// Visible text cut off by its box, and controls outside the viewport that no scrolling ancestor can bring into view.
// Visually hidden screen-reader text (.sr-only) clips by design; world labels, SVG and the canvas are not layout.
export const layoutAudit = (page: Page) => page.evaluate(() => {
  const vw = innerWidth, vh = innerHeight, clipped: string[] = [], offscreen: string[] = [], smallTargets: string[] = [];
  const visible = (el: Element) => {
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0 && r.width > 0 && r.height > 0;
  };
  const name = (el: Element) => `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).join('.') : ''} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40)}"`;
  for (const el of document.querySelectorAll('main *')) {
    if (!visible(el) || el.closest('.scene-labels, svg, canvas, .sr-only')) continue;
    const s = getComputedStyle(el);
    const clips = s.overflowX === 'hidden' || s.overflowX === 'clip' || s.textOverflow === 'ellipsis';
    if (clips && el.scrollWidth > el.clientWidth + 1 && el.children.length === 0) clipped.push(name(el));
    if (!el.matches('button, a, input, select, [role=button]')) continue;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 || r.bottom > vh + 1 || r.left < -1 || r.top < -1) {
      let p = el.parentElement, scrolls = false;
      while (p && p !== document.body) { const ps = getComputedStyle(p); if (/(auto|scroll)/.test(ps.overflowY + ps.overflowX)) { scrolls = true; break; } p = p.parentElement; }
      if (!scrolls) offscreen.push(`${name(el)} @${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    if (r.width < 24 || r.height < 24) smallTargets.push(`${name(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  return { clipped, offscreen, smallTargets, document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, vw, vh } };
});

// Fails (softly, so one screen's findings do not hide the next) on clipped text or unreachable controls; small
// targets and the document size are recorded only.
export async function expectLayoutFits(page: Page, testInfo: TestInfo, screen: string) {
  const audit = await layoutAudit(page);
  expect.soft(audit.clipped, `clipped text on ${screen}`).toEqual([]);
  expect.soft(audit.offscreen, `off-screen controls on ${screen}`).toEqual([]);
  if (audit.smallTargets.length) note(testInfo, `small targets on ${screen}`, audit.smallTargets);
  return audit;
}
