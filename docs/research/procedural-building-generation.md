# Procedural building generation: better ways to build the assets

Research date: 2026-11-09. Scope: how the district's buildings and street assets are generated today, how that design rates, and what the web and the installed three.js say about doing it better while keeping everything procedural.

This is research, not a spec. Nothing here has been implemented.

## Coverage and gaps

- Read in the repository: `src/game/mapgen.ts` (`layout`), `src/scene/district.ts`, `src/scene/city.tsx`, and the generators shipped in `node_modules/three/examples/jsm/generators/` (three 0.187.0).
- Not read: `src/scene/view.ts`, `src/scene/materials.ts`, `src/scene/textures.ts` beyond their function names, and the tests.
- Two pages returned HTTP 403 and were not read: the Codrops article "Exploring Procedural Geometry with Three.js and WebGPU" and the gamedev.net article "Procedural Modeling of Buildings with Shape Grammars".
- The XCOM 2 details come from press coverage and a talk listing, not from the GDC talk itself.
- Claims about shape grammars, lot subdivision and wave function collapse come from search summaries of the papers and theses listed under Sources, not from reading the full papers.
- The sign atlas overflow described below was read from the code and has not been confirmed on screen.

## How buildings are generated today

Generation has two stages, both seeded from the contract. No building has a model; every one is a set of instanced boxes.

### Stage 1: layout (gameplay)

`layout()` in `src/game/mapgen.ts`:

- Map size comes from the tier: 32 x 24 m at tier 1, plus 3 x 2 m per tier (`mapSize`).
- The map is split into blocks of about 8 m (`blockGrid`), so tier 1 is 4 x 3 blocks.
- Each block has a 20% chance of staying empty (an open plaza). Otherwise it gets exactly one building.
- The block keeps a 1.5 m street margin (`STREET`) on each side. The building's width and depth are each 55 to 100% of the remaining room, and it is shifted randomly inside that room.
- Height is 1.4 m up to `2.4 + 0.9 x tier`.
- Each building also gets a name from a shuffled list and one of five accent colors, drawn from the same random stream.

The result is a `Building` (`x, z, w, d, h, name, accent`): an axis-aligned box. That box is all the simulation knows. `World` uses it for navigation and line of sight.

### Stage 2: dressing (looks only)

`dressDistrict(plan)` in `src/scene/district.ts` turns each box into parts. Each building gets its own random stream (`seed ^ (i + 1) x 0x9e3779b1`), so dressing never shifts the layout.

- **Massing** picks the silhouette: a single slab for short or narrow buildings; otherwise 40% podium with an inset tower, 32% stepped stack of two or three tiers, 28% single slab. Upper tiers start on a window-floor line and stay inside the footprint and under `Building.h`.
- **`dressBuilding`** adds a plinth, one facade box per tier with a parapet, neon trim, cornices, awnings, vents, blade signs, rooftop clutter (name board, AC units, vents, tank, antenna) and curb props (kiosk, crates).
- Windows are not geometry. Each facade instance carries four numbers that the TSL facade material reads against a shared per-contract atlas.
- `dressDistrict` also lays sidewalks, curbs, street paint, crosswalks, corner lamps, puddles and an outer ring of low shops and parked cars past the map bounds.

### Rendering

`src/scene/city.tsx` renders each part list (`solid`, `facade`, `neon`, `signs`, cylinders) as one `InstancedParts` mesh of a unit box, cylinder or plane. Every part carries its building index, so a whole building can fade when it hides a unit.

## Rating of the current architecture: 8/10

### Strengths

- **Gameplay and looks are cleanly split.** The simulation only knows boxes; everything visual derives from the plan and cannot affect navigation or line of sight.
- **Random streams are isolated.** Dressing uses its own streams, and each building has its own.
- **Dressing is pure data.** `dressDistrict` returns part lists, so tests can check them against the navigation grid and the footprint box.
- **Rendering cost is flat.** A handful of instanced meshes, windows in a shader atlas, and a fixed number of point lights so shaders do not recompile between districts.

### Weaknesses

- **Layouts are samey by construction.** One building per 8 m block on a regular grid means every district is the same street lattice with different box sizes. There are no alleys, L-shapes, courtyards or merged blocks. For a game about engagement control, tactical variety is the thinnest part.
- **Cosmetics leak into the layout stream.** `name` and `accent` live on `Building` and are drawn from mapgen's stream, so changing the accent list would change every map. Dressing then maps accents by hex string through `NEON` with a silent fallback.
- **Sign atlas overflow.** Once `k.blades` reaches 16 or `k.boards` reaches 8, the list stops growing, so `length % CELLS` is always 0 and every later sign reuses cell 0. A later rooftop board would show the first board's name. A high-tier map can reach both caps.
- **`dressBuilding` is hard to change safely.** About 130 lines of dense one-liners with inline numbers, where each feature's look depends on its position in the random call order.

