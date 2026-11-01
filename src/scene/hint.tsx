import { useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import type { Simulation } from '../game/simulation.ts';
import { TOP } from './units.tsx';

// Over a hostile the pointer would attack, what the order does with the current selection:
// a takedown, or the volley against the hostile's HP ("48 / 75 · will alert"). A plain DOM node,
// positioned every frame without React renders.
export function AttackHint({ sim, labels, hovered }: { sim: Simulation; labels: RefObject<HTMLDivElement>; hovered: RefObject<string | null> }) {
  const camera = useThree(s => s.camera), size = useThree(s => s.size), node = useRef<HTMLDivElement | null>(null), at = useMemo(() => new Vector3(), []);
  useEffect(() => {
    const el = document.createElement('div');
    el.className = 'attack-hint'; el.hidden = true;
    labels.current.appendChild(el); node.current = el;
    return () => { el.remove(); node.current = null; };
  }, [labels]);
  useFrame(() => {
    const el = node.current; if (!el) return;
    const u = hovered.current ? sim.units.find(v => v.id === hovered.current) : undefined;
    const text = u?.faction === 'hostile' && !sim.pending ? sim.attackHint(u.id) : null;
    if (!u || !text) { if (!el.hidden) el.hidden = true; return; }
    at.set(u.x, TOP[u.kind] + .95, u.z).project(camera);
    el.style.transform = `translate(${(at.x + 1) / 2 * size.width}px, ${(1 - at.y) / 2 * size.height}px) translate(-50%, -100%)`;
    if (el.textContent !== text) {
      el.textContent = text;
      el.dataset.tone = text.startsWith('Takedown') || text.includes('silent') ? 'quiet' : text.includes('will alert') ? 'loud' : 'alarm';
    }
    if (el.hidden) el.hidden = false;
  });
  return null;
}
