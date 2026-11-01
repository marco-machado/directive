import { useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, RingGeometry, Sphere } from 'three';
import { ABILITY_STATS } from '../game/classes.ts';
import { HOSTILE_STATS, SUSPICIOUS } from '../game/simulation.ts';
import type { Pending, Simulation, Unit } from '../game/simulation.ts';
import type { EnemyKind } from '../game/mapgen.ts';
import type { Point, World } from '../game/world.ts';
import { play } from '../ui/audio.ts';
import { CombatEffects } from './combat.tsx';

const RING = new RingGeometry(.9, 1, 48);
const FLAT: [number, number, number] = [-Math.PI / 2, 0, 0];

// Vision cones: each one is the hostile's visibility polygon on the ground. RAYS rays fan across its field of view
// and stop at the first building footprint in the way (World.sightDistance, the same footprints that block
// sightClear), so a cone shows the ground the hostile can actually see. Every cone owns a preallocated
// geometry that is rewritten in place each frame, in world-aligned offsets from the hostile. The fill fades
// from the hostile out to its range, strongest on the near ground where detection is fastest; a bright outline
// traces the edge of what it sees.
const FADE = [[0, 1], [.45, .65], [1, .35]] as const; // [share of the range, fill alpha]
const RAYS = 32, EDGE_WIDTH = .09, CONES = 40; // EDGE_WIDTH in m
const fadeAlpha = (share: number) => {
  for (let i = 1; i < FADE.length; i++) {
    const [r0, a0] = FADE[i - 1], [r1, a1] = FADE[i];
    if (share <= r1) return a0 + (a1 - a0) * (share - r0) / (r1 - r0);
  }
  return FADE[FADE.length - 1][1];
};
// The fill: one row of RAYS + 1 vertices per FADE ring, each ray's vertex pulled in to where the ray stops.
function fillGeometry() {
  const index: number[] = [];
  for (let row = 0; row < FADE.length - 1; row++) for (let k = 0; k < RAYS; k++) {
    const a = row * (RAYS + 1) + k, b = a + RAYS + 1;
    index.push(a, b, b + 1, a, b + 1, a + 1);
  }
  const n = FADE.length * (RAYS + 1), g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(new Float32Array(n * 3), 3)); g.setAttribute('color', new Float32BufferAttribute(new Float32Array(n * 4).fill(1), 4)); g.setIndex(index);
  g.boundingSphere = new Sphere(); return g;
}
// The outline: a quad EDGE_WIDTH wide along each side of the polygon, the RAYS rim segments and the two sides.
function edgeGeometry() {
  const quads = RAYS + 2, index: number[] = [];
  for (let q = 0; q < quads; q++) index.push(4 * q, 4 * q + 1, 4 * q + 2, 4 * q, 4 * q + 2, 4 * q + 3);
  const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(new Float32Array(quads * 12), 3)); g.setIndex(index);
  g.boundingSphere = new Sphere(); return g;
}
const reach = new Float32Array(RAYS + 1), rayX = new Float32Array(RAYS + 1), rayZ = new Float32Array(RAYS + 1);
function writeQuad(pos: Float32Array, q: number, ax: number, az: number, bx: number, bz: number) {
  const len = Math.hypot(bx - ax, bz - az), nx = len ? -(bz - az) / len * EDGE_WIDTH / 2 : 0, nz = len ? (bx - ax) / len * EDGE_WIDTH / 2 : 0, o = q * 12;
  pos[o] = ax + nx; pos[o + 2] = az + nz; pos[o + 3] = ax - nx; pos[o + 5] = az - nz;
  pos[o + 6] = bx - nx; pos[o + 8] = bz - nz; pos[o + 9] = bx + nx; pos[o + 11] = bz + nz;
}
// Casts the rays for `u` and rewrites both geometries of its cone.
function shapeCone(fill: BufferGeometry, outline: BufferGeometry, world: World, u: Unit, range: number, fov: number) {
  for (let k = 0; k <= RAYS; k++) {
    const a = u.heading - fov + 2 * fov * k / RAYS;
    rayX[k] = Math.sin(a); rayZ[k] = Math.cos(a); reach[k] = world.sightDistance(u, rayX[k], rayZ[k], range);
  }
  const fillPos = fill.attributes.position.array as Float32Array, fillColor = fill.attributes.color.array as Float32Array;
  for (let row = 0; row < FADE.length; row++) for (let k = 0; k <= RAYS; k++) {
    const v = row * (RAYS + 1) + k, d = Math.min(FADE[row][0] * range, reach[k]);
    fillPos[3 * v] = rayX[k] * d; fillPos[3 * v + 2] = rayZ[k] * d; fillColor[4 * v + 3] = fadeAlpha(d / range);
  }
  const edgePos = outline.attributes.position.array as Float32Array;
  for (let k = 0; k < RAYS; k++) writeQuad(edgePos, k, rayX[k] * reach[k], rayZ[k] * reach[k], rayX[k + 1] * reach[k + 1], rayZ[k + 1] * reach[k + 1]);
  writeQuad(edgePos, RAYS, 0, 0, rayX[0] * reach[0], rayZ[0] * reach[0]);
  writeQuad(edgePos, RAYS + 1, 0, 0, rayX[RAYS] * reach[RAYS], rayZ[RAYS] * reach[RAYS]);
  // Both bounding spheres, refit in place to the box around the polygon, keep frustum culling tight.
  let minX = 0, maxX = 0, minZ = 0, maxZ = 0;
  for (let k = 0; k <= RAYS; k++) {
    const x = rayX[k] * reach[k], z = rayZ[k] * reach[k];
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const fillSphere = fill.boundingSphere!, edgeSphere = outline.boundingSphere!;
  fillSphere.center.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2); fillSphere.radius = Math.hypot(maxX - minX, maxZ - minZ) / 2 + EDGE_WIDTH;
  edgeSphere.copy(fillSphere);
  fill.attributes.position.needsUpdate = true; fill.attributes.color.needsUpdate = true; outline.attributes.position.needsUpdate = true;
}
const CALM = new Color('#f2e6c8'), ALERT = new Color('#ff4b3a');
function VisionCones({ sim }: { sim: Simulation }) {
  const cones = useRef<(Group | null)[]>([]);
  const shapes = useMemo(() => Array.from({ length: CONES }, () => ({ fill: fillGeometry(), edge: edgeGeometry() })), []);
  useEffect(() => () => shapes.forEach(s => { s.fill.dispose(); s.edge.dispose(); }), [shapes]);
  useFrame(() => {
    let n = 0;
    const world = sim.plan?.world;
    if (world) for (const u of sim.units) {
      if (u.faction !== 'hostile' || u.hp <= 0 || !u.visible || u.stunned > 0) continue;
      const cone = cones.current[n], shape = shapes[n++]; if (!cone) break;
      const stats = HOSTILE_STATS[u.kind as EnemyKind], [fill, outline] = cone.children as Mesh[];
      const fillMat = fill.material as MeshBasicMaterial, edgeMat = outline.material as MeshBasicMaterial;
      shapeCone(shape.fill, shape.edge, world, u, stats.vision, stats.fov);
      cone.visible = true; cone.position.set(u.x, .03, u.z);
      fillMat.color.lerpColors(CALM, ALERT, u.detect); fillMat.opacity = .42 + .3 * u.detect;
      edgeMat.color.copy(fillMat.color); edgeMat.opacity = .6 + .4 * u.detect;
    }
    for (; n < cones.current.length; n++) if (cones.current[n]) cones.current[n]!.visible = false;
  });
  return <>{shapes.map((shape, i) => <group ref={el => { cones.current[i] = el; }} key={i} visible={false}>
    <mesh geometry={shape.fill} renderOrder={1}><meshBasicMaterial vertexColors transparent depthWrite={false} /></mesh>
    <mesh geometry={shape.edge} position={[0, .005, 0]} renderOrder={2}><meshBasicMaterial transparent depthWrite={false} toneMapped={false} side={DoubleSide} /></mesh>
  </group>)}</>;
}

