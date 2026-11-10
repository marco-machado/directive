import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, QUEUE_SPACING, ROUTE_MAX, WAIT_MAX, WAIT_STEP } from '../src/game/simulation.ts';
import type { Unit } from '../src/game/simulation.ts';
import type { ContractType } from '../src/game/campaign.ts';
import { distance, World } from '../src/game/world.ts';
import type { Point } from '../src/game/world.ts';
import { CONTRACT_TYPES, MAX_TIER } from '../src/game/campaign.ts';
import { planMission } from '../src/game/mapgen.ts';
import { step, arena, contract, FOUR } from './arena.ts';

// Steps frame by frame until `u` stands exactly on `p` (walk() lands on each path point), returning the mission time.
const reach = (sim: Simulation, u: Unit, p: Point, seconds = 30) => {
  step(sim, seconds, () => u.x === p.x && u.z === p.z);
  assert.ok(u.x === p.x && u.z === p.z, `${u.name} never reached ${JSON.stringify(p)}`);
  return sim.time;
};

const block = (x0: number, x1: number, z0: number, z1: number) => ({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0, h: 3 });

// A 1.4 m alley along z at x = 0, too narrow for the side-by-side spread.
const ALLEY = [block(-6, -.7, -2, 10), block(.7, 6, -2, 10)];

// A walled-in room around (15, 15) that nothing outside can reach.
const POCKET = [block(12, 18, 17.5, 18.5), block(12, 18, 11.5, 12.5), block(11.5, 12.5, 11.5, 18.5), block(17.5, 18.5, 11.5, 18.5)];

function streets(buildings = ALLEY, type: ContractType = 'heist') {
  const a = arena(type, FOUR);
  a.sim.plan = { ...a.sim.plan!, world: new World(a.world.bounds, buildings, []) };
  a.squad.forEach((u, i) => { u.x = i - 1.5; u.z = -5; });
  return a;
}

const settle = (sim: Simulation, units: Unit[]) => {
  const done = () => units.every(u => !u.path.length && !u.route.length && !u.wait);
  step(sim, 30, done);
  assert.equal(sim.phase, 'mission'); assert.ok(done(), 'still walking');
};

const spaced = (units: Point[]) => units.every((u, i) => units.every((v, j) => i === j || distance(u, v) >= QUEUE_SPACING - 1e-3));

test('the squad queues single file into an alley too narrow to stand abreast', () => {
  const { sim, squad } = streets();
  sim.move({ x: 0, z: 8 });
  assert.ok(squad.every(u => u.path.length), 'someone ignored the order');
  settle(sim, squad);
  const byZ = [...squad].sort((a, b) => b.z - a.z);
  assert.ok(distance(byZ[0], { x: 0, z: 8 }) < 1e-6);
  for (const u of squad) { assert.ok(sim.plan!.world.walkable(u)); assert.ok(Math.abs(u.x) < .32 && u.z > -2, JSON.stringify(u)); }
  for (let i = 1; i < byZ.length; i++) assert.ok(byZ[i - 1].z - byZ[i].z >= QUEUE_SPACING - 1e-3, `gap ${i}`);
});

test('a leader already on the point still gets a queue behind it, not a pile', () => {
  const { sim, squad } = streets();
  squad[0].x = 0; squad[0].z = 8;
  sim.move({ x: 0, z: 8 }); settle(sim, squad);
  assert.ok(spaced(squad), JSON.stringify(squad.map(u => [u.x, u.z])));
});

test('operatives bunched on the point all still move, stacking where the route runs out', () => {
  const { sim, squad } = streets();
  squad.forEach((u, i) => { u.x = 0; u.z = 7.9 + i * .05; });
  sim.move({ x: 0, z: 8 });
  for (const u of squad) assert.deepEqual(u.path.at(-1), { x: 0, z: 8 });
});

test('the queue follows a bent alley around its corner', () => {
  // The alley runs north at x = 0, then turns east along z = 7.
  const { sim, squad } = streets([block(-6, -.7, -2, 10), block(.7, 6, -2, 6.3), block(.7, 6, 7.7, 10)]);
  sim.move({ x: 5, z: 7 }); settle(sim, squad);
  for (const u of squad) assert.ok(sim.plan!.world.walkable(u), JSON.stringify(u));
  assert.ok(spaced(squad));
});

