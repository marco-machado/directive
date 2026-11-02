import { useSyncExternalStore } from 'react';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { UnitKind } from '../game/simulation.ts';

// Imported unit models (auto-rigged GLBs under public/models) and the rifles some of them carry. A kind without
// one, or whose file has not loaded or failed to, keeps its procedural rig or rifle, so the game never waits on a
// download.
const UNITS: Partial<Record<UnitKind, string>> = {
  assault: '/models/assault.glb', support: '/models/support.glb', recon: '/models/recon.glb', tech: '/models/tech.glb',
  guard: '/models/guard.glb', heavy: '/models/heavy.glb', target: '/models/target.glb', vip: '/models/vip.glb',
};
// A rifle file: where its pistol grip meets the receiver and where the off hand holds the handguard, in the file's
// own units, with the muzzle along +x and up along +y.
export type WeaponFile = { url: string; grip: [number, number]; fore: [number, number] };
export const WEAPONS: Partial<Record<UnitKind, WeaponFile>> = {
  assault: { url: '/models/assault-carbine.glb', grip: [-.17, .16], fore: [.26, .19] },
  support: { url: '/models/support-rifle.glb', grip: [-.15, .15], fore: [.28, .18] },
  recon: { url: '/models/marksman-rifle.glb', grip: [-.2, .09], fore: [.16, .13] },
  tech: { url: '/models/smg.glb', grip: [-.14, .2], fore: [.32, .25] },
  guard: { url: '/models/security-rifle.glb', grip: [-.2, .155], fore: [.24, .2] },
  // The heavy's off hand holds its shield, not this handguard.
  heavy: { url: '/models/riot-rifle.glb', grip: [-.14, .145], fore: [.28, .17] },
};
const loaded = new Map<string, GLTF>(), listeners = new Set<() => void>();
let started = false;

function load() {
  started = true;
  const loader = new GLTFLoader();
  for (const url of [...Object.values(UNITS), ...Object.values(WEAPONS).map(w => w.url)]) {
    loader.loadAsync(url).then(gltf => { loaded.set(url, gltf); listeners.forEach(l => l()); }, err => console.warn(`Model ${url} failed to load; keeping the procedural one.`, err));
  }
}
const subscribe = (listener: () => void) => {
  if (!started) load();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const useFile = (url: string | undefined) => useSyncExternalStore(subscribe, () => url ? loaded.get(url) ?? null : null);
export const useUnitModel = (kind: UnitKind) => useFile(UNITS[kind]);
export const useWeaponModel = (kind: UnitKind) => useFile(WEAPONS[kind]?.url);
