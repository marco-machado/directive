# CLAUDE.md

This file provides guidance when working with code in this repository.

## Attribution

- Never add AI attribution footers to commits, PRs, or comments.

## Starting new work

Start every task from the latest `origin/main`, so the work never conflicts with or duplicates what has already landed.

- In the main checkout: `git switch main && git pull`.
- In a worktree (where `main` is checked out elsewhere): `git fetch origin main`, then `git merge --ff-only origin/main` if the branch has no commits of its own yet, or `git merge origin/main` if it does.
- Before opening a PR, fetch again and merge `origin/main` if it moved.

A `SessionStart` hook in `.claude/settings.json` fetches `origin/main` and warns when the branch is behind it.

## Commands

Node.js 24+. Install with `npm ci` (its `postinstall` reapplies `patches/@react-three+fiber+9.8.2.patch`; regenerate or drop it when upgrading R3F).

- `npm run dev`: Vite dev server on 0.0.0.0. The Cloudflare Vite plugin runs the Worker and the `PlayerCampaign` Durable Object locally in workerd, so `/api/*` works in dev. `.claude/launch.json` starts it on port 5173 (`--strictPort`).
- `npm test`: Node's built-in runner with `--experimental-transform-types` over `tests/*.test.ts` (no Vitest/Jest).
- One file: `node --test --experimental-transform-types tests/game.test.ts`
- One test: add `--test-name-pattern="<regex>"` to the command above.
- `npm run typecheck`: checks the browser code (`tsconfig.json`) and the Worker (`worker/tsconfig.json`) separately.
- `npm run build`: bundles `dist/`. The `three` chunk exceeds Vite's 500 kB warning; that is expected.
- `npm run cf-typegen`: run after editing `wrangler.jsonc` to regenerate `worker/worker-configuration.d.ts`.
- CI (`.github/workflows/verify-game-and-worker.yml`) runs test, typecheck, build, then `npx wrangler deploy --dry-run --outdir .wrangler/dry`. Every push to `main` deploys to Cloudflare after those checks.

Imports use explicit `.ts` extensions (`allowImportingTsExtensions`, `verbatimModuleSyntax`), which the Node test runner needs; use `import type` for types.

## Architecture

A React Three Fiber squad-stealth game served by one Cloudflare Worker. The README has the full game rules and the API route table; keep it in sync when behavior changes.

**Simulation is the single source of game state.** `src/game/simulation.ts` holds a `Simulation` class that is plain TypeScript with no React or Three.js dependency, so the tests drive it directly (`sim.update(1/60)` in a loop; see the `arena()` helper in `tests/game.test.ts` for an open, building-free map). One shared instance lives in `src/app.ts`. React DOM reads it through `useSyncExternalStore(sim.subscribe, sim.getSnapshot)`; snapshots are emitted at about 10 Hz, not every frame. The R3F scene advances it with `useFrame((_, dt) => sim.update(dt), -1)` in `src/scene/GameCanvas.tsx` and mutates Three.js objects per frame from `sim` directly rather than through React state. Tunable rules are exported constants at the top of `simulation.ts`, and tests import them instead of hard-coding numbers.

**Campaign rules are shared by browser and Worker.** `src/game/campaign.ts` contains pure functions (`startMission`, `completeMission`, `applyPurchase`, `applyRecruit`, `applyDismiss`, `clampCampaign`, migration) that take an injected `Rng`. The Worker's `PlayerCampaign` Durable Object (`worker/player.ts`, one instance per save code, a single `ledger` storage key) routes every write through them, so the server stays authoritative for credits, offers, roster, and payout. The client simulates the mission itself and the server trusts its stealth report. The server pays a contract once per deploy and no sooner than `MIN_MISSION_MS` after it.

**Client/server sync.** `Simulation` reports campaign events through the `CampaignSync` interface; `CampaignClient` (`src/net/campaignClient.ts`) implements it, queues requests, and pushes server replies back via `sim.applyCampaign`. If the Worker is unreachable, the game keeps running with `saveUnavailable` set and resyncs every 5 s; once the server answers, its campaign replaces local progress. The save code lives in `localStorage['ndPlayer']` and is written before the create call so a retry hits the same player. A legacy `localStorage['ndSave']` is imported once on create, then removed. Campaign `version` 3 is current; the DO upgrades older ledgers on read.

**Determinism.** `src/game/mapgen.ts` builds a district (blocks, cover, patrols, objectives, posted-guard look schedules) from a contract's seed using `mulberry32` from `src/game/rng.ts`. `src/game/world.ts` provides navigation and line of sight.

**Rendering.** The district's look is dressing derived from the plan, never gameplay: `src/scene/district.ts` is pure and seeded from the contract (its own `mulberry32` streams), and `tests/district.test.ts` keeps ground props off walkable ground and cover and keeps building parts inside the box `view.ts` uses for fades and silhouettes (footprint + `PLINTH`, up to `buildingTop`). Instanced parts carry per-instance data for the shader injections in `materials.ts`. Emissive surfaces are authored above 1 (`Part.glow`, the facade window gain) so the bloom pass's threshold picks them out; lit surfaces stay below it. Tone mapping is Neutral so HUD-colored overlays look the same with bloom on or off.

**Camera.** `src/scene/framing.ts` (framing math) and `src/scene/drag.ts` (telling a drag from a click) are pure and unit-tested. The camera frames the `.view-frame` element, the area the HUD leaves free, not the full canvas.

**Worker routing.** `wrangler.jsonc` runs the Worker first only for `/api/*`; everything else is static assets with SPA fallback. `worker/index.ts` maps routes onto DO methods and turns `{ ok: false, status }` results into 404/409 responses.

`artifacts/game-progress.md` holds the `threejs-game-director` skill's working notes and the design decisions behind past passes; it is history, not a spec.
