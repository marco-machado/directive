export type Point = { x: number; z: number };
export type Building = Point & { w: number; d: number; h: number; name: string; accent: string };
export const BOUNDS = { minX: -16, maxX: 16, minZ: -12, maxZ: 12 };
export const EXTRACT: Point = { x: -12, z: 8 };
export const BUILDINGS: Building[] = [
  { x: -11, z: -6, w: 5, d: 7, h: 5.6, name: 'KESSLER', accent: '#b9d6cc' },
  { x: -3.5, z: -7, w: 5, d: 5, h: 3.3, name: 'DATA / 04', accent: '#ffb17d' },
  { x: 5, z: -7.5, w: 5, d: 5, h: 6.5, name: 'NEXUS', accent: '#73dfca' },
  { x: -5, z: .5, w: 4, d: 4, h: 2.1, name: 'RELAY', accent: '#bad3c8' },
  { x: 4, z: 2, w: 4, d: 4, h: 2.8, name: '07', accent: '#e2a078' },
  { x: 11.5, z: 5.5, w: 5, d: 8, h: 4.1, name: 'METRO', accent: '#73dfca' },
  { x: -1.5, z: 8, w: 6, d: 3, h: 1.4, name: 'LOGISTICS', accent: '#b9d6cc' },
];
export function walkable(p: Point, padding = .38): boolean {
  return p.x > BOUNDS.minX + padding && p.x < BOUNDS.maxX - padding && p.z > BOUNDS.minZ + padding && p.z < BOUNDS.maxZ - padding &&
    !BUILDINGS.some(b => Math.abs(p.x - b.x) < b.w / 2 + padding && Math.abs(p.z - b.z) < b.d / 2 + padding);
}
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
export function clearLine(a: Point, b: Point, padding = .1): boolean {
  const steps = Math.ceil(distance(a, b) * 6);
  for (let n = 1; n <= steps; n++) {
    const t = n / steps;
    if (!walkable({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, padding)) return false;
  }
  return true;
}

// A small fixed-grid A* pathfinder keeps navigation independent of Three.js.
export function findPath(from: Point, to: Point): Point[] {
  if (!walkable(to)) return [];
  if (clearLine(from, to, .4)) return [to];
  const key = (p: Point) => `${p.x},${p.z}`;
  const start = { x: Math.round(from.x), z: Math.round(from.z) };
  const goal = { x: Math.round(to.x), z: Math.round(to.z) };
  if (!walkable(start) || !walkable(goal)) return [];
  const open: Point[] = [start], came = new Map<string, Point>(), cost = new Map([[key(start), 0]]);
  const closed = new Set<string>();
  while (open.length) {
    open.sort((a, b) => (cost.get(key(a))! + distance(a, goal)) - (cost.get(key(b))! + distance(b, goal)));
    const current = open.shift()!;
    if (distance(current, goal) < .1) {
      const path = [to]; let p = current;
      while (came.has(key(p))) { path.unshift(p); p = came.get(key(p))!; }
      return path;
    }
    closed.add(key(current));
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const next = { x: current.x + dx, z: current.z + dz }, nk = key(next);
      if (closed.has(nk) || !walkable(next) || !clearLine(current, next, .4)) continue;
      const nextCost = cost.get(key(current))! + Math.hypot(dx, dz);
      if (nextCost >= (cost.get(nk) ?? Infinity)) continue;
      came.set(nk, current); cost.set(nk, nextCost);
      if (!open.some(p => key(p) === nk)) open.push(next);
    }
  }
  return [];
}