// The move order's destination, with a ping that expands each time a new order lands.
function CommandMarker({ sim }: { sim: Simulation }) {
  const marker = useRef<Group>(null), ping = useRef<Mesh>(null), last = useRef<Point | null>(null), age = useRef(0);
  useFrame((_, dt) => {
    const point = sim.commandPoint;
    if (!marker.current || !ping.current) return;
    if (point !== last.current) { last.current = point; age.current = 0; if (point && sim.phase === 'mission') play('order', point); }
    age.current += dt;
    marker.current.visible = !!point && sim.phase === 'mission';
    if (!point) return;
    marker.current.position.set(point.x, .06, point.z);
    const k = Math.min(1, age.current / .45);
    ping.current.visible = k < 1; ping.current.scale.setScalar(.3 + k * .9);
    (ping.current.material as MeshBasicMaterial).opacity = (1 - k) * .9;
  });
  return <group ref={marker} visible={false}>
    <mesh rotation={FLAT}><ringGeometry args={[.22, .29, 4]} /><meshBasicMaterial color="#5ef2c0" toneMapped={false} /></mesh>
    <mesh ref={ping} rotation={FLAT} geometry={RING}><meshBasicMaterial color="#5ef2c0" transparent toneMapped={false} depthWrite={false} /></mesh>
  </group>;
}

