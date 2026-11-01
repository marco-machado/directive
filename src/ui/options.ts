// Gameplay options, remembered on this device.
export type Options = { autoPause: boolean };
const KEY = 'ndOptions';
let options: Options = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Options> | null;
    return { autoPause: saved?.autoPause === true };
  } catch { return { autoPause: false }; }
})();
const listeners = new Set<() => void>();

export const gameOptions = {
  subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
  get: () => options,
  toggleAutoPause: () => {
    options = { ...options, autoPause: !options.autoPause };
    try { localStorage.setItem(KEY, JSON.stringify(options)); } catch { /* the option still applies for this session */ }
    listeners.forEach(fn => fn());
  },
};
