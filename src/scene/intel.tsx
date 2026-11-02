import { useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BufferGeometry, CylinderGeometry, DoubleSide, Float32BufferAttribute, Mesh, MeshBasicMaterial, RingGeometry, Vector3 } from 'three';
import type { Group } from 'three';
import { GHOST_SECONDS } from '../game/simulation.ts';
import type { Simulation } from '../game/simulation.ts';
import type { Point } from '../game/world.ts';
import { eachDash } from './dashes.ts';

const GHOST_COLOR = '#ff7a6a', ROUTE_COLOR = '#ff8a7a';

// Last-seen ghosts: where a hostile was, and which way it faced, when the squad lost sight of it. A hollow
// figure, a ring and a heading chevron fade out over GHOST_SECONDS; a small DOM label (positioned every frame,
// like the attack hint) gives the seconds since. The simulation clears a ghost once the hostile is seen again.
// Two draw calls a ghost: the figure, and the ring and chevron as one ground mark. The materials are
// single-pass, since three.js draws a transparent double-sided material twice otherwise.
const BODY = new CylinderGeometry(.3, .3, 1.15, 14, 1, true);
const MARK = (() => {
  const ring = new RingGeometry(.42, .5, 32).rotateX(-Math.PI / 2).toNonIndexed(), g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([...ring.attributes.position.array, -.22, 0, .55, 0, 0, .9, .22, 0, .55], 3));
  ring.dispose(); return g;
})();
const GHOSTS = 40;
export function LastSeenGhosts({ sim, labels }: { sim: Simulation; labels: RefObject<HTMLDivElement> }) {
  const groups = useRef<(Group | null)[]>([]), tags = useRef<HTMLDivElement[]>([]), shown = useRef<number[]>([]);
  const camera = useThree(s => s.camera), size = useThree(s => s.size), at = useMemo(() => new Vector3(), []);
  useEffect(() => {
    tags.current = Array.from({ length: GHOSTS }, () => {
      const el = document.createElement('div');
      el.className = 'ghost-label'; el.hidden = true; labels.current.appendChild(el); return el;
    });
    shown.current = Array.from({ length: GHOSTS }, () => -1);
    return () => { tags.current.forEach(el => el.remove()); tags.current = []; };
  }, [labels]);
  useFrame(() => {
    let n = 0;
    if (sim.phase === 'mission') for (const s of sim.lastSeen.values()) {
      const group = groups.current[n], tag = tags.current[n]; if (!group || !tag) break;
      const age = sim.time - s.at, fade = Math.max(0, 1 - age / GHOST_SECONDS), seconds = Math.floor(age);
      group.visible = true; group.position.set(s.x, 0, s.z); group.rotation.y = s.heading;
      const [body, mark] = group.children as Mesh[];
      (body.material as MeshBasicMaterial).opacity = .3 * fade; (mark.material as MeshBasicMaterial).opacity = .65 * fade;
      at.set(s.x, 1.55, s.z).project(camera);
      tag.style.transform = `translate(${(at.x + 1) / 2 * size.width}px, ${(1 - at.y) / 2 * size.height}px) translate(-50%, -100%)`;
      tag.style.opacity = String(.35 + .65 * fade);
      if (shown.current[n] !== seconds) { shown.current[n] = seconds; tag.textContent = `${seconds}s`; }
      if (tag.hidden) tag.hidden = false;
      n++;
    }
    for (; n < GHOSTS; n++) {
      if (groups.current[n]) groups.current[n]!.visible = false;
      const tag = tags.current[n]; if (tag && !tag.hidden) tag.hidden = true;
    }
  });
  return <>{Array.from({ length: GHOSTS }, (_, i) => <group ref={el => { groups.current[i] = el; }} key={i} visible={false}>
    <mesh geometry={BODY} position={[0, .58, 0]}><meshBasicMaterial color={GHOST_COLOR} transparent depthWrite={false} toneMapped={false} side={DoubleSide} forceSinglePass /></mesh>
    <mesh geometry={MARK} position={[0, .04, 0]}><meshBasicMaterial color={GHOST_COLOR} transparent depthWrite={false} toneMapped={false} side={DoubleSide} forceSinglePass /></mesh>
  </group>)}</>;
}

// Earned patrol intel: once the squad has watched a guard finish a patrol leg, its whole route stays on the
// ground as a dashed line for the rest of the mission. A route's geometry is built once, when it is learned.
function dashes(route: Point[]) {
  const points: number[] = [], index: number[] = [];
  eachDash(route, (fx, fz, tx, tz, nx, nz) => {
    const n = points.length / 3;
    points.push(fx + nx, 0, fz + nz, fx - nx, 0, fz - nz, tx - nx, 0, tz - nz, tx + nx, 0, tz + nz);
    index.push(n, n + 1, n + 2, n, n + 2, n + 3);
  });
  const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(points, 3)); g.setIndex(index); return g;
}
const ROUTE = new MeshBasicMaterial({ color: ROUTE_COLOR, transparent: true, opacity: .55, depthWrite: false, toneMapped: false, side: DoubleSide, forceSinglePass: true });
export function PatrolIntel({ sim }: { sim: Simulation }) {
  const root = useRef<Group>(null), learned = useRef<Map<string, Point[]> | null>(null);
  const clear = (group: Group) => { for (const child of [...group.children]) { group.remove(child); (child as Mesh).geometry.dispose(); } };
  useEffect(() => () => { if (root.current) clear(root.current); }, []);
  useFrame(() => {
    const group = root.current; if (!group) return;
    group.visible = sim.phase === 'mission';
    if (learned.current !== sim.intel) { clear(group); learned.current = sim.intel; }
    if (group.children.length === sim.intel.size) return;
    for (const [id, route] of sim.intel) {
      if (group.getObjectByName(id)) continue;
      const line = new Mesh(dashes(route), ROUTE);
      line.name = id; line.position.y = .025; group.add(line);
    }
  });
  return <group ref={root} />;
}
