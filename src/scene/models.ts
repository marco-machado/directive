import { useSyncExternalStore } from 'react';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { UnitKind } from '../game/simulation.ts';

// Imported unit models (auto-rigged GLBs under public/models). A kind without one, or whose file has not loaded
// or failed to, keeps its procedural rig, so the game never waits on a download.
const URLS: Partial<Record<UnitKind, string>> = { assault: '/models/assault.glb', support: '/models/support.glb' };
const loaded = new Map<UnitKind, GLTF>(), listeners = new Set<() => void>();
let started = false;

function load() {
  started = true;
  const loader = new GLTFLoader();
  for (const [kind, url] of Object.entries(URLS) as [UnitKind, string][]) {
    loader.loadAsync(url).then(gltf => { loaded.set(kind, gltf); listeners.forEach(l => l()); }, err => console.warn(`Unit model ${url} failed to load; keeping the procedural ${kind}.`, err));
  }
}
const subscribe = (listener: () => void) => {
  if (!started) load();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export const useUnitModel = (kind: UnitKind) => useSyncExternalStore(subscribe, () => loaded.get(kind) ?? null);
