import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { CONTRACT_TYPES, contractPayout, MAX_TIER, MODIFIER_FITS } from '../src/game/campaign.ts';
import type { ContractType } from '../src/game/campaign.ts';
import { alley } from '../src/game/lots.ts';
import { blockGrid, planMission, STREET } from '../src/game/mapgen.ts';
import type { MissionPlan } from '../src/game/mapgen.ts';
import { shuffle, stream } from '../src/game/rng.ts';
import { World } from '../src/game/world.ts';
import type { Rect } from '../src/game/world.ts';
import { dressDistrict, GRID_Y, MAX_PRACTICALS, OVERLAY_FLOOR, partBounds } from '../src/scene/district.ts';
import type { District, Part } from '../src/scene/district.ts';
import { ACCENTS, buildingNames, NAMES, shell, structure, vents } from '../src/scene/generators/building.ts';
import { FACES, openFaces } from '../src/scene/generators/faces.ts';
import { CAR, Kit, RUBBER } from '../src/scene/generators/kit.ts';
import { ring } from '../src/scene/generators/ring.ts';
import { rooftop } from '../src/scene/generators/rooftop.ts';
import { BLADE_CELLS, BOARD_CELLS, bladeSigns, SignAtlas } from '../src/scene/generators/signage.ts';
import { awnings, curbProps } from '../src/scene/generators/storefront.ts';
import { buildingTop, hides, PLINTH } from '../src/scene/view.ts';

const contract = (type: ContractType, tier: number, seed: number) => ({ id: `c-${seed}`, type, tier, seed, payout: contractPayout(tier), district: 'GLASS DISTRICT', sector: 4 });
// Every type and tier, plus through-runs, whose start and extraction sit at opposite corners.
const through = MODIFIER_FITS.through.flatMap(type => [2, 4].map(tier => ({ ...contract(type, tier, 4242 + tier), modifiers: ['through' as const] })));
const cases = [...CONTRACT_TYPES.flatMap(type => Array.from({ length: MAX_TIER }, (_, i) => [7, 31337].map(seed => contract(type, i + 1, seed + i * 101)))).flat(), ...through];
const overlaps = (a: Rect, b: Rect) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.z - b.z) < (a.d + b.d) / 2;
const layout = (plan: MissionPlan) => JSON.stringify({ ...plan, world: { bounds: plan.world.bounds, buildings: plan.world.buildings, cover: plan.world.cover } });
const lit = (d: District): Part[] => [...d.solid, ...d.cylinders, ...d.facade, ...d.neon, ...d.signs];

test('dressing a district leaves the mission plan as mapgen made it', () => {
  for (const c of cases) {
    const plan = planMission(c), before = layout(plan);
    dressDistrict(plan);
    assert.equal(layout(plan), before);
    assert.equal(layout(planMission(c)), before);
  }
});

test('a contract always dresses its district the same way, and another seed dresses it differently', () => {
  const c = contract('heist', 3, 2024);
  assert.deepEqual(dressDistrict(planMission(c)), dressDistrict(planMission(c)));
  assert.notDeepEqual(dressDistrict(planMission(c)).facade, dressDistrict(planMission({ ...c, seed: 2025 })).facade);
});

test('street props stand where no unit can, and never on a barrier', () => {
  for (const c of cases) {
    const plan = planMission(c), { world } = plan, district = dressDistrict(plan);
    assert.ok(district.footprints.length > 0);
    for (const r of district.footprints) {
      for (const fx of [-.5, 0, .5]) for (const fz of [-.5, 0, .5]) {
        const p = { x: r.x + fx * r.w, z: r.z + fz * r.d };
        assert.ok(!world.walkable(p), `seed ${c.seed}: a prop at ${p.x.toFixed(2)}, ${p.z.toFixed(2)} stands on walkable ground`);
      }
      assert.ok(world.cover.every(b => !overlaps(b, r)), `seed ${c.seed}: a prop overlaps a barrier`);
    }
    for (const r of district.flats) assert.ok(world.cover.every(b => !overlaps(b, r)), `seed ${c.seed}: street paint or a puddle runs under a barrier`);
  }
});

