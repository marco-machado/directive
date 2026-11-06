// The bots scripts/balance.ts runs, and what a bot may know about a mission.
import type { Campaign, Contract } from '../src/game/campaign.ts';
import type { AbilityId, ClassId } from '../src/game/classes.ts';
import type { Area, EnemyKind } from '../src/game/mapgen.ts';
import { apparentHealth, GHOST_SECONDS, isReinforcement } from '../src/game/simulation.ts';
import type { Objective, Pending, Simulation, Unit } from '../src/game/simulation.ts';
import { distance } from '../src/game/world.ts';
import type { Point, World } from '../src/game/world.ts';

// A bot is made for one mission and called every THINK seconds of mission time.
export type Bot = (sim: Simulation, options: { quietOnly: boolean }) => () => void;

// ---- No tactics ----
// Select all, click the objective, then extraction; revive the downed; no abilities. It reads the simulation directly
// (it walks to the target's true position), as it always has, so its numbers stay comparable with older runs.
export const noTactics: Bot = sim => {
  let order = '', point: Point | null = null;
  const squad = () => sim.units.filter(u => u.faction === 'squad');
  const go = (key: string, p: Point) => { order = key; point = { x: p.x, z: p.z }; sim.selectAll(); sim.move(p); };
  return () => {
    const living = squad().filter(u => u.hp > 0), idle = living.every(u => !u.path.length && !u.targetId && !u.takedownId && !u.reviveTarget);
    const down = squad().find(u => u.hp <= 0);
    const goal = sim.objectives.find(o => !o.done)!;
    // A downed operative is revived before anything else; a move order would cancel the revive.
    if (down) { if (!living.some(u => u.reviveTarget)) { sim.selectAll(); sim.revive(down.id); order = ''; } }
    else if (goal.kind === 'target' || goal.kind === 'sweep') {
      // Elimination: the nearest of the district's own hostiles still standing.
      const lead = living[0], left = sim.units.filter(u => u.faction === 'hostile' && u.hp > 0 && !isReinforcement(u));
      const target = goal.kind === 'target' ? sim.units.find(u => u.kind === 'target') as Unit : left.sort((a, b) => distance(a, lead) - distance(b, lead))[0];
      if (!target) return;
      if (target.visible) { if (order !== 'attack' || idle) { order = 'attack'; sim.selectAll(); sim.attack(target.id); } }
      else if (order !== 'hunt' || idle || distance(point!, target) > 3) go('hunt', target);
    } else {
      const p = goal.kind === 'vip' ? sim.units.find(u => u.faction === 'vip')! : goal;
      const key = `${goal.kind}:${goal.label}`;
      // A player clicks again when the squad has stopped short of the objective.
      if (order !== key || (idle && living.some(u => distance(u, p) > 2))) go(key, p);
    }
  };
};

// ---- What a tactical bot may know ----
// Only what the player can see: hostiles in sight, the ones it remembers seeing (a moving one only while its last-seen
// marker lasts), patrol routes from intel, the objectives and the briefing's target area. Never the plan's enemy list,
// the exits, look-around timers or anything private.
export type Seen = {
  id: string; kind: EnemyKind; x: number; z: number; heading: number; sweep: number; hp: number; maxHp: number;
  detect: number; stunned: number; held: number; visible: boolean; at: number;
  // The route as far as the squad knows: the intel route once watched, else (for a hostile seen walking) its position twice.
  patrol: Point[];
};
export type Op = {
  id: string; slot: number; name: string; cls: ClassId; ability: AbilityId | null; level: number; x: number; z: number; hp: number; maxHp: number;
  abilityCd: number; route: Point[]; targetId: string | null; takedownId: string | null; reviveTarget: string | null;
};
export type Knowledge = {
  time: number; alarm: boolean; detected: boolean; world: World; contract: Contract; campaign: Campaign; extract: Point; kills: number;
  squad: Op[]; hostiles: Seen[]; objectives: Objective[]; targetArea: Area | null; vip: (Point & { joined: boolean }) | null; pending: Pending;
};
// The orders a player can give, and the hover preview of an attack.
export type Orders = Pick<Simulation, 'select' | 'selectAll' | 'move' | 'addWait' | 'hold' | 'attack' | 'attackPreview' | 'revive' | 'ability' | 'unitClick' | 'groundClick' | 'cancelAbility'>;

const isHostile = (u: Unit) => u.faction === 'hostile';
// Builds a mission's Knowledge each think, remembering what the squad has seen.
export function observer(sim: Simulation): () => Knowledge {
  const known = new Map<string, Seen>(), dead = new Set<string>();
  let last = sim.time;
  return () => {
    const dt = sim.time - last; last = sim.time;
    for (const u of sim.units) {
      if (!isHostile(u)) continue;
      if (u.visible) {
        if (u.hp <= 0) { known.delete(u.id); dead.add(u.id); continue; }
        const walks = u.patrol.length >= 2 || u.hunting || u.moving, health = apparentHealth(u, sim.plan!.contract.tier);
        known.set(u.id, {
          id: u.id, kind: (u.guise ?? u.kind) as EnemyKind, x: u.x, z: u.z, heading: u.heading, sweep: u.sweep, hp: health.hp, maxHp: health.maxHp,
          detect: u.detect, stunned: u.stunned, held: u.held, visible: true, at: sim.time,
          patrol: sim.intel.get(u.id) ?? (walks ? [{ x: u.x, z: u.z }, { x: u.x, z: u.z }] : []),
        });
      } else {
        const s = known.get(u.id); if (!s) continue;
        s.visible = false;
        // A stun seen wears off on the mission clock, out of sight as in it.
        s.stunned = Math.max(0, s.stunned - dt);
        // A hostile that walks is only where its last-seen marker says while the marker lasts.
        if (s.patrol.length >= 2 && sim.time - s.at >= GHOST_SECONDS) known.delete(u.id);
      }
    }
    const plan = sim.plan!, vip = sim.units.find(u => u.faction === 'vip');
    const squad = sim.squad.map((id, slot): Op => {
      const u = sim.units.find(v => v.id === id)!, op = sim.campaign.roster.find(o => o.id === id)!;
      return {
        id, slot, name: u.name, cls: op.cls, ability: u.ability, level: sim.campaign.abilities[op.cls], x: u.x, z: u.z, hp: u.hp, maxHp: u.maxHp, abilityCd: u.abilityCd,
        route: [...u.path, ...u.route.flatMap(l => l.path)], targetId: u.targetId, takedownId: u.takedownId, reviveTarget: u.reviveTarget,
      };
    });
    return {
      time: sim.time, alarm: sim.alarm, detected: sim.detected, world: plan.world, contract: plan.contract, campaign: sim.campaign, extract: plan.extract, kills: dead.size,
      squad, hostiles: [...known.values()], objectives: sim.objectives, targetArea: sim.targetArea, pending: sim.pending,
      vip: vip ? { x: vip.x, z: vip.z, joined: sim.objectives.some(o => o.kind === 'vip' && o.done) } : null,
    };
  };
}
