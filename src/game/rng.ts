export type Rng = () => number;

// Small seeded generator so a contract seed always produces the same district.
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A stream of its own for one use of a seed, picked by name (and by index, for one of many). A generator that draws
// from its own stream never shifts what another generator makes: the name is hashed (FNV-1a) into the seed.
export function stream(seed: number, name: string, index = 0): Rng {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193);
  return mulberry32(seed ^ h ^ Math.imul(index + 1, 0x9e3779b1));
}

export const pick = <T>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng() * list.length)];
export const between = (rng: Rng, min: number, max: number) => min + rng() * (max - min);
export function shuffle<T>(rng: Rng, list: readonly T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
