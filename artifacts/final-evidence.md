# Production readiness pass — 2026-11-01

Base: `origin/main` at 21ce98d (deployed to Cloudflare by the `Deploy to Cloudflare` run of the same commit, which succeeded).

## Verdict

Ready to ship. Every CI gate passes. The production build plays end to end through real input on desktop and tablet, with no console, page or network errors, at a steady 60 fps. Renderer memory stays flat across restarts and district changes. The pass found and fixed one visible defect (glass HUD cards showing world labels through them) and two release gaps (no long-term caching for the fingerprinted bundles, no favicon). What remains is listed under *Open risks*: none of it blocks a release, and the dependency advisory and rate limiting are decisions for the owner.

## Fixed in this pass

| Defect | Cause | Fix | Verified |
|---|---|---|---|
| World labels read through the squad cards: the EXTRACTION label sat crisply over ROOK's card ("SUPPORT" over "EXTRACTION") | The `.squad` dock's entrance animation (`rise … both`) holds its end opacity, which makes `.squad` the backdrop root, so the cards' `backdrop-filter: blur(10px)` saw nothing to blur | `src/style.css`: `.squad` animation fill `both` → `backwards` (same entrance, nothing held afterwards) | A test string placed under ROOK's card shows sharp before the fix (`release-qa/probe-card-no-anim.png` shows the blurred target) and as a blurred haze after it (`release-qa/probe-card-as-is.png`, rerun on the rebuilt production preview). The tracker and command buttons already blurred correctly, since their animation is on the element itself. |
| Fingerprinted bundles were revalidated on every visit | Cloudflare static assets default to `Cache-Control: public, max-age=0, must-revalidate` | `public/_headers`: `/assets/*` → `public, max-age=31536000, immutable`. Models and audio keep the default (their names don't change with their content). | `curl -I` on the production preview: `/assets/index-*.js` sends the immutable header; `/models/*.glb`, `/audio/*`, `/` keep `max-age=0, must-revalidate` with ETags; `/_headers` itself is not served (SPA fallback to `index.html`) |
| No favicon (a request for `/favicon.ico` got `index.html` through the SPA fallback) | Missing asset | `public/favicon.svg` (the N logo), linked from `index.html` | `/favicon.svg` → 200 `image/svg+xml`; no 404 in any run |

Also added a `preview` entry to `.claude/launch.json` (port 4173) so the production build can be started the same way as the dev server.

## Checks run

### CI gates (locally, after `npm ci`; Node 24.22.1)

- `npm test`: 150 / 150 pass (before and after the fixes).
- `npm run typecheck`: browser and Worker both clean.
- `npm run build`: passes; `three` chunk 812 kB (expected warning), vendor 418 kB, app 246 kB, CSS 58 kB (gzip 206 / 130 / 83 / 12 kB).
- `npx wrangler deploy --dry-run`: passes; bindings `PLAYERS` (Durable Object) and `ASSETS`; 71 asset files after the fixes (69 before, plus `_headers` and `favicon.svg`).
- Secrets: no API keys or provider URLs in `src/`, `worker/`, `index.html` or `dist/client` (only a code comment naming ElevenLabs as the audio source). `__THREE_GAME_DIAGNOSTICS__` is only mounted when `import.meta.env.DEV`.

### Browser QA

Headless Chromium 156 (Playwright 1.64.1, `channel: 'chromium'`) on the real GPU (ANGLE Metal, Apple M5 Pro), so frame times are hardware numbers. No window opened. The driver scripts are in `artifacts/release-qa/driver/` (they need `@playwright/test` and `pngjs`, installed outside the repo for this pass).

**Production build** (`vite preview` on 4173, Worker and Durable Object in workerd), real input on five viewports, before and after the fixes:

| Viewport | Title → board → deploy | Orders (select all / tap, move) | Pause | Menu, Audio, Manual, Restart, Resume | Long press waypoint | Errors |
|---|---|---|---|---|---|---|
| Desktop 1440×900 @2x | pass | pass | Space | pass | — | 0 |
| Laptop 1280×720 | pass | pass | Space | pass | — | 0 |
| Tablet 1180×820, touch | pass | pass (taps) | button | pass | pass | 0 |
| Tablet portrait 744×1133, touch | pass | pass (taps) | button | pass | pass | 0 |
| Phone 390×844 | "Directive needs a larger screen" notice, as specified (minimum 744×600) | | | | | 0 |

Text-fit audit on every screen: no clipped visible text and no off-screen controls; the only clipped elements are `.sr-only` live regions. Frame time in active play, desktop and laptop: 60 fps, p99 16.8 ms, no frame over 33 ms.

**Full loop on the dev server** (1440×900; the page's own modules are read only to aim clicks and observe state, every order is a real click or key):

- Contract 01 (tier 1 heist): select all, overview, click the vault terminal, then extraction. Won in 41.8 s, undetected, ₡625 with the stealth bonus. API: `201 /players`, `201 /missions`, `200 /missions/:id/complete`.
- Headquarters: bought Smart ammunition, ₡625 → ₡325, `200 /upgrades/weapon`.
- Offline: `/api/*` blocked, another purchase → top bar shows `OFFLINE · NOT SAVING`; unblocked → `UPLINK SECURE` within 7 s and the server's campaign (₡325) replaced the unsaved purchase, as designed. The one console error in this run is that deliberately blocked request.
- Failure: tier 1 assassination, breach grenade at once → alarm at 00:01, the target escaped at 16.5 s → "Mission failed / The target escaped." with the alarm pinned to VEX's grenade on the district map.
- Retry: Next contract → board → deploy → a new mission starts.
- Restart contract from the menu ×6: works each time.

**Audio**: the Audio dialog opens from the title bar and the mission menu and returns to the menu; no `Audio … failed to load` warning in any run (the loader logs one on a failed fetch or decode). Playback by ear was not checked.

### Renderer, memory and assets

| Scene (dev diagnostics, all passes of the frame) | Draw calls | Triangles | Geometries | Textures | Programs |
|---|---|---|---|---|---|
| Contract 01 start | 56 | 93,124 | 41 | 31 | 41 |
| Contract 01 at the vault | 65 | 114,727 | 55 | 35 | 47 |
| Assassination after a grenade | 64 | 96,884 | 78 | 36 | 48 |
| Board, largest district preview | 64 | 117,948 | 34 | 27 | 34 |

All under the inspector's desktop budget (300 calls, 750k triangles, 300 geometries, 60 textures) and its mobile budget (150, 300k, 200, 40).

- Restarting the same contract 6 times: geometries 45, textures 31, programs 43 every time; JS heap 118 → 93 MB.
- Switching between three districts on the board 12 times: geometries 32–34, textures 27, heap steady at 102–103 MB. District atlases and geometry are disposed.
- Pixel metrics (inspector formula) on the production build, active play: desktop entropy 5.26 bits, edge density 0.374, contrast 105.7, dominant color 0.21; tablet 5.30 / 0.377 / 111.4 / 0.18. Title and board: entropy 3.2–4.0, contrast 109–126.
- Models: 19 GLBs, 9.6 MB (5.1 MB gzipped), ~10k triangles per character and ~4k per prop, one 512² JPEG each, no mesh compression. All of them load on the title screen; procedural units stand in until they arrive. Audio: 2.9 MB, fetched on use.

### Headless balance bot

`node --experimental-transform-types scripts/balance.ts` on the current code (no-tactics bot, 12 seeds per cell): see the table below. Contract 01 is not in this sweep (it is fixed, and covered by its own test at several start times).

Win rate averaged over the four contract types (full output in `release-qa/balance-2026-11-01.txt`):

| Roster | T1 | T2 | T3 | T4 | T5 |
|---|---|---|---|---|---|
| Starters (VEX, ROOK) | 83% | 69% | 44% | 8% | 0% |
| Four operatives | 100% | 96% | 85% | 35% | 4% |
| Four, fully upgraded | 100% | 100% | 100% | 100% | 98% |

The bot raises the alarm in 75–100% of runs (it never sneaks), so these are loud-play numbers. Pressure rises with tier and falls with roster and upgrades. The starters still win most tier 1–2 contracts, which are the only tiers the board offers until two contracts are done. Every run ended in a result: a single timeout out of 720 (four operatives, tier 5 assassination), no stuck runs.

## Visual scorecard

Genre equivalents: Hero = the operatives; Obstacles/enemies = guards, heavies, cameras, turrets and their vision cones; Interactables = vault terminal, charges, VIP, target area, extraction. Scored from the active-play captures above against the packaged anchors. No earlier score exists, so "before" is not captured.

| Category | Score | Evidence |
|---|---|---|
| Art direction | 2.5 | Neon-noir night district carries through the facades, generated-glyph signs, HUD palette (mint, amber, alarm red), title, board and after-action report |
| Hero (operatives) | 2 | Imported rigged models per class with class-colored trim, carried weapons, selection rings and health bars; small at the tactical zoom, so the class reads mostly by color and the card |
| Obstacles / enemies | 2 | Guard model reads apart from the squad (red armor, rifle); vision cones on the street fill toward red with detection; last-seen markers with a timer; distinct models per hostile type |
| Interactables | 2 | Terminal model with beacon and progress ring, extraction hex and label, target area ring, red exit flag, objective-complete callout |
| World | 2.5 | Podium and tower massing, rooftop plant, signs, awnings, sidewalks, crosswalks, lamps, kiosks, parked cars, ring road; buildings dither away in front of the squad |
| Materials | 2 | Per-contract facade atlas, roof grime, panel lines, wet puddles; roofs read fairly flat at this distance |
| Lighting / render | 2.5 | Neutral tone mapping, moonlight plus camera fill, lamp pools, bloom only above the emissive threshold; measured contrast 106–111 |
| VFX / motion | 2 | Tracers, muzzle flashes, sparks, smoke, blast rings and scorch marks, hit flashes, the alarm edge pulse; no motion capture was recorded in this pass |
| UI / HUD | 2.5 | Genre-specific tracker, squad cards with segmented health, ability state and cover badge, status pill, comms log, tips, pause and targeting banners, after-action alarm map; text fit clean on four viewports; glass bleed fixed |
| Performance evidence | 2.5 | Renderer counts in calm and loud play, frame-time percentiles on hardware, memory checks across restarts and districts, bundle and asset review; no real tablet measured |

Average 2.25, no category below 2, no automatic failure standing (the label-over-card overlap was one, and is fixed). That sits just under the premium line of 2.3. The categories that would move it are Hero (larger or more distinct class silhouettes at the tactical zoom), Materials (roof and street detail) and VFX (a motion capture of a firefight to judge it at all).

## Open risks

1. **Dependency advisory (dev and deploy tooling only).** `npm audit`: 1 high, 3 moderate, all from `undici` 7.29.1 inside `miniflare`, pulled in by `@cloudflare/vite-plugin` 1.64.0 and `wrangler` 4.151.0. None of it is in the shipped Worker; it runs in `npm run dev` and in `wrangler deploy` on CI. The fix needs `@cloudflare/vite-plugin` 1.67.0, which pins `wrangler` 4.156.1, published 2026-11-01, the day of this pass.
2. **No rate limit on player creation.** `POST /api/players` creates a Durable Object for any well-formed code, with no limit per client, so a script can create objects and storage without bound. A Cloudflare rate-limiting rule on `/api/players` (or the Workers rate-limiting binding) would cap it.
3. **Client-trusted values, by design.** The one-time legacy import on create accepts the client's cash (up to 100,000,000), upgrades and completed count, and the stealth bonus trusts the client's report (documented in the README). Saves are single-player, so this only lets a player cheat their own save. The legacy import can go once pre-server saves no longer exist.
4. **Model download.** 9.6 MB of uncompressed GLBs load on the title screen and revalidate on each visit. Meshopt compression with quantization would likely cut most of it, but needs `MeshoptDecoder` and a check that prop fitting and rig attachment still line up.
5. **Fonts from Google's CDN.** `index.html` loads Barlow, Barlow Semi Condensed and Chakra Petch from `fonts.googleapis.com`: a third-party dependency at load time and a privacy consideration for EU players. Self-hosting removes both.
6. **Not checked here:** the live deployment (its URL is not in the repo or the deploy log), real tablet hardware (frame times above are an M5 Pro desktop signal), and audio by ear.

## Harness decision

No visual-regression baseline or `__THREE_GAME_TEST_HOOKS__` was added: the game has no state hooks, and adding them plus a Playwright dependency is a project change of its own. This pass used an out-of-repo real-input driver instead (kept in `artifacts/release-qa/driver/`). Bringing it into the repo as a repeatable release check is the natural next step.

## Files

- Changed: `src/style.css`, `index.html`, `.claude/launch.json`, `.gitignore`
- Added: `public/_headers`, `public/favicon.svg`, this report
- Local only (gitignored, 28 MB): `artifacts/release-qa/` with every capture, JSON report and the driver
