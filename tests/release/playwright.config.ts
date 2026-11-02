import { defineConfig } from '@playwright/test';

// The release check: real input on the built game. `npm run test:release` builds first; the smoke runs on
// `vite preview` (the production bundle and the Worker in workerd), the playthrough on the dev server, where it can
// read the page's modules to aim clicks. Each server takes the first free port from its default up, and the specs
// read the one it reported from PREVIEW_PORT and DEV_PORT.
const listening = (name: string) => new RegExp(`Local:\\s+(?:\\x1b\\[[\\d;]*m)*http://localhost:(?:\\x1b\\[[\\d;]*m)*(?<${name}>\\d+)`);

export default defineConfig({
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
    { name: 'playthrough', testMatch: 'playthrough.spec.ts' },
  ],
  webServer: [
    { name: 'preview', command: 'npx vite preview --port 4173', cwd: '../..', wait: { stdout: listening('preview_port') }, timeout: 60_000 },
    { name: 'dev', command: 'npx vite --port 5173', cwd: '../..', wait: { stdout: listening('dev_port') }, timeout: 60_000 },
  ],
});
