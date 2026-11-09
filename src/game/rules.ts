// The simulation's vocabulary: its types, its tunable rules (exported constants, which the tests import instead of
// hard-coding numbers) and the pure helpers that read them. Nothing here holds state.
import { SQUAD_SPEED } from './classes.ts';
import type { AbilityId, ClassId } from './classes.ts';
import type { Badge, Campaign, Contract, Loadout, MissionReport, Reward, Upgrade } from './campaign.ts';
import type { EnemyKind, MissionPlan } from './mapgen.ts';
import { mulberry32 } from './rng.ts';
import { World, distance } from './world.ts';
import type { Point } from './world.ts';

export type Faction = 'squad' | 'hostile' | 'vip';
export type UnitKind = ClassId | EnemyKind | 'vip';
// A queued leg of an operative's move order: the path from the previous leg's end, and how long to hold at its own end.
type Leg = { path: Point[]; wait: number };
// A stop on a planned route, as the scene numbers it.
export type Waypoint = Point & { wait: number };
export type Unit = Point & {
  id: string; name: string; kind: UnitKind; faction: Faction; hp: number; maxHp: number; cooldown: number;
  // `path` is the leg being walked. An operative holds `wait` seconds at its end, then takes the next leg of `route`.
  path: Point[]; route: Leg[]; targetId: string | null; heading: number; moving: boolean; repath: number;
  ability: AbilityId | null; abilityCd: number; reviveTarget: string | null; revive: number; hurt: number;
  patrol: Point[]; patrolIndex: number; exit: Point | null; wait: number; detect: number; stunned: number; marked: number; visible: boolean; hunting: boolean; sweep: number;
  // Takedowns: the hostile an operative is closing on, and how long a hostile has been held.
  takedownId: string | null; held: number;
  // An Intercept escort: the courier it walks beside.
  escort: string | null;
  // A posted guard's look-around: seconds into the current cycle, that cycle's length, and its count.
  look: number; lookEvery: number; lookCycle: number;
  // An unknown target: the kind it passes as until identified, and how long an operative has watched it (seconds).
  // Surveillance's executives reuse `watched` toward a tag, and `tagged` once tagged.
  guise: EnemyKind | null; watched: number; tagged: boolean;
  // Whether an operative's last move order was its own, not the squad's (only that hands a carrier's package over).
  solo: boolean;
};
// A carry contract's package: where it is, who carries it (null once dropped), and the squadmate taking it over and for how long.
export type Cargo = Point & { carrier: string | null; to: string | null; hand: number };
export type Pickup = Point & { in: number };
// Where a hostile was, and which way it faced, when the squad lost sight of it (`at` is mission time).
export type Sighting = Point & { heading: number; at: number };
export type Shot = { id: number; from: Point; to: Point; faction: Faction; shooter: UnitKind; kind: 'bullet' | 'snipe'; ttl: number };
export type Blast = { id: number; kind: 'grenade' | 'heal' | 'emp'; x: number; z: number; radius: number; ttl: number };
// A 'sweep' (Elimination) has no place of its own: its point is the district's center, and nothing draws or points at it.
// An `optional` objective (Smash and grab's caches past the first, a Surveillance executive past the second or lost, a
// Jailbreak cell once a freed prisoner lives) never holds extraction back. A 'tag' objective follows its executive
// (`unit`) while the squad can see it, and is `lost` once that executive is killed or gets away; a 'cell' holds its
// prisoner (`unit`), and is `lost` once that prisoner is killed.
export type Objective = Point & { kind: 'target' | 'terminal' | 'charge' | 'cache' | 'vip' | 'cell' | 'sweep' | 'tag' | 'extract'; label: string; progress: number; done: boolean; optional: boolean; unit?: string; lost?: boolean };
export const cacheLetter = (o: Objective) => /(?:cache|executive|prisoner) ([A-Z])/i.exec(o.label)?.[1] ?? '';
// Whether extraction is open: every objective but extraction is done or optional.
export const objectivesMet = (objectives: readonly Objective[]) => objectives.every(o => o.kind === 'extract' || o.done || o.optional);
export type Phase = 'briefing' | 'mission' | 'headquarters';
export type Pending = { unitId: string; ability: AbilityId } | null;
// 'covered' when every threat fires into the barrier the unit crouches behind, 'flanked' when one of them has a clear shot.
export type Shield = 'covered' | 'flanked' | null;
export type CoverStatus = { threats: { id: string; covered: boolean }[]; shield: Shield };
export type CoverSnap = Point & { along: Point; span: { lo: number; hi: number } | null };
// Situations a first-time player meets, each recorded the first time it happens in a mission, in order.
export type Milestone = 'hostileSeen' | 'suspicious' | 'alarm' | 'abilityReady' | 'downed' | 'extractOpen';
// What raised the mission's first alarm, the one that cost the stealth bonus: how, the hostile that raised it (null for a
// grenade), the operative that gave the squad away (null when there was none), where, the nearest objective, and mission time.
export type AlarmTrigger = 'sighting' | 'takedown' | 'gunfire' | 'grenade';
export type AlarmCause = Point & { trigger: AlarmTrigger | null; hostile: EnemyKind | null; operative: string | null; near: string; at: number };
export type Snapshot = {
  phase: Phase; paused: boolean; selected: string[]; squad: string[]; squadPick: string[]; units: Unit[]; campaign: Campaign;
  contract: Contract | null; plan: MissionPlan | null; objectives: Objective[]; alarm: boolean; calmIn: number; reinforceIn: number; reinforced: number;
  // How many alarms the mission has had, this alarm's reinforcement cap and stand-down time, and what the next alarm brings.
  alarms: number; reinforceCap: number; calmFor: number; nextAlarm: Escalation;
  result: 'success' | 'failure' | null; failReason: string; payout: number; stealth: boolean; alarmCause: AlarmCause | null; time: number; message: string;
  saveUnavailable: boolean; syncing: boolean; pending: Pending; cover: Record<string, Shield>; milestones: Milestone[];
  // The badges a won contract earned, and how many times an operative went down.
  badges: Badge[]; downs: number;
  // What a won contract earned beyond its payout, and whether the mission started with an intel reward's routes.
  reward: Reward; intelReward: boolean;
  cargo: Cargo | null; // a carry contract's package, once the vault gives it up
  // A called extraction: where the pickup was called and the seconds until it lands, and whether the squad is choosing where.
  pickup: Pickup | null; calling: boolean;
  lockdownIn: number | null; // seconds until a Lockdown contract's exits seal, once its first alarm has sounded
  // The Countermeasures level picked for (or fixed by) the mission, and the highest one open.
  countermeasures: number; countermeasuresOpen: number;
};
// Reports campaign events to the server; the server answers through applyCampaign.
export type CampaignSync = {
  deployed(contractId: string, squad: string[], countermeasures: number): void; completed(report: MissionReport): void;
  bought(type: Upgrade): void; equipped(loadout: Loadout): void; recruited(id: string): void; dismissed(id: string): void;
  picked(squad: string[]): void; // the briefing's squad pick, which stays in this browser
};

