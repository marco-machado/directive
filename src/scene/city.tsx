import { memo, useEffect, useMemo } from 'react';
import { BufferGeometry, Float32BufferAttribute } from 'three';
import { blockGrid } from '../game/mapgen.ts';
import type { MissionPlan } from '../game/mapgen.ts';
import { distance } from '../game/world.ts';
import type { Bounds, Building, Point } from '../game/world.ts';
import { Box, InstancedBoxes } from './parts.tsx';
import type { Part } from './parts.tsx';

function buildingParts(b: Building, bi: number, lit: Part[], light: Part[]) {
  const add = (list: Part[], x: number, y: number, z: number, w: number, h: number, d: number, color: string) => list.push({ x: b.x + x, y, z: b.z + z, w, h, d, color });
  add(lit, 0, .12, 0, b.w + .5, .24, b.d + .5, '#455350');
  add(lit, 0, b.h / 2 + .24, 0, b.w, b.h, b.d, '#314247');
  add(lit, 0, b.h + .3, 0, b.w + .12, .2, b.d + .12, '#526060');
  add(lit, 0, b.h + .61, 0, b.w * .45, .45, b.d * .4, '#29383c');
  add(lit, 0, .65, b.d / 2 + .03, 1.2, .8, .08, '#162b30');
  add(lit, -b.w * .28, b.h + .6, -b.d * .2, .5, .5, .8, '#73807c');
  add(light, 0, 1.2, b.d / 2 + .08, b.w * .7, .09, .1, b.accent);
  add(light, b.w / 2 + .015, b.h * .45, 0, .06, .1, b.d * .7, b.accent);
  // Windows only on the two faces the isometric camera sees.
  for (let y = 1.8; y < b.h - .3; y += .72) {
    for (let x = -b.w / 2 + .5; x < b.w / 2 - .3; x += .75) add(light, x, y, b.d / 2 + .016, .35, .28, .018, ((Math.round(y * 10 + x) + bi) % 4) ? '#89a9a2' : '#e6b981');
    for (let z = -b.d / 2 + .5; z < b.d / 2 - .3; z += .75) add(light, b.w / 2 + .016, y, z, .018, .28, .35, '#6e9b98');
  }
}

// Interior street lines of the map generator's block grid.
function streetLines(b: Bounds) {
  const { cols, rows, cw, cd } = blockGrid(b);
  return { xs: Array.from({ length: cols - 1 }, (_, i) => b.minX + (i + 1) * cw), zs: Array.from({ length: rows - 1 }, (_, j) => b.minZ + (j + 1) * cd) };
}

function cityParts(plan: MissionPlan) {
  const { world, sites, extract } = plan, b = world.bounds, lit: Part[] = [], light: Part[] = [];
  world.buildings.forEach((building, i) => buildingParts(building, i, lit, light));
  // Jersey barriers: a wide footing, a narrower wall and a thin accent stripe on top.
  for (const r of world.cover) {
    const long = r.w >= r.d, t = long ? r.d : r.w;
    lit.push({ x: r.x, y: .11, z: r.z, w: r.w, h: .22, d: r.d, color: '#5d6966' });
    lit.push({ x: r.x, y: .41, z: r.z, w: long ? r.w - .06 : t * .55, h: .38, d: long ? t * .55 : r.d - .06, color: '#77837e' });
    light.push({ x: r.x, y: .605, z: r.z, w: long ? r.w * .82 : .05, h: .015, d: long ? .05 : r.d * .82, color: '#e2a078' });
  }
  const { xs, zs } = streetLines(b), keep = [extract, ...sites];
  const open = (p: Point) => world.walkable(p, .6) && keep.every(k => distance(k, p) > 2);
  for (const x of xs) for (let z = b.minZ + 1; z < b.maxZ - 1; z += 2) if (zs.every(s => Math.abs(s - z) > 1.6) && open({ x, z })) lit.push({ x, y: .015, z, w: .075, h: .02, d: .8, color: '#647167' });
  for (const z of zs) for (let x = b.minX + 1; x < b.maxX - 1; x += 2) if (xs.every(s => Math.abs(s - x) > 1.6) && open({ x, z })) lit.push({ x, y: .015, z, w: .8, h: .02, d: .075, color: '#647167' });
  // Street lamps on every other intersection, set back on a corner of the curb.
  xs.forEach((x, i) => zs.forEach((z, j) => {
    if ((i + j) % 2) return;
    const lamp = [[.95, .95], [-.95, .95], [.95, -.95], [-.95, -.95]].map(([dx, dz]) => ({ x: x + dx, z: z + dz }))
      .find(p => world.walkable(p, .35) && keep.every(k => distance(k, p) > 1.8));
    if (!lamp) return;
    const dx = x - lamp.x, dz = z - lamp.z, len = Math.hypot(dx, dz);
    lit.push({ x: lamp.x, y: 1.4, z: lamp.z, w: .1, h: 2.8, d: .1, color: '#5c6d6a' });
    light.push({ x: lamp.x + dx / len * .3, y: 2.8, z: lamp.z + dz / len * .3, w: .18, h: .1, d: .7, ry: Math.atan2(dx, dz), color: '#f2d5a1' });
  }));
  return { lit, light };
}

function gridGeometry(b: Bounds) {
  const points: number[] = [];
  for (let x = Math.ceil(b.minX); x <= b.maxX; x++) points.push(x, 0, b.minZ, x, 0, b.maxZ);
  for (let z = Math.ceil(b.minZ); z <= b.maxZ; z++) points.push(b.minX, 0, z, b.maxX, 0, z);
  const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(points, 3)); return g;
}

export const City = memo(function City({ plan }: { plan: MissionPlan }) {
  const b = plan.world.bounds, w = b.maxX - b.minX, d = b.maxZ - b.minZ, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const { lit, light } = useMemo(() => cityParts(plan), [plan]);
  const grid = useMemo(() => gridGeometry(b), [b]);
  useEffect(() => () => grid.dispose(), [grid]);
  return <group>
    <Box position={[cx, -.35, cz]} size={[w + 1, .65, d + 1]} color="#1a292e" />
    <mesh position={[cx, -.02, cz]} receiveShadow><boxGeometry args={[w, .05, d]} /><meshStandardMaterial color="#2d3a3e" roughness={.75} metalness={.18} /></mesh>
    <lineSegments geometry={grid} position={[0, .007, 0]}><lineBasicMaterial color="#37484a" transparent opacity={.45} depthWrite={false} /></lineSegments>
    <InstancedBoxes parts={lit} lit />
    <InstancedBoxes parts={light} />
  </group>;
});
