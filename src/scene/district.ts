import { blockGrid } from '../game/mapgen.ts';
import type { MissionPlan } from '../game/mapgen.ts';
import { stream } from '../game/rng.ts';
import type { Rect } from '../game/world.ts';
import { buildingNames, shell, structure, vents } from './generators/building.ts';
import { openFaces } from './generators/faces.ts';
import { Kit } from './generators/kit.ts';
import type { BoardText, Part, Placement, Pool, Practical } from './generators/kit.ts';
import { ring } from './generators/ring.ts';
import { rooftop } from './generators/rooftop.ts';
import { bladeSigns, SignAtlas } from './generators/signage.ts';
import { awnings, curbProps } from './generators/storefront.ts';
import { barriers, puddles, sidewalks, streetLines } from './generators/street.ts';

// The district's dressing: everything the scene draws around the gameplay layout. It is derived from the mission
// plan and the contract seed and changes nothing the simulation reads. Pure data, so the tests can check it against
// the navigation grid and cover. This file decides what is dressed and in what order, and picks which lights become
// the practicals; what each thing looks like is in ./generators, one module per asset. Every asset's stream is named
// here (and numbered per building) and feeds that asset alone, so a new draw for one never moves another's, and
// none of them touches mapgen's stream; the buildings' names come from one more, 'names', in building.ts. Two
// things are shared on purpose: a building's Structure (name, accent, massing and wall order), which everything on
// that building is placed against, and the district's SignAtlas (signage.ts), whose cells go
// to signs in building order, so which cell a sign shows, and whether a late name board is built at all, depends
// on the signs before it.

export { ATLAS_CELLS, BAY, FLOOR0, ROW } from './generators/building.ts';
export { GRID_Y, OVERLAY_FLOOR, partBounds } from './generators/kit.ts';
export type { Part, Placement, Practical } from './generators/kit.ts';
export { BLADE_CELLS, BOARD_CELLS, glyphStrokes } from './generators/signage.ts';

export type District = {
  solid: Part[]; cylinders: Part[]; facade: Part[]; neon: Part[]; signs: Part[]; masts: Part[];
  pools: Pool[]; puddles: Part[]; practicals: Practical[];
  blades: number[][]; boards: BoardText[]; // sign atlas content: glyph strings and rooftop board texts
  cars: Placement[]; lamps: Placement[]; // one copy of the car or lamp model each (propGeometry.ts)
  hulls: Part[];      // boxes and cylinders whose overall extent each model stays inside: tested, never drawn
  footprints: Rect[]; // ground footprints of the free-standing street props
  flats: Rect[];      // sidewalks, curbs, crosswalk stripes and puddles
  seed: number;
};

export const MAX_PRACTICALS = 8;

const cache = new WeakMap<MissionPlan, District>();
export function dressDistrict(plan: MissionPlan): District {
  const cached = cache.get(plan);
  if (cached) return cached;
  const { world, extract, sites, spawn, contract } = plan, b = world.bounds, seed = contract.seed;
  const k = new Kit(), atlas = new SignAtlas(), names = buildingNames(seed, world.buildings.length);
  // Street paint, lamps and puddles keep clear of these.
  const keep = [extract, ...sites, ...spawn];
  world.buildings.forEach((building, i) => {
    const s = structure(building, i, names[i], openFaces(building, world.buildings), stream(seed, 'structure', i));
    shell(k, s, stream(seed, 'shell', i));
    awnings(k, s, stream(seed, 'awnings', i));
    vents(k, s, stream(seed, 'vents', i));
    bladeSigns(k, s, atlas, stream(seed, 'signage', i));
    rooftop(k, s, atlas, stream(seed, 'rooftop', i));
    curbProps(k, world, s, stream(seed, 'curb', i));
  });
  barriers(k, world);
  const walks = sidewalks(k, world);
  const { cols, rows, cw, cd } = blockGrid(b);
  const grid = { xs: Array.from({ length: cols - 1 }, (_, n) => b.minX + (n + 1) * cw), zs: Array.from({ length: rows - 1 }, (_, n) => b.minZ + (n + 1) * cd) };
  streetLines(k, world, grid, walks, keep);
  puddles(k, world, contract.tier, walks, keep, stream(seed, 'puddles'));
  ring(k, b, grid, keep, { cars: stream(seed, 'ring-cars'), shops: stream(seed, 'ring-shops'), puddles: stream(seed, 'ring-puddles') });

  // Practical lights: a fixed number of point lights (so shaders never recompile between districts), given to
  // the intersection lamps nearest the center, two signs, then whatever is left.
  const ranked = k.lights.sort((a, c) => c.rank - a.rank), lamps = ranked.filter(l => l.rank >= 2).slice(0, MAX_PRACTICALS - 2);
  const practicals = [...lamps, ...ranked.filter(l => !lamps.includes(l))].slice(0, MAX_PRACTICALS).map(({ rank: _, ...p }) => p);
  const district: District = {
    solid: k.solid, cylinders: k.cylinders, facade: k.facade, neon: k.neon, signs: k.signs, masts: k.masts,
    pools: k.pools, puddles: k.puddles, practicals, blades: atlas.blades, boards: atlas.boards, cars: k.cars, lamps: k.lamps, hulls: k.hulls, footprints: k.footprints, flats: k.flats, seed,
  };
  cache.set(plan, district);
  return district;
}