type HostileStats = { name: string; hp: number; damage: number; range: number; fireCooldown: number; speed: number; alertSpeed: number; vision: number; fov: number };
export const HOSTILE_STATS: Record<EnemyKind, HostileStats> = {
  guard: { name: 'SECURITY', hp: 75, damage: 14, range: 5.5, fireCooldown: 1.25, speed: 1.8, alertSpeed: 3, vision: 7, fov: .87 },
  heavy: { name: 'HEAVY', hp: 180, damage: 16, range: 5, fireCooldown: 1.4, speed: 1.5, alertSpeed: 2.2, vision: 6, fov: .87 },
  camera: { name: 'CAMERA', hp: 40, damage: 0, range: 0, fireCooldown: 0, speed: 0, alertSpeed: 0, vision: 8, fov: .61 },
  turret: { name: 'TURRET', hp: 140, damage: 18, range: 7, fireCooldown: 1.1, speed: 0, alertSpeed: 0, vision: 7, fov: .79 },
  target: { name: 'TARGET', hp: 110, damage: 0, range: 0, fireCooldown: 0, speed: 0, alertSpeed: 1.8, vision: 6, fov: .87 },
};
// Hostiles grow 5% tougher and 4% deadlier per tier up to tier 3, then a further 10% and 15% per tier.
export const tierHp = (tier: number) => 1 + .05 * (tier - 1) + .1 * Math.max(0, tier - 3);
export const tierDamage = (tier: number) => 1 + .04 * (tier - 1) + .15 * Math.max(0, tier - 3);
export { SQUAD_SPEED };
export const VIP_SPEED = 3.2;
export const VIP_HP = 160;
export const VIP_REACH = 3;           // an operative this close to the VIP
export const VIP_SECURE_SECONDS = 5; // takes this long to free them
export const VIP_DAMAGE_TAKEN = .5; // the VIP wears body armor: hostile fire does half damage
export const VIP_COVER_REACH = 4;   // under fire, the VIP ducks behind cover this close to its operative
export const PRISONER_HP = 100;     // a Jailbreak prisoner: freed like the VIP, but with no body armor
export const FLEE_DELAY = 5;        // the target hesitates before running for an exit
export const FLEE_MIN_EXIT = 16;    // and picks an exit at least this far away
export const EXECUTIVE_SPEED = 1.2; // a Surveillance executive strolls its beat
export const SIGHT_RANGE = 10;      // fog of war: hostiles beyond this or behind buildings are hidden
export const GHOST_SECONDS = 12;    // a hostile that drops out of sight leaves a last-seen marker this long
export const CONVERGE_RADIUS = 14;  // guards this close to the alarm hunt the squad
export const SUSPICIOUS = .3;       // detection above this makes a guard stop and stare
// Detection fills in DETECT_BASE + DETECT_PER_METER × distance seconds: 1.5 s at 2 m, 4 s at a guard's full 7 m.
const DETECT_BASE = .5;
const DETECT_PER_METER = .5;
export const CAMERA_DETECT = .75;   // a camera fills in this share of a guard's time at the same distance
export const DETECT_DRAIN = .25;    // per second, with nobody in sight
export const detectSeconds = (kind: EnemyKind, d: number) => (DETECT_BASE + DETECT_PER_METER * d) * (kind === 'camera' ? CAMERA_DETECT : 1);
export const FIRST_WAVE_SECONDS = 5; // the first reinforcement wave follows the alarm this quickly
export const REINFORCE_SECONDS = 20; // and later waves this far apart
export const CALM_SECONDS = 25;     // the alarm stands down after this long without contact
export const SEARCH_TURN = 1.5;     // a hunter at the last known position turns this fast (rad/s)
export const REINFORCE_CAP = 8;     // reinforcements the first alarm of a mission can bring
export const REPEAT_REINFORCEMENTS = 4; // each later alarm in the mission brings this many more
export const CALM_STEP = 10;        // and takes this much longer to stand down
// What a mission's `n`th alarm brings (n counts from 1; the first is the plain alarm): how many reinforcements the
// mission can have had by its end (any an earlier alarm never sent still come), how many heavies lead each wave,
// and how long the squad must stay out of contact for it to stand down.
// Each alarm puts one more heavy at the head of its waves than the one before, until whole waves are heavies.
export type Escalation = { cap: number; heavies: number; calm: number };
export const escalation = (n: number, tier: number): Escalation =>
  ({ cap: REINFORCE_CAP + REPEAT_REINFORCEMENTS * (n - 1), heavies: Math.min(n - 1, waveSize(tier)), calm: CALM_SECONDS + CALM_STEP * (n - 1) });
