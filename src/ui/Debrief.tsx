import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import type { ClassId } from '../game/classes.ts';
import { HOSTILE_STATS } from '../game/simulation.ts';
import type { AlarmCause, Snapshot, Unit } from '../game/simulation.ts';
import { Clearance, clock, CONTRACTS, Credits, SaveCode, SaveWarning, threat } from './common.tsx';
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

// "SECURITY spotted VEX near Charge A · 00:50"
function alarmLine(cause: AlarmCause) {
  const who = cause.hostile ? HOSTILE_STATS[cause.hostile].name : 'A hostile', op = cause.operative;
  const what = cause.trigger === 'grenade' ? `${op ? `${op}'s` : 'A'} grenade went off`
    : cause.trigger === 'takedown' ? `${who} saw ${op ? `${op}'s` : 'a'} takedown`
    : cause.trigger === 'gunfire' ? `${who} survived ${op ? `a hit from ${op}` : 'a hit'}`
    : op ? `${who} spotted ${op}` : 'The alarm sounded';
  return `${what} near ${cause.near}`;
}

// A plan of the district (x to the right, z down) with the objectives and a pin where the first alarm was raised.
function AlarmMap({ state, cause }: { state: Snapshot; cause: AlarmCause }) {
  const world = state.plan!.world, { minX, maxX, minZ, maxZ } = world.bounds;
  return <svg className="alarm-map" viewBox={`${minX} ${minZ} ${maxX - minX} ${maxZ - minZ}`} role="img" aria-label={`District map, alarm pinned ${alarmLine(cause)}`}>
    <rect className="alarm-map-ground" x={minX} y={minZ} width={maxX - minX} height={maxZ - minZ} />
    {world.buildings.map((b, i) => <rect key={i} className="alarm-map-block" x={b.x - b.w / 2} y={b.z - b.d / 2} width={b.w} height={b.d} />)}
    {state.objectives.map((o, i) => o.kind === 'extract'
      ? <circle key={i} className="alarm-map-extract" cx={o.x} cy={o.z} r={1.4} />
      : <rect key={i} className="alarm-map-objective" x={o.x - .9} y={o.z - .9} width={1.8} height={1.8} transform={`rotate(45 ${o.x} ${o.z})`} />)}
    <circle className="alarm-map-ring" cx={cause.x} cy={cause.z} r={3} />
    <circle className="alarm-map-pin" cx={cause.x} cy={cause.z} r={1.1} />
  </svg>;
}

function AlarmReport({ state, cause }: { state: Snapshot; cause: AlarmCause }) {
  return <section className="alarm-report" aria-label="Alarm report">
    {state.plan ? <AlarmMap state={state} cause={cause} /> : null}
    <div className="alarm-copy">
      <small>Alarm raised</small>
      <strong>{alarmLine(cause)}</strong>
      <span className="alarm-time"><Icon name="clock" />{clock(cause.at)}</span>
    </div>
  </section>;
}

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
      <div className={`debrief-intel${state.alarmCause ? '' : ' single'}`}>
        {state.alarmCause ? <AlarmReport state={state} cause={state.alarmCause} /> : null}
        <Clearance campaign={state.campaign} justCompleted={success} />
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
