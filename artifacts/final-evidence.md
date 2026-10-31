# Gameplay depth pass: evidence

## Checks (final code)
- `npm test`: 32 pass, 0 fail.
- `npm run typecheck`: clean (browser + Worker).
- `npm run build`: passes; existing warning that the three.js chunk is over 500 kB.
- `npx wrangler deploy --dry-run`: passes (PlayerCampaign Durable Object, assets).

## Local Worker API (curl against `npm run dev`)
- Forged contract id and unknown squad member: 409. Deploy rerolls the board.
- Completing before 15 s: 409. After 15 s with `stealth: true` on a tier-1 contract: cash 625, completed 1. Repeat claim: 409.
- Recruit / upgrade without credits: 409. Unknown upgrade: 400. Dismissing the last operative: 409.
- `POST /api/players` with body `null`: 201 (was an uncaught error before the review fix).
- Not run: migration of a stored v2 ledger inside a real Durable Object (covered by `clampCampaign` unit tests only).

## Headless browser (playwright-cli, Chrome, 1440x900 and iPhone 15 emulation)
- Captures: scratchpad `qa/` (first pass) and `qa2/` (after fixes).
- Real input exercised: contract board, deploy, click-to-move, Shift+1 grenade aiming with reach/area preview, Esc cancel, Space pause, scroll zoom, VIP pickup, alarm (red HUD, reinforcement countdown), VIP death -> after-action report with shop.
- Not exercised by real input: a full successful contract, recruit/dismiss in the UI, sniper/EMP in the browser, revive in the browser (covered by unit tests and the bots).
- Console: 0 errors; 2 warnings from three.js (`THREE.Clock` deprecated, PCFSoftShadowMap fallback).

## Headless balance bots (scratchpad `bot.ts`, `sneak.ts`, 12 seeds per cell)
- Loud bot, starting 2 operatives, no upgrades: tier 1 wins 12/12 on all types; tier 4-5 mostly squad wipes.
- Loud bot, 4 operatives, no upgrades, tier 5: assassination 2/12, heist 9/12, sabotage 8/12, escort 8/12.
- Loud bot, 4 operatives, all upgrades, tier 5: assassination 6/12, others 12/12.
- Stealth bot (recon + tech, never orders attacks): no-alarm completions in heist/sabotage/escort at several tiers; it never kills the assassination target, so 0 there by construction.

## Scorecard
Not scored: this pass was gameplay depth, not a premium visual pass.
