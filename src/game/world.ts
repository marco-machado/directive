export type Point = { x: number; z: number };
export type Rect = Point & { w: number; d: number };
export type Building = Rect & { h: number; name: string; accent: string };
export type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };

export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const inside = (p: Point, r: Rect, padding: number) => Math.abs(p.x - r.x) < r.w / 2 + padding && Math.abs(p.z - r.z) < r.d / 2 + padding;
const edgeDistance = (p: Point, r: Rect) => Math.hypot(Math.max(0, Math.abs(p.x - r.x) - r.w / 2), Math.max(0, Math.abs(p.z - r.z) - r.d / 2));
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
const COVER_GAP = .45; // m between a barrier's face and an operative crouched behind it
const SIGHT_PAD = .05; // m around a building's footprint that already blocks sight
const DIRS =[[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

// Buildings block movement and sight; low cover blocks movement only.
export class World {
  private readonly cols: number;
  private readonly rows: number;
  private readonly open: Uint8Array;
  private readonly edges: Uint8Array;

  constructor(readonly bounds: Bounds, readonly buildings: Building[], readonly cover: Rect[]) {
    this.cols = Math.floor(bounds.maxX) - Math.ceil(bounds.minX) + 1;
    this.rows = Math.floor(bounds.maxZ) - Math.ceil(bounds.minZ) + 1;
    this.open = new Uint8Array(this.cols * this.rows);
    this.edges = new Uint8Array(this.cols * this.rows);
    for (let i = 0; i < this.open.length; i++) this.open[i] = this.walkable(this.point(i)) ? 1 : 0;
    // A small fixed-grid navigation graph keeps pathing independent of Three.js.
    for (let i = 0; i < this.open.length; i++) {
      if (!this.open[i]) continue;
      const p = this.point(i);
      DIRS.forEach(([dx, dz], d) => {
        const j = this.index({ x: p.x + dx, z: p.z + dz });
        if (j >= 0 && this.open[j] && this.passable(p, this.point(j), .4)) this.edges[i] |= 1 << d;
      });
    }
  }

  private point(i: number): Point { return { x: Math.ceil(this.bounds.minX) + (i % this.cols), z: Math.ceil(this.bounds.minZ) + Math.floor(i / this.cols) }; }
  private index(p: Point): number {
    const c = p.x - Math.ceil(this.bounds.minX), r = p.z - Math.ceil(this.bounds.minZ);
    return c < 0 || r < 0 || c >= this.cols || r >= this.rows ? -1 : r * this.cols + c;
  }

  inBounds(p: Point, padding = .38): boolean {
    const b = this.bounds;
    return p.x > b.minX + padding && p.x < b.maxX - padding && p.z > b.minZ + padding && p.z < b.maxZ - padding;
  }
  walkable(p: Point, padding = .38): boolean {
    return this.inBounds(p, padding) && !this.buildings.some(r => inside(p, r, padding)) && !this.cover.some(r => inside(p, r, padding));
  }
  // Movement clearance along a segment.
  passable(a: Point, b: Point, padding = .1): boolean { return this.sample(a, b, p => this.walkable(p, padding)); }
  // Line of sight: only buildings block it.
  sightClear(a: Point, b: Point): boolean {
    return this.sample(a, b, p => !this.buildings.some(r => inside(p, r, SIGHT_PAD)));
  }
  // How far a ray from `from` along the unit vector (dx, dz) travels before it enters a building, up to `max`:
  // a 2D slab test against each footprint, padded as in sightClear. Allocation-free, so it can run every frame.
  sightDistance(from: Point, dx: number, dz: number, max: number): number {
    let best = max;
    for (const r of this.buildings) {
      const hx = r.w / 2 + SIGHT_PAD, hz = r.d / 2 + SIGHT_PAD;
      let near = 0, far = best;
      if (dx === 0) { if (Math.abs(from.x - r.x) >= hx) continue; }
      else {
        const t1 = (r.x - hx - from.x) / dx, t2 = (r.x + hx - from.x) / dx;
        near = Math.max(near, Math.min(t1, t2)); far = Math.min(far, Math.max(t1, t2));
      }
      if (dz === 0) { if (Math.abs(from.z - r.z) >= hz) continue; }
      else {
        const t1 = (r.z - hz - from.z) / dz, t2 = (r.z + hz - from.z) / dz;
        near = Math.max(near, Math.min(t1, t2)); far = Math.min(far, Math.max(t1, t2));
      }
      if (near <= far) best = near;
    }
    return best;
  }
  private sample(a: Point, b: Point, ok: (p: Point) => boolean) {
    const steps = Math.ceil(distance(a, b) * 6);
    for (let n = 1; n < steps; n++) {
      const t = n / steps;
      if (!ok({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t })) return false;
    }
    return true;
  }
  // True when `target` is crouched behind a barrier that lies on the attacker's line of fire.
  coverBetween(attacker: Point, target: Point): boolean {
    return this.cover.some(r => {
      if (!inside(target, r, 1.1) || inside(attacker, r, 1.1)) return false;
      const steps = Math.ceil(distance(attacker, target) * 8);
      for (let n = 1; n < steps; n++) {
        const t = n / steps;
        if (inside({ x: attacker.x + (target.x - attacker.x) * t, z: attacker.z + (target.z - attacker.z) * t }, r, .05)) return true;
      }
      return false;
    });
  }
  // Close enough to a barrier to crouch behind it (the reach coverBetween allows).
  besideCover(p: Point): boolean { return this.cover.some(r => inside(p, r, 1.1)); }
  // A spot against the barrier nearest `p` (within `reach` of its edge) that shelters from `threat`, level with `p`
  // along the barrier's face, with `along` the face's direction. Of the faces that cover, the one nearest `p`;
  // if none does, the face farthest from the threat. Null when no barrier is that close.
  coverSpot(p: Point, threat: Point, reach = 1): { point: Point; along: Point; covered: boolean } | null {
    let r: Rect | null = null, best = Infinity;
    for (const c of this.cover) { const d = edgeDistance(p, c); if (d <= reach && d < best) { r = c; best = d; } }
    if (!r) return null;
    const { x, z, w, d } = r;
    const faces = [-1, 1].flatMap(s => [
      { point: { x: clamp(p.x, x - w / 2 + .2, x + w / 2 - .2), z: z + s * (d / 2 + COVER_GAP) }, along: { x: 1, z: 0 } },
      { point: { x: x + s * (w / 2 + COVER_GAP), z: clamp(p.z, z - d / 2 + .2, z + d / 2 - .2) }, along: { x: 0, z: 1 } },
    ]).filter(f => this.walkable(f.point)).map(f => ({ ...f, covered: this.coverBetween(threat, f.point) }));
    const covered = faces.filter(f => f.covered);
    return (covered.length ? covered.sort((a, b) => distance(a.point, p) - distance(b.point, p)) : faces.sort((a, b) => distance(b.point, threat) - distance(a.point, threat)))[0] ?? null;
  }

  private nearestNode(p: Point): number {
    let best = -1, bestD = Infinity;
    const cx = Math.round(p.x), cz = Math.round(p.z);
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const q = { x: cx + dx, z: cz + dz }, i = this.index(q);
      if (i < 0 || !this.open[i]) continue;
      const d = distance(p, q);
      if (d < bestD && this.passable(p, q, .2)) { best = i; bestD = d; }
    }
    return best;
  }

  // `avoid` marks ground the route must keep off (a hostile's vision cone); the goal's own node is exempt.
  findPath(from: Point, to: Point, avoid?: (p: Point) => boolean): Point[] {
    if (!this.walkable(to)) return [];
    const clear = (a: Point, b: Point) => !avoid || this.sample(a, b, p => !avoid(p));
    if (this.passable(from, to, .4) && clear(from, to)) return [to];
    const start = this.nearestNode(from), goal = this.nearestNode(to);
    if (start < 0 || goal < 0) return [];
    const goalPoint = this.point(goal);
    const banned = new Int8Array(avoid ? this.open.length : 0).fill(-1);
    const off = (j: number) => { if (!avoid || j === goal) return false; if (banned[j] < 0) banned[j] = avoid(this.point(j)) ? 1 : 0; return banned[j] === 1; };
    const cost = new Float32Array(this.open.length).fill(Infinity);
    const came = new Int32Array(this.open.length).fill(-1);
    const closed = new Uint8Array(this.open.length);
    const heap: [number, number][] = [];
    const push = (i: number, f: number) => {
      heap.push([f, i]);
      for (let k = heap.length - 1; k > 0;) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        for (let k = 0; ;) {
          const l = 2 * k + 1, r = l + 1; let m = k;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m;
        }
      }
      return top[1];
    };
    cost[start] = 0; push(start, distance(this.point(start), goalPoint));
    while (heap.length) {
      const i = pop();
      if (closed[i]) continue;
      if (i === goal) {
        const path: Point[] = [to];
        for (let k = goal; k >= 0; k = came[k]) path.unshift(this.point(k));
        return this.smooth(from, path, clear);
      }
      closed[i] = 1;
      const p = this.point(i);
      DIRS.forEach(([dx, dz], d) => {
        if (!(this.edges[i] & (1 << d))) return;
        const j = i + dz * this.cols + dx, next = cost[i] + Math.hypot(dx, dz);
        if (closed[j] || next >= cost[j] || off(j)) return;
        cost[j] = next; came[j] = i; push(j, next + distance({ x: p.x + dx, z: p.z + dz }, goalPoint));
      });
    }
    return [];
  }
  // Drops waypoints that a straight walk can skip, so units do not zigzag along the grid.
  private smooth(from: Point, path: Point[], clear: (a: Point, b: Point) => boolean): Point[] {
    const out: Point[] = [];
    let anchor = from;
    for (let i = 0; i < path.length; i++) {
      const next = path[i + 1];
      if (next && this.passable(anchor, next, .4) && clear(anchor, next)) continue;
      out.push(path[i]); anchor = path[i];
    }
    return out;
  }
}
