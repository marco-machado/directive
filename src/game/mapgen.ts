import { hasModifier } from './campaign.ts';
import type { Contract } from './campaign.ts';
import { SQUAD_SPEED } from './classes.ts';
import { between, mulberry32, pick, shuffle } from './rng.ts';
import type { Rng } from './rng.ts';
import { distance, World } from './world.ts';
import type { Bounds, Building, Point, Rect } from './world.ts';

export type EnemyKind = 'guard' | 'heavy' | 'camera' | 'turret' | 'target';
// `escort` marks a guard that walks beside an Intercept courier (the plan's target) instead of keeping a patrol or a post.
export type EnemySpawn = Point & { kind: EnemyKind; heading: number; patrol: Point[]; escort?: true };
export type ObjectiveSite = Point & { kind: 'terminal' | 'charge' };
export type Area = Point & { r: number };
export type MissionPlan = {
  contract: Contract; world: World; label: string;
  // The squad's start corner, and where it extracts: the same corner, but the opposite one on a through-run. A called
  // extraction has no fixed one; its `extract` is the start, where reinforcements enter until a pickup is called.
  spawn: Point[]; start: Point; extract: Point; enemies: EnemySpawn[]; sites: ObjectiveSite[]; vip: Point | null; exits: Point[];
  targetArea: Area | null; // assassination intel: where the target was last reported; Intercept: where the courier enters
};

const STREET = 1.5; // clearance between a block's edge and its building
const EDGE = .9;    // lattice inset from the map edge
const SAFE_RADIUS = 9; // no hostile starts this close to the squad
const BACK_ROOM = 1.5; // map left behind a posted guard, so a takedown has ground to end on
// Intercept: the courier waits COURIER_DELAY s, then walks its route at COURIER_SPEED from one edge exit to another at
// least COURIER_MIN_RUN m away (and most of the district's width), pausing COURIER_PAUSE s at each street corner. The
// squad can always reach some point of the route INTERCEPT_MARGIN s before the courier gets there.
export const COURIER_DELAY = 6;
export const COURIER_SPEED = 1.5;
export const COURIER_PAUSE = 1.2;
export const COURIER_MIN_RUN = 16;
export const INTERCEPT_MARGIN = 5;
// m the route keeps from extraction, so the ambush is a walk out across the district, not a step off the start.
export const COURIER_BERTH = 15;
export const TARGET_AREA_RADIUS = 6;
export const TARGET_AREA_OFFSET = 3; // the area's center lies within this of the target, so the area always contains it
const ACCENTS = ['#b9d6cc', '#ffb17d', '#73dfca', '#bad3c8', '#e2a078'];
const NAMES = ['KESSLER', 'DATA / 04', 'NEXUS', 'RELAY', '07', 'METRO', 'LOGISTICS', 'ARCOLOGY', 'VAULT', 'HYDRO', 'PRISM', 'SPIRE', 'DEPOT', 'ATLAS', 'GRID 9', 'KIOSK'];

export const mapSize = (tier: number) => ({ w: 32 + 3 * (tier - 1), d: 24 + 2 * (tier - 1) });
const headingTo = (a: Point, b: Point) => Math.atan2(b.x - a.x, b.z - a.z);

type Lattice = { cols: number; rows: number; node: (i: number, j: number) => Point };
// One city block per ~8 m; the scene draws street markings from the same grid.
export function blockGrid(b: Bounds) {
  const w = b.maxX - b.minX, d = b.maxZ - b.minZ, cols = Math.round(w / 8), rows = Math.round(d / 8);
  return { cols, rows, cw: w / cols, cd: d / rows };
}

