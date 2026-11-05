# Neon Directive: New Contract Types

November 5, 2026 · Marco Machado

## Summary

All four contract types follow the same pattern. The squad walks out to a far objective, does one thing there, and walks back to the corner it started from. Only assassination raises its stakes when the alarm sounds. No contract has a clock, a moving objective, an optional objective or an ending of its own.

This plan adds four contract types and an assassination variant. It also adds contract modifiers, among them carrying a package and two new ways to end. Two foundations come first: new types unlock with clearance, and contracts can reward more than credits. Every new contract can still be finished unseen, fought through, or anything in between.

Each change is a GitHub issue, listed under The plan. The game itself has not changed yet.

## The four types today

- **Assassination:** kill the target. Once the alarm sounds, it runs for an exit, and the contract fails if it gets there.
- **Data heist:** hold the vault terminal for 12 s.
- **Sabotage:** plant two charges, 3 s each.
- **Escort:** stay beside the VIP for 5 s to free them, then bring them to extraction. The contract fails if the VIP dies.

What they share, in the code:

- The squad starts beside extraction: `spawn` sits next to `extract` in `src/game/mapgen.ts`, and the objectives go among the street points farthest from it.
- Extraction opens only once every objective is done (`extractReady` in `src/game/simulation.ts`), so nothing is optional.
- Apart from assassination, an alarm only brings reinforcements. Nothing about the contract itself changes.
- The tactical bot works through the objectives one at a time with the whole squad (`goal()` in `scripts/tactical.ts`).

## Decisions