test("a building's dressing stays inside the box the fade and silhouette tests use", () => {
  for (const c of cases) {
    const plan = planMission(c), { buildings } = plan.world;
    for (const p of lit(dressDistrict(plan))) {
      if (p.building === undefined) continue;
      const b = buildings[p.building], e = partBounds(p), eps = 1e-6;
      assert.ok(e.minX >= b.x - b.w / 2 - PLINTH - eps && e.maxX <= b.x + b.w / 2 + PLINTH + eps && e.minZ >= b.z - b.d / 2 - PLINTH - eps && e.maxZ <= b.z + b.d / 2 + PLINTH + eps,
        `seed ${c.seed}: a part of building ${p.building} reaches past its plinth`);
      assert.ok(e.maxY <= buildingTop(b) + eps, `seed ${c.seed}: a part of building ${p.building} rises above ${buildingTop(b).toFixed(2)} m`);
    }
  }
});

test('nothing past the bounds hides a unit at the edge, even from the lowest camera tilt', () => {
  const rise = Math.tan(Math.PI / 2 - Math.PI * 13 / 36); // OrbitControls' maxPolarAngle in GameCanvas.tsx
  for (const c of cases.filter((_, i) => i % 3 === 0)) {
    const plan = planMission(c), b = plan.world.bounds, edge = .38;
    const district = dressDistrict(plan);
    // Cars and lamps are drawn as models; their hulls stand in for them here.
    const ring = [...lit(district), ...district.hulls].map(partBounds).filter(e => e.maxX < b.minX || e.minX > b.maxX || e.maxZ < b.minZ || e.minZ > b.maxZ);
    assert.ok(ring.length > 0);
    const units = [];
    for (let x = b.minX + edge; x <= b.maxX - edge; x += 1) units.push({ x, z: b.minZ + edge }, { x, z: b.maxZ - edge });
    for (let z = b.minZ + edge; z <= b.maxZ - edge; z += 1) units.push({ x: b.minX + edge, z }, { x: b.maxX - edge, z });
    for (let a = 0; a < 24; a++) {
      const view = { ux: Math.cos(a * Math.PI / 12), uz: Math.sin(a * Math.PI / 12), rise };
      for (const e of ring) {
        const r: Rect = { x: (e.minX + e.maxX) / 2, z: (e.minZ + e.maxZ) / 2, w: e.maxX - e.minX, d: e.maxZ - e.minZ };
        for (const u of units) assert.ok(!hides(u, .9, view, r, e.maxY), `seed ${c.seed}: a ring part ${e.maxY.toFixed(2)} m tall hides a unit at ${u.x.toFixed(1)}, ${u.z.toFixed(1)}`);
      }
    }
  }
});

test('flat street dressing stays under the tactical grid and every gameplay ground overlay', () => {
  assert.ok(GRID_Y < OVERLAY_FLOOR);
  for (const c of cases) {
    const district = dressDistrict(planMission(c));
    const flat = district.solid.map(partBounds).filter(e => e.maxY < .1);
    assert.ok(flat.length > 0);
    for (const e of flat) assert.ok(e.maxY < GRID_Y, `seed ${c.seed}: street dressing reaches ${e.maxY.toFixed(3)} m`);
    for (const p of district.puddles) assert.ok(p.y < GRID_Y);
  }
});

test('every building stands inside its block\'s room, so the streets stay as wide as the layout drew them', () => {
  let joined = 0, alleys = 0;
  for (const c of cases) {
    const { world } = planMission(c), b = world.bounds, { cw, cd } = blockGrid(b);
    for (const bd of world.buildings) {
      const i = Math.floor((bd.x - b.minX) / cw), j = Math.floor((bd.z - b.minZ) / cd);
      const room = { x: b.minX + (i + .5) * cw, z: b.minZ + (j + .5) * cd, w: cw - 2 * STREET, d: cd - 2 * STREET };
      assert.ok(Math.abs(bd.x - room.x) + bd.w / 2 <= room.w / 2 + 1e-9 && Math.abs(bd.z - room.z) + bd.d / 2 <= room.d / 2 + 1e-9, `${c.id}: a building reaches into the street`);
      if (openFaces(bd, world.buildings).length < 4) joined++;
      else if (world.buildings.some(o => o !== bd && Math.floor((o.x - b.minX) / cw) === i && Math.floor((o.z - b.minZ) / cd) === j)) alleys++;
    }
  }
  assert.ok(joined > 0 && alleys > 0, 'no test district has a corner block and a twin block');
});

