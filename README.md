# Neon Directive

A React Three Fiber squad-combat game served by one Cloudflare Worker. Campaign progress lives in a per-player Durable Object, addressed by a shareable save code.

## Run

Node.js 24 or newer. Install the locked dependencies with `npm ci`, then run `npm run dev`; the Cloudflare Vite plugin runs the Worker and Durable Object locally in workerd. `npm run build` bundles `dist/`; `npm run typecheck` runs the TypeScript compiler. `npm test` exercises district generation, navigation, detection and the alarm, abilities, every contract type, revive, fog of war, the campaign ledger (offers, recruits, upgrades, migration), the client holding a fast win's payout claim until the server's minimum mission time, and telling a camera drag from a click.

`npm run typecheck` checks the browser code and, with `worker/tsconfig.json`, the Worker. After editing `wrangler.jsonc`, run `npm run cf-typegen` to regenerate `worker/worker-configuration.d.ts`.

Direct dependency versions are pinned to the npm registry's stable `latest` releases resolved during this rewrite. `package-lock.json` locks the transitive dependency graph.

`@react-three/fiber` 9.8.2 is patched: `patches/@react-three+fiber+9.8.2.patch` swaps its store's deprecated `THREE.Clock` for a Clock-compatible class backed by `THREE.Timer`, and the `postinstall` script reapplies it with `patch-package` on every install. When upgrading R3F, regenerate or drop the patch.

## Structure

- `src/game/`: serializable campaign data, renderer-independent simulation, navigation and line-of-sight.
- `src/game/campaign.ts`: campaign rules (contract offers, tiers and payouts, prices, roster, mission ledger) shared by the browser and the Worker.
- `src/game/mapgen.ts`: builds a district (city blocks, cover, patrols, objectives) from a contract's seed.
- `src/game/simulation.ts`: stealth, alarm, combat, abilities, objectives, revive and fog of war.
- `src/game/classes.ts`: operative classes and their abilities.
- `src/scene/`: React Three Fiber scene, procedural city and agents, camera, visual effects, health bars, objective beacons and off-screen objective arrows. Frame updates mutate Three.js objects; UI snapshots update at 10 Hz. The camera fits the district into the space the HUD leaves free (the `.view-frame` element) and orbits it with left-drag; `drag.ts` keeps a drag from counting as a click.
- `src/net/campaignClient.ts`: creates or loads the player's save code and reports deploys, completed contracts, purchases, recruits and dismissals to the Worker.
- `src/app.ts`: the shared `Simulation`, campaign client and player connection.
- `src/main.tsx`: screen flow (title, mission select, headquarters, mission, debrief), hotkeys and dialogs.
- `src/ui/`: React DOM screens and HUD, event callouts, SVG icons and class portraits, and the Web Audio manager (`audio.ts`: positional cues, music and ambience loops, volume groups saved in `localStorage['ndAudio']`). The samples in `public/audio/` were generated with ElevenLabs sound effects; `artifacts/generate-audio.py` holds the prompts.
- `worker/`: Worker entry (`/api/*` routes, static assets) and the `PlayerCampaign` Durable Object.

## Play

The title screen continues the campaign, loads a save code from another device, or opens the operator manual. On the mission select screen, pick one of three contracts and up to four operatives, then deploy; the briefing lists the objectives and the hostiles known to be in the district. Each contract is a generated district that grows with its tier: **assassination** (kill the target before it flees once the alarm sounds), **data heist** (hold the vault terminal for 12 s), **sabotage** (plant two charges) or **escort** (bring the VIP to extraction). Every contract ends when the whole squad reaches extraction.

Guards patrol with vision cones, cameras sweep, and turrets guard objectives. Posted guards (two at each objective) turn 60° to one side every 6 to 8 s, alternating sides, and hold that look for 2 s; the schedule follows the contract seed. Enemies outside your squad's line of sight are hidden. A full detection meter, or a hostile that survives being hit, raises the alarm: nearby guards hunt the squad's last known position, reinforcements arrive every 20 s, and an assassination target runs for an exit. Alarmed hostiles fire in every direction and the squad fires at will, so to stand the alarm down the squad has to stay out of every hostile's sight and firing range, with no shots fired, for 25 s (cameras keep watching; an EMP blinds them). Hostiles then return to their patrols, reinforcements stop (the cap of 8 covers the whole mission), and the squad holds fire again; a fleeing target keeps running. Before the alarm the squad only fires at ordered targets, and operatives ordered onto the same target hold fire until every one of them can hit, then fire on the same frame; a volley that kills stays quiet. An attack order on an unaware guard, heavy or target (no alarm, not suspicious) that the selection's volley would not kill is a takedown instead: the nearest selected operative circles out of the hostile's vision cone to within 1.2 m and finishes it after 1.5 s. A heavy needs two operatives. A takedown is silent unless another hostile sees it. Hovering a hostile shows what the order would do, for example `Takedown · ROOK` or `48 / 75 · will alert`. Finishing without ever raising the alarm pays a 25% stealth bonus; a stood-down alarm still voids it. Low barriers halve fire from the far side.