test('an operative who cannot reach the point keeps its orders; the rest queue', () => {
  const { sim, squad } = streets([...ALLEY, ...POCKET]);
  const stuck = squad[3]; stuck.x = 15; stuck.z = 15; stuck.path = [{ x: 16, z: 15 }];
  sim.move({ x: 0, z: 8 });
  assert.deepEqual(stuck.path, [{ x: 16, z: 15 }]);
  const rest = squad.slice(0, 3); settle(sim, rest);
  assert.ok(spaced(rest)); assert.ok(rest.every(u => Math.abs(u.x) < .32));
});

test('when only some fit abreast, the whole squad queues instead', () => {
  // 2.2 m wide: the inner pair could stand abreast, the outer pair could not.
  const { sim, squad } = streets([block(-6, -1.1, -2, 10), block(1.1, 6, -2, 10)]);
  sim.move({ x: 0, z: 8 }); settle(sim, squad);
  const zs = squad.map(u => u.z).sort((a, b) => b - a);
  for (let i = 1; i < zs.length; i++) assert.ok(zs[i - 1] - zs[i] >= QUEUE_SPACING - 1e-3, String(zs));
});

test('in the open the squad still spreads side by side', () => {
  const { sim, squad } = streets([]);
  sim.move({ x: 10, z: 10 });
  squad.forEach((u, i) => assert.deepEqual(u.path.at(-1), { x: 10 + (i - 1.5) * QUEUE_SPACING, z: 10 }));
});

test('a point nobody can reach is refused and leaves every order alone', () => {
  const { sim, squad } = streets([...ALLEY, ...POCKET]);
  squad.forEach(u => { u.path = [{ x: -10, z: -10 }]; });
  sim.move({ x: 15, z: 15 });
  assert.match(sim.message, /Route blocked/); assert.equal(sim.commandPoint, null);
  for (const u of squad) assert.deepEqual(u.path, [{ x: -10, z: -10 }]);
});

test('holding position stops the squad and clears the move destination', () => {
  const { sim, squad } = streets([]);
  sim.move({ x: 10, z: 10 });
  assert.ok(sim.commandPoint);
  sim.hold();
  assert.equal(sim.commandPoint, null);
  for (const u of squad) assert.deepEqual(u.path, []);
});

test('a click on the VIP sends the squad to where the VIP stood', () => {
  const { sim, squad } = streets(ALLEY, 'escort');
  const vip = sim.units.find(u => u.faction === 'vip')!; vip.x = 0; vip.z = 8;
  sim.unitClick(vip.id);
  vip.x = 0; vip.z = 3;
  assert.ok(squad.every(u => u.path.length));
  assert.ok(squad.some(u => u.path.at(-1)!.z === 8)); assert.ok(squad.every(u => u.path.at(-1) !== vip));
});

test('a move order cancels attack and revive orders, abreast or in a queue', () => {
  for (const buildings of [[], ALLEY]) {
    const { sim, squad } = streets(buildings);
    squad.forEach(u => { u.targetId = 'h0'; u.reviveTarget = 'rook'; u.revive = 1; });
    sim.move({ x: 0, z: 8 });
    for (const u of squad) { assert.equal(u.targetId, null); assert.equal(u.reviveTarget, null); assert.equal(u.revive, 0); }
  }
});

test('the same order in the same alley gives the same queue', () => {
  const runs = [streets(), streets()].map(({ sim, squad }) => { sim.move({ x: 0, z: 8 }); return squad.map(u => u.path); });
  assert.deepEqual(runs[0], runs[1]);
});

// ---- Waypoint routes ----
const stops = (sim: Simulation, u: Unit) => sim.waypoints(u).map(w => [w.x, w.z, w.wait]);

test('an appended waypoint starts where the route ends, and the legs are walked in order', () => {
  const { sim, squad } = streets(), vex = squad[0];
  sim.select(vex.id);
  sim.move({ x: 10, z: -10 }); sim.move({ x: 10, z: 5 }, true);
  assert.match(sim.message, /Waypoint added/);
  assert.deepEqual(stops(sim, vex), [[10, -10, 0], [10, 5, 0]]);
  // From where VEX stands the alley's east block is in the way; from the first waypoint it is a straight run.
  assert.ok(sim.plan!.world.findPath(vex, { x: 10, z: 5 }).length > 1);
  assert.deepEqual(vex.route.map(leg => leg.path), [[{ x: 10, z: 5 }]], 'the second leg runs from the first waypoint');
  reach(sim, vex, { x: 10, z: -10 });
  assert.equal(vex.route.length, 1);
  settle(sim, [vex]);
  assert.deepEqual([vex.x, vex.z], [10, 5]); assert.deepEqual(stops(sim, vex), []);
});