test('sidewalks and street props stop at a neighbor\'s wall', () => {
  const within = (r: Rect, b: Rect) => Math.abs(r.x - b.x) + r.w / 2 <= b.w / 2 && Math.abs(r.z - b.z) + r.d / 2 <= b.d / 2;
  for (const c of cases) {
    const plan = planMission(c), district = dressDistrict(plan);
    for (const r of district.flats) assert.ok(!plan.world.buildings.some(b => overlaps(r, b)), `${c.id}: street dressing runs under a building`);
    for (const r of district.footprints) assert.ok(!plan.world.buildings.some(b => within(r, b)), `${c.id}: a street prop stands inside a building`);
  }
});

test('nothing a building hangs on its walls or sets at its curb reaches into a neighbor', () => {
  let closed = 0, parts = 0;
  for (const c of cases) {
    const plan = planMission(c), { buildings } = plan.world;
    buildings.forEach((b, i) => {
      const walls = openFaces(b, buildings).length;
      if (walls === 4) return;
      closed += 4 - walls;
      const { kits } = alone(plan, i);
      // Awnings, vents, blade signs and their faces, kiosks and crates: everything but the body and the roof.
      // A sign's face is a flat plane: its `d` is not a depth.
      for (const kit of [kits.awnings, kits.vents, kits.signage, kits.curb]) for (const p of [...kit.solid, ...kit.neon, ...kit.signs.map(f => ({ ...f, d: 0 }))]) {
        const e = partBounds(p);
        parts++;
        for (const o of buildings) if (o !== b) assert.ok(e.maxX <= o.x - o.w / 2 + 1e-6 || e.minX >= o.x + o.w / 2 - 1e-6 || e.maxZ <= o.z - o.d / 2 + 1e-6 || e.minZ >= o.z + o.d / 2 - 1e-6, `${c.id}: building ${i} has a part inside its neighbor`);
      }
    });
  }
  assert.ok(closed > 0 && parts > 0);
});

test('a twin block\'s alley is clear from street to street on every map: no barrier stands in it', () => {
  let alleys = 0;
  for (const c of cases) {
    const { world } = planMission(c), b = world.bounds, { cols, rows, cw, cd } = blockGrid(b);
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const room = { x: b.minX + (i + .5) * cw, z: b.minZ + (j + .5) * cd, w: cw - 2 * STREET, d: cd - 2 * STREET };
      const lots = world.buildings.filter(bd => Math.abs(bd.x - room.x) < room.w / 2 && Math.abs(bd.z - room.z) < room.d / 2);
      if (lots.length !== 2 || openFaces(lots[0], lots).length < 4) continue;
      alleys++;
      // From 0.6 m outside one end of the room to 0.6 m outside the other, along the alley's center line.
      const strip = alley([...lots].sort((p, q) => room.w >= room.d ? p.x - q.x : p.z - q.z), room, .6), alongX = strip.w > strip.d;
      const ends = alongX ? [{ x: strip.x - strip.w / 2, z: strip.z }, { x: strip.x + strip.w / 2, z: strip.z }] : [{ x: strip.x, z: strip.z - strip.d / 2 }, { x: strip.x, z: strip.z + strip.d / 2 }];
      assert.ok(world.passable(ends[0], ends[1], .4), `${c.id}: the alley of block ${i},${j} is blocked`);
    }
  }
  assert.ok(alleys > 20, `${alleys} alleys`);
});

