import { memo, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';
import { blockGrid } from '../game/mapgen.ts';
import type { MissionPlan } from '../game/mapgen.ts';
import type { Simulation } from '../game/simulation.ts';
import { distance } from '../game/world.ts';
import type { Bounds, Building, Point } from '../game/world.ts';
import { Box, InstancedBoxes } from './parts.tsx';
import type { Fades, Part } from './parts.tsx';
import { markHiding, viewAlong } from './view.ts';

// Offsets and sizes here set ROOF and PLINTH in view.ts.
function buildingParts(b: Building, bi: number, lit: Part[], light: Part[]) {
  const add = (list: Part[], x: number, y: number, z: number, w: number, h: number, d: number, color: string) => list.push({ x: b.x + x, y, z: b.z + z, w, h, d, color, building: bi });
  add(lit, 0, .12, 0, b.w + .5, .24, b.d + .5, '#455350');
  add(lit, 0, b.h / 2 + .24, 0, b.w, b.h, b.d, '#314247');
  add(lit, 0, b.h + .3, 0, b.w + .12, .2, b.d + .12, '#526060');
  add(lit, 0, b.h + .61, 0, b.w * .45, .45, b.d * .4, '#29383c');
  add(lit, 0, .65, b.d / 2 + .03, 1.2, .8, .08, '#162b30');
  add(lit, -b.w * .28, b.h + .6, -b.d * .2, .5, .5, .8, '#73807c');
  add(light, 0, 1.2, b.d / 2 + .08, b.w * .7, .09, .1, b.accent);
  for (const side of [1, -1]) add(light, side * (b.w / 2 + .015), b.h * .45, 0, .06, .1, b.d * .7, b.accent);
  // Windows on all four faces, since the camera orbits.
  for (let y = 1.8; y < b.h - .3; y += .72) for (const side of [1, -1]) {
    for (let x = -b.w / 2 + .5; x < b.w / 2 - .3; x += .75) add(light, x, y, side * (b.d / 2 + .016), .35, .28, .018, ((Math.round(y * 10 + x) + bi) % 4) ? '#89a9a2' : '#e6b981');
    for (let z = -b.d / 2 + .5; z < b.d / 2 - .3; z += .75) add(light, side * (b.w / 2 + .016), y, z, .018, .28, .35, '#6e9b98');
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

const FADE = .8;          // share of a faded building's pixels that are dropped
const FADE_SECONDS = .25;
const FIGHT_LINGER = 1.5; // seconds a shot or blast keeps its spot clear, so the gaps between shots don't flicker
const BODY = .9, TRACER = .8, SPREAD = .25; // ray heights for a unit and a tracer; side rays for a unit's width

// Fades the buildings that hide the selected operatives, the VIP or a fight the player can see.
// Tests the view ray from each of them against the building footprints, not against meshes.
function useBuildingFades(sim: Simulation, plan: MissionPlan): Fades {
  const buildings = plan.world.buildings;
  const state = useMemo(() => ({
    fades: { level: new Float32Array(buildings.length), version: 0 } as Fades,
    progress: new Float32Array(buildings.length), want: new Uint8Array(buildings.length),
    fights: [] as (Point & { until: number })[], shot: -1, blast: -1, look: new Vector3(),
  }), [buildings]);
  useFrame(({ camera }, dt) => {
    const { fades, progress, want, look } = state;
    want.fill(0);
    if (sim.phase === 'mission' && sim.plan === plan) {
      const d = camera.getWorldDirection(look), view = viewAlong(d.x, d.y, d.z);
      for (const u of sim.units) if (sim.selected.includes(u.id) || u.faction === 'vip' && u.hp > 0) markHiding(buildings, view, u, BODY, SPREAD, want);
      // Shots by the squad hit visible hostiles; a hostile's shot counts only while the shooter is in sight.
      for (const s of sim.shots) {
        if (s.id <= state.shot) continue;
        state.shot = s.id;
        if (s.faction === 'hostile' && !sim.units.some(u => u.faction === 'hostile' && u.visible && distance(u, s.from) < .75)) continue;
        state.fights.push({ ...s.from, until: sim.time + FIGHT_LINGER }, { ...s.to, until: sim.time + FIGHT_LINGER },
          { x: (s.from.x + s.to.x) / 2, z: (s.from.z + s.to.z) / 2, until: sim.time + FIGHT_LINGER });
      }
      for (const b of sim.blasts) {
        if (b.id <= state.blast) continue;
        state.blast = b.id;
        if (b.kind !== 'heal') state.fights.push({ x: b.x, z: b.z, until: sim.time + FIGHT_LINGER });
      }
      // A restart rewinds sim.time, which also clears the last attempt's fights.
      state.fights = state.fights.filter(f => f.until > sim.time && f.until <= sim.time + FIGHT_LINGER);
      for (const f of state.fights) markHiding(buildings, view, f, TRACER, 0, want);
    } else state.fights = [];
    // Each building eases toward its target over FADE_SECONDS.
    let changed = false;
    for (let i = 0; i < buildings.length; i++) {
      const next = Math.min(1, Math.max(0, progress[i] + (want[i] ? 1 : -1) * dt / FADE_SECONDS));
      if (next === progress[i]) continue;
      progress[i] = next; fades.level[i] = FADE * next * next * (3 - 2 * next); changed = true;
    }
    if (changed) fades.version++;
  }, -1);
  return state.fades;
}

export const City = memo(function City({ plan, sim }: { plan: MissionPlan; sim: Simulation }) {
  const b = plan.world.bounds, w = b.maxX - b.minX, d = b.maxZ - b.minZ, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const { lit, light } = useMemo(() => cityParts(plan), [plan]);
  const fades = useBuildingFades(sim, plan);
  const grid = useMemo(() => gridGeometry(b), [b]);
  useEffect(() => () => grid.dispose(), [grid]);
  return <group>
    <Box position={[cx, -.35, cz]} size={[w + 1, .65, d + 1]} color="#1a292e" />
    <mesh position={[cx, -.02, cz]} receiveShadow><boxGeometry args={[w, .05, d]} /><meshStandardMaterial color="#2d3a3e" roughness={.75} metalness={.18} /></mesh>
    <lineSegments geometry={grid} position={[0, .007, 0]}><lineBasicMaterial color="#37484a" transparent opacity={.45} depthWrite={false} /></lineSegments>
    <InstancedBoxes parts={lit} lit fades={fades} />
    <InstancedBoxes parts={light} fades={fades} />
  </group>;
});
