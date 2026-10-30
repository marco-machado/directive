# Neon Directive

A React Three Fiber rewrite of the original squad-combat prototype. The same Site and `ndSave` browser-storage key preserve existing progress.

## Run

Node.js 24 or newer. Install the locked dependencies with `npm ci`, then run `npm run dev`. `npm run build` bundles `dist/`; `npm run typecheck` runs the TypeScript compiler. `npm test` exercises navigation, combat/extraction, pause, save migration, upgrades, and failure recovery.

TypeScript 7 uses a native compiler. In restricted environments without `/proc/self/exe`, its Linux binary cannot initialize. Run `npm run typecheck` on a normal Node/Linux, macOS, or Windows development machine; Vite's production build and the simulation tests run independently.

Direct dependency versions are pinned to the npm registry's stable `latest` releases resolved during this rewrite. `package-lock.json` locks the transitive dependency graph.

## Structure

- `src/game/`: serializable campaign data, renderer-independent simulation, navigation and line-of-sight.
- `src/scene/`: React Three Fiber scene, procedural city and agents, camera, and visual effects. Frame updates mutate Three.js objects; UI snapshots update at 10 Hz.
- `src/main.tsx`: React DOM HUD, briefing, controls, headquarters and upgrade purchase flow.

Select agents with click or 1/2, Shift-click to combine, A to select all. Click the street to move or a hostile to focus fire. S holds position. Space pauses and permits queued commands. Scroll to zoom, right-drag to pan, R to reset the camera. Touch uses tap commands and two-finger pan/zoom.

The campaign is intentionally one replayable district. Completing extraction pays 500 credits; ammunition costs 300 and plating costs 250, each capped at three levels. Progress saves locally in the same browser. No network backend or external 3D assets are required.