test('a building with one open wall keeps its body and roof, and dresses that wall only', () => {
  const b = { x: 0, z: 0, w: 4, d: 4, h: 5 }, east = FACES.filter(f => f.nx === 1);
  let dressed = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const s = structure(b, 0, 'BOXED', east, stream(seed, 'structure')), k = new Kit();
    assert.deepEqual(s.faces, east);
    shell(k, s, stream(seed, 'shell')); rooftop(k, s, new SignAtlas(), stream(seed, 'rooftop'));
    assert.ok(k.solid.length > 0 && k.facade.length === s.tiers.length);
    const walls = new Kit();
    awnings(walls, s, stream(seed, 'awnings')); vents(walls, s, stream(seed, 'vents')); bladeSigns(walls, s, new SignAtlas(), stream(seed, 'signage')); curbProps(walls, new World({ minX: -9, maxX: 9, minZ: -9, maxZ: 9 }, [b], []), s, stream(seed, 'curb'));
    // On the east side, and not past the north or south wall: an upper tier's east wall may stand back from the base's.
    for (const p of [...walls.solid, ...walls.neon, ...walls.signs]) assert.ok(p.x > 0 && Math.abs(p.z) < 2, `seed ${seed}: a part off the open wall`);
    dressed += walls.solid.length;
  }
  assert.ok(dressed > 0);
});

test('cars and lamps are placed as models: no box or cylinder of one is left in the drawn lists', () => {
  for (const c of cases) {
    const district = dressDistrict(planMission(c));
    assert.ok(district.cars.length > 0 && district.lamps.length > 0 && district.hulls.length > district.cars.length + district.lamps.length);
    assert.ok(!district.cylinders.some(p => p.data === RUBBER), `${c.id}: a wheel is still a cylinder`);
    assert.ok(![...district.solid, ...district.cylinders].some(p => p.h === 2.6 && p.w === .09), `${c.id}: a lamp mast is still a cylinder`);
    assert.ok(![...district.solid, ...district.neon].some(p => p.data === CAR || p.color === '#ff2a3a'), `${c.id}: a car body or tail light is still a box`);
    // Every lamp's pool and every lamp-colored practical light sits over exactly one lamp's head.
    const heads = district.lamps.map(l => ({ x: l.x + Math.sin(l.ry) * .75, z: l.z + Math.cos(l.ry) * .75 }));
    const over = (p: { x: number; z: number }) => heads.filter(h => Math.hypot(h.x - p.x, h.z - p.z) < 1e-9).length;
    const pools = district.pools.filter(p => p.r === 2.1 && p.color === '#ffc58e');
    assert.equal(pools.length, district.lamps.length);
    for (const p of pools) assert.equal(over(p), 1, `${c.id}: a lamp pool without its lamp`);
    for (const p of district.practicals.filter(p => p.color === '#ffbf7a')) assert.equal(over(p), 1, `${c.id}: a lamp light without its lamp`);
    // A prop's hull stands on its footprint, and footprints stay off walkable ground (tested above).
    for (const car of district.cars) assert.ok(district.footprints.some(r => r.x === car.x && r.z === car.z));
    for (const l of district.lamps) assert.ok(district.footprints.some(r => r.x === l.x && r.z === l.z));
  }
});

test('every district fits the fixed pool of practical lights and lights its streets', () => {
  for (const c of cases) {
    const district = dressDistrict(planMission(c));
    assert.ok(district.practicals.length > 0 && district.practicals.length <= MAX_PRACTICALS);
    assert.ok(district.pools.length >= district.practicals.length);
    assert.ok(district.blades.every(text => text.length >= 3));
    for (const p of district.signs) assert.ok(p.data!.every(v => v >= 0 && v <= 1));
  }
});

// One building's dressing, each asset made alone in a kit of its own, last to first.
const alone = (plan: MissionPlan, i: number) => {
  const seed = plan.contract.seed, s = structure(plan.world.buildings[i], i, buildingNames(seed, plan.world.buildings.length)[i], openFaces(plan.world.buildings[i], plan.world.buildings), stream(seed, 'structure', i));
  const kits = { curb: new Kit(), rooftop: new Kit(), signage: new Kit(), vents: new Kit(), awnings: new Kit(), shell: new Kit() };
  curbProps(kits.curb, plan.world, s, stream(seed, 'curb', i));
  rooftop(kits.rooftop, s, new SignAtlas(), stream(seed, 'rooftop', i));
  bladeSigns(kits.signage, s, new SignAtlas(), stream(seed, 'signage', i));
  vents(kits.vents, s, stream(seed, 'vents', i));
  awnings(kits.awnings, s, stream(seed, 'awnings', i));
  shell(kits.shell, s, stream(seed, 'shell', i));
  return { s, kits };
};
// Which atlas cell a sign shows depends on the signs before it, so signs are compared without it.
const bare = (parts: readonly Part[]) => parts.map(({ data: _, ...p }) => p);