// What each Countermeasures level does (see campaign.ts), each adding to the one before: hostiles notice intruders in
// `detect` times the usual time, alarms take `calm` s longer to stand down, and with `uncapped` reinforcements never stop.
export const COUNTERMEASURES = [
  { detect: 1, calm: 0, uncapped: false },
  { detect: .8, calm: 0, uncapped: false },
  { detect: .8, calm: 15, uncapped: false },
  { detect: .8, calm: 15, uncapped: true },
] as const;
// Reinforcements enter in waves of this many.
export const waveSize = (tier: number) => tier >= 4 ? 3 : 2;
export const REVIVE_SECONDS = 3;
export const REVIVE_HP = .4;
export const HACK_SECONDS = 12;
export const PLANT_SECONDS = 3;
export const CACHE_SECONDS = 3; // an operative at a Smash and grab cache opens it in this long
export const COVER_FACTOR = .5;
// What each gear level buys, by how the squad spends it (Campaign.loadout). At level 0 every mode is plain issue.
export const PIERCING_BONUS = 4;       // damage a weapon level adds with piercing rounds
export const SUPPRESSOR_STEP = .2;     // with suppressors, a hostile that survives a rifle hit gains 1 − this × level detection, not the alarm
export const EXTENDED_RANGE = .6;      // m of rifle range a weapon level adds with extended barrels
export const HEAVY_HP = 12;            // health an armor level adds with heavy plating
export const LIGHT_CONCEALMENT = .15;  // with light weave, hostiles take 1 + this × level times as long to notice an operative
export const gearDamage = (c: Campaign) => c.loadout.weapon === 'piercing' ? c.weapon * PIERCING_BONUS : 0;
export const gearRange = (c: Campaign) => c.loadout.weapon === 'extended' ? c.weapon * EXTENDED_RANGE : 0;
export const suppressedAlert = (c: Campaign) => c.loadout.weapon === 'suppressed' ? 1 - SUPPRESSOR_STEP * c.weapon : 1;
export const gearHp = (c: Campaign) => c.loadout.armor === 'heavy' ? c.armor * HEAVY_HP : 0;
export const concealment = (c: Campaign) => c.loadout.armor === 'light' ? 1 + LIGHT_CONCEALMENT * c.armor : 1;
export const PICKUP_RADIUS = 3;     // a called pickup's zone (a fixed extraction's is 2 m)
export const QUEUE_SPACING = .9;    // gap between operatives, side by side or in single file
export const ROUTE_MAX = 8;         // waypoints an operative's route can hold, the one it is walking to included
export const WAIT_STEP = 2;         // each wait order adds this many seconds at the last waypoint
export const WAIT_MAX = 10;         // and one past this clears the wait
export const TAKEDOWN_REACH = 1.2;  // an operative this close to an unaware hostile starts the takedown
export const TAKEDOWN_SECONDS = 1.5;
export const TAKEDOWN_STANDOFF = .9;       // where the approach route ends, behind the hostile
export const LOOK_ANGLE = Math.PI / 3; // posted guards look this far to either side of their post
export const LOOK_PAUSE = 2;        // and hold that look this long
export const LOOK_EVERY = [6, 8] as const; // seconds between the starts of two look-arounds
export const LOOK_TURN = 1.5;       // rad/s while looking around
// Cameras and turrets sweep this far (rad) to either side of the way they were set up to face.
export const SWEEP: Record<'camera' | 'turret', number> = { camera: .7, turret: 1 };

