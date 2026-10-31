# Neon Directive — gameplay depth pass

## Intent
Gameplay depth for the existing R3F squad-tactics game. Procedural visuals in the current style, no external asset services. Existing v2 saves migrate to v3.

## Decisions (user-approved)
- Enemies: patrol routes, vision cones, detection meters, alarm. Alarm: nearby guards converge, reinforcements from map edge every 20 s (2, or 3 at tier 4+, max 8 total), assassination target flees to an exit (escape = failure).
- Alarm triggers: an observer's detection meter fills (faster up close); a hostile is hit and survives. Recon sniper shot is silent; grenade is loud (instant alarm).
- Fire control: before alarm operatives only fire at ordered targets; after alarm weapons free.
- Fog of war: enemies outside squad line of sight hidden; Recon mark reveals for 6 s.
- Vision cones always drawn on the ground, filling toward red with detection.
- Cover: low barriers; reduced damage from the far side.
- Contracts: assassination, data heist (hold terminal 12 s within 1.5 m, pauses when empty), sabotage (plant 2 charges, 3 s each), escort (VIP follows nearest operative, stops under fire, dies = fail, must reach extraction). All end with extraction (one operative is enough).
- Maps: procedural city blocks from the contract seed; size grows with tier, 32x24 to ~44x32. District names generated ("SECTOR 07 / CHROME QUARTER").
- Roster: 4 classes. Assault (grenade 90 dmg r2.2 cd18), Support (heal +60 r3 cd20), Recon (sniper 130 dmg range 14 cd15, mark 6 s), Tech (EMP r2.5: stun guards/turrets 5 s, cameras 10 s, cd20).
  Stats HP/dmg/range: Assault 140/28/6.2, Support 120/20/6.2, Recon 100/30/8 (slower fire), Tech 110/20/6.2.
- Squad up to 4 chosen at HQ, hotkeys 1-4 select; Shift+1-4 fires that operative's ability (targeted ones wait for a click, Esc cancels). Keyboard additive select dropped; Shift-click and A remain.
- Recruiting: HQ offers 2 recruits per visit at 400 credits, server-priced; VEX (Assault) and ROOK (Support) owned at start. Named individuals, no permadeath. Roster cap 6, duplicate classes allowed, dismiss frees a slot.
- Revive: select a living operative, click a downed one; 3 s still, interrupted by damage; revives at 40% HP.
- Upgrades: ammo/plating stay global; ability upgrades per class, 200 credits/level, 3 levels, each -15% cooldown +20% effect.
- Difficulty: base tier rises with contracts completed; 3 offers per HQ visit at different tier/payout, rerolled after every mission (won or lost). 5 tiers, payout 500 -> 1500, capped.
- Stealth bonus +25% for no alarm; the client reports it, the server trusts it (same trust as completion).
- Contract authority: the Durable Object generates offers (type, tier, seed, payout) and pays the stored amount.
- Enemy types: guard 75 HP, heavy 180 HP slow, camera 40 HP sees 8 m sweeps, turret 140 HP 18 dmg 7 m.

## Design brief
- Player promise: run a covert squad through a hostile corporate district and choose, every contract, between a clean ghost run and a loud firefight.
- Target feeling: tense planning, then decisive execution; panic and recovery when the alarm sounds.
- Primary verb: order operatives (move, focus fire). Secondary: abilities, revive, pause-and-plan.
- Every 5-30 s: pick the next street around vision cones, decide whether to snipe/EMP a watcher or wait for its patrol.
- Across 1-5 min: objective, then extraction; after an alarm, reinforcement waves every 20 s raise the pressure.
- Lose/learn/restart: squad wipe, dead VIP or escaped target; after-action report names the reason; new board right away.
- Rewarded: no-alarm completion (+25%), higher tiers. Risk: higher tiers, loud abilities, splitting the squad.
- Better player: reads patrols and cones, uses cover, sequences silent kills, keeps the VIP safe.
- Next decision communicated by: objective list, vision cones, alarm badge, ability cooldowns, pending-target banner.
- Non-goals: permadeath, consumable gear, generated 3D assets, audio.