test('routes planned leg by leg while paused wait for the resume', () => {
  const { sim, squad } = streets([]), vex = squad[0];
  sim.select(vex.id); sim.togglePause();
  sim.move({ x: 5, z: -5 }); sim.move({ x: 5, z: 5 }, true); sim.move({ x: -5, z: 5 }, true);
  const before = structuredClone(sim.units);
  step(sim, 1);
  assert.deepEqual(sim.units, before);
  sim.togglePause();
  reach(sim, vex, { x: 5, z: -5 }); reach(sim, vex, { x: 5, z: 5 }); reach(sim, vex, { x: -5, z: 5 });
});

test('a plain click replaces the whole route', () => {
  const { sim, squad } = streets([]), vex = squad[0];
  sim.select(vex.id);
  sim.move({ x: 5, z: -5 }); sim.move({ x: 5, z: 5 }, true); sim.addWait();
  sim.move({ x: -5, z: -10 });
  assert.match(sim.message, /Move order confirmed/);
  assert.deepEqual(stops(sim, vex), [[-5, -10, 0]]); assert.deepEqual(vex.route, []);
});

test('appended into an alley, the squad lines up from where its routes end and queues single file', () => {
  const { sim, squad } = streets();
  const slots = squad.map((_, i) => ({ x: 10 + (i - 1.5) * QUEUE_SPACING, z: -10 }));
  sim.move({ x: 10, z: -10 }); sim.move({ x: 0, z: 8 }, true);
  squad.forEach((u, i) => { assert.deepEqual(sim.waypoints(u)[0], { ...slots[i], wait: 0 }); assert.equal(u.route.length, 1); });
  // The queue is the one a plain order would give a squad already standing on those slots.
  const there = streets();
  there.squad.forEach((u, i) => { u.x = slots[i].x; u.z = slots[i].z; });
  there.sim.move({ x: 0, z: 8 });
  assert.deepEqual(squad.map(u => u.route[0].path), there.squad.map(u => u.path));
  const passed = new Set<Unit>();
  step(sim, 30, () => {
    squad.forEach((u, i) => { if (u.x === slots[i].x && u.z === slots[i].z) passed.add(u); });
    return squad.every(u => !u.path.length && !u.route.length);
  });
  assert.equal(passed.size, squad.length, 'someone cut the corner past its first waypoint');
  const byZ = [...squad].sort((a, b) => b.z - a.z);
  assert.ok(distance(byZ[0], { x: 0, z: 8 }) < 1e-6);
  for (const u of squad) assert.ok(Math.abs(u.x) < .32 && u.z > -2, JSON.stringify(u));
  for (let i = 1; i < byZ.length; i++) assert.ok(byZ[i - 1].z - byZ[i].z >= QUEUE_SPACING - 1e-3, `gap ${i}`);
});

test('a plain order into an alley drops a planned route and queues from where the squad stands', () => {
  const fresh = streets(), planned = streets();
  fresh.sim.move({ x: 0, z: 8 });
  planned.sim.move({ x: 10, z: -10 }); planned.sim.move({ x: -10, z: -10 }, true);
  planned.sim.move({ x: 0, z: 8 });
  assert.deepEqual(planned.squad.map(u => u.path), fresh.squad.map(u => u.path));
  for (const u of planned.squad) assert.deepEqual(u.route, []);
});

test('the same appended orders give the same routes', () => {
  const runs = [streets(), streets()].map(({ sim, squad }) => {
    sim.move({ x: 10, z: -10 }); sim.move({ x: 0, z: 8 }, true); sim.move({ x: 4, z: 12 }, true);
    return squad.map(u => [u.path, u.route]);
  });
  assert.deepEqual(runs[0], runs[1]);
});

