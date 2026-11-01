import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contractPayout, MAX_TIER } from '../src/game/campaign.ts';
import type { ContractType } from '../src/game/campaign.ts';
import { planMission } from '../src/game/mapgen.ts';
import type { MissionPlan } from '../src/game/mapgen.ts';
import type { Rect } from '../src/game/world.ts';
import { dressDistrict, GRID_Y, MAX_PRACTICALS, OVERLAY_FLOOR, partBounds } from '../src/scene/district.ts';
import type { District, Part } from '../src/scene/district.ts';
import { buildingTop, hides, PLINTH } from '../src/scene/view.ts';

const contract = (type: ContractType, tier: number, seed: number) => ({ id: `c-${seed}`, type, tier, seed, payout: contractPayout(tier), district: 'GLASS DISTRICT', sector: 4 });
const cases = (['assassination', 'heist', 'sabotage', 'escort'] as const).flatMap(type => Array.from({ length: MAX_TIER }, (_, i) => [7, 31337].map(seed => contract(type, i + 1, seed + i * 101)))).flat();
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
        `seed ${c.seed}: a part of ${b.name} reaches past its plinth`);
      assert.ok(e.maxY <= buildingTop(b) + eps, `seed ${c.seed}: a part of ${b.name} rises above ${buildingTop(b).toFixed(2)} m`);
    }
  }
});

test('nothing past the bounds hides a unit at the edge, even from the lowest camera tilt', () => {
  const rise = Math.tan(Math.PI / 2 - Math.PI * 13 / 36); // OrbitControls' maxPolarAngle in GameCanvas.tsx
  for (const c of cases.filter((_, i) => i % 3 === 0)) {
    const plan = planMission(c), b = plan.world.bounds, edge = .38;
    const ring = lit(dressDistrict(plan)).map(partBounds).filter(e => e.maxX < b.minX || e.minX > b.maxX || e.maxZ < b.minZ || e.minZ > b.maxZ);
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

test('every district fits the fixed pool of practical lights and lights its streets', () => {
  for (const c of cases) {
    const district = dressDistrict(planMission(c));
    assert.ok(district.practicals.length > 0 && district.practicals.length <= MAX_PRACTICALS);
    assert.ok(district.pools.length >= district.practicals.length);
    assert.ok(district.blades.every(text => text.length >= 3));
    for (const p of district.signs) assert.ok(p.data!.every(v => v >= 0 && v <= 1));
  }
});
