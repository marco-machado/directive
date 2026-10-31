import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import type { ClassId } from '../game/classes.ts';
import type { Snapshot, Unit } from '../game/simulation.ts';
import { clock, CONTRACTS, Credits, SaveCode, SaveWarning, threat } from './common.tsx';
import { Icon, Portrait } from './icons.tsx';
import type { IconName } from './icons.tsx';

// Counts up to the payout once; reduced motion shows the final value at once.
function useCountUp(target: number) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setValue(target); return; }
    let frame = 0; const start = performance.now();
    const tick = (now: number) => { const k = Math.min(1, (now - start) / 900); setValue(Math.round(target * (1 - (1 - k) ** 3))); if (k < 1) frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return value;
}

const Stat = ({ icon, label, value, tone = '' }: { icon: IconName; label: string; value: string; tone?: string }) =>
  <div className={`stat ${tone}`}><Icon name={icon} /><small>{label}</small><strong>{value}</strong></div>;

export function Debrief({ state, saveCode, titleRef, onBoard, onHeadquarters }: { state: Snapshot; saveCode: string | null; titleRef: RefObject<HTMLHeadingElement | null>; onBoard: () => void; onHeadquarters: () => void }) {
  const success = state.result === 'success', c = state.contract;
  const kills = state.units.filter(u => u.faction === 'hostile' && u.hp <= 0).length;
  const squad = state.squad.map(id => state.units.find(u => u.id === id)).filter((u): u is Unit => !!u);
  const fee = success && c ? c.payout : 0, bonus = success ? state.payout - fee : 0, total = useCountUp(success ? state.payout : 0);
  return <section className={`debrief ${success ? 'success' : 'failure'}`} aria-labelledby="ops-title">
    <div className="debrief-card panel">
      <p className="debrief-stamp"><Icon name={success ? 'check' : 'alert'} />{success ? 'Contract complete' : 'Mission failed'}</p>
      <h2 id="ops-title" ref={titleRef} tabIndex={-1}>{success ? 'Business is good.' : 'Recover. Refit.'}</h2>
      {c ? <p className="debrief-contract" style={threat(c.tier)}><Icon name={c.type} />{CONTRACTS[c.type].title} · Tier {c.tier} · {state.plan?.label}</p> : null}
      {success ? null : <p className="debrief-reason">{state.failReason} The contract is lost; purchased upgrades are kept.</p>}
      <div className="debrief-grid">
        <div className="stats">
          <Stat icon="clock" label="Mission time" value={clock(state.time)} />
          <Stat icon="kills" label="Hostiles down" value={String(kills)} />
          <Stat icon={state.stealth ? 'eye' : 'alert'} label="Detection" value={state.stealth ? 'Undetected' : 'Alarm raised'} tone={state.stealth ? 'good' : 'bad'} />
        </div>
        <dl className="ledger">
          <div><dt>Contract fee</dt><dd>{success ? <Credits value={fee} /> : 'Forfeit'}</dd></div>
          <div className={bonus ? 'bonus' : 'void'}><dt>Stealth bonus</dt><dd>{bonus ? <>+<Credits value={bonus} /></> : state.stealth ? '—' : 'Alarm raised'}</dd></div>
          <div className="total"><dt>Payout</dt><dd><span aria-hidden="true">+<Credits value={total} /></span><span className="sr-only">₡ {success ? state.payout : 0}</span></dd></div>
          <div className="funds-row"><dt>Funds</dt><dd><Credits value={state.campaign.cash} /></dd></div>
        </dl>
      </div>
      <ul className="debrief-squad" aria-label="Squad">{squad.map(u => <li key={u.id} className={`cls-${u.kind as ClassId}${u.hp <= 0 ? ' down' : ''}`}>
        <Portrait cls={u.kind as ClassId} /><span><strong>{u.name}</strong><small>{u.hp <= 0 ? 'Down' : `${Math.ceil(u.hp)} / ${u.maxHp} HP`}</small></span>
      </li>)}</ul>
      <div className="debrief-actions">
        <button className="btn primary" onClick={onBoard}><span>Next contract</span><Icon name="arrow" /></button>
        <button className="btn" onClick={onHeadquarters}><Icon name="recruit" /><span>Headquarters</span></button>
      </div>
      {state.saveUnavailable ? <SaveWarning /> : null}
      {saveCode ? <SaveCode code={saveCode} /> : null}
    </div>
  </section>;
}
