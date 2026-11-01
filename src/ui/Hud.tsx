import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent } from 'react';
import { sim } from '../app.ts';
import { missionPayout } from '../game/campaign.ts';
import type { Campaign } from '../game/campaign.ts';
import { abilityCooldown, ABILITY_STATS, CLASS_STATS } from '../game/classes.ts';
import type { ClassId } from '../game/classes.ts';
import { SUSPICIOUS } from '../game/simulation.ts';
import type { Pending, Shield, Snapshot, Unit } from '../game/simulation.ts';
import { clock, CONTRACTS, Credits, threat } from './common.tsx';
import { Icon, Portrait } from './icons.tsx';
import { play } from './audio.ts';

function Tracker({ state }: { state: Snapshot }) {
  const c = state.contract!, current = state.objectives.findIndex(o => !o.done);
  const extractOpen = state.objectives.every(o => o.kind === 'extract' || o.done), team = state.squad.length;
  return <section className="tracker panel" aria-label="Mission status" style={threat(c.tier)}>
    <header className="tracker-head">
      <span className="tracker-icon"><Icon name={c.type} /></span>
      <span className="tracker-title"><strong>{CONTRACTS[c.type].title}</strong><small>{c.district}</small></span>
      <span className="tier-badge">T{c.tier}</span>
    </header>
    <ol className="objectives">{state.objectives.map((o, i) => {
      const timed = (o.kind === 'terminal' || o.kind === 'charge' || o.kind === 'vip' || (o.kind === 'extract' && extractOpen)) && !o.done;
      return <li key={i} className={o.done ? 'done' : i === current ? 'current' : ''}>
        <span className="obj-mark">{o.done ? <Icon name="check" /> : null}</span>
        <span className="obj-copy">{o.label}{timed ? <span className="obj-progress" role="progressbar" aria-label={`${o.label} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(o.progress * 100)}>
          <b style={{ width: `${o.progress * 100}%` }} /></span> : null}</span>
        {timed ? <span className="obj-pct">{o.kind === 'extract' ? `${Math.round(o.progress * team)}/${team}` : `${Math.round(o.progress * 100)}%`}</span> : null}
      </li>;
    })}</ol>
    <footer className="tracker-pay">
      <span><small>Payout</small><strong><Credits value={c.payout} /></strong></span>
      <span className={state.stealth ? 'bonus' : 'lost'}><small>{state.stealth ? 'Stealth bonus' : 'Bonus lost'}</small><strong>+<Credits value={missionPayout(c, true) - c.payout} /></strong></span>
    </footer>
  </section>;
}

// Two clicks or taps on a card within this many ms focus the view on that operative.
const DOUBLE_TAP_MS = 450;
function SquadCard({ unit, slot, selected, campaign, pending, cover, onFocusSelection }: { unit: Unit; slot: number; selected: boolean; campaign: Campaign; pending: Pending; cover: Shield; onFocusSelection: () => void }) {
  const cls = unit.kind as ClassId, ability = unit.ability ?? CLASS_STATS[cls].ability, name = ABILITY_STATS[ability].name;
  const max = abilityCooldown(ability, campaign.abilities[cls]), down = unit.hp <= 0, ready = unit.abilityCd <= 0, aiming = pending?.unitId === unit.id;
  const health = unit.hp / unit.maxHp, hit = !down && unit.hurt > 1.1, lastTap = useRef(-Infinity);
  // Timed by hand: touch browsers don't all report a double tap as dblclick.
  const pick = (e: MouseEvent<HTMLButtonElement>) => {
    play('select'); sim.select(unit.id, e.shiftKey);
    if (e.timeStamp - lastTap.current < DOUBLE_TAP_MS) { lastTap.current = -Infinity; onFocusSelection(); } else lastTap.current = e.timeStamp;
  };
  return <div className={`agent cls-${cls}${selected ? ' selected' : ''}${down ? ' down' : ''}${hit ? ' hit' : ''}${down ? '' : health <= .3 ? ' critical' : health <= .55 ? ' wounded' : ''}`}>
    <button className="agent-select" data-cue="own" disabled={down} aria-pressed={selected} aria-keyshortcuts={String(slot + 1)} title="Double-click to focus the view" onClick={pick}>
      <span className="agent-portrait"><Portrait cls={cls} /><kbd>{slot + 1}</kbd></span>
      <span className="agent-copy">
        <span className="agent-name"><b>{unit.name}</b><small>{CLASS_STATS[cls].title}</small></span>
        <span className="hp" style={{ '--hp': health } as CSSProperties}><i /></span>
        <span className="hp-text">{down ? <b className="down-text">Down</b> : <><span><b>{Math.ceil(unit.hp)}</b> / {unit.maxHp}</span>
          {cover ? <span className={`cover-badge ${cover}`} role="img" aria-label={cover === 'covered' ? 'In cover' : 'Flanked'} title={cover === 'covered' ? 'In cover: incoming fire halved' : 'Flanked: a hostile has a clear shot'}><Icon name="cover" /></span> : null}</>}</span>
      </span>
    </button>
    {down ? <p className="agent-down">Select a teammate, click the body to revive</p>
      : <button className={`ability${ready ? ' ready' : ''}${aiming ? ' aiming' : ''}`} style={{ '--cd': ready ? 0 : unit.abilityCd / max } as CSSProperties} aria-keyshortcuts={`Shift+${slot + 1}`}
        title={`${name} [Shift+${slot + 1}]`} aria-label={`${name}: ${aiming ? 'choose a target' : ready ? 'ready' : `recharging, ${Math.ceil(unit.abilityCd)} seconds`}`}
        onClick={() => { if (aiming) sim.cancelAbility(); else sim.ability(slot); }}>
        <Icon name={ability} /><span className="ability-state">{aiming ? 'Aim' : ready ? 'Ready' : Math.ceil(unit.abilityCd)}</span>
      </button>}
  </div>;
}

// The last few orders and reports, newest at the bottom. A restart (the clock running back) starts a fresh log.
function Comms({ state }: { state: Snapshot }) {
  const [log, setLog] = useState<{ id: number; text: string; at: number }[]>([]), next = useRef(0), last = useRef({ text: '', at: 0 });
  useEffect(() => {
    const restarted = state.time < last.current.at;
    if (!restarted && last.current.text === state.message) { last.current.at = state.time; return; }
    last.current = { text: state.message, at: state.time };
    setLog(list => [...(restarted ? [] : list.slice(-3)), { id: next.current++, text: state.message, at: state.time }]);
  }, [state.message, state.time]);
  return <ol className="comms" aria-label="Comms">{log.map(m => <li key={m.id} className={m.text.startsWith('ALARM') ? 'danger' : ''}><time>{clock(m.at)}</time><span>{m.text}</span></li>)}</ol>;
}

function Targeting({ pending }: { pending: NonNullable<Pending> }) {
  const stats = ABILITY_STATS[pending.ability];
  return <div className={`targeting ab-${pending.ability}`}>
    <Icon name={pending.ability} />
    <span><strong>{stats.name}</strong><small>{pending.ability === 'snipe' ? `Click a visible hostile within ${stats.reach} m` : `Click a point within ${stats.reach} m`} · <kbd>Esc</kbd> cancels</small></span>
    <button className="btn ghost small" onClick={() => sim.cancelAbility()}>Cancel</button>
  </div>;
}

// Who is noticing the squad before the alarm: the hostile closest to raising it, by name, with its detection.
// Its marker sits over it on the map, or an edge arrow points to it when it is off screen.
const WATCHER: Partial<Record<Unit['kind'], string>> = { guard: 'Guard', heavy: 'Heavy', camera: 'Camera', turret: 'Turret', target: 'Target' };
function Spotted({ state }: { state: Snapshot }) {
  const watchers = state.alarm ? [] : state.units.filter(u => u.faction === 'hostile' && u.hp > 0 && u.visible && u.detect > 0).sort((a, b) => b.detect - a.detect);
  const top = watchers[0];
  if (!top) return null;
  const suspicious = top.detect > SUSPICIOUS, percent = Math.round(top.detect * 100);
  return <div className={`spotted${suspicious ? ' suspicious' : ''}`}>
    <Icon name="eye" />
    <span className="spotted-copy"><strong>Being spotted</strong>
      <small>{WATCHER[top.kind]} · {suspicious ? 'suspicious' : 'noticing'}{watchers.length > 1 ? ` · +${watchers.length - 1} more` : ''}</small></span>
    <span className="spotted-meter" role="meter" aria-label={`${WATCHER[top.kind]} detection`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><i style={{ width: `${percent}%` }} /></span>
  </div>;
}

export function Hud({ state, overview, onFocusSelection, onToggleOverview }: { state: Snapshot; overview: boolean; onFocusSelection: () => void; onToggleOverview: () => void }) {
  return <>
    <aside className="hud-left"><Tracker state={state} /><Comms state={state} /></aside>
    <Spotted state={state} />
    {state.pending ? <Targeting pending={state.pending} /> : null}
    {state.paused ? <div className="pause-banner"><Icon name="pause" /><span><strong>Tactical pause</strong><small>Orders queue while paused</small></span>
      <button className="btn small" onClick={sim.togglePause}><Icon name="play" />Resume <kbd>Space</kbd></button></div> : null}
    <p className="sr-only" role="status">{state.message}</p>
    <footer className="hud-bottom">
      <section className="squad" aria-label="Squad selection">{state.squad.map((id, i) => {
        const u = state.units.find(v => v.id === id);
        return u ? <SquadCard key={id} unit={u} slot={i} selected={state.selected.includes(id)} campaign={state.campaign} pending={state.pending} cover={state.cover[id] ?? null} onFocusSelection={onFocusSelection} /> : null;
      })}</section>
      <div className="commands" role="group" aria-label="Orders">
        <button className="cmd" onClick={sim.hold} aria-keyshortcuts="S"><Icon name="hold" /><span>Hold</span><kbd>S</kbd></button>
        <button className="cmd" onClick={sim.selectAll} aria-keyshortcuts="A"><Icon name="squad" /><span>All</span><kbd>A</kbd></button>
        <button className="cmd" onClick={onFocusSelection} aria-keyshortcuts="F" aria-label="Focus view on the selection"><Icon name="recenter" /><span>View</span><kbd>F</kbd></button>
        <button className="cmd" onClick={onToggleOverview} aria-keyshortcuts="R" aria-pressed={overview} aria-label="District overview"><Icon name="overview" /><span>Overview</span><kbd>R</kbd></button>
      </div>
      {state.campaign.completed ? null : <p className="controls-hint" aria-hidden="true">Click street: move · click hostile: takedown or volley · <kbd>1</kbd>–<kbd>4</kbd> select · <kbd>Shift</kbd>+<kbd>1</kbd>–<kbd>4</kbd> ability · <kbd>Space</kbd> pause</p>}
    </footer>
  </>;
}