## Core loop contract
Player orders the squad to complete the contract objective while patrols, cameras and turrets threaten detection; success pays the contract (+25% without an alarm) for upgrades and recruits; failure pays nothing and the board rerolls.
- Verb mapped to input: click/tap, 1-4, Shift+1-4, A, S, Space, Esc (tests + browser QA).
- Objective visible: HUD objective list, world markers (terminal, charges, VIP, target label, extraction ring).
- Pressure in the first minute: guards within ~15 m of the squad start; detection meters.
- Reward changes state: credits, tier progression, upgrades change HP/damage/cooldowns.
- Failure teaches: after-action report shows the reason ("The VIP was killed.", "The target escaped.").

## Level plan (generated per contract seed)
- Format: city-block grid (~8 m blocks, 1.5 m street clearance), 32x24 at tier 1 to 44x32 at tier 5; ~20% of blocks are open plazas.
- Squad starts at a map corner next to extraction; objectives are placed in the farthest 40% of street points.
- First decision: which street to take toward the objective; first threat: patrol guards (no hostile within 9 m of the start).
- Escalation by tier: guards 3+tier, heavies floor(tier/2), cameras tier-1, turrets tier-2 near objectives, cover 5+2*tier, hostile HP +10%/tier and damage +15%/tier.
- Recovery beats: cover barriers along streets, revive, field heal.
- Telegraphs: vision cones redden as detection builds; alarm badge and red frame; reinforcement countdown.
- Every key point is checked reachable from the start; layouts that fail are regenerated.

## Tuning added by lead (beyond the approved list; report to user)
- Hostile HP +10%/tier and damage +15%/tier above tier 1.
- Assassination target: hesitates 5 s after the alarm, flees at 1.8 m/s, to an exit at least 16 m away (falls back to nearest reachable).
- VIP HP 160; hostiles shoot operatives before the VIP.
- Values not on the approved list (user said tuning is fine; mechanics marked * still need the user's OK):
  guard damage 10 / cd 1.25 / range 5.5 / vision 7 m / FOV ±50°; heavy damage 16 / range 5 / vision 6 m; turret FOV ±45°; camera FOV ±35°, sweep ±40°;
  target HP 110, vision 6 m; detection fill 1/(0.35 + 0.12·d) per s, drain 0.25/s; alarm converge radius 14 m;
  base tier = 1 + floor(completed / 2); offers = three consecutive tiers around the base.
  * Recon mark covers hostiles within 4 m of the shot target.
  * Grenade reach 8 m, EMP reach 7 m, all targeted abilities need a clear line.
  * Fog-of-war sight range 10 m (also hides hostiles in clear sight beyond 10 m).
  * A suspicious guard (detection > 30%) stops and stares at the squad.
  * Vision cones hidden for stunned hostiles.
  * Clicking the VIP moves the squad to it (was: nothing).
  * Headquarters/after-action report lives in the same side panel as the contract board (HUD worker's call).

## Status
- [x] core: campaign v3, mapgen, world, simulation, worker, client, tests (30 passing)
- [x] headless bot balance runs (scratchpad bot.ts / sneak.ts)
- [x] scene
- [x] UI
- [x] README
- [x] typecheck, build, wrangler dry-run, API checks against local Worker
- [x] headless browser QA desktop 1440x900 + iPhone 15 (board, deploy, move, aim/cancel, pause, alarm, VIP death -> after-action)
- [x] rules review (fixed: equal-tier offers, brief text, footer label, test-only rng param, redundant guard, EMP test)
- [x] code review findings (fixed 1,2,3,4,6,7,8 + readability; open: 5 failed-contract replay via forged client)
- [x] final browser pass after fixes
