import { useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferGeometry, CircleGeometry, Color, CylinderGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, RingGeometry, SphereGeometry, Vector3 } from 'three';
import { ABILITY_STATS } from '../game/classes.ts';
import { HOSTILE_STATS, SUSPICIOUS } from '../game/simulation.ts';
import type { Blast, Faction, Pending, Shot, Simulation } from '../game/simulation.ts';
import type { EnemyKind } from '../game/mapgen.ts';
import type { Point } from '../game/world.ts';
import { play } from '../ui/audio.ts';
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

// Vision cones: one fan per hostile kind, laid flat in x/z at unit range so rotation.y = heading aims it and
// the scale sets the range. The fill fades from the hostile out to its range, strongest on the near ground where
// detection is fastest; a bright outline marks the edge of what it sees.
const FADE = [[0, 1], [.45, .65], [1, .35]] as const; // [share of the range, fill alpha]
const SEGMENTS = 24, EDGE_WIDTH = .09; // m
function fan(fov: number) {
  const points: number[] = [], colors: number[] = [], index: number[] = [];
  for (const [r, alpha] of FADE) for (let k = 0; k <= SEGMENTS; k++) {
    const a = -fov + 2 * fov * k / SEGMENTS;
    points.push(Math.sin(a) * r, 0, Math.cos(a) * r); colors.push(1, 1, 1, alpha);
  }
  for (let row = 0; row < FADE.length - 1; row++) for (let k = 0; k < SEGMENTS; k++) {
    const a = row * (SEGMENTS + 1) + k, b = a + SEGMENTS + 1;
    index.push(a, b, b + 1, a, b + 1, a + 1);
  }
  const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(points, 3)); g.setAttribute('color', new Float32BufferAttribute(colors, 4)); g.setIndex(index); return g;
}
// The outline: the rim arc and both sides of the fan, EDGE_WIDTH wide whatever the range.
function edge(fov: number, range: number) {
  const w = EDGE_WIDTH / range, points: number[] = [], index: number[] = [];
  const quad = (...corners: number[][]) => { const n = points.length / 3; corners.forEach(([x, z]) => points.push(x, 0, z)); index.push(n, n + 1, n + 2, n, n + 2, n + 3); };
  for (let k = 0; k < SEGMENTS; k++) {
    const a = -fov + 2 * fov * k / SEGMENTS, b = a + 2 * fov / SEGMENTS;
    quad([Math.sin(a) * (1 - w), Math.cos(a) * (1 - w)], [Math.sin(a), Math.cos(a)], [Math.sin(b), Math.cos(b)], [Math.sin(b) * (1 - w), Math.cos(b) * (1 - w)]);
  }
  for (const side of [-1, 1]) {
    const a = side * fov, ix = -side * Math.cos(a) * w, iz = side * Math.sin(a) * w; // a step inward, across the side
    quad([0, 0], [Math.sin(a), Math.cos(a)], [Math.sin(a) + ix, Math.cos(a) + iz], [ix, iz]);
  }
  const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(points, 3)); g.setIndex(index); return g;
}
const KINDS = Object.entries(HOSTILE_STATS) as [EnemyKind, (typeof HOSTILE_STATS)[EnemyKind]][];
const FANS = Object.fromEntries(KINDS.map(([kind, s]) => [kind, fan(s.fov)])) as Record<EnemyKind, BufferGeometry>;
const EDGES = Object.fromEntries(KINDS.map(([kind, s]) => [kind, edge(s.fov, s.vision)])) as Record<EnemyKind, BufferGeometry>;
const CALM = new Color('#f2e6c8'), ALERT = new Color('#ff4b3a');
function VisionCones({ sim }: { sim: Simulation }) {
  const cones = useRef<(Group | null)[]>([]);
  useFrame(() => {
    let n = 0;
    for (const u of sim.units) {
      if (u.faction !== 'hostile' || u.hp <= 0 || !u.visible || u.stunned > 0) continue;
      const cone = cones.current[n++]; if (!cone) break;
      const kind = u.kind as EnemyKind, range = HOSTILE_STATS[kind].vision, [fill, outline] = cone.children as Mesh[];
      const fillMat = fill.material as MeshBasicMaterial, edgeMat = outline.material as MeshBasicMaterial;
      cone.visible = true; fill.geometry = FANS[kind]; outline.geometry = EDGES[kind];
      cone.position.set(u.x, .03, u.z); cone.rotation.y = u.heading; cone.scale.set(range, 1, range);
      fillMat.color.lerpColors(CALM, ALERT, u.detect); fillMat.opacity = .42 + .3 * u.detect;
      edgeMat.color.copy(fillMat.color); edgeMat.opacity = .6 + .4 * u.detect;
    }
    for (; n < cones.current.length; n++) if (cones.current[n]) cones.current[n]!.visible = false;
  });
  return <>{Array.from({ length: 40 }, (_, i) => <group ref={el => { cones.current[i] = el; }} key={i} visible={false}>
    <mesh geometry={FANS.guard} renderOrder={1}><meshBasicMaterial vertexColors transparent depthWrite={false} /></mesh>
    <mesh geometry={EDGES.guard} position={[0, .005, 0]} renderOrder={2}><meshBasicMaterial transparent depthWrite={false} toneMapped={false} side={DoubleSide} /></mesh>
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
