export type ClassId = 'assault' | 'support' | 'recon' | 'tech';
export type AbilityId = 'grenade' | 'heal' | 'snipe' | 'emp';
export const CLASSES: readonly ClassId[] = ['assault', 'support', 'recon', 'tech'];
export const isClass = (v: unknown): v is ClassId => CLASSES.includes(v as ClassId);

export type ClassStats = { title: string; hp: number; damage: number; range: number; fireCooldown: number; ability: AbilityId };
export const CLASS_STATS: Record<ClassId, ClassStats> = {
  assault: { title: 'ASSAULT', hp: 140, damage: 28, range: 6.2, fireCooldown: .65, ability: 'grenade' },
  support: { title: 'SUPPORT', hp: 120, damage: 20, range: 6.2, fireCooldown: .65, ability: 'heal' },
  recon: { title: 'RECON', hp: 100, damage: 30, range: 8, fireCooldown: 1, ability: 'snipe' },
  tech: { title: 'TECH', hp: 110, damage: 20, range: 6.2, fireCooldown: .65, ability: 'emp' },
};

// `power` is damage, healing, or stun seconds; `reach` is how far from the operative it can be aimed.
export type AbilityStats = { name: string; cooldown: number; power: number; radius: number; reach: number; targeted: boolean };
export const ABILITY_STATS: Record<AbilityId, AbilityStats> = {
  grenade: { name: 'Breach grenade', cooldown: 18, power: 90, radius: 2.2, reach: 8, targeted: true },
  heal: { name: 'Field heal', cooldown: 20, power: 60, radius: 3, reach: 0, targeted: false },
  snipe: { name: 'Sniper shot', cooldown: 15, power: 130, radius: 0, reach: 14, targeted: true },
  emp: { name: 'EMP', cooldown: 20, power: 5, radius: 2.5, reach: 7, targeted: true },
};
export const MARK_SECONDS = 6;
export const MARK_RADIUS = 4;
export const EMP_CAMERA_SECONDS = 10;

// Each purchased level shortens the cooldown by 15% and strengthens the effect by 20%.
export const abilityCooldown = (ability: AbilityId, level: number) => ABILITY_STATS[ability].cooldown * (1 - .15 * level);
export const effectScale = (level: number) => 1 + .2 * level;
export const abilityPower = (ability: AbilityId, level: number) => ABILITY_STATS[ability].power * effectScale(level);
