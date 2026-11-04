import { defineConfig } from '@playwright/test';
import type { Renderer } from './helpers.ts';

// The release check: real input on the built game. `npm run test:release` builds first; the smoke runs on
// `vite preview` (the production bundle and the Worker in workerd), the playthrough on the dev server, where it can
// read the page's modules to aim clicks. Each server takes the first free port from its default up, and the specs
// read the one it reported from PREVIEW_PORT and DEV_PORT. The smoke runs once on the renderer's own choice (WebGPU
// where the browser offers it) and once on its WebGL 2 fallback.
const listening = (name: string) => new RegExp(`Local:\\s+(?:\\x1b\\[[\\d;]*m)*http://localhost:(?:\\x1b\\[[\\d;]*m)*(?<${name}>\\d+)`);

export default defineConfig<{ renderer: Renderer }>({
  testDir: '.',
  outputDir: '../../test-results/release',
  reporter: [['list'], ['html', { outputFolder: '../../test-results/release-report', open: 'never' }]],
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  use: {
    channel: 'chromium',
    headless: true,
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'smoke', testMatch: 'smoke.spec.ts' },
    { name: 'smoke-webgl', testMatch: 'smoke.spec.ts', use: { renderer: 'webgl' } },
    { name: 'playthrough', testMatch: 'playthrough.spec.ts' },
  ],
  webServer: [
    { name: 'preview', command: 'npx vite preview --port 4173', cwd: '../..', wait: { stdout: listening('preview_port') }, timeout: 60_000 },
    { name: 'dev', command: 'npx vite --port 5173', cwd: '../..', wait: { stdout: listening('dev_port') }, timeout: 60_000 },
  ],
});
