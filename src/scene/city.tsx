import { memo, useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';
import type { MissionPlan } from '../game/mapgen.ts';
import type { Simulation } from '../game/simulation.ts';
import { distance } from '../game/world.ts';
import type { Bounds, Point } from '../game/world.ts';
import { dressDistrict, GRID_Y } from './district.ts';
import type { Part } from './district.ts';
import { disposeMaterials, districtMaterials } from './materials.ts';
import { BOX, InstancedParts, PLANE, ROUND } from './parts.tsx';
import type { Fades } from './parts.tsx';
import { facadeAtlas, nightEnvironment, poolTexture, puddleTexture, signAtlas } from './textures.ts';
import { markHiding, viewAlong } from './view.ts';

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

const GROUND = 20; // meters of street drawn past the bounds; the horizon fade in materials.ts darkens it well before

export const City = memo(function City({ plan, sim }: { plan: MissionPlan; sim: Simulation }) {
  const b = plan.world.bounds, w = b.maxX - b.minX, d = b.maxZ - b.minZ, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const gl = useThree(s => s.gl), district = dressDistrict(plan);
  // One facade atlas and one sign atlas per contract, shared by every building, the ground and the ring.
  const kit = useMemo(() => {
    const textures = [facadeAtlas(district.seed, Math.min(8, gl.capabilities.getMaxAnisotropy())), signAtlas(district), poolTexture(), puddleTexture()] as const;
    const materials = districtMaterials(...textures, nightEnvironment(gl));
    materials.bounds.value.set(b.minX, b.minZ, b.maxX, b.maxZ);
    return { textures, materials };
  }, [district, gl, b]);
  useEffect(() => () => { disposeMaterials(kit.materials); kit.textures.forEach(t => t.dispose()); }, [kit]);
  const parts = useMemo(() => ({
    cylinders: [...district.cylinders, ...district.masts.filter(p => p.glow === undefined)],
    neon: [...district.neon, ...district.masts.filter(p => p.glow !== undefined)],
    pools: district.pools.map((p): Part => ({ x: p.x, y: .05, z: p.z, w: 2 * p.r, h: 2 * p.r, d: 1, rx: -Math.PI / 2, color: p.color, glow: p.strength })),
  }), [district]);
  const fades = useBuildingFades(sim, plan);
  const grid = useMemo(() => gridGeometry(b), [b]);
  useEffect(() => () => grid.dispose(), [grid]);
  const m = kit.materials;
  return <group>
    <mesh position={[cx, -.03, cz]} receiveShadow material={m.ground}><boxGeometry args={[w + 2 * GROUND, .06, d + 2 * GROUND]} /></mesh>
    <lineSegments geometry={grid} position={[0, GRID_Y, 0]}><lineBasicMaterial color="#2f5866" transparent opacity={.35} depthWrite={false} /></lineSegments>
    <InstancedParts parts={district.solid} geometry={BOX} material={m.solid} fades={fades} castShadow receiveShadow />
    <InstancedParts parts={parts.cylinders} geometry={ROUND} material={m.solid} fades={fades} castShadow receiveShadow />
    <InstancedParts parts={district.facade} geometry={BOX} material={m.facade} fades={fades} castShadow receiveShadow />
    <InstancedParts parts={parts.neon} geometry={BOX} material={m.neon} fades={fades} />
    <InstancedParts parts={district.signs} geometry={PLANE} material={m.signs} fades={fades} />
    <InstancedParts parts={district.puddles} geometry={PLANE} material={m.puddles} receiveShadow renderOrder={-2} />
    <InstancedParts parts={parts.pools} geometry={PLANE} material={m.pools} renderOrder={-1} />
  </group>;
});