test('each asset of a building comes from its own stream alone, whatever the others drew', () => {
  const plan = planMission(contract('heist', 3, 2024)), district = dressDistrict(plan), made = { awnings: 0, curb: 0, signs: 0, rooftop: 0, vents: 0 };
  // Under eight name boards, so the full atlas keeps none of this district's boards from being built.
  assert.ok(district.boards.length < BOARD_CELLS);
  plan.world.buildings.forEach((_, i) => {
    const { s, kits } = alone(plan, i), all = Object.values(kits);
    assert.ok(kits.shell.solid.length > 0 && kits.shell.facade.length === s.tiers.length);
    // Everything tagged with this building in the district is exactly what the generators made alone.
    for (const list of ['solid', 'cylinders', 'facade', 'neon', 'masts'] as const) {
      const whole = district[list].filter(p => p.building === i), parts = all.flatMap(k => k[list]).filter(p => p.building === i);
      assert.equal(parts.length, whole.length, `building ${i}: ${list}`);
      for (const p of parts) assert.ok(whole.some(q => isDeepStrictEqual(q, p)), `building ${i}: a ${list} part made alone is not in the district`);
    }
    const signs = bare(district.signs.filter(p => p.building === i)), mine = bare(all.flatMap(k => k.signs));
    assert.equal(mine.length, signs.length, `building ${i}: signs`);
    for (const p of mine) assert.ok(signs.some(q => isDeepStrictEqual(q, p)), `building ${i}: a sign made alone is not in the district`);
    // Curb props carry no building tag: find them among the district's parts.
    for (const p of kits.curb.solid) assert.ok(district.solid.some(q => isDeepStrictEqual(q, p)), `building ${i}: a curb prop made alone is not in the district`);
    for (const r of kits.curb.footprints) assert.ok(district.footprints.some(q => isDeepStrictEqual(q, r)));
    made.awnings += kits.awnings.solid.length; made.curb += kits.curb.footprints.length; made.signs += kits.signage.signs.length;
    made.rooftop += kits.rooftop.solid.length; made.vents += kits.vents.solid.length + kits.vents.cylinders.length;
  });
  for (const [name, count] of Object.entries(made)) assert.ok(count > 0, `no ${name} in the whole district`);
});

test('a district names its buildings from the contract seed: sixteen names, repeated in order past that', () => {
  const names = buildingNames(7, 20);
  assert.equal(names.length, 20);
  assert.deepEqual([...names.slice(0, 16)].sort(), [...NAMES].sort());
  assert.deepEqual(names.slice(16), names.slice(0, 4));
  assert.deepEqual(buildingNames(7, 16), names.slice(0, 16));
  assert.notDeepEqual(buildingNames(8, 16), buildingNames(7, 16));
  assert.deepEqual(buildingNames(7, 0), []);
  // The order is the district's 'names' stream and no other.
  assert.deepEqual(buildingNames(7, 16), shuffle(stream(7, 'names'), NAMES));
});

test('a building\'s neon is the accent its structure drew, or an awning\'s lip', () => {
  const seen = new Set<string>();
  for (const c of cases) {
    const plan = planMission(c), district = dressDistrict(plan), names = buildingNames(c.seed, plan.world.buildings.length);
    const accents = plan.world.buildings.map((b, i) => structure(b, i, names[i], openFaces(b, plan.world.buildings), stream(c.seed, 'structure', i)).accent);
    for (const p of district.neon) {
      if (p.building === undefined || p.color === '#ffc685') continue;
      assert.equal(p.color, accents[p.building], `${c.id}: building ${p.building} glows in another color than its accent`);
      seen.add(p.color);
    }
  }
  assert.deepEqual([...seen].sort(), [...ACCENTS].sort());
});

test('a structure draws its accent last, after its massing and wall order', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rng = stream(seed, 'structure');
    let last = 0;
    const s = structure({ x: 0, z: 0, w: 5, d: 4, h: 4 }, 0, 'ANY', FACES, () => last = rng());
    assert.equal(s.accent, ACCENTS[Math.floor(last * ACCENTS.length)], `seed ${seed}`);
  }
});

