// Gameplay and graphics options, remembered on this device. Low graphics quality drops the bloom pass.
export type Quality = 'high' | 'low';
export type Options = { autoPause: boolean; quality: Quality };
const KEY = 'ndOptions';
let options: Options = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Options> | null;
    return { autoPause: saved?.autoPause === true, quality: saved?.quality === 'low' ? 'low' : 'high' };
  } catch { return { autoPause: false, quality: 'high' }; }
})();
const listeners = new Set<() => void>();
const set = (next: Partial<Options>) => {
  options = { ...options, ...next };
  try { localStorage.setItem(KEY, JSON.stringify(options)); } catch { /* the option still applies for this session */ }
  listeners.forEach(fn => fn());
};

export const gameOptions = {
  subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
  get: () => options,
  toggleAutoPause: () => set({ autoPause: !options.autoPause }),
  toggleQuality: () => set({ quality: options.quality === 'high' ? 'low' : 'high' }),
};