function layout(contract: Contract, rng: Rng) {
  const { w, d } = mapSize(contract.tier);
  const bounds = { minX: -w / 2, maxX: w / 2, minZ: -d / 2, maxZ: d / 2 };
  const { cols, rows, cw, cd } = blockGrid(bounds);
  const lattice: Lattice = {
    cols, rows,
    node: (i, j) => ({ x: Math.min(bounds.maxX - EDGE, Math.max(bounds.minX + EDGE, bounds.minX + i * cw)), z: Math.min(bounds.maxZ - EDGE, Math.max(bounds.minZ + EDGE, bounds.minZ + j * cd)) }),
  };
  const names = shuffle(rng, NAMES);
  const buildings: Building[] = [];
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    if (rng() < .2) continue; // open plaza
    const room = { w: cw - 2 * STREET, d: cd - 2 * STREET };
    const bw = between(rng, room.w * .55, room.w), bd = between(rng, room.d * .55, room.d);
    buildings.push({
      x: bounds.minX + (i + .5) * cw + between(rng, -(room.w - bw) / 2, (room.w - bw) / 2),
      z: bounds.minZ + (j + .5) * cd + between(rng, -(room.d - bd) / 2, (room.d - bd) / 2),
      w: bw, d: bd, h: between(rng, 1.4, 2.4 + contract.tier * .9), name: names[buildings.length % names.length], accent: pick(rng, ACCENTS),
    });
  }
  return { bounds, buildings, lattice };
}

// Street points: intersections plus the midpoint of every street segment between them.
function streetPoints(l: Lattice) {
  const nodes: { p: Point; i: number; j: number }[] = [];
  for (let i = 0; i <= l.cols; i++) for (let j = 0; j <= l.rows; j++) nodes.push({ p: l.node(i, j), i, j });
  const mids: Point[] = [];
  for (const a of nodes) for (const [di, dj] of [[1, 0], [0, 1]]) {
    if (a.i + di > l.cols || a.j + dj > l.rows) continue;
    const b = l.node(a.i + di, a.j + dj);
    mids.push({ x: (a.p.x + b.x) / 2, z: (a.p.z + b.z) / 2 });
  }
  return { nodes, mids };
}

// Routes never enter the squad's safe corner.
function patrolRoute(rng: Rng, l: Lattice, i: number, j: number, steps: number, safe: Point): Point[] {
  const route = [l.node(i, j)];
  for (let s = 0; s < steps; s++) {
    const moves = shuffle(rng, [[1, 0], [-1, 0], [0, 1], [0, -1]])
      .filter(([di, dj]) => i + di >= 0 && i + di <= l.cols && j + dj >= 0 && j + dj <= l.rows && distance(l.node(i + di, j + dj), safe) > SAFE_RADIUS);
    if (!moves.length) break;
    const [di, dj] = moves[0]; i += di; j += dj;
    route.push(l.node(i, j));
  }
  // Walk out and back so the route loops without retracing through buildings.
  return [...route, ...route.slice(1, -1).reverse()];
}

// The courier's route: edge nodes far apart, joined by the fewest streets that stay out of the squad's safe corner,
// with a point the squad can reach first by INTERCEPT_MARGIN. Null when the district has no such pair.
// A cramped district that has no such route at COURIER_BERTH gets one closer in, never inside the safe radius.
function courierRoute(rng: Rng, l: Lattice, world: World, from: Point, extract: Point, width: number): Point[] | null {
  for (const berth of [COURIER_BERTH, SAFE_RADIUS + 1]) { const route = courierRouteAt(rng, l, world, from, extract, width, berth); if (route) return route; }
  return null;
}
function courierRouteAt(rng: Rng, l: Lattice, world: World, from: Point, extract: Point, width: number, berth: number): Point[] | null {
  const key = (i: number, j: number) => i * (l.rows + 1) + j, clear = (i: number, j: number) => distance(l.node(i, j), extract) > berth;
  const edge: [number, number][] = [];
  for (let i = 0; i <= l.cols; i++) for (let j = 0; j <= l.rows; j++) if ((i === 0 || j === 0 || i === l.cols || j === l.rows) && clear(i, j)) edge.push([i, j]);
  const run = Math.max(COURIER_MIN_RUN, width * .6);
  for (const [ai, aj] of shuffle(rng, edge)) for (const [bi, bj] of shuffle(rng, edge)) {
    if (distance(l.node(ai, aj), l.node(bi, bj)) < run) continue;
    // Breadth-first over the street lattice.
    const prev = new Map<number, number>([[key(ai, aj), -1]]), queue: [number, number][] = [[ai, aj]];
    while (queue.length && !prev.has(key(bi, bj))) {
      const [i, j] = queue.shift()!;
      for (const [di, dj] of shuffle(rng, [[1, 0], [-1, 0], [0, 1], [0, -1]])) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni > l.cols || nj > l.rows || prev.has(key(ni, nj)) || !clear(ni, nj)) continue;
        if (!world.findPath(l.node(i, j), l.node(ni, nj)).length) continue;
        prev.set(key(ni, nj), key(i, j)); queue.push([ni, nj]);
      }
    }
    if (!prev.has(key(bi, bj))) continue;
    const route: Point[] = [];
    for (let k = key(bi, bj); k >= 0; k = prev.get(k)!) route.unshift(l.node(Math.floor(k / (l.rows + 1)), k % (l.rows + 1)));
    if (interceptable(world, from, route)) return route;
  }
  return null;
}
// Whether the squad, leaving `from` at once, reaches some corner of the route INTERCEPT_MARGIN s before the courier.
export function interceptable(world: World, from: Point, route: Point[]) {
  let courier = COURIER_DELAY;
  return route.some((p, k) => {
    if (k) courier += distance(route[k - 1], p) / COURIER_SPEED + COURIER_PAUSE;
    const path = world.findPath(from, p);
    if (!path.length) return false;
    const walk = path.reduce((sum, q, i) => sum + distance(i ? path[i - 1] : from, q), 0);
    return walk / SQUAD_SPEED + INTERCEPT_MARGIN <= courier;
  });
}