const strips = (lengths: number[]) => { const atlas = new SignAtlas(); for (const n of lengths) atlas.blade(Array(n).fill(0)); return atlas; };
const fullAtlas = () => { const atlas = strips(Array.from({ length: BLADE_CELLS }, (_, n) => 3 + n % 5)); for (let n = 0; n < BOARD_CELLS; n++) atlas.board({ title: `FULL ${n}`, glyphs: [0] }); return atlas; };
// The atlas cell a sign face shows, read back from the UV rectangle in its data.
const isBoard = (p: Part) => p.data![2] === .5, bladeCell = (p: Part) => p.data![0] * BLADE_CELLS, boardCell = (p: Part) => p.data![0] / .5 + 2 * (.375 - p.data![1]) / .125;
// Where textures.ts draws each cell: sixteen strips side by side across the top half, boards two across and four down the bottom half.
const bladeRect = (cell: number) => [cell / BLADE_CELLS, .5, 1 / BLADE_CELLS, .5], boardRect = (cell: number) => [(cell % 2) * .5, .375 - Math.floor(cell / 2) * .125, .5, .125];
const showsCell = (p: Part, cells: number) => { const cell = isBoard(p) ? boardCell(p) : bladeCell(p); return Number.isInteger(cell) && cell >= 0 && cell < cells && isDeepStrictEqual(p.data, isBoard(p) ? boardRect(cell) : bladeRect(cell)); };

test('the sign atlas gives each blade sign a strip, and shares the closest ones once it is full', () => {
  const atlas = new SignAtlas();
  for (let n = 0; n < BLADE_CELLS; n++) assert.equal(atlas.blade(Array(3 + n % 5).fill(n)), n);
  assert.equal(atlas.blades.length, BLADE_CELLS);
  // Strips of 5 glyphs sit in cells 2, 7 and 12: overflowing signs of that length take turns on them.
  assert.deepEqual([0, 1, 2, 3].map(() => atlas.blade(Array(5).fill(-1))), [2, 7, 12, 2]);
  assert.equal(atlas.blades.length, BLADE_CELLS);
  assert.ok(atlas.blades.every(text => !text.includes(-1)));
  // No strip of 6: the nearest lengths are 5 (cells 0, 1) and 7 (cell 2), one glyph off either way.
  const uneven = strips([5, 5, 7, ...Array(BLADE_CELLS - 3).fill(3)]);
  assert.deepEqual([0, 1, 2, 3].map(() => uneven.blade(Array(6).fill(0))), [0, 1, 2, 0]);
  assert.equal(strips([3, 4, 7, ...Array(BLADE_CELLS - 3).fill(3)]).blade(Array(6).fill(0)), 2);
  // The turn counts every overflowing sign, whatever its length: lengths 5 (cells 2, 7, 12) and 3 (cells 0, 5, 10, 15) in turn.
  const mixed = strips(Array.from({ length: BLADE_CELLS }, (_, n) => 3 + n % 5));
  assert.deepEqual([5, 3, 5, 3, 5].map(n => mixed.blade(Array(n).fill(0))), [2, 5, 12, 15, 7]);
});

test('the sign atlas gives each name board a cell until none is left', () => {
  const atlas = new SignAtlas();
  for (let n = 0; n < BOARD_CELLS; n++) assert.equal(atlas.board({ title: `B${n}`, glyphs: [n] }), n);
  assert.equal(atlas.board({ title: 'LATE', glyphs: [0] }), null);
  assert.deepEqual(atlas.boards.map(b => b.title), Array.from({ length: BOARD_CELLS }, (_, n) => `B${n}`));
});

