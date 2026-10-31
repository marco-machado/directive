import { useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import type { Objective, Simulation } from '../game/simulation.ts';

// Canvas pixels covered by HUD panels on each side, measured by the camera rig.
export type Insets = { l: number; t: number; r: number; b: number };
const MARGIN = 34;
const name = (o: Objective) => o.kind === 'terminal' ? 'VAULT' : o.kind === 'charge' ? `CHARGE ${o.label.at(-1)}` : o.kind === 'vip' ? 'VIP' : 'EXTRACT';

// Edge arrows toward open objectives that are outside the free frame. Plain DOM nodes,
// positioned every frame without React renders.
export function Pointers({ sim, labels, insets }: { sim: Simulation; labels: RefObject<HTMLDivElement>; insets: RefObject<Insets> }) {
  const camera = useThree(s => s.camera), size = useThree(s => s.size), nodes = useRef<HTMLDivElement[]>([]), at = useMemo(() => new Vector3(), []);
  useEffect(() => {
    const host = labels.current;
    nodes.current = Array.from({ length: 3 }, () => {
      const el = document.createElement('div');
      el.className = 'pointer'; el.hidden = true; el.innerHTML = '<i class="pointer-arrow"></i><b class="pointer-dot"></b><span class="pointer-label"></span>';
      host.appendChild(el); return el;
    });
    return () => nodes.current.forEach(el => el.remove());
  }, [labels]);
  useFrame(() => {
    const list = nodes.current, { l, t, r, b } = insets.current;
    const x0 = l + MARGIN, x1 = size.width - r - MARGIN, y0 = t + MARGIN, y1 = size.height - b - MARGIN, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const ready = sim.extractReady;
    let n = 0;
    if (sim.phase === 'mission' && x1 > x0 && y1 > y0) for (const o of sim.objectives) {
      if (n >= list.length) break;
      if (o.done || o.kind === 'target' || (o.kind === 'extract' && !ready)) continue;
      const p = o.kind === 'vip' ? sim.units.find(u => u.kind === 'vip') ?? o : o;
      at.set(p.x, .5, p.z).project(camera);
      const sx = (at.x + 1) / 2 * size.width, sy = (1 - at.y) / 2 * size.height;
      if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) continue;
      const dx = sx - cx, dy = sy - cy, k = Math.min((x1 - cx) / Math.max(Math.abs(dx), 1e-6), (y1 - cy) / Math.max(Math.abs(dy), 1e-6));
      const el = list[n++], label = name(o);
      if (el.hidden) el.hidden = false;
      if (el.dataset.kind !== o.kind) el.dataset.kind = o.kind;
      el.style.transform = `translate(${cx + dx * k}px, ${cy + dy * k}px)`;
      (el.firstChild as HTMLElement).style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
      if (el.lastChild!.textContent !== label) el.lastChild!.textContent = label;
    }
    for (; n < list.length; n++) if (!list[n].hidden) list[n].hidden = true;
  });
  return null;
}
