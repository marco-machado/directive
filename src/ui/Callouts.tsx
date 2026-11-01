import { useEffect, useRef, useState } from 'react';
import { REINFORCE_CAP } from '../game/simulation.ts';
import type { Snapshot } from '../game/simulation.ts';
import { CONTRACTS } from './common.tsx';
import { play, stinger } from './audio.ts';
import type { Cue } from './audio.ts';
import { enqueue, SHOW_MS } from './calloutQueue.ts';
import type { Callout, CalloutPart, Tone } from './calloutQueue.ts';

// Turns snapshot changes into callouts docked under the status pill, and their cues.
export function useCallouts(state: Snapshot) {
  const [queue, setQueue] = useState<Callout[]>([]);
  const previous = useRef(state), next = useRef(0);
  useEffect(() => {
    const p = previous.current; previous.current = state;
    if (p === state) return;
    const add = (tone: Tone, part: CalloutPart, cue: Cue) => { const now = performance.now(), id = next.current++; setQueue(list => enqueue(list, id, tone, part, now)); play(cue); };
    const restarted = p.phase === 'mission' && state.phase === 'mission' && state.time < p.time;
    if (state.phase === 'mission' && state.contract && (p.phase !== 'mission' || restarted)) {
      setQueue([]);
      add('info', { title: CONTRACTS[state.contract.type].title, detail: `${state.contract.district} · Tier ${state.contract.tier}` }, 'deploy');
      return;
    }
    if (p.phase === 'mission' && state.phase === 'headquarters') { setQueue([]); stinger(state.result === 'success' ? 'success' : 'failure'); return; }
    if (p.phase !== 'mission' || state.phase !== 'mission') return;
    if (state.pending && !p.pending) play('aim');
    if (state.alarm && !p.alarm) add('danger', { title: 'Alarm', detail: state.reinforced >= REINFORCE_CAP ? 'no more reinforcements' : `reinforcements in ${Math.ceil(state.reinforceIn)} s` }, 'alarm');
    if (!state.alarm && p.alarm) add('good', { title: 'Alarm cleared', detail: 'stealth bonus lost' }, 'objective');
    state.objectives.forEach((o, i) => {
      if (!o.done || p.objectives[i]?.done || o.kind === 'extract') return;
      add('objective', { title: 'Objective complete', detail: o.label }, 'objective');
    });
    if (state.reinforced > p.reinforced) add('danger', { title: 'Reinforcements', detail: `${state.reinforced} / ${REINFORCE_CAP} entering` }, 'reinforce');
    for (const u of state.units) {
      const before = u.faction === 'squad' ? p.units.find(v => v.id === u.id) : undefined;
      if (!before) continue;
      if (before.hp > 0 && u.hp <= 0) add('danger', { title: `${u.name} down`, detail: 'click the body to revive' }, 'down');
      else if (before.hp <= 0 && u.hp > 0) add('good', { title: `${u.name} revived` }, 'revive');
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
      {callout.parts.map((part, i) => <span key={i}><strong>{part.title}</strong>{part.detail ? <> · {part.detail}</> : null}</span>)}
    </div>
  </div>;
}
