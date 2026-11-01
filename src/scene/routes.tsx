import { useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, MeshBasicMaterial, RingGeometry, Vector3 } from 'three';
import type { Group, Mesh } from 'three';
import { SQUAD_MAX } from '../game/campaign.ts';
import { ROUTE_MAX } from '../game/simulation.ts';
import type { Simulation } from '../game/simulation.ts';
import { distance } from '../game/world.ts';
import type { Point } from '../game/world.ts';
import { DASH, eachDash, PERIOD } from './dashes.ts';
import { CLASS_COLOR } from './rigs.ts';

// Planned move orders: each operative's route as a dashed line in its class color, from where it stands through
// every queued leg, with a ring and a numbered tag at each waypoint (and the seconds it will hold there). Shown
// for the selection, and for the whole squad while paused. The dashes are laid out back from the route's end, so
// they stay put on the street while the operative walks the line down. Each line owns a preallocated geometry
// that is rewritten in place each frame; tags are plain DOM nodes, positioned like the last-seen labels.
const DASH_CAP = 512, ROUTE_Y = .05;
const MARKER = new RingGeometry(.2, .27, 24).rotateX(-Math.PI / 2);
function lineGeometry() {
  const index: number[] = [];
  for (let q = 0; q < DASH_CAP; q++) index.push(4 * q, 4 * q + 1, 4 * q + 2, 4 * q, 4 * q + 2, 4 * q + 3);
  const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(new Float32Array(DASH_CAP * 12), 3)); g.setIndex(index);
  g.setDrawRange(0, 0); return g;
}
const colors = new Map<string, Color>();
const classColor = (kind: string) => { let c = colors.get(kind); if (!c) colors.set(kind, c = new Color(CLASS_COLOR[kind as keyof typeof CLASS_COLOR] ?? '#5ef2c0')); return c; };

export function PlannedRoutes({ sim, labels }: { sim: Simulation; labels: RefObject<HTMLDivElement> }) {
  const slots = useMemo(() => Array.from({ length: SQUAD_MAX }, () => ({
    geometry: lineGeometry(), material: new MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false, side: DoubleSide, forceSinglePass: true }),
  })), []);
  useEffect(() => () => slots.forEach(s => { s.geometry.dispose(); s.material.dispose(); }), [slots]);
  const lines = useRef<(Mesh | null)[]>([]), markers = useRef<(Group | null)[]>([]), tags = useRef<HTMLDivElement[][]>([]);
  const camera = useThree(s => s.camera), size = useThree(s => s.size), at = useMemo(() => new Vector3(), []), route = useMemo<Point[]>(() => [], []);
  useEffect(() => {
    tags.current = slots.map(() => Array.from({ length: ROUTE_MAX }, () => {
      const el = document.createElement('div');
      el.className = 'waypoint-label'; el.hidden = true; labels.current.appendChild(el); return el;
    }));
    return () => { tags.current.flat().forEach(el => el.remove()); tags.current = []; };
  }, [labels, slots]);
  useFrame(() => {
    slots.forEach((slot, i) => {
      const line = lines.current[i], ring = markers.current[i], list = tags.current[i];
      if (!line || !ring || !list) return;
      const u = sim.phase === 'mission' ? sim.units.find(v => v.id === sim.squad[i]) : undefined, picked = !!u && sim.selected.includes(u.id);
      const stops = u && u.hp > 0 && (sim.paused || picked) ? sim.waypoints(u) : [];
      line.visible = ring.visible = stops.length > 0;
      if (!u || !stops.length) { list.forEach(tag => { if (!tag.hidden) tag.hidden = true; }); return; }
      slot.material.color.copy(classColor(u.kind)); slot.material.opacity = picked ? .85 : .45;
      route.length = 0; route.push(u, ...u.path);
      for (const leg of u.route) route.push(...leg.path);
      let length = 0;
      for (let k = 1; k < route.length; k++) length += distance(route[k - 1], route[k]);
      const pos = slot.geometry.attributes.position.array as Float32Array;
      let q = 0;
      eachDash(route, (fx, fz, tx, tz, nx, nz) => {
        if (q >= DASH_CAP) return false;
        const o = q++ * 12;
        pos[o] = fx + nx; pos[o + 2] = fz + nz; pos[o + 3] = fx - nx; pos[o + 5] = fz - nz;
        pos[o + 6] = tx - nx; pos[o + 8] = tz - nz; pos[o + 9] = tx + nx; pos[o + 11] = tz + nz;
      }, ((length - DASH) % PERIOD + PERIOD) % PERIOD);
      slot.geometry.setDrawRange(0, q * 6); slot.geometry.attributes.position.needsUpdate = true;
      ring.children.forEach((m, j) => { const s = stops[j]; m.visible = !!s; if (s) m.position.set(s.x, 0, s.z); });
      list.forEach((tag, j) => {
        const s = stops[j];
        if (!s) { if (!tag.hidden) tag.hidden = true; return; }
        at.set(s.x, ROUTE_Y, s.z).project(camera);
        tag.style.transform = `translate(${(at.x + 1) / 2 * size.width}px, ${(1 - at.y) / 2 * size.height}px) translate(-50%, -50%)`;
        const text = s.wait > 0 ? `${j + 1} · ${Math.ceil(s.wait)}s` : String(j + 1);
        if (tag.textContent !== text) tag.textContent = text;
        const look = `waypoint-label cls-${u.kind}${picked ? '' : ' dim'}`;
        if (tag.className !== look) tag.className = look;
        if (tag.hidden) tag.hidden = false;
      });
    });
  });
  return <>{slots.map((slot, i) => <group key={i}>
    <mesh ref={el => { lines.current[i] = el; }} geometry={slot.geometry} material={slot.material} position={[0, ROUTE_Y, 0]} renderOrder={3} frustumCulled={false} visible={false} />
    <group ref={el => { markers.current[i] = el; }} position={[0, ROUTE_Y + .005, 0]} visible={false}>
      {Array.from({ length: ROUTE_MAX }, (_, j) => <mesh key={j} geometry={MARKER} material={slot.material} renderOrder={3} visible={false} />)}
    </group>
  </group>)}</>;
}