export const angleDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
// Turns `u` toward `heading` by at most `step` radians, the short way round.
export const turnTo = (u: Unit, heading: number, step: number) => {
  const d = Math.atan2(Math.sin(heading - u.heading), Math.cos(heading - u.heading));
  u.heading = Math.abs(d) <= step ? heading : u.heading + Math.sign(d) * step;
};
// A number in [0, 1) fixed by the contract seed, a unit id and a counter, so look-arounds replay exactly.
export const hashed = (seed: number, id: string, n: number) => {
  let h = seed ^ 0x2545f491;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return mulberry32((h ^ Math.imul(n + 1, 0x9e3779b1)) >>> 0)();
};
// How the debrief names each objective as a landmark (charges carry their letter from the label).
export const LANDMARK: Record<Objective['kind'], string> = { target: 'the target', terminal: 'the vault terminal', charge: 'a charge site', cache: 'a cache', tag: 'an executive', vip: 'the VIP', cell: 'a cell', sweep: 'the district', extract: 'extraction' };
// Elimination's objective, with how many of the district's own hostiles are still standing.
export const sweepLabel = (left: number) => left ? `Down every hostile (${left} left)` : 'Down every hostile';
// Reinforcements are numbered r0, r1, … as they enter (see reinforce); the district's own hostiles are h0, h1, ….
export const isReinforcement = (u: Pick<Unit, 'id' | 'faction'>) => u.faction === 'hostile' && /^r\d+$/.test(u.id);
// What a hostile shows the squad: an unknown target passes for the guard it is disguised as.
export const seenAs = (u: Pick<Unit, 'kind'> & { guise?: EnemyKind | null }) => HOSTILE_STATS[(u.guise ?? u.kind) as EnemyKind];
// The health and full health the squad reads off a hostile: an unknown target reads as the guard it passes for, at the
// same share of its health.
export const apparentHealth = (u: Pick<Unit, 'hp' | 'maxHp' | 'guise'>, tier: number) => {
  if (!u.guise) return { hp: u.hp, maxHp: u.maxHp };
  const maxHp = Math.round(HOSTILE_STATS[u.guise].hp * tierHp(tier));
  return { hp: maxHp * u.hp / u.maxHp, maxHp };
};
export const takedownable = (u: Unit) => u.kind === 'guard' || u.kind === 'heavy' || u.kind === 'target';
export const posted = (u: Pick<Unit, 'kind' | 'patrol'> & { guise?: EnemyKind | null }) => (u.kind === 'guard' || u.kind === 'heavy' || !!u.guise) && u.patrol.length < 2;
export const headingTo = (a: Point, b: Point) => Math.atan2(b.x - a.x, b.z - a.z);
export const routeLength = (from: Point, path: Point[]) => path.reduce((sum, p, i) => sum + distance(i ? path[i - 1] : from, p), 0);
// The point `d` back from the end of a route, walking toward its start.
export const pointBack = (route: Point[], d: number): Point => {
  for (let i = route.length - 1; i > 0; i--) {
    const a = route[i], b = route[i - 1], len = distance(a, b);
    if (!len || len < d) { d -= len; continue; }
    return { x: a.x + (b.x - a.x) * d / len, z: a.z + (b.z - a.z) * d / len };
  }
  return { x: route[0].x, z: route[0].z };
};
// Ground a hostile can see, widened by `margin` for planning, wherever it will look: a posted guard's whole look-around
// and a camera's or turret's whole sweep count, not only the way it faces now.
export function watchedBy(world: World, v: Pick<Unit, 'x' | 'z' | 'kind' | 'heading' | 'sweep' | 'patrol'>, margin = 1) {
  const stats = seenAs(v), range = stats.vision + .8 * margin, fov = stats.fov + .25 * margin;
  const turn = posted(v) ? LOOK_ANGLE : v.kind === 'camera' || v.kind === 'turret' ? SWEEP[v.kind] : null;
  return (p: Point) => {
    if (distance(v, p) > range) return false;
    const a = headingTo(v, p);
    if (angleDiff(a, v.heading) > fov && !(turn !== null && angleDiff(a, v.sweep) <= turn + fov)) return false;
    return world.sightClear(v, p);
  };
}
// What an attack order would do with the current selection: a takedown by the listed operatives, a volley that kills
// silently, one that leaves the hostile alive and raises the alarm, or (during the alarm) just a volley.
// With suppressed rifles, a volley that leaves the hostile alive can turn it suspicious instead of raising the alarm.
export type AttackPreview = { outcome: 'takedown' | 'kill' | 'suspicious' | 'alert' | 'volley'; takedown: string[]; damage: number; hp: number; short: number };