test('a wait at a waypoint lets two operatives time a crossing', () => {
  const { sim, squad } = streets([]), [vex, rook] = squad;
  sim.select(vex.id); sim.move({ x: vex.x, z: 0 }); sim.addWait(); sim.move({ x: vex.x, z: 5 }, true);
  assert.deepEqual(stops(sim, vex), [[vex.x, 0, WAIT_STEP], [vex.x, 5, 0]]);
  assert.match(sim.message, /Waypoint added/);
  sim.select(rook.id); sim.move({ x: rook.x, z: 0 }); sim.move({ x: rook.x, z: 5 }, true);
  const on = (u: Unit, x: number, z: number) => u.x === x && u.z === z, t = { stop: 0, off: 0, rook: 0, vex: 0, left: -1 };
  step(sim, 30, () => {
    if (!t.stop && on(vex, vex.x, 0)) t.stop = sim.time;
    if (t.stop && !t.off && !on(vex, vex.x, 0)) t.off = sim.time;
    if (t.stop && !t.off && t.left < 0 && sim.time - t.stop >= 1) t.left = stops(sim, vex)[0][2] - (WAIT_STEP - (sim.time - t.stop));
    if (!t.rook && on(rook, rook.x, 5)) t.rook = sim.time;
    if (on(vex, vex.x, 5)) t.vex = sim.time;
    return !!t.vex;
  });
  const frame = 2 / 60;
  assert.ok(Math.abs(t.off - t.stop - WAIT_STEP) < frame, `held ${t.off - t.stop} s`);
  assert.ok(Math.abs(t.left) < frame, 'the marker counts the wait down');
  assert.ok(t.rook && Math.abs(t.vex - t.rook - WAIT_STEP) < frame, `VEX ${t.vex} s, ROOK ${t.rook} s`);
});

test('each wait order adds WAIT_STEP at the last waypoint and one past WAIT_MAX clears it', () => {
  const { sim, squad } = streets([]), vex = squad[0];
  sim.select(vex.id); sim.move({ x: 5, z: -5 }); sim.move({ x: 5, z: 5 }, true);
  for (let w = WAIT_STEP; w <= WAIT_MAX; w += WAIT_STEP) { sim.addWait(); assert.equal(vex.route[0].wait, w); }
  assert.equal(vex.wait, 0, 'only the last waypoint waits');
  sim.addWait();
  assert.equal(vex.route[0].wait, 0); assert.equal(sim.message, 'Wait cleared.');
});

test('without a route a wait holds the operative where it stands, then it takes the appended leg', () => {
  const { sim, squad } = streets([]), vex = squad[0], start = { x: vex.x, z: vex.z };
  sim.select(vex.id); sim.addWait();
  assert.deepEqual(stops(sim, vex), [[start.x, start.z, WAIT_STEP]]);
  sim.move({ x: start.x, z: 0 }, true);
  assert.deepEqual(stops(sim, vex), [[start.x, start.z, WAIT_STEP], [start.x, 0, 0]], 'the leg queues behind the wait');
  step(sim, WAIT_STEP - .1);
  assert.deepEqual([vex.x, vex.z], [start.x, start.z]);
  step(sim, .5);
  assert.ok(vex.z > start.z);
  sim.hold();
  assert.deepEqual(stops(sim, vex), []); assert.equal(vex.wait, 0);
});

test('an appended waypoint replaces an attack order instead of queuing behind it', () => {
  const { sim, squad, hostile } = arena(), vex = squad[0];
  const guard = hostile('guard', 8, 8, Math.PI);
  sim.select(vex.id); sim.attack(guard.id);
  assert.ok(vex.targetId || vex.takedownId);
  sim.move({ x: -5, z: 5 }, true);
  assert.equal(vex.targetId, null); assert.equal(vex.takedownId, null);
  assert.deepEqual(stops(sim, vex), [[-5, 5, 0]]);
});

test(`a route holds ${ROUTE_MAX} waypoints`, () => {
  const { sim, squad } = streets([]), vex = squad[0];
  sim.select(vex.id); sim.move({ x: 0, z: 0 });
  for (let i = 1; i < ROUTE_MAX; i++) sim.move({ x: i, z: i % 2 ? 4 : 0 }, true);
  assert.equal(sim.waypoints(vex).length, ROUTE_MAX);
  const route = structuredClone(vex.route), point = sim.commandPoint;
  sim.move({ x: -5, z: -5 }, true);
  assert.match(sim.message, /Route full/); assert.deepEqual(vex.route, route); assert.equal(sim.commandPoint, point);
});

test('a downed operative drops its route', () => {
  const { sim, squad } = streets([]), vex = squad[0];
  sim.select(vex.id); sim.move({ x: 5, z: -5 }); sim.move({ x: 5, z: 5 }, true); sim.addWait();
  (sim as unknown as { damage(u: Unit, n: number, from: Point | null): void }).damage(vex, vex.hp, null);
  assert.deepEqual(vex.route, []); assert.deepEqual(stops(sim, vex), []);
});