Operatives come in four classes, each with one ability: Assault (breach grenade, loud), Support (field heal), Recon (silent sniper shot that marks nearby enemies through walls) and Tech (EMP that stuns guards and turrets and blinds cameras). A downed operative can be revived by a teammate during the mission.

Select agents with click or 1–4, Shift-click to combine, A to select all. Shift+1–4 uses that operative's ability; targeted abilities wait for a click and Esc cancels. Click the street to move, a hostile to take it down or fire a volley, or a downed teammate to revive them. S holds position. Space pauses and permits queued commands. Drag to rotate and tilt the view, scroll to zoom, right-drag to pan, R to recenter the view. Directive runs on tablets and computers with a viewport of at least 744 × 600; phones are not supported. Touch uses tap commands, one-finger drag to rotate, two-finger pan/zoom and the ability buttons on the squad cards. Arrows at the edge of the view point to objectives off screen. The mission menu (☰) pauses and offers restart, the manual and audio; the speaker button opens the Audio dialog (mute, and master, music, ambience, effects and interface volume).

The campaign starts with VEX (Assault) and ROOK (Support). Until the first contract is completed, one recruit on offer is always a Recon or a Tech. Payouts run from 500 credits at tier 1 to 1,500 at tier 5, and the offered tiers rise as contracts are completed. Offers and recruits reroll after every deployment, won or lost. Headquarters sells ammunition (300) and plating (250) for the whole squad, ability upgrades per class (200; −15% cooldown and +20% effect per level), each capped at three levels, and recruits (400; roster of up to six, duplicates allowed, dismiss to free a slot). Progress saves to a Durable Object keyed by a 12-character save code (shown as `XXXX-XXXX-XXXX` on the title screen, at headquarters, in the after-action report and in the operator manual). The browser generates its code and remembers it in `localStorage['ndPlayer']` before creating the player, so a retry after a lost reply reaches the same save; enter the code on the title screen or at headquarters on another device to continue there. A pre-server `ndSave` browser save is imported on first visit, then removed; saves from before contracts existed are upgraded with their credits, upgrades and progress kept. The real-time mission runs in the browser. The Worker deals the contract offers, prices purchases and recruits, and pays the stored contract once per deploy, no sooner than 15 seconds after it. The client reports whether the alarm was raised, and the Worker trusts that report for the stealth bonus. If the Worker is unreachable, the game stays playable and warns that progress is not saved. After a failed save, the browser checks the Worker every 5 seconds; once it answers, its campaign replaces the progress that was not saved.

## API

| Route | Effect |
|---|---|
| `POST /api/players` | `{ code, legacy? }`: creates the player for a code the browser generated, importing the optional `legacy` Campaign; returns the existing player unchanged (`legacy` ignored) if the code is taken; 400 without a valid code |
| `GET /api/campaign/:code` | Current campaign |
| `POST /api/campaign/:code/missions` | `{ contractId, squad }`: deploys an offered contract and deals a new board; returns `missionId` and the campaign |
| `POST /api/campaign/:code/missions/:id/complete` | `{ stealth }`: pays the contract once |
| `POST /api/campaign/:code/upgrades/:type` | Buys `weapon`, `armor`, or an ability upgrade (`assault`, `support`, `recon`, `tech`) |
| `POST /api/campaign/:code/recruits/:id` | Hires an offered recruit |
| `DELETE /api/campaign/:code/roster/:id` | Dismisses an operative |

## Deploy

GitHub Actions deploys on every push to `main` (`.github/workflows/deploy-to-cloudflare.yml`) after the checks in `.github/workflows/verify-game-and-worker.yml`, which also run on pull requests.

1. Create a Cloudflare API token from the "Edit Cloudflare Workers" template.
2. In the repository settings, create a `production` environment and add the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to it. Add required reviewers there to gate deploys.
3. Push to `main`. The first deploy creates the `PlayerCampaign` Durable Object namespace from migration `v1`.

To deploy by hand, run `npx wrangler login`, then `npm run deploy`.