test('a blade sign draws the same and looks the same on a full atlas, showing a strip already there', () => {
  const plan = planMission(contract('heist', 3, 2024)), seed = plan.contract.seed;
  let faces = 0;
  plan.world.buildings.forEach((b, i) => {
    const s = structure(b, i, 'ANY', openFaces(b, plan.world.buildings), stream(seed, 'structure', i)), empty = new Kit(), full = new Kit(), atlas = fullAtlas(), a = stream(seed, 'signage', i), c = stream(seed, 'signage', i);
    bladeSigns(empty, s, new SignAtlas(), a); bladeSigns(full, s, atlas, c);
    assert.deepEqual({ ...full, signs: bare(full.signs) }, { ...empty, signs: bare(empty.signs) }, `building ${i}: the sign differs on a full atlas`);
    assert.equal(c(), a(), `building ${i}: the sign drew a different number of values on a full atlas`);
    assert.equal(atlas.blades.length, BLADE_CELLS);
    for (const p of [...full.signs, ...empty.signs]) assert.ok(showsCell(p, BLADE_CELLS), `building ${i}: a blade face shows no whole cell`);
    faces += full.signs.length;
  });
  assert.ok(faces > 0);
});

test('a roof gets no name board once the atlas is full: no posts, no panel, and its room goes to the plant', () => {
  const posts = (k: Kit) => k.solid.filter(p => p.color === '#2b3139'), panel = (k: Kit) => k.solid.filter(p => p.color === '#15181d');
  const plant = (k: Kit) => [...k.solid.filter(p => p.color !== '#2b3139' && p.color !== '#15181d'), ...k.cylinders, ...k.masts];
  let boards = 0, moved = 0;
  // A wide flat roof, where the plant always finds room on its first tries.
  for (let seed = 1; seed <= 200; seed++) {
    const s = structure({ x: 0, z: 0, w: 8, d: 8, h: 2 }, 0, 'WIDE', FACES, stream(seed, 'structure')), built = new Kit(), refused = new Kit(), fresh = new SignAtlas(), atlas = fullAtlas();
    rooftop(built, s, fresh, stream(seed, 'rooftop')); rooftop(refused, s, atlas, stream(seed, 'rooftop'));
    assert.equal(atlas.boards.length, BOARD_CELLS);
    assert.equal(refused.signs.length, 0); assert.equal(posts(refused).length, 0); assert.equal(panel(refused).length, 0);
    assert.ok(plant(refused).length > 0, `seed ${seed}: a roof with no plant`);
    // A roof that had no board anyway is the same roof.
    if (!fresh.boards.length) { assert.deepEqual(refused, built); continue; }
    boards++;
    assert.equal(built.signs.length, 1); assert.equal(posts(built).length, 2); assert.equal(panel(built).length, 1);
    assert.ok(showsCell(built.signs[0], 1)); assert.equal(fresh.boards[0].title, 'WIDE');
    // The plant starts from the same point in the stream: its first piece has the same size on both roofs.
    const size = ({ w, h, d }: Part) => ({ w, h, d });
    assert.deepEqual(size(plant(refused)[0]), size(plant(built)[0]), `seed ${seed}: the refused board changed what the plant drew`);
    // The built board keeps the plant off its strip of roof; on the refused roof that strip is free to use.
    const [board] = panel(built), across = Math.abs(Math.sin(board.ry ?? 0)) > .5, room = { x: board.x, z: board.z, w: across ? .3 : board.w, d: across ? board.w : .3 };
    assert.ok(!plant(built).some(p => overlaps(room, p)), `seed ${seed}: plant under a built board`);
    if (plant(refused).some(p => overlaps(room, p))) moved++;
  }
  assert.ok(boards > 20 && moved > 0, `${boards} boards, ${moved} roofs used the freed room`);
});

test('every sign shows a cell the atlas holds, and every name board its own building\'s name', () => {
  let shared = 0, capped = 0;
  for (const c of cases) {
    const plan = planMission(c), district = dressDistrict(plan);
    assert.ok(district.blades.length <= BLADE_CELLS && district.boards.length <= BOARD_CELLS);
    const blades = district.signs.filter(p => !isBoard(p)), boards = district.signs.filter(isBoard);
    for (const p of blades) assert.ok(showsCell(p, district.blades.length), `${c.id}: a blade sign shows no stored strip`);
    for (const p of boards) assert.ok(showsCell(p, district.boards.length), `${c.id}: a name board shows no stored board`);
    assert.equal(boards.length, district.boards.length);
    const names = buildingNames(c.seed, plan.world.buildings.length);
    for (const p of boards) assert.equal(district.boards[boardCell(p)]?.title, names[p.building!], `${c.id}: a name board shows another building's name`);
    if (blades.length / 2 > BLADE_CELLS) shared++;
    if (district.boards.length === BOARD_CELLS) capped++;
  }
  assert.ok(shared > 0 && capped > 0, 'no test district fills the atlas');
});

