import { useEffect, useRef, useState } from 'react';
import { REINFORCE_CAP } from '../game/simulation.ts';
import type { Snapshot } from '../game/simulation.ts';
import { CONTRACTS } from './common.tsx';
import { play, stinger } from './audio.ts';
import type { Cue } from './audio.ts';

type Callout = { id: number; tone: 'info' | 'danger' | 'good' | 'objective'; kicker: string; title: string; detail?: string };
const SHOW_MS = 2600;

// Turns snapshot changes into center-screen callouts and their cues.
export function useCallouts(state: Snapshot) {
  const [queue, setQueue] = useState<Callout[]>([]);
  const previous = useRef(state), next = useRef(0);
  useEffect(() => {
    const p = previous.current; previous.current = state;
    if (p === state) return;
    const add = (c: Omit<Callout, 'id'>, cue: Cue) => { setQueue(list => [...list, { ...c, id: next.current++ }].slice(-4)); play(cue); };
    const restarted = p.phase === 'mission' && state.phase === 'mission' && state.time < p.time;
    if (state.phase === 'mission' && state.contract && (p.phase !== 'mission' || restarted)) {
      setQueue([]);
      add({ tone: 'info', kicker: 'Contract live', title: CONTRACTS[state.contract.type].title, detail: `${state.contract.district} · Tier ${state.contract.tier}` }, 'deploy');
      return;
    }
    if (p.phase === 'mission' && state.phase === 'headquarters') { setQueue([]); stinger(state.result === 'success' ? 'success' : 'failure'); return; }
    if (p.phase !== 'mission' || state.phase !== 'mission') return;
    if (state.pending && !p.pending) play('aim');
    if (state.alarm && !p.alarm) add({ tone: 'danger', kicker: 'Alarm raised', title: 'Weapons free', detail: state.reinforced >= REINFORCE_CAP ? 'No more reinforcements' : `Reinforcements in ${Math.ceil(state.reinforceIn)} s` }, 'alarm');
    if (!state.alarm && p.alarm) add({ tone: 'good', kicker: 'Alarm cleared', title: 'Holding fire', detail: 'Stealth bonus lost' }, 'objective');
    state.objectives.forEach((o, i) => {
      if (!o.done || p.objectives[i]?.done || o.kind === 'extract') return;
      const upcoming = state.objectives.find(n => !n.done);
      add({ tone: 'objective', kicker: 'Objective complete', title: o.label, detail: upcoming ? `Next: ${upcoming.label}` : undefined }, 'objective');
    });
    if (state.reinforced > p.reinforced) add({ tone: 'danger', kicker: 'Reinforcements', title: 'Hostiles entering the district', detail: `${state.reinforced} / ${REINFORCE_CAP}` }, 'reinforce');
    for (const u of state.units) {
      const before = u.faction === 'squad' ? p.units.find(v => v.id === u.id) : undefined;
      if (!before) continue;
      if (before.hp > 0 && u.hp <= 0) add({ tone: 'danger', kicker: 'Operative down', title: u.name, detail: 'Select a teammate and click the body to revive' }, 'down');
      else if (before.hp <= 0 && u.hp > 0) add({ tone: 'good', kicker: 'Revived', title: u.name, detail: 'Back on their feet' }, 'revive');
    }
  }, [state]);
  const head = queue[0]?.id;
  useEffect(() => {
    if (head === undefined) return;
    const timer = setTimeout(() => setQueue(list => list.slice(1)), SHOW_MS);
    return () => clearTimeout(timer);
  }, [head]);
  return queue[0] ?? null;
}

// Visual only; screen readers hear the simulation's messages through the HUD's live region.
export function Callouts({ callout }: { callout: Callout | null }) {
  if (!callout) return null;
  return <div className="callouts" aria-hidden="true">
    <div key={callout.id} className={`callout ${callout.tone}`}>
      <small>{callout.kicker}</small><strong>{callout.title}</strong>{callout.detail ? <span>{callout.detail}</span> : null}
    </div>
  </div>;
}
