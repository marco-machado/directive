# Neon Directive

A React Three Fiber squad-combat game served by one Cloudflare Worker. Campaign progress lives in a per-player Durable Object, addressed by a shareable save code.

## Run

Node.js 24 or newer. Install the locked dependencies with `npm ci`, then run `npm run dev`; the Cloudflare Vite plugin runs the Worker and Durable Object locally in workerd. `npm run build` bundles `dist/`; `npm run typecheck` runs the TypeScript compiler. `npm test` exercises navigation, combat/extraction, pause, save migration, upgrades, and failure recovery.

`npm run typecheck` checks the browser code and, with `worker/tsconfig.json`, the Worker. After editing `wrangler.jsonc`, run `npm run cf-typegen` to regenerate `worker/worker-configuration.d.ts`.

Direct dependency versions are pinned to the npm registry's stable `latest` releases resolved during this rewrite. `package-lock.json` locks the transitive dependency graph.

## Structure

- `src/game/`: serializable campaign data, renderer-independent simulation, navigation and line-of-sight.
- `src/scene/`: React Three Fiber scene, procedural city and agents, camera, and visual effects. Frame updates mutate Three.js objects; UI snapshots update at 10 Hz.
- `src/game/campaign.ts`: campaign rules (prices, payout, level cap, mission ledger) shared by the browser and the Worker.
- `src/net/campaignClient.ts`: creates or loads the player's save code and reports deploys, completed contracts, and purchases to the Worker.
- `src/main.tsx`: React DOM HUD, briefing, controls, headquarters, upgrade purchase flow, and save-code UI.
- `worker/`: Worker entry (`/api/*` routes, static assets) and the `PlayerCampaign` Durable Object.

Select agents with click or 1/2, Shift-click to combine, A to select all. Click the street to move or a hostile to focus fire. S holds position. Space pauses and permits queued commands. Scroll to zoom, right-drag to pan, R to reset the camera. Touch uses tap commands and two-finger pan/zoom.

The campaign is intentionally one replayable district. Completing extraction pays 500 credits; ammunition costs 300 and plating costs 250, each capped at three levels. Progress saves to a Durable Object keyed by a 12-character save code (shown as `XXXX-XXXX-XXXX` in the briefing, headquarters, and help dialogs). The browser remembers its code in `localStorage['ndPlayer']`; enter the code on another device to continue there. A pre-server `ndSave` browser save is imported on first visit, then removed. The real-time mission runs in the browser; the Worker prices purchases and pays a contract once per deploy, and no sooner than 15 seconds after it. If the Worker is unreachable, the game stays playable and warns that progress is not saved.

## API

| Route | Effect |
|---|---|
| `POST /api/players` | New save code; optional `{ "legacy": Campaign }` import |
| `GET /api/campaign/:code` | Current campaign |
| `POST /api/campaign/:code/missions` | Starts a contract; returns `missionId` |
| `POST /api/campaign/:code/missions/:id/complete` | Pays the contract once |
| `POST /api/campaign/:code/upgrades/:type` | Buys `weapon` or `armor` |

## Deploy

GitHub Actions deploys on every push to `main` (`.github/workflows/deploy-to-cloudflare.yml`) after the checks in `.github/workflows/verify-game-and-worker.yml`, which also run on pull requests.

1. Create a Cloudflare API token from the "Edit Cloudflare Workers" template.
2. In the repository settings, create a `production` environment and add the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to it. Add required reviewers there to gate deploys.
3. Push to `main`. The first deploy creates the `PlayerCampaign` Durable Object namespace from migration `v1`.

To deploy by hand, run `npx wrangler login`, then `npm run deploy`.
