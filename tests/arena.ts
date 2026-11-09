// Helpers the simulation tests share: contracts and campaigns to deploy, and an open arena to check one rule at a time.
import { Simulation, REINFORCE_CAP } from '../src/game/simulation.ts';
import type { CampaignSync, Unit, Upgrade } from '../src/game/simulation.ts';
import { contractPayout, freshCampaign } from '../src/game/campaign.ts';
import type { Campaign, ContractType } from '../src/game/campaign.ts';
import type { EnemyKind } from '../src/game/mapgen.ts';
import { mulberry32 } from '../src/game/rng.ts';
import { World } from '../src/game/world.ts';
import type { Point } from '../src/game/world.ts';
import { raiseAlarm } from '../src/game/alarm.ts';

export const recorder = () => {
  const events: string[] = [];
  const sync: CampaignSync = {
    deployed: (id, squad) => events.push(`deployed:${id}:${squad.join(',')}`), completed: r => events.push(`completed:${r.stealth}`),
    bought: (t: Upgrade) => events.push(`bought:${t}`), equipped: l => events.push(`equipped:${l.weapon}/${l.armor}`), recruited: id => events.push(`recruited:${id}`), dismissed: id => events.push(`dismissed:${id}`),
    picked: squad => events.push(`picked:${squad.join(',')}`),
  };
  return { events, sync };
};

export const contract = (type: ContractType, tier = 1, seed = 1234) => ({ id: `c-${type}`, type, tier, seed, payout: contractPayout(tier), district: 'GLASS DISTRICT', sector: 4 });

export const campaignWith = (type: ContractType, extra: Partial<Campaign> = {}): Campaign => ({ ...freshCampaign(mulberry32(7)), offers: [contract(type)], ...extra });

export const step = (sim: Simulation, seconds: number, until?: () => boolean) => {
  for (let i = 0; i < seconds * 60 && sim.phase === 'mission' && !until?.(); i++) sim.update(1 / 60);
};

// An open, building-free arena so each rule can be checked in isolation.
export function arena(type: ContractType = 'heist', extra: Partial<Campaign> = {}, sync?: CampaignSync, countermeasures = 0) {
  const sim = new Simulation(campaignWith(type, extra), sync);
  sim.chooseCountermeasures(countermeasures);
  sim.deploy();
  const world = new World({ minX: -20, maxX: 20, minZ: -20, maxZ: 20 }, [], []);
  sim.plan = { ...sim.plan!, world, extract: { x: -18, z: -18 }, exits: [{ x: 19, z: 0 }] };
  const extract = sim.objectives.at(-1)!; extract.x = -18; extract.z = -18;
  const squad = sim.units.filter(u => u.faction === 'squad');
  squad.forEach((u, i) => { u.x = i; u.z = 0; u.path = []; });
  sim.units = [...squad, ...sim.units.filter(u => u.faction === 'vip')];
  const hostile = (kind: EnemyKind, x: number, z: number, heading = 0, hp = 75): Unit => {
    const u: Unit = { ...squad[0], id: `t-${sim.units.length}`, name: kind.toUpperCase(), kind, faction: 'hostile', x, z, heading, sweep: heading, hp, maxHp: hp, ability: null, cooldown: 0, path: [], route: [], patrol: [], targetId: null, visible: true };
    sim.units.push(u); return u;
  };
  return { sim, squad, hostile, world };
}

// A barrier lying across the street north of the squad: from z < 5 it shelters whoever crouches at z ≈ 6.
export const BARRIER = { x: 0, z: 5.3, w: 1.6, d: .45 };

export const withBarrier = (sim: Simulation) => { sim.plan = { ...sim.plan!, world: new World(sim.plan!.world.bounds, [], [BARRIER]) }; };

// ---- Alarm stand-down ----
// An alarm with no reinforcement waves left, so only the units a test places can keep contact.
export function alarmed(type: ContractType = 'heist', extra: Partial<Campaign> = {}, sync?: CampaignSync, countermeasures = 0) {
  const a = arena(type, extra, sync, countermeasures);
  a.sim.reinforced = REINFORCE_CAP;
  return { ...a, raise: (at: Point = { x: 0, z: 0 }) => raiseAlarm(a.sim, at, 'test') };
}

// A full squad of four, one of each class.
export const FOUR: Partial<Campaign> = { roster: [{ id: 'vex', name: 'VEX', cls: 'assault' }, { id: 'rook', name: 'ROOK', cls: 'support' }, { id: 'kai', name: 'KAI', cls: 'recon' }, { id: 'nova', name: 'NOVA', cls: 'tech' }] };
