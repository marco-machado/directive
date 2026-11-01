import { useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferGeometry, CircleGeometry, Color, CylinderGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, RingGeometry, Sphere, SphereGeometry, Vector3 } from 'three';
import { ABILITY_STATS } from '../game/classes.ts';
import { HOSTILE_STATS, SUSPICIOUS } from '../game/simulation.ts';
import type { Blast, Faction, Pending, Shot, Simulation, Unit } from '../game/simulation.ts';
import type { EnemyKind } from '../game/mapgen.ts';
import type { Point, World } from '../game/world.ts';
import { play } from '../ui/audio.ts';
import { shield, SHIELD_COLOR } from './parts.tsx';
import type { Cue } from '../ui/audio.ts';

const UP = new Vector3(0, 1, 0);
const BEAM = new CylinderGeometry(1, 1, 1, 6), RING = new RingGeometry(.9, 1, 48), DISC = new CircleGeometry(1, 40), FLASH = new SphereGeometry(1, 16, 10);
const FLAT: [number, number, number] = [-Math.PI / 2, 0, 0];

// Shots
const TRACER: Record<Faction, Color> = { squad: new Color('#c4ffe4'), hostile: new Color('#ffb08a'), vip: new Color('#ffe1a1') };
const SNIPE = new Color('#f4fdff');
const gunfire = (shot: Shot): Cue => shot.kind === 'snipe' ? 'snipe' : shot.shooter === 'turret' ? 'turretShot' : shot.faction === 'squad' ? 'shot' : 'hostileShot';
function Shots({ sim }: { sim: Simulation }) {
  const beams = useRef<(Mesh | null)[]>([]), direction = useMemo(() => new Vector3(), []), heard = useRef(-1);
  useFrame(() => {
    for (const shot of sim.shots) if (shot.id > heard.current) { heard.current = shot.id; play(gunfire(shot), shot.from); play('impact', shot.to); }
    beams.current.forEach((mesh, i) => {
      if (!mesh) return;
      const shot = sim.shots[i];
      mesh.visible = !!shot && sim.phase === 'mission';
      if (!shot) return;
      const { from, to } = shot, snipe = shot.kind === 'snipe', r = snipe ? .05 : .022;
      direction.set(to.x - from.x, 0, to.z - from.z);
      const length = direction.length();
      if (length < .01) { mesh.visible = false; return; }
      mesh.position.set((from.x + to.x) / 2, snipe ? .9 : .8, (from.z + to.z) / 2);
      mesh.scale.set(r, length, r); mesh.quaternion.setFromUnitVectors(UP, direction.normalize());
      const material = mesh.material as MeshBasicMaterial;
      material.color.copy(snipe ? SNIPE : TRACER[shot.faction]); material.opacity = snipe ? Math.min(1, shot.ttl / .2) : 1;
    });
  });
  return <>{Array.from({ length: 24 }, (_, i) => <mesh ref={el => { beams.current[i] = el; }} key={i} geometry={BEAM} visible={false}><meshBasicMaterial transparent toneMapped={false} depthWrite={false} /></mesh>)}</>;
}

// Blasts
const BLAST: Record<Blast['kind'], { color: Color; ttl: number }> = { grenade: { color: new Color('#ffa25c'), ttl: .7 }, heal: { color: new Color('#8ff5c8'), ttl: .8 }, emp: { color: new Color('#7fc8ff'), ttl: .8 } };
function Blasts({ sim }: { sim: Simulation }) {
  const groups = useRef<(Group | null)[]>([]), heard = useRef(-1);
  useFrame(() => {
    for (const blast of sim.blasts) if (blast.id > heard.current) { heard.current = blast.id; play(blast.kind, blast); }
    groups.current.forEach((group, i) => {
      if (!group) return;
      const blast = sim.blasts[i];
      group.visible = !!blast && sim.phase === 'mission';
      if (!blast) return;
      const { color, ttl } = BLAST[blast.kind], t = Math.min(1, Math.max(0, 1 - blast.ttl / ttl)), grow = 1 - (1 - t) ** 3;
      const [ring, disc, flash] = group.children as Mesh[];
      group.position.set(blast.x, 0, blast.z);
      ring.scale.setScalar(blast.radius * (.3 + .7 * grow)); disc.scale.setScalar(blast.radius * (.3 + .7 * grow));
      const ringMat = ring.material as MeshBasicMaterial, discMat = disc.material as MeshBasicMaterial, flashMat = flash.material as MeshBasicMaterial;
      ringMat.color.copy(color); discMat.color.copy(color); flashMat.color.copy(color);
      ringMat.opacity = (1 - t) * .95;
      discMat.opacity = blast.kind === 'grenade' ? Math.max(0, 1 - t * 2.5) * .55 : (1 - t) * .16;
      flash.visible = blast.kind === 'grenade' && t < .35;
      flash.scale.setScalar(.4 + t * 2.2); flashMat.opacity = Math.max(0, 1 - t / .35) * .85;
    });
  });
  return <>{Array.from({ length: 8 }, (_, i) => <group ref={el => { groups.current[i] = el; }} key={i} visible={false}>
    <mesh rotation={FLAT} position={[0, .08, 0]} geometry={RING}><meshBasicMaterial transparent toneMapped={false} depthWrite={false} /></mesh>
    <mesh rotation={FLAT} position={[0, .06, 0]} geometry={DISC}><meshBasicMaterial transparent toneMapped={false} depthWrite={false} /></mesh>
    <mesh position={[0, .5, 0]} geometry={FLASH}><meshBasicMaterial transparent toneMapped={false} depthWrite={false} /></mesh>
  </group>)}</>;
}

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

// Where a move order under the pointer would end when it lies within 1 m of a barrier: the barrier's sheltered
// side (Simulation.coverSnap), marked with a shield. Hidden while aiming, over a unit, or with nobody selected.
export function CoverPreview({ sim, pointer, hovered }: { sim: Simulation; pointer: RefObject<Pointer>; hovered: RefObject<string | null> }) {
  const marker = useRef<Group>(null), icon = useRef<Mesh>(null);
  useFrame(({ camera }) => {
    const g = marker.current, m = icon.current, p = pointer.current;
    if (!g || !m) return;
    const ready = sim.phase === 'mission' && p.on && !sim.pending && !hovered.current && sim.selected.some(id => sim.units.some(u => u.id === id && u.hp > 0));
    const snap = ready ? sim.coverSnap(p) : null;
    g.visible = !!snap;
    if (!snap) return;
    g.position.set(snap.x, .06, snap.z);
    m.quaternion.copy(camera.quaternion); m.scale.setScalar(20 / camera.zoom);
  });
  return <group ref={marker} visible={false}>
    <mesh rotation={FLAT}><ringGeometry args={[.22, .29, 4]} /><meshBasicMaterial color={SHIELD_COLOR.covered} transparent opacity={.75} toneMapped={false} depthWrite={false} /></mesh>
    <mesh ref={icon} position={[0, .75, 0]} material={shield(SHIELD_COLOR.covered)} renderOrder={22}><planeGeometry args={[1, 1]} /></mesh>
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
  return <><VisionCones sim={sim} /><Shots sim={sim} /><Blasts sim={sim} /><CommandMarker sim={sim} /><CombatAudio sim={sim} /></>;
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