- New contract types unlock as clearance rises ([#44](https://github.com/marco-machado/directive/issues/44)).
- Rewards can go beyond credits ([#45](https://github.com/marco-machado/directive/issues/45)).
- Not taken in this round: linked targets (two targets wired to each other, so killing one alerts the other) and defending a device, which forces a fight.

## The plan

The unlock tiers below are proposals, to confirm in #44.

### Foundations

- [#44 Unlock contract types with clearance](https://github.com/marco-machado/directive/issues/44). A type is dealt once the campaign's base tier reaches its unlock tier, and the first board after an unlock always includes it. The board and the after-action report name the next type to unlock.
- [#45 Pay contract rewards beyond credits](https://github.com/marco-machado/directive/issues/45). The client's report gains per-contract results, which the Worker bounds against the contract. Rewards can then be bonus credits, an operative who joins the roster, or intel carried into the next contract.
- [#46 Add contract modifiers to the board](https://github.com/marco-machado/directive/issues/46). A contract can carry modifiers that the Worker deals with it and the board, briefing, tracker and report show. The first ones are Lockdown (the exits seal a set time after the first alarm) and a no-kill clause (killing anyone but a target cuts the payout).

### New contract types

- [#47 Intercept](https://github.com/marco-machado/directive/issues/47), tier 2. A courier and two escorts walk a fixed route from one edge exit to another, and the squad must stop the courier before it leaves. The player picks the ambush ground and the moment, which is choosing when the fight starts in its purest form.
- [#48 Elimination](https://github.com/marco-machado/directive/issues/48), tier 2. Down every hostile the district started with, the Purge badge as a contract. Takedowns and quiet volleys keep a ghost run possible. Purge and Bloodless need a new rule on this type.
- [#49 Smash and grab](https://github.com/marco-machado/directive/issues/49), tier 3. Opening the first of three caches starts a lockdown countdown, and each extra cache pays a bonus. The player prepares everything before choosing when the clock starts, then weighs greed against time. It adds optional objectives.
- [#50 Surveillance](https://github.com/marco-machado/directive/issues/50), tier 3. Tag executives by keeping them in sight unnoticed. An alarm sends the untagged ones running. Staying out of the fight is the goal itself, and Recon's mark tags instantly.
- [#51 Jailbreak](https://github.com/marco-machado/directive/issues/51), tier 4. Free two or three prisoners and bring at least one out. Each one past the first pays more, and one may join the roster. Every follower makes the squad harder to hide.

### Modifiers and variants

- [#52 Carry a package](https://github.com/marco-machado/directive/issues/52). The prize is something to carry out. The carrier is slower and cannot fire or use its ability, so who carries it and the route back become part of the plan.
- [#53 Through-run and called extraction](https://github.com/marco-machado/directive/issues/53). On a through-run the squad starts at one corner and extracts at the opposite one. With a called extraction, the player picks the pickup point and holds it until the pickup lands. Both change how an engagement ends.
- [#54 Unknown target](https://github.com/marco-machado/directive/issues/54), tier 3. On an assassination, the target passes as a guard until an operative identifies it up close or Recon marks it.

### Suggested order

1. #44 and #45. Every new type ships gated, and three of them pay rewards beyond credits.
2. #48 Elimination and #47 Intercept. They reuse the most code and unlock first.
3. #46, then the modifiers built on it: #54, #52 and #53.
4. #49 Smash and grab, which adds optional objectives, and #50 Surveillance.
5. #51 Jailbreak, which reuses #49's optional objectives and turns the single-VIP code into a list of followers.

### What every new type touches

- **Rules:** `ContractType`, `CONTRACT_TYPES`, `PAR_SECONDS` and the unlock tier in `src/game/campaign.ts`; placement in `src/game/mapgen.ts`; objectives, progress, failure messages and `LANDMARK` in `src/game/simulation.ts`.
- **UI:**
  - Title, brief and badge copy: `src/ui/common.tsx`
  - Icon: `src/ui/icons.tsx`
  - Briefing intel: `src/ui/MissionSelect.tsx`
  - HUD: `src/ui/Hud.tsx`
  - Objective beacon: `src/scene/objectives.tsx`
  - Edge arrow: `src/scene/pointers.tsx`
- **Bots:** `scripts/bots.ts` and `scripts/tactical.ts` must play it, and `scripts/balance.ts` must cover it. Then regenerate `scripts/balance-current.txt` and read it against the targets in `artifacts/late-campaign-balance.md`.
- **Tests and docs:** `tests/game.test.ts` (it covers every contract type), `tests/campaign.test.ts`, `tests/bots.test.ts` and the README's Play section.
- **The board:** it still deals three offers of different types, so each type comes up less often as the list grows. Contract 01 is unaffected.

## Techniques from other games

### A moving objective sets its own clock

[Long War 2](<https://ufopaedia.org/Missions_(LW2)>) · secondary: community wiki

Long War 2, an XCOM 2 mod, lists a troop-column ambush among its liberation missions. It is the model for Intercept, where the courier's walk is the time limit.

### Plan without limit, then start the clock yourself

[Teardown](https://get-teardown.readthedocs.io/en/latest/gameplay/heist-basics.html) · secondary: community documentation

Planning has no time limit. Stealing the first target trips the alarm, and the player then has 60 seconds to take the rest and reach the escape vehicle. Smash and grab borrows this shape.

### Optional objectives and greed

[Long War 2](<https://ufopaedia.org/Missions_(LW2)>) · secondary: community wiki

Smash and Grab has the squad retrieve resource caches against a 12-turn reinforcement timer, starting unconcealed. Jailbreak needs only one prisoner out of two to four.

[Invisible, Inc.](https://invisibleinc-archive.fandom.com/Game_Objectives) · secondary: fan wiki, seen only in a search excerpt

The fan wiki describes objectives as optional: a team can leave a facility as soon as it finds the exit.

### Rescues that grow the team

[Long War 2](<https://ufopaedia.org/Missions_(LW2)>) · secondary: community wiki

Jailbreak frees two to four prisoners from a jail, starts concealed and ends at a fixed exit.

[Invisible, Inc.](https://forums.kleientertainment.com/forums/topic/40012-having-trouble-tldr-strategyexplanation-here/) · secondary: player forum

A detention center holds either a prisoner the team can sell for money or an extra agent.

[Syndicate](https://en.wikipedia.org/wiki/Syndicate_(1993_video_game)) · secondary: encyclopedia

Its missions include assassinating rival executives and rescuing captured allies.

### More than one way out

[Long War 2](<https://ufopaedia.org/Missions_(LW2)>) · secondary: community wiki

Its missions end at a fixed exit, an evac flare or a countdown exit, depending on the type.

### Find the target with little intel

[Hitman's Elusive Targets](https://www.sector.sk/game-news/117146/first-elusive-target-mission-for-hitman-is-online.htm) · secondary: press

The targets appear neither on the map nor in Instinct, so the player has to find and identify them from limited intel. The player gets one attempt, with saving disabled.

### Objectives as verbs

[Syndicate Wars](https://psxdatacenter.com/games/P/S/SLES-00213.html) · secondary: game listing

Each mission is one of five verbs: eliminate, persuade, escort, acquire or evacuate. The original Syndicate had plain sweeps for enemy agents. That is the basis for Elimination and for carrying a package.

### The same maps with new objectives

[Desperados III](https://ipfs.ssi.eecc.de/ipns/en.wikipedia-on-ipfs.org/wiki/Desperados_III) · secondary: encyclopedia

The 14 free post-launch missions reuse the main game's settings, but each has its own objective and some limit which characters can be used.

[Designing the real-time stealth and combat of Desperados III](https://gamedeveloper.com/design/designing-the-real-time-stealth-and-combat-of-i-desperados-iii-i-) · primary: creative director Dominik Abé

Giving players as much information as possible is a design pillar, so they can read complex enemy patterns and understand why a plan failed. Badges reward replaying with different approaches.

## Method

- **Code.** Read on `main` at commit `9fa8e29` ([marco-machado/directive#39](https://github.com/marco-machado/directive/pull/39)) on November 5, 2026: `src/game/campaign.ts`, `mapgen.ts`, `simulation.ts`, `classes.ts`, the UI and scene files listed above, `scripts/tactical.ts`, `scripts/bots.ts` and `scripts/balance-current.txt`.
- **Balance.** No balance runs were made for this research. Each new-type issue asks for one.
- **Web research.** Done on November 5, 2026. Most sources are community wikis, guides or press. The Desperados III interview is the only primary source.
- **Pages that would not open.** UFOpaedia's XCOM 2 mission page returned HTTP 526, and the Invisible, Inc. fan wiki reset the connection. The claims from them rest on search excerpts.

## Sources

- [Missions (LW2)](<https://ufopaedia.org/Missions_(LW2)>) (UFOpaedia)
- [XCOM 2 mission analysis: Guerrilla Ops](https://vigaroeentertainment.blogspot.com/2021/12/xcom-2-mission-analysis-guerrilla-ops.html) (blog)
- [Teardown: Heist Basics](https://get-teardown.readthedocs.io/en/latest/gameplay/heist-basics.html) (community documentation)
- [Game Objectives](https://invisibleinc-archive.fandom.com/Game_Objectives) (Invisible, Inc. fan wiki)
- [Having trouble? TL;DR strategy explanation](https://forums.kleientertainment.com/forums/topic/40012-having-trouble-tldr-strategyexplanation-here/) (Klei forums)
- [Syndicate (1993 video game)](https://en.wikipedia.org/wiki/Syndicate_(1993_video_game)) (Wikipedia)
- [Syndicate Wars](https://psxdatacenter.com/games/P/S/SLES-00213.html) (PSX Datacenter)
- [First Elusive Target mission for Hitman is online](https://www.sector.sk/game-news/117146/first-elusive-target-mission-for-hitman-is-online.htm) (Sector.sk)
- [Hitman's first Elusive Target arrives May 13](https://gamesradar.com/hitmans-first-elusive-target-arrives-may-13-you-have-48-hours-one-chance) (GamesRadar)
- [Desperados III](https://ipfs.ssi.eecc.de/ipns/en.wikipedia-on-ipfs.org/wiki/Desperados_III) (Wikipedia mirror)
- [Designing the real-time stealth and combat of Desperados III](https://gamedeveloper.com/design/designing-the-real-time-stealth-and-combat-of-i-desperados-iii-i-) (Game Developer)