test('the ring\'s cars, shops and puddles each come from a stream of their own', () => {
  const plan = planMission(contract('heist', 3, 2024)), seed = plan.contract.seed, b = plan.world.bounds, { cols, rows, cw, cd } = blockGrid(b), district = dressDistrict(plan);
  const grid = { xs: Array.from({ length: cols - 1 }, (_, n) => b.minX + (n + 1) * cw), zs: Array.from({ length: rows - 1 }, (_, n) => b.minZ + (n + 1) * cd) };
  const keep = [plan.extract, ...plan.sites, ...plan.spawn];
  const build = (extra?: 'cars' | 'shops' | 'puddles') => {
    const k = new Kit(), rngs = { cars: stream(seed, 'ring-cars'), shops: stream(seed, 'ring-shops'), puddles: stream(seed, 'ring-puddles') };
    if (extra) rngs[extra]();
    ring(k, b, grid, keep, rngs);
    return k;
  };
  // The shops are the ring's only facades; its solid parts are road paint, sidewalks and shops, never a car.
  const carParts = (k: Kit) => k.cars, rest = (k: Kit) => k.solid;
  const base = build(), cars = build('cars'), shops = build('shops'), puddles = build('puddles');
  assert.ok(carParts(base).length > 0 && base.facade.length > 0 && base.puddles.length > 0);
  // The district's ring is the one these three streams make.
  for (const list of ['solid', 'facade', 'neon', 'puddles', 'cars', 'lamps'] as const) for (const p of base[list]) assert.ok(district[list].some(q => isDeepStrictEqual(q, p)), `a ring part in ${list} is not in the district`);
  // An extra draw on one stream moves that asset and leaves the other two as they were.
  assert.notDeepEqual(carParts(cars), carParts(base)); assert.deepEqual(rest(cars), rest(base)); assert.deepEqual(cars.facade, base.facade); assert.deepEqual(cars.puddles, base.puddles);
  assert.notDeepEqual(shops.facade, base.facade); assert.deepEqual(carParts(shops), carParts(base)); assert.deepEqual(shops.puddles, base.puddles);
  assert.notDeepEqual(puddles.puddles, base.puddles); assert.deepEqual(puddles.solid, base.solid); assert.deepEqual(puddles.facade, base.facade); assert.deepEqual(puddles.neon, base.neon);
});

test('a wall too short for an awning or a sign gets neither, and the building keeps its body', () => {
  const sideways = (p: Part) => Math.abs(Math.sin(p.ry ?? 0)) > .99; // mounted on an x-facing wall
  const long = new Kit(), signs = new Kit();
  for (let seed = 1; seed <= 40; seed++) {
    // 1 m across x: the two z-facing walls are 1 m long, under the 1.2 m both need.
    const s = structure({ x: 0, z: 0, w: 1, d: 4, h: 5 }, 0, 'SLIVER', FACES, stream(seed, 'structure')), k = new Kit();
    shell(k, s, stream(seed, 'shell'));
    assert.ok(k.solid.length > 0 && k.facade.length === s.tiers.length);
    const dressed = new Kit();
    awnings(dressed, s, stream(seed, 'awnings')); bladeSigns(dressed, s, new SignAtlas(), stream(seed, 'signage'));
    for (const p of [...dressed.solid, ...dressed.neon]) assert.ok(sideways(p), `seed ${seed}: an awning or a sign hangs on a 1 m wall`);
    for (const p of dressed.signs) assert.ok(!sideways(p)); // a blade's faces look along its wall
    awnings(long, s, stream(seed, 'awnings')); bladeSigns(signs, s, new SignAtlas(), stream(seed, 'signage'));
  }
  // Its 4 m walls are long enough for both, and some seeds put them there.
  assert.ok(long.solid.length > 0 && signs.signs.length > 0);
});
