import type { Milestone } from '../game/simulation.ts';

// First-time tips, remembered on this device: whether they show at all, and which ones were dismissed.
export type Tips = { enabled: boolean; seen: Milestone[] };
const KEY = 'ndTips';
let tips: Tips = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Tips> | null;
    return { enabled: saved?.enabled !== false, seen: Array.isArray(saved?.seen) ? saved.seen.filter((m): m is Milestone => typeof m === 'string') : [] };
  } catch { return { enabled: true, seen: [] }; }
})();
const listeners = new Set<() => void>();
const set = (next: Partial<Tips>) => {
  tips = { ...tips, ...next };
  try { localStorage.setItem(KEY, JSON.stringify(tips)); } catch { /* the change still applies for this session */ }
  listeners.forEach(fn => fn());
};

export const tipStore = {
  subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
  get: () => tips,
  toggle: () => set({ enabled: !tips.enabled }),
  dismiss: (id: Milestone) => { if (!tips.seen.includes(id)) set({ seen: [...tips.seen, id] }); },
  // Every tip shows again, and tips turn back on.
  reset: () => set({ enabled: true, seen: [] }),
};
