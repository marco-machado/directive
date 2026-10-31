import { useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferGeometry, CircleGeometry, Color, CylinderGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, RingGeometry, SphereGeometry, Vector3 } from 'three';
import { ABILITY_STATS } from '../game/classes.ts';
import { HOSTILE_STATS } from '../game/simulation.ts';
import type { Blast, Faction, Pending, Simulation } from '../game/simulation.ts';
import type { EnemyKind } from '../game/mapgen.ts';

const UP = new Vector3(0, 1, 0);
const BEAM = new CylinderGeometry(1, 1, 1, 6), RING = new RingGeometry(.9, 1, 48), DISC = new CircleGeometry(1, 40), FLASH = new SphereGeometry(1, 16, 10);
const FLAT: [number, number, number] = [-Math.PI / 2, 0, 0];

// Shots
const TRACER: Record<Faction, Color> = { squad: new Color('#c4ffe4'), hostile: new Color('#ffb08a'), vip: new Color('#ffe1a1') };
const SNIPE = new Color('#f4fdff');
function Shots({ sim }: { sim: Simulation }) {
  const beams = useRef<(Mesh | null)[]>([]), direction = useMemo(() => new Vector3(), []);
  useFrame(() => {
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
  const groups = useRef<(Group | null)[]>([]);
  useFrame(() => {
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

// Vision cones: one fan per hostile kind, laid flat in x/z so rotation.y = heading aims it.
function fan(fov: number) {
  const segments = 24, points = [0, 0, 0], index: number[] = [];
  for (let k = 0; k <= segments; k++) { const a = -fov + 2 * fov * k / segments; points.push(Math.sin(a), 0, Math.cos(a)); }
  for (let k = 0; k < segments; k++) index.push(0, k + 1, k + 2);
  const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(points, 3)); g.setIndex(index); return g;
}
const FANS = Object.fromEntries(Object.entries(HOSTILE_STATS).map(([kind, s]) => [kind, fan(s.fov)])) as Record<EnemyKind, BufferGeometry>;
const CALM = new Color('#e9dcc0'), ALERT = new Color('#ff4b3a');
function VisionCones({ sim }: { sim: Simulation }) {
  const cones = useRef<(Mesh | null)[]>([]);
  useFrame(() => {
    let n = 0;
    for (const u of sim.units) {
      if (u.faction !== 'hostile' || u.hp <= 0 || !u.visible || u.stunned > 0) continue;
      const mesh = cones.current[n++]; if (!mesh) break;
      const kind = u.kind as EnemyKind, range = HOSTILE_STATS[kind].vision, material = mesh.material as MeshBasicMaterial;
      mesh.visible = true; mesh.geometry = FANS[kind];
      mesh.position.set(u.x, .03, u.z); mesh.rotation.y = u.heading; mesh.scale.set(range, 1, range);
      material.color.lerpColors(CALM, ALERT, u.detect); material.opacity = .12 + .2 * u.detect;
    }
    for (; n < cones.current.length; n++) if (cones.current[n]) cones.current[n]!.visible = false;
  });
  return <>{Array.from({ length: 40 }, (_, i) => <mesh ref={el => { cones.current[i] = el; }} key={i} geometry={FANS.guard} visible={false} renderOrder={1}><meshBasicMaterial transparent depthWrite={false} /></mesh>)}</>;
}

function CommandMarker({ sim }: { sim: Simulation }) {
  const marker = useRef<Mesh>(null);
  useFrame(() => {
    if (!marker.current) return;
    marker.current.visible = !!sim.commandPoint && sim.phase === 'mission';
    if (sim.commandPoint) marker.current.position.set(sim.commandPoint.x, .06, sim.commandPoint.z);
  });
  return <mesh ref={marker} rotation={FLAT} visible={false}><ringGeometry args={[.25, .3, 4]} /><meshBasicMaterial color="#def6cc" /></mesh>;
}

export function Effects({ sim }: { sim: Simulation }) {
  return <><VisionCones sim={sim} /><Shots sim={sim} /><Blasts sim={sim} /><CommandMarker sim={sim} /></>;
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
