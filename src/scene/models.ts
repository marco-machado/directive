import { useSyncExternalStore } from 'react';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { UnitKind } from '../game/simulation.ts';

// Imported unit models (auto-rigged GLBs under public/models) and the props they carry. A kind or prop without a
// file, or whose file has not loaded or failed to, keeps its procedural one, so the game never waits on a download.
const UNITS: Partial<Record<UnitKind, string>> = {
  assault: '/models/assault.glb', support: '/models/support.glb', recon: '/models/recon.glb', tech: '/models/tech.glb',
  guard: '/models/guard.glb', heavy: '/models/heavy.glb', target: '/models/target.glb', vip: '/models/vip.glb',
};
// A prop file: the point the hand holds, in the file's own units with up along +y, and how it is fitted to the
// procedural prop it replaces: by length (its long axis along the file's x, turned to +z) or by height (standing
// along y, its face toward +z). A rifle also gives where the off hand holds the handguard, in the same units.
export type PropFile = { url: string; hold: [number, number, number]; fit: 'length' | 'height'; fore?: [number, number] };
const rifle = (url: string, [x, y]: [number, number], fore: [number, number]): PropFile => ({ url, hold: [x, y, 0], fit: 'length', fore });
export const WEAPONS: Partial<Record<UnitKind, PropFile>> = {
  assault: rifle('/models/assault-carbine.glb', [-.17, .16], [.26, .19]),
  support: rifle('/models/support-rifle.glb', [-.15, .15], [.28, .18]),
  recon: rifle('/models/marksman-rifle.glb', [-.2, .09], [.16, .13]),
  tech: rifle('/models/smg.glb', [-.14, .2], [.32, .25]),
  guard: rifle('/models/security-rifle.glb', [-.2, .155], [.24, .2]),
  // The heavy's off hand holds its shield, not this handguard.
  heavy: rifle('/models/riot-rifle.glb', [-.14, .145], [.28, .17]),
};
// The shield's handle is on its back, at mid height; the briefcase's on top.
export const SHIELD: PropFile = { url: '/models/riot-shield.glb', hold: [0, .5, -.05], fit: 'height' };
export const BRIEFCASE: PropFile = { url: '/models/briefcase.glb', hold: [0, .8, 0], fit: 'length' };
// A machine part file: the point that sits on its bone (the base's foot, the head's bearing), in the file's own
// units with up along +y and forward along +z, and its scale into meters. A turret head also gives its muzzle.
export type MachinePart = { url: string; at: [number, number, number]; scale: number; muzzle?: [number, number, number] };
// A machine's head turns at `pivot` (model height): on the turret's bearing, on top of the camera's pole.
export type Machine = { pivot: number; base?: MachinePart; head: MachinePart };
export const MACHINES: Partial<Record<UnitKind, Machine>> = {
  turret: {
    pivot: .43,
    base: { url: '/models/turret-base.glb', at: [-.045, 0, 0], scale: .72 },
    head: { url: '/models/turret-head.glb', at: [.02, 0, -.22], scale: .72, muzzle: [.01, .22, .5] },
  },
  camera: { pivot: 1.86, head: { url: '/models/camera-head.glb', at: [0, 0, -.135], scale: .5 } },
};
const loaded = new Map<string, GLTF>(), listeners = new Set<() => void>();
let started = false;

function load() {
  started = true;
  const loader = new GLTFLoader();
  const parts = Object.values(MACHINES).flatMap(m => [m.base, m.head]).filter(p => !!p);
  for (const url of [...Object.values(UNITS), ...[...Object.values(WEAPONS), SHIELD, BRIEFCASE, ...parts].map(p => p.url)]) {
    loader.loadAsync(url).then(gltf => { loaded.set(url, gltf); listeners.forEach(l => l()); }, err => console.warn(`Model ${url} failed to load; keeping the procedural one.`, err));
  }
}
const subscribe = (listener: () => void) => {
  if (!started) load();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export const useModelFile = (url: string | undefined) => useSyncExternalStore(subscribe, () => url ? loaded.get(url) ?? null : null);
export const useUnitModel = (kind: UnitKind) => useModelFile(UNITS[kind]);
