# Rewrite validation

- Registry resolution: all direct runtime and development dependencies use the exact stable `latest` versions returned by npm. `npm outdated --json` returned `{}`.
- Seven Node tests passed: legacy save migration and invalid-value handling; obstacle-aware navigation and blocked lines of sight; pause and queued movement; full combat/extraction with exactly one payout; purchase debit/application/persistence; mission loss and recovery; storage failure handling.
- Vite 8 production build passed. The Three.js renderer chunk is larger than Vite's general-purpose 500 kB warning threshold (about 188 kB compressed); rendering packages are separated from game code.
- TypeScript 7.0.2's native Linux checker could not initialize in this execution environment because `/proc/self/exe` is unavailable. `npm run typecheck` remains available for a normal development environment. No older compiler was substituted.
- Browser visual/interaction QA could not run: `sites-preview start` reported that the preview daemon mailbox was unavailable. Rendering, pointer selection, camera controls, and responsive layout require a browser playtest. The gameplay simulation tests do not establish browser-rendering correctness.