// Hostile kills and a guard turning suspicious, heard where they happen.
function CombatAudio({ sim }: { sim: Simulation }) {
  const before = useRef(new Map<string, { hp: number; detect: number }>());
  useFrame(() => {
    for (const u of sim.units) {
      if (u.faction !== 'hostile') continue;
      const was = before.current.get(u.id);
      before.current.set(u.id, { hp: u.hp, detect: u.detect });
      if (!was || sim.phase !== 'mission') continue;
      if (was.hp > 0 && u.hp <= 0) play(u.kind === 'camera' || u.kind === 'turret' ? 'destroy' : 'kill', u);
      else if (!sim.alarm && u.visible && (u.kind === 'guard' || u.kind === 'heavy') && was.detect <= SUSPICIOUS && u.detect > SUSPICIOUS) play('suspicious', u);
    }
  });
  return null;
}

export function Effects({ sim }: { sim: Simulation }) {
  return <><VisionCones sim={sim} /><CombatEffects sim={sim} /><CommandMarker sim={sim} /><CombatAudio sim={sim} /></>;
}

// Ability targeting: reach around the caster, plus the blast area under the pointer for grenade and EMP.
export type Pointer = { x: number; z: number; on: boolean };
const AIM: Record<string, string> = { grenade: '#ffb17d', emp: '#7fc8ff', snipe: '#e8f6ff' }, OUT_OF_REACH = new Color('#ff5a4a');
export function Targeting({ sim, pending, pointer }: { sim: Simulation; pending: NonNullable<Pending>; pointer: RefObject<Pointer> }) {
  const reach = useRef<Group>(null), area = useRef<Group>(null), areaRing = useRef<MeshBasicMaterial>(null), areaFill = useRef<MeshBasicMaterial>(null);
  const stats = ABILITY_STATS[pending.ability], color = AIM[pending.ability] ?? '#e8f6ff', inReach = useMemo(() => new Color(color), [color]);
  useFrame(() => {
    const caster = sim.units.find(u => u.id === pending.unitId), p = pointer.current;
    if (!caster || !reach.current) return;
    reach.current.position.set(caster.x, .05, caster.z);
    if (!area.current || !areaRing.current || !areaFill.current) return;
    area.current.visible = p.on;
    area.current.position.set(p.x, .06, p.z);
    const tint = Math.hypot(p.x - caster.x, p.z - caster.z) > stats.reach || !sim.plan?.world.sightClear(caster, p) ? OUT_OF_REACH : inReach;
    areaRing.current.color.copy(tint); areaFill.current.color.copy(tint);
  });
  return <>
    <group ref={reach}>
      <mesh rotation={FLAT}><ringGeometry args={[stats.reach - .06, stats.reach, 96]} /><meshBasicMaterial color={color} transparent opacity={.7} depthWrite={false} toneMapped={false} /></mesh>
      <mesh rotation={FLAT}><circleGeometry args={[stats.reach, 64]} /><meshBasicMaterial color={color} transparent opacity={.04} depthWrite={false} /></mesh>
    </group>
    {stats.radius > 0 ? <group ref={area} visible={false}>
      <mesh rotation={FLAT}><ringGeometry args={[stats.radius - .05, stats.radius, 64]} /><meshBasicMaterial ref={areaRing} transparent opacity={.85} depthWrite={false} toneMapped={false} /></mesh>
      <mesh rotation={FLAT}><circleGeometry args={[stats.radius, 48]} /><meshBasicMaterial ref={areaFill} transparent opacity={.12} depthWrite={false} /></mesh>
    </group> : null}
  </>;
}
