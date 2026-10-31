import type { Contract } from './campaign.ts';
import { between, mulberry32, pick, shuffle } from './rng.ts';
import type { Rng } from './rng.ts';
import { distance, World } from './world.ts';
import type { Bounds, Building, Point, Rect } from './world.ts';

export type EnemyKind = 'guard' | 'heavy' | 'camera' | 'turret' | 'target';
export type EnemySpawn = Point & { kind: EnemyKind; heading: number; patrol: Point[] };
export type ObjectiveSite = Point & { kind: 'terminal' | 'charge' };
export type MissionPlan = {
  contract: Contract; world: World; label: string;
  spawn: Point[]; extract: Point; enemies: EnemySpawn[]; sites: ObjectiveSite[]; vip: Point | null; exits: Point[];
};

const STREET = 1.5; // clearance between a block's edge and its building
const EDGE = .9;    // lattice inset from the map edge
const SAFE_RADIUS = 9; // no hostile starts this close to the squad
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

function attempt(contract: Contract, rng: Rng, withCover: boolean): MissionPlan | null {
  const { bounds, buildings, lattice } = layout(contract, rng);
  const bare = new World(bounds, buildings, []);
  const { nodes, mids } = streetPoints(lattice);
  const candidates = [...nodes.map(n => n.p), ...mids].filter(p => bare.walkable(p, .6));
  const corner = pick(rng, [[0, 0], [lattice.cols, 0], [0, lattice.rows], [lattice.cols, lattice.rows]]);
  const extract = lattice.node(corner[0], corner[1]);
  // The squad lines up along the two edge streets that meet at the extraction corner.
  const sx = Math.sign(-extract.x), sz = Math.sign(-extract.z);
  const spawn = [{ x: extract.x + sx * 1.2, z: extract.z }, { x: extract.x, z: extract.z + sz * 1.2 }, { x: extract.x + sx * 2.2, z: extract.z }, { x: extract.x, z: extract.z + sz * 2.2 }];
  if (!spawn.every(p => bare.walkable(p))) return null;
  const far = candidates.filter(p => distance(p, extract) > SAFE_RADIUS + 4).sort((a, b) => distance(b, extract) - distance(a, extract));
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
  if (type === 'assassination') enemies.push({ ...primary, kind: 'target', heading: headingTo(primary, extract), patrol: [] });

  const used: Point[] = [primary, ...sites];
  const free = (p: Point, gap = 1.5) => distance(p, extract) > SAFE_RADIUS && used.every(u => distance(u, p) >= gap);
  const add = (kind: EnemyKind, p: Point, patrol: Point[], heading = headingTo(p, extract)) => { enemies.push({ ...p, kind, heading, patrol }); used.push(p); };
  const near = (center: Point, r: number) => shuffle(rng, candidates).find(p => distance(p, center) <= r && free(p)) ??
    [0, 1, 2, 3, 4, 5].map(k => ({ x: center.x + Math.cos(k) * 1.6, z: center.z + Math.sin(k) * 1.6 })).find(p => bare.walkable(p, .5) && free(p, 1));

  // Two posted guards hold every objective; the rest walk the streets.
  const guards = 3 + contract.tier;
  for (const site of (sites.length ? sites : [primary]).slice(0, 2)) {
    for (let k = 0; k < (sites.length > 1 ? 1 : 2); k++) { const p = near(site, 4); if (p) add('guard', p, []); }
  }
  const nodeStarts = shuffle(rng, nodes).filter(n => free(n.p, 3));
  while (enemies.filter(e => e.kind === 'guard').length < guards && nodeStarts.length) {
    const n = nodeStarts.pop()!, route = patrolRoute(rng, lattice, n.i, n.j, 2 + Math.floor(rng() * 2), extract);
    add('guard', n.p, route, headingTo(route[0], route[1] ?? extract));
  }
  for (let k = 0; k < Math.floor(contract.tier / 2) && nodeStarts.length; k++) {
    const n = nodeStarts.pop()!, route = patrolRoute(rng, lattice, n.i, n.j, 1, extract);
    add('heavy', n.p, route, headingTo(route[0], route[1] ?? extract));
  }
  for (let k = 0; k < contract.tier - 1 && nodeStarts.length; k++) {
    const n = nodeStarts.pop()!;
    add('camera', n.p, [], headingTo(n.p, pick(rng, candidates.filter(c => distance(c, n.p) > 3)) ?? extract));
  }
  for (let k = 0; k < contract.tier - 2; k++) {
    const site = (sites.length ? sites : [primary])[k % Math.max(1, sites.length)];
    const p = near(site, 5); if (p) add('turret', p, []);
  }

  const cover: Rect[] = [];
  if (withCover) {
    const keyPoints = [extract, ...spawn, ...used, ...enemies.flatMap(e => e.patrol)];
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
  const exits = nodes.filter(n => (n.i === 0 || n.j === 0 || n.i === lattice.cols || n.j === lattice.rows) && distance(n.p, extract) > 14).map(n => n.p);
  if (!exits.length) return null;
  // Every place a unit must reach has to be reachable from the squad's start.
  const reach = [extract, ...used, ...exits, ...enemies.flatMap(e => e.patrol)];
  if (!reach.every(p => world.findPath(spawn[0], p).length)) return null;
  const label = `SECTOR ${String(contract.sector).padStart(2, '0')} / ${contract.district}`;
  return { contract, world, label, spawn, extract, enemies, sites, vip, exits };
}

export function planMission(contract: Contract): MissionPlan {
  const rng = mulberry32(contract.seed);
  for (let k = 0; k < 12; k++) { const plan = attempt(contract, rng, k < 8); if (plan) return plan; }
  throw new Error(`No playable layout for contract seed ${contract.seed}.`);
}