function attempt(contract: Contract, rng: Rng, withCover: boolean): MissionPlan | null {
  const { bounds, buildings, lattice } = layout(contract, rng);
  const bare = new World(bounds, buildings, []);
  const { nodes, mids } = streetPoints(lattice);
  const candidates = [...nodes.map(n => n.p), ...mids].filter(p => bare.walkable(p, .6));
  const corner = pick(rng, [[0, 0], [lattice.cols, 0], [0, lattice.rows], [lattice.cols, lattice.rows]]);
  const start = lattice.node(corner[0], corner[1]);
  // A through-run extracts at the opposite corner; every other contract where it started.
  const through = hasModifier(contract, 'through'), extract = through ? lattice.node(lattice.cols - corner[0], lattice.rows - corner[1]) : start;
  // The squad lines up along the two edge streets that meet at its start corner.
  const sx = Math.sign(-start.x), sz = Math.sign(-start.z);
  const spawn = [{ x: start.x + sx * 1.2, z: start.z }, { x: start.x, z: start.z + sz * 1.2 }, { x: start.x + sx * 2.2, z: start.z }, { x: start.x, z: start.z + sz * 2.2 }];
  if (!spawn.every(p => bare.walkable(p))) return null;
  // Objectives lie far from the start; on a through-run far from both corners, so the way out still crosses the district.
  const reach = (p: Point) => through ? Math.min(distance(p, start), distance(p, extract)) : distance(p, start);
  const far = candidates.filter(p => reach(p) > SAFE_RADIUS + 4).sort((a, b) => reach(b) - reach(a));
  const farthest = far.slice(0, Math.max(3, Math.ceil(far.length * .4)));
  if (farthest.length < 2) return null;

  const sites: ObjectiveSite[] = [];
  let primary = pick(rng, farthest), vip: Point | null = null;
  const enemies: EnemySpawn[] = [];
  const type = contract.type;
  if (type === 'heist') sites.push({ ...primary, kind: 'terminal' });
  if (type === 'sabotage') {
    const second = shuffle(rng, farthest).find(p => distance(p, primary) >= 8) ?? far.find(p => distance(p, primary) >= 8);
    if (!second) return null;
    sites.push({ ...primary, kind: 'charge' }, { ...second, kind: 'charge' });
  }
  if (type === 'escort') { primary = pick(rng, far.slice(0, Math.ceil(far.length * .5))); vip = primary; }
  if (type === 'assassination') enemies.push({ ...primary, kind: 'target', heading: headingTo(primary, start), patrol: [] });
  // Intercept: the courier starts at its entry exit with two escorts beside it; the posted guards hold the route's middle.
  let escorts: Point[] = [];
  if (type === 'intercept') {
    const route = courierRoute(rng, lattice, bare, spawn[0], start, bounds.maxX - bounds.minX);
    if (!route) return null;
    const entry = route[0], ahead = headingTo(entry, route[1]);
    // The entry is on the map edge, so they stand at its shoulders a step in, or in file ahead where a shoulder is off the map.
    const at = ([along, side]: number[]) => ({ x: entry.x + Math.sin(ahead) * along + Math.cos(ahead) * side, z: entry.z + Math.cos(ahead) * along - Math.sin(ahead) * side });
    escorts = [[.5, .9], [.5, -.9], [1.2, .7], [1.2, -.7], [1.4, 0], [2.4, 0]].map(at).filter(p => bare.walkable(p, .4)).slice(0, 2);
    if (escorts.length < 2) return null;
    enemies.push({ ...entry, kind: 'target', heading: ahead, patrol: route });
    primary = route[Math.floor(route.length / 2)];
  }

  const used: Point[] = [primary, ...sites, ...enemies.flatMap(e => [e, ...e.patrol]), ...escorts];
  const free = (p: Point, gap = 1.5) => distance(p, start) > SAFE_RADIUS && used.every(u => distance(u, p) >= gap);
  const add = (kind: EnemyKind, p: Point, patrol: Point[], heading = headingTo(p, start)) => { enemies.push({ ...p, kind, heading, patrol }); used.push(p); };
  const near = (center: Point, r: number, ok = (_: Point) => true) => shuffle(rng, candidates).find(p => distance(p, center) <= r && free(p) && ok(p)) ??
    [0, 1, 2, 3, 4, 5].map(k => ({ x: center.x + Math.cos(k) * 1.6, z: center.z + Math.sin(k) * 1.6 })).find(p => bare.walkable(p, .5) && free(p, 1) && ok(p));
  // A posted guard faces the extraction, so its back is to the map's far side, where the objectives are.
  // Takedowns end just behind it, so it never stands with its back to the map edge; near an edge that can
  // push its post out past 4 m from the objective it holds.
  const backRoom = (p: Point) => { const h = headingTo(p, start); return bare.inBounds({ x: p.x - Math.sin(h) * BACK_ROOM, z: p.z - Math.cos(h) * BACK_ROOM }); };
  const post = (site: Point) => near(site, 4, backRoom) ?? near(site, 6, backRoom) ?? near(site, 8, backRoom);

  for (const p of escorts) enemies.push({ ...p, kind: 'guard', heading: enemies[0].heading, patrol: enemies[0].patrol, escort: true });
  // Two posted guards hold every objective; the rest walk the streets. The courier's escorts stand in for Intercept's.
  if (type !== 'intercept') for (const site of (sites.length ? sites : [primary]).slice(0, 2)) {
    for (let k = 0; k < (sites.length > 1 ? 1 : 2); k++) { const p = post(site); if (p) add('guard', p, []); }
  }
  const guarding = () => enemies.filter(e => e.kind === 'guard' && !e.escort).length;
  const guards = contract.patrols === undefined ? 3 + contract.tier - (type === 'intercept' ? 2 : 0) : guarding() + contract.patrols;
  const nodeStarts = shuffle(rng, nodes).filter(n => free(n.p, 3));
  while (guarding() < guards && nodeStarts.length) {
    const n = nodeStarts.pop()!, route = patrolRoute(rng, lattice, n.i, n.j, 2 + Math.floor(rng() * 2), start);
    add('guard', n.p, route, headingTo(route[0], route[1] ?? start));
  }
  for (let k = 0; k < Math.floor(contract.tier / 2) && nodeStarts.length; k++) {
    const n = nodeStarts.pop()!, route = patrolRoute(rng, lattice, n.i, n.j, 1, start);
    add('heavy', n.p, route, headingTo(route[0], route[1] ?? start));
  }
  for (let k = 0; k < contract.tier - 1 && nodeStarts.length; k++) {
    const n = nodeStarts.pop()!;
    add('camera', n.p, [], headingTo(n.p, pick(rng, candidates.filter(c => distance(c, n.p) > 3)) ?? start));
  }
  for (let k = 0; k < contract.tier - 3; k++) {
    const site = (sites.length ? sites : [primary])[k % Math.max(1, sites.length)];
    const p = near(site, 5); if (p) add('turret', p, []);
  }

  const cover: Rect[] = [];
  if (withCover) {
    const keyPoints = [start, extract, ...spawn, ...used, ...enemies.flatMap(e => e.patrol)];
    const clear = (r: Rect) => keyPoints.every(p => Math.abs(p.x - r.x) > r.w / 2 + .9 || Math.abs(p.z - r.z) > r.d / 2 + .9) &&
      nodes.every(n => distance(n.p, r) > 1.6) && cover.every(c => distance(c, r) > 2) && bare.walkable(r, .5);
    const segments = nodes.flatMap(a => [[1, 0], [0, 1]].filter(([di, dj]) => a.i + di <= lattice.cols && a.j + dj <= lattice.rows).map(([di, dj]) => [a.p, lattice.node(a.i + di, a.j + dj)] as const));
    const wanted = 5 + 2 * contract.tier;
    // Barriers sit to one side of a street so the other side stays open.
    for (let tries = 0; cover.length < wanted && tries < 200; tries++) {
      const [a, b] = pick(rng, segments), t = between(rng, .3, .7), side = rng() < .5 ? -1 : 1;
      const alongX = Math.abs(b.x - a.x) > Math.abs(b.z - a.z);
      const nearObjective = tries % 3 === 0 ? (sites[0] ?? primary) : null;
      const base = nearObjective && distance(a, nearObjective) < 6 ? nearObjective : { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
      const r: Rect = alongX ? { x: base.x, z: base.z + side * .85, w: 1.6, d: .45 } : { x: base.x + side * .85, z: base.z, w: .45, d: 1.6 };
      if (clear(r)) cover.push(r);
    }
  }

  const world = new World(bounds, buildings, cover);
  const exits = nodes.filter(n => (n.i === 0 || n.j === 0 || n.i === lattice.cols || n.j === lattice.rows) && distance(n.p, start) > 14 && distance(n.p, extract) > 14).map(n => n.p);
  if (!exits.length) return null;
  // Every place a unit must reach has to be reachable from the squad's start.
  const needed = [start, extract, ...used, ...exits, ...enemies.flatMap(e => e.patrol)];
  if (!needed.every(p => world.findPath(spawn[0], p).length)) return null;
  const label = `SECTOR ${String(contract.sector).padStart(2, '0')} / ${contract.district}`;
  // Barriers can lengthen the squad's way to the route, so the margin is checked again on the finished streets.
  const courier = enemies.find(e => e.kind === 'target' && e.patrol.length);
  if (courier && !interceptable(world, spawn[0], courier.patrol)) return null;
  return { contract, world, label, spawn, start, extract, enemies, sites, vip, exits, targetArea: null };
}

// Drawn from its own stream so the intel never shifts the district's layout.
function lastKnownArea(seed: number, target: Point): Area {
  const rng = mulberry32(seed ^ 0x2c1b3c6d), angle = rng() * Math.PI * 2, offset = Math.sqrt(rng()) * TARGET_AREA_OFFSET;
  return { x: target.x + Math.cos(angle) * offset, z: target.z + Math.sin(angle) * offset, r: TARGET_AREA_RADIUS };
}

export function planMission(contract: Contract): MissionPlan {
  const rng = mulberry32(contract.seed);
  for (let k = 0; k < 12; k++) {
    const plan = attempt(contract, rng, k < 8), target = plan?.enemies.find(e => e.kind === 'target');
    // An Intercept courier's area is centered on its entry exit; its route is given away as a patrol's is.
    if (plan && target && contract.type === 'intercept') return { ...plan, targetArea: { x: target.x, z: target.z, r: TARGET_AREA_RADIUS } };
    if (plan) return target ? { ...plan, targetArea: lastKnownArea(contract.seed, target) } : plan;
  }
  throw new Error(`No playable layout for contract seed ${contract.seed}.`);
}
