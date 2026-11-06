import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import type { ClassId } from '../game/classes.ts';
import { badgesFor, MAX_COUNTERMEASURES, noKillShare, parSeconds } from '../game/campaign.ts';
import { countsAsKill, HOSTILE_STATS, isReinforcement } from '../game/simulation.ts';
import type { AlarmCause, Snapshot, Unit } from '../game/simulation.ts';
import { BADGE_COPY, Clearance, clock, CM_LEVEL, CONTRACTS, Credits, earnedLines, SaveCode, SaveWarning, threat } from './common.tsx';
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
    {state.objectives.map((o, i) => o.kind === 'sweep' ? null : o.kind === 'extract'
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

// Each badge, lit when the contract earned it; a missed one says why.
function Badges({ state }: { state: Snapshot }) {
  const c = state.contract!, hostiles = state.units.filter(u => u.faction === 'hostile'), district = hostiles.filter(u => !isReinforcement(u));
  const missed = {
    ghost: 'Alarm raised', untouched: `${state.downs} down`, swift: `${clock(state.time)} / ${clock(parSeconds(c.type, c.tier))}`,
    bloodless: `${hostiles.filter(u => u.hp <= 0 && countsAsKill(u, c.type)).length} killed`, purge: `${district.filter(u => u.hp <= 0).length} of ${district.length} down`,
  };
  return <ul className="badge-grid debrief-badges" aria-label="Badges">{badgesFor(c.type).map(b => {
    const won = state.badges.includes(b);
    return <li key={b} className={won ? '' : 'missed'}><Icon name={BADGE_COPY[b].icon} /><b>{BADGE_COPY[b].title}</b><small>{won ? 'Earned' : missed[b]}</small></li>;
  })}</ul>;
}

// How a won contract on a Countermeasures level moved the ladder.
function countermeasuresResult(state: Snapshot) {
  const level = state.countermeasures, name = `Countermeasures ${CM_LEVEL[level]}`;
  if (!state.badges.length || state.campaign.countermeasures < level) return `${name} won, but no new level opens: that takes a badge on the highest open level.`;
  return level < MAX_COUNTERMEASURES ? `${name} cleared: level ${CM_LEVEL[level + 1]} is open.` : `${name} cleared: the top of the ladder.`;
}

export function Debrief({ state, saveCode, titleRef, onBoard, onHeadquarters }: { state: Snapshot; saveCode: string | null; titleRef: RefObject<HTMLHeadingElement | null>; onBoard: () => void; onHeadquarters: () => void }) {
  const success = state.result === 'success', c = state.contract;
  const kills = state.units.filter(u => u.faction === 'hostile' && u.hp <= 0).length;
  const squad = state.squad.map(id => state.units.find(u => u.id === id)).filter((u): u is Unit => !!u);
  // A no-kill clause cuts the fee before the stealth bonus is added.
  const slain = state.units.filter(u => u.faction === 'hostile' && u.hp <= 0 && countsAsKill(u, c?.type)).length, cut = success && c ? c.payout - Math.round(c.payout * noKillShare(c, slain)) : 0;
  const extra = success ? state.reward.credits : 0, fee = success && c ? c.payout : 0, bonus = success ? state.payout - fee + cut : 0, total = useCountUp(success ? state.payout + extra : 0);
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
          {cut ? <div className="void"><dt>No-kill clause</dt><dd>−<Credits value={cut} /></dd></div> : null}
          <div className={bonus ? 'bonus' : 'void'}><dt>Stealth bonus</dt><dd>{bonus ? <>+<Credits value={bonus} /></> : state.stealth ? '—' : 'Alarm raised'}</dd></div>
          {extra ? <div className="bonus"><dt>Rewards</dt><dd>+<Credits value={extra} /></dd></div> : null}
          <div className="total"><dt>Payout</dt><dd><span aria-hidden="true">+<Credits value={total} /></span><span className="sr-only">₡ {success ? state.payout + extra : 0}</span></dd></div>
          <div className="funds-row"><dt>Funds</dt><dd><Credits value={state.campaign.cash} /></dd></div>
        </dl>
        <ul className="debrief-squad" aria-label="Squad">{squad.map(u => <li key={u.id} className={`cls-${u.kind as ClassId}${u.hp <= 0 ? ' down' : ''}`}>
          <Portrait cls={u.kind as ClassId} /><span><strong>{u.name}</strong><small>{u.hp <= 0 ? 'Down' : `${Math.ceil(u.hp)} / ${u.maxHp} HP`}</small></span>
        </li>)}</ul>
      </div>
      {success ? <Badges state={state} /> : <p className="debrief-note">No badges on a lost contract.</p>}
      {success ? earnedLines(state.reward).map(l => <p key={l} className="debrief-note">{l}</p>) : null}
      {success && state.countermeasures ? <p className="debrief-note cm">{countermeasuresResult(state)}</p> : null}
      <div className={`debrief-intel${state.alarmCause ? '' : ' single'}`}>
        {state.alarmCause ? <AlarmReport state={state} cause={state.alarmCause} /> : null}
        <Clearance campaign={state.campaign} earned={success ? state.badges : null} />
      </div>
      <div className="debrief-actions">
        <button className="btn primary" onClick={onBoard}><span>Next contract</span><Icon name="arrow" /></button>
        <button className="btn" onClick={onHeadquarters}><Icon name="recruit" /><span>Headquarters</span></button>
      </div>
      {state.saveUnavailable ? <SaveWarning /> : null}
      {saveCode ? <SaveCode code={saveCode} /> : null}
    </div>
  </section>;
}