## What the research says

### One generator per asset, composed by a layout

Source: three.js `CityGenerator`, shipped in three 0.187 under `examples/jsm/generators/`.

- `CityGenerator.js` only lays out the grid and hands out placements. Each asset has its own file under `city/`: `SkyscraperGenerator`, `SidewalkGenerator`, `StreetlightGenerator`, `TrafficlightGenerator`, `TrashcanGenerator`, `BenchGenerator`, `HydrantGenerator`, `StreetTreeGenerator`, `CarGenerator`, `PersonGenerator`.
- Each generator has static `defaults`, takes parameters, and is material agnostic ("it only produces geometry", per the `SkyscraperGenerator` doc comment).
- Props share a small base class, `InstancedMeshGenerator`: build one canonical model, then instance it over a `Matrix4[]` of placements. The canonical model has a documented orientation (for example, a streetlight's arm reaches toward +Z) so the layout can aim it.
- The layout draws one seed per building from its own stream (`seed: Math.floor(random() * 100000)`) and passes it down, so a building's look depends only on its seed.
- Each vertex carries a `partId`, and one TSL material branches on it with `select()`. This is the same idea as `Part.data` roles here.
- The layout is exposed (`CityGenerator#layout`) so road markings align to the same grid, as `blockGrid` already does here.
- Dimensions snap to a shared module (a brick course) so procedural shading lines up with geometry.
- Each skyscraper is baked into one non-indexed geometry and drawn in one call.

What does not transfer: the towers are 140 m Beaux-Arts buildings, and one merged mesh per building does not fit this game's scale, look or instanced per-building fade. Borrow the structure, not the code.

### Lots inside blocks

Sources: CityEngine block parameters; Vanegas et al., "Procedural Generation of Parcels in Urban Modeling" (Eurographics 2012).

- **Recursive OBB subdivision:** split a block across its long side at the midpoint, and recurse only while both halves meet the minimum width and area. An irregularity value moves the split off center. A "force street access" value favors lots that touch a street.
- **Offset subdivision:** keep a fixed-depth strip of lots along the street edges and leave the middle open. This gives courtyards and alleys. It falls back to OBB subdivision when the offset collapses.
- **Skeleton subdivision:** uses the straight skeleton for street-aligned lots on irregular blocks. Not needed on an axis-aligned grid.
- Small lots are merged with neighbors until they pass a minimum area.
- Per-lot seeds are computed before recursion so results stay stable under edits.

On this game's axis-aligned grid, recursive and offset subdivision are short, pure functions.

### Authored templates inside a procedural frame

Sources: Game Rant on XCOM 2; the "Plot and Parcel" GDC talk listing; Shadows of Doubt DevBlog #13.

- XCOM 2 fixes the street layout per map (the plot) and fills small, medium and large slots (parcels) from a pool of designed pieces that suit the theme. The plot itself also gets some random dressing.
- The stated reason: the earlier game's fully random placement put items where they had no tactical value. Art director Greg Foertsch: "Random's not fun".
- Shadows of Doubt made the same choice one level down: designed floor plans are the unit the generator arranges, and its hierarchy runs City > District > Block > Building > Floor > Address > Room > Tile.

For an engagement-control game this matters more than facade detail. Parcel archetypes (courtyard, L-block, twin buildings with an alley, plaza with cover) would give designed sight lines while seeds still vary everything.

### Facade techniques

- **Split grammars (CGA shape).** The standard for facade geometry: extrude a footprint, split faces into floors, repeat-split floors into bays, place a module at each terminal. The facade shader here already performs the floor and bay split in TSL, so a grammar engine would add little. Known limits: split rules over-partition, and sibling shapes cannot interact.
- **Interior mapping.** Fakes rooms behind windows by intersecting the view ray with a box in the shader. three's `SkyscraperGenerator` does this in TSL with per-pane `roomCenter` and `roomSize` attributes, so a working WebGPU reference exists in the project's dependencies. At this game's camera height the payoff is small.
- **Modular kits.** Authored parts with named sockets on a meter grid, assembled from a data file rather than merged. Keeps buildings editable. Relevant only if the project starts using modeled parts.
- **Wave function collapse.** Needs a tile set and works on an existing grid. A poor fit for free-size boxes; a possible fit for cover and prop placement within a parcel.

### Seeding

Common guidance across the sources: derive a named sub-seed per system from the master seed so changing one generator does not reshuffle the others, chain generators in stages (layout, then population, then decoration, then cleanup passes), and test generators across many seeds for constraints such as reachability.

## Recommendation: move to dedicated generators

1. **Split `district.ts` into `src/scene/generators/`.** One file each for `building` (massing, facade, trim), `rooftop`, `signage`, `storefront`, `street` (sidewalks, curbs, paint), `lamp`, `car` and `ring`. Each is a pure function from an input and a random stream to `Part[]`, which keeps the testable data model that three's version lacks. `dressDistrict` becomes a composer that owns placements and shared budgets (the eight practical lights, the sign atlas cells). That ownership also removes the atlas overflow.
2. **Give each generator a named stream** derived from the seed, the generator's name and an index, so adding a draw to rooftops cannot change signs. This changes every existing district's look once.
3. **Move `name` and `accent` out of `layout()`** into the building generator, so cosmetics stop consuming the layout stream. This shifts every map's layout once, so it belongs with step 4.
4. **Add a lot stage to `mapgen.ts`.** Block to lots by recursive split, then a parcel archetype per block. This is a gameplay change (README, tests, patrol and cover placement) and is the largest piece.
5. **Optional: real geometry for round props.** Cars and lamps as one canonical merged geometry, instanced per placement the way `InstancedMeshGenerator` does. Buildings stay boxes.

Steps 1 and 2 are a refactor with no gameplay risk. Step 4 is where the layout weakness would actually improve.

## Additional research pointers

Not yet read. Each is a lead, with the question it should answer.

### Layout and tactical quality

- **"Plot and Parcel: Procedural Level Design in XCOM 2" (Brian Hess, GDC).** How plots, parcels and plot cover parcels (PCPs) are zoned and selected, and how the team validated tactical quality. Listing: https://gdcvault.com/play/1025213/
- **Invisible, Inc. level generator.** No description of its internals turned up. A Klei postmortem or talk would show how a stealth-tactics game tunes guard routes and sight lines against generated rooms. Starting point: https://www.shacknews.com/article/82772/invisible-inc-adjusting-difficulty-for-procedural-generation
- **XCOM 2 modding documentation on plots and parcels.** A practical description of the data format. https://www.nexusmods.com/xcom2/mods/302?tab=docs
- **Parish and Müller, "Procedural Modeling of Cities" (SIGGRAPH 2001).** The original street network and lot pipeline. Useful if the fixed 8 m grid is ever replaced.
- **Kelly, "Unwritten procedural modeling with the straight skeleton" (Glasgow PhD thesis, 2014).** Only needed if blocks stop being rectangles. https://theses.gla.ac.uk/4975
- **Open question, no source found:** metrics for scoring a generated tactical map (sight line lengths, cover density, number of routes between spawn and objective) so seeds can be tested or rejected automatically.

### Building form and facades

- **Müller et al., "Procedural Modeling of Buildings" (SIGGRAPH 2006).** The CGA shape paper: the primary reference for massing and facade rules.
- **Wonka et al., "Instant Architecture" (SIGGRAPH 2003).** The split grammar foundation.
- **gamedev.net, "Procedural Modeling of Buildings with Shape Grammars".** Returned 403. A games-focused walkthrough of split rules. https://gamedev.net/tutorials/programming/engines-and-middleware/procedural-modeling-of-buildings-with-shape-grammars-r4596
- **Townscaper (Oskar Stålberg).** The search found nothing. Its module selection by neighborhood is the best-known alternative to grammars for building form.
- **nutWFC and the Tartu "Grape Grammar" thesis.** Wave function collapse with tiles of varying size, and a grammar combined with WFC. Relevant to parcel dressing. https://dspace.ut.ee/items/09b0b22a-2924-4661-9df9-e0a20849d9db
- **Joost van Dongen, "Interior Mapping" (2008).** The original interior mapping paper, if window interiors are ever pursued.

### three.js and WebGPU implementation

- **The rest of three's bundled generators.** Only `CityGenerator.js`, `InstancedMeshGenerator.js`, `CityGeneratorUtils.js` and the heads of `StreetlightGenerator.js` and `SkyscraperGenerator.js` were read. `CarGenerator.js` and `SidewalkGenerator.js` are the closest to assets this game already draws; `CityGenerator#buildProxy` and `buildFurniture` show how placements and distant stand-ins are produced.
- **Codrops, "Exploring Procedural Geometry with Three.js and WebGPU" (2026-08-11).** Returned 403. https://tympanus.net/codrops/2026/08/11/exploring-procedural-geometry-with-three-js-and-webgpu/
- **three.js `BatchedMesh` with LOD and BVH.** When many distinct geometries would otherwise mean many draw calls. https://threejs.org/examples/webgl_batch_lod_bvh.html
- **three-fenestra.** An interior mapping material for three.js; whether it supports the WebGPU node path was not confirmed. https://www.jsdelivr.com/package/npm/three-fenestra
- **The `threejs-procedural-buildings-and-cities` agent skill.** Community guidance on massing grammars, instancing versus merging, and validation gates. The raw file returned 404; a mirror is at https://www.skills.sh/linegel/threejs-complete-set-of-skill/threejs-procedural-buildings-and-cities

### Determinism and testing

- **Open question, no authoritative source found:** a write-up of the "named random stream per pass" pattern. The guidance found was consistent but generic.
- **Golden-seed tests.** Storing reference outputs for known seeds to catch unintended generator changes; worth checking how this would sit beside `tests/district.test.ts`.

## Sources

### Read in full or in substance

- three.js `SkyscraperGenerator` (r186.1 on unpkg): https://app.unpkg.com/three@0.186.1/files/examples/jsm/generators/city/SkyscraperGenerator.js. The 0.187.0 copies of `CityGenerator.js`, `city/InstancedMeshGenerator.js`, `city/CityGeneratorUtils.js`, `city/StreetlightGenerator.js` and `city/SkyscraperGenerator.js` were read in the project's `node_modules`.
- CityEngine block parameters: https://doc.arcgis.com/en/cityengine/2024.1/help/help-layers-block-parameters.htm
- "XCOM 2 Dev Details Procedural Generation & Destructibility", Game Rant: https://gamerant.com/xcom-2-procedural-level-detail/
- Interior mapping write-up, Kristian Dixon: http://kristiandixon.com//2025/02/27/InteriorMapping.html
- "Modular London terraces in three.js: sockets, assembly files and meshopt LODs", three.js forum: https://discourse.threejs.org/t/modular-london-terraces-in-three-js-sockets-assembly-files-and-meshopt-lods/94887

### Known through search summaries only

- Vanegas et al., "Procedural Generation of Parcels in Urban Modeling": https://www.cs.purdue.edu/cgvlab/papers/aliaga/eg2012.pdf
- Kelly, "Unwritten procedural modeling with the straight skeleton": https://theses.gla.ac.uk/4975
- "Plot and Parcel: Procedural Level Design in XCOM 2", Class Central listing: https://classcentral.com/classroom/youtube-plot-and-parcel-procedural-level-design-in-xcom-2-158048
- XCOM 2 plot and parcel modding FAQ: https://www.nexusmods.com/xcom2/mods/302?tab=docs
- Shadows of Doubt DevBlog #13, "Creating Procedural Interiors": https://colepowered.com/2019/02/
- Shadows of Doubt DevBlog #30: https://colepowered.itch.io/shadows/devlog/354045/shadows-of-doubt-devblog-30-the-top-shadows-of-doubt-development-challenges-part-i
- Invisible, Inc. on procedural difficulty, Shacknews: https://www.shacknews.com/article/82772/invisible-inc-adjusting-difficulty-for-procedural-generation
- Zweig, "Procedural Architectural Facade Modeling" (Brown undergraduate thesis): https://cs.brown.edu/research/pubs/theses/ugrad/2013/zweig.pdf
- "Inverse Procedural Modeling of Facade Layouts": https://arxiv.org/pdf/1308.0419
- "FaçAID: A Transformer Model for Neuro-Symbolic Facade Reconstruction": https://arxiv.org/abs/2406.01829
- "Procedural Generation of Unique Buildings" (Tartu thesis): https://dspace.ut.ee/items/09b0b22a-2924-4661-9df9-e0a20849d9db
- "Building Model Generation Framework Based on Wave Function Collapse": https://structurae.net/de/fachliteratur/fachartikel/building-model-generation-framework-based-on-wave-function-collapse
- three-fenestra: https://www.jsdelivr.com/package/npm/three-fenestra
- three.js `BatchedMesh` LOD and BVH example: https://threejs.org/examples/webgl_batch_lod_bvh.html
- `threejs-procedural-buildings-and-cities` skill: https://www.skills.sh/linegel/threejs-complete-set-of-skill/threejs-procedural-buildings-and-cities
- "Procedural Generation Best Practices": https://aischool.lillytechsystems.com/procedural-generation/best-practices.html
- "Interior Mapping: rendering real rooms without geometry": https://gamedeveloper.com/programming/interior-mapping-rendering-real-rooms-without-geometry

### Not retrieved (HTTP 403 or 404)

- "Exploring Procedural Geometry with Three.js and WebGPU", Codrops: https://tympanus.net/codrops/2026/08/11/exploring-procedural-geometry-with-three-js-and-webgpu/
- "Procedural Modeling of Buildings with Shape Grammars", gamedev.net: https://www.gamedev.net/articles/programming/general/creating-a-custom-unreal-engine-plugin-r4596/
- `threejs-procedural-buildings-and-cities` SKILL.md on GitHub: https://raw.githubusercontent.com/linegel/threejs-complete-set-of-skill/main/threejs-procedural-buildings-and-cities/SKILL.md