// A barrier 1.07 m from a wall: the strip between them is wide enough to stand in, and the navigation points along
// the wall (x = 1) are walkable but too tight to walk between, so none of them connects to the streets.
const SQUEEZE = { wall: block(1.39, 6, -6, 6), barrier: { x: .1, z: 0, w: .45, d: 1.6 } };

test('an operative in cover between a barrier and a wall can still be ordered away', () => {
  const a = arena('heist'), world = new World(a.world.bounds, [SQUEEZE.wall], [SQUEEZE.barrier]);
  a.sim.plan = { ...a.sim.plan!, world };
  const spot = world.coverSpot({ x: .8, z: 0 }, { x: -8, z: 0 })!;
  assert.ok(spot.covered && world.walkable(spot.point) && spot.point.x > .325);
  assert.ok(world.findPath(spot.point, { x: -8, z: 0 }).length > 0, 'no route out of cover');
  const [u] = a.squad;
  u.x = spot.point.x; u.z = spot.point.z;
  a.sim.select(u.id); a.sim.move({ x: -8, z: 5 });
  assert.doesNotMatch(a.sim.message, /Route blocked/);
  reach(a.sim, u, { x: -8, z: 5 });
});

test('every cover spot on a generated map can start a route to extraction', () => {
  let spots = 0;
  for (const type of CONTRACT_TYPES) for (let tier = 1; tier <= MAX_TIER; tier++) for (const seed of [3, 7, 10]) {
    const plan = planMission(contract(type, tier, seed)), w = plan.world;
    for (const c of w.cover) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const k of [-.6, 0, .6]) {
      const p = { x: c.x + dx * (c.w / 2 + .6) + (dx ? 0 : k), z: c.z + dz * (c.d / 2 + .6) + (dz ? 0 : k) };
      const spot = w.coverSpot(p, { x: c.x - dx * 6, z: c.z - dz * 6 });
      if (!spot) continue;
      spots++;
      assert.ok(w.findPath(spot.point, plan.extract).length > 0, `${type} tier ${tier} seed ${seed}: no route from cover at (${spot.point.x.toFixed(2)}, ${spot.point.z.toFixed(2)})`);
    }
  }
  assert.ok(spots > 1000);
});

// Whether the straight line from a to b enters a rectangle: exact, by clipping the segment to it.
const enters = (a: Point, b: Point, r: { x: number; z: number; w: number; d: number }) => {
  let near = 0, far = 1;
  for (const [p, d, c, h] of [[a.x, b.x - a.x, r.x, r.w / 2], [a.z, b.z - a.z, r.z, r.d / 2]]) {
    if (d === 0) { if (Math.abs(p - c) >= h) return false; continue; }
    const t1 = (c - h - p) / d, t2 = (c + h - p) / d;
    near = Math.max(near, Math.min(t1, t2)); far = Math.min(far, Math.max(t1, t2));
  }
  return far - near > 1e-9;
};
const throughSolid = (world: World, from: Point, path: Point[]) => [from, ...path].some((p, n, all) => n > 0 && [...world.buildings, ...world.cover].some(r => enters(all[n - 1], p, r)));

test('a route never cuts through the corner of a building or a barrier to reach the streets', () => {
  // A walkable spot whose only straight lines to a street point pass a building's corner.
  const plan = planMission(contract('surveillance', 3, 84)), start = { x: -7.205, z: -11.645 };
  assert.ok(plan.world.walkable(start));
  assert.ok(!throughSolid(plan.world, start, plan.world.findPath(start, plan.extract)), 'the route crosses a building or a barrier');
  let legs = 0;
  for (const type of CONTRACT_TYPES) for (let tier = 1; tier <= MAX_TIER; tier++) for (const seed of [3, 7, 10, 84]) {
    const p = planMission(contract(type, tier, seed)), w = p.world;
    for (const c of w.cover) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const k of [-.6, 0, .6]) {
      const spot = w.coverSpot({ x: c.x + dx * (c.w / 2 + .6) + (dx ? 0 : k), z: c.z + dz * (c.d / 2 + .6) + (dz ? 0 : k) }, { x: c.x - dx * 6, z: c.z - dz * 6 });
      if (!spot) continue;
      const path = w.findPath(spot.point, p.extract);
      legs += path.length;
      assert.ok(path.length > 0 && !throughSolid(w, spot.point, path), `${type} tier ${tier} seed ${seed}: the route from cover at (${spot.point.x.toFixed(2)}, ${spot.point.z.toFixed(2)}) crosses something solid`);
    }
  }
  assert.ok(legs > 5000);
});
