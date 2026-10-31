import { Component, StrictMode, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, ErrorInfo, FormEvent, ReactNode, RefObject } from 'react';
import { createRoot } from 'react-dom/client';
import { GameCanvas } from './scene/GameCanvas.tsx';
import { HACK_SECONDS, REINFORCE_CAP, REINFORCE_SECONDS, Simulation } from './game/simulation.ts';
import type { Pending, Snapshot, Unit } from './game/simulation.ts';
import { ABILITY_UPGRADE_COST, GEAR_COST, MAX_LEVEL, MAX_TIER, missionPayout, RECRUIT_COST, ROSTER_CAP, SQUAD_MAX, STEALTH_BONUS } from './game/campaign.ts';
import type { Campaign, ContractType, Operative } from './game/campaign.ts';
import { abilityCooldown, ABILITY_STATS, CLASSES, CLASS_STATS } from './game/classes.ts';
import type { AbilityId, ClassId } from './game/classes.ts';
import { formatSaveCode, normalizeSaveCode } from './game/saveCode.ts';
import { ApiError, CampaignClient, connectPlayer, fetchCampaign, loadLegacyCampaign, rememberSaveCode } from './net/campaignClient.ts';
import './style.css';

const client = new CampaignClient();
const sim = new Simulation(loadLegacyCampaign(), client);
// Module scope so StrictMode's double effects never create two players.
const connection = connectPlayer().then(({ code, campaign }) => { client.attach(sim, code); sim.applyCampaign(campaign); return code; });

const CONTRACTS: Record<ContractType, { title: string; icon: string; brief: string }> = {
  assassination: { title: 'Assassination', icon: '✕', brief: 'Neutralize the target, then extract. Once the alarm sounds, the target runs for an exit.' },
  heist: { title: 'Data heist', icon: '⌗', brief: `Hold the vault terminal for ${HACK_SECONDS} seconds to download the data, then extract.` },
  sabotage: { title: 'Sabotage', icon: '△', brief: 'Plant a charge at every site, then extract.' },
  escort: { title: 'Escort', icon: '◇', brief: 'Reach the VIP and escort them to extraction. The VIP freezes under fire; if they die, the contract fails.' },
};
const ABILITY_ICON: Record<AbilityId, string> = { grenade: '✹', heal: '✚', snipe: '◎', emp: 'ϟ' };
const STEALTH_PERCENT = Math.round(STEALTH_BONUS * 100);
const pad = (n: number) => String(n).padStart(2, '0');
const credits = (n: number) => `₡ ${n.toLocaleString()}`;
const secs = (n: number) => `${Number(n.toFixed(1))} s`;

function SaveCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const pretty = formatSaveCode(code);
  const copy = () => navigator.clipboard.writeText(pretty).then(() => setCopied(true), () => setCopied(false));
  return <div className="save-code"><span>SAVE CODE</span><strong>{pretty}</strong><button className="text-button" onClick={copy}>{copied ? 'COPIED' : 'COPY'}</button></div>;
}

function LoadSaveCode({ onLoaded, busy, setBusy }: { onLoaded: (code: string) => void; busy: boolean; setBusy: (busy: boolean) => void }) {
  const [value, setValue] = useState(''), [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const code = normalizeSaveCode(value);
    if (!code) { setError('Save codes have 12 letters and digits, like 7KQ2-M9XD-4TRB.'); return; }
    setBusy(true); setError('');
    try {
      const campaign = await fetchCampaign(code);
      rememberSaveCode(code); client.attach(sim, code); sim.applyCampaign(campaign); sim.setSaveUnavailable(false);
      setValue(''); onLoaded(code);
    } catch (err) { setError(err instanceof ApiError && err.status === 404 ? 'No campaign uses that code.' : 'Server unreachable. Try again.'); }
    finally { setBusy(false); }
  };
  return <form className="load-code" onSubmit={submit}>
    <label htmlFor="load-code-input">Continue on this device</label>
    <div><input id="load-code-input" value={value} onChange={e => setValue(e.target.value)} placeholder="XXXX-XXXX-XXXX" autoComplete="off" spellCheck={false} /><button type="submit" disabled={busy || !value.trim()}>{busy ? 'Loading…' : 'Load'}</button></div>
    {error ? <p className="save-warning" role="alert">{error}</p> : null}
  </form>;
}

class RenderBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('3D renderer failed', error, info.componentStack); }
  render() { return this.state.failed ? <div className="render-error"><h2>The 3D renderer could not start.</h2><p>Enable hardware acceleration and reload the page.</p><button onClick={() => location.reload()}>Reload game</button></div> : this.props.children; }
}

function Dialog({ children, onClose, dismissible = false }: { children: ReactNode; onClose?: () => void; dismissible?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const el = ref.current; el?.showModal(); return () => el?.close(); }, []);
  return <dialog ref={ref} aria-labelledby="dialog-title" onCancel={e => { e.preventDefault(); if (dismissible) onClose?.(); }}>
    {children}
  </dialog>;
}

const Pips = ({ value, max, label }: { value: number; max: number; label: string }) =>
  <span className="level-pips" role="img" aria-label={`${label} ${value} of ${max}`}>{Array.from({ length: max }, (_, i) => <i className={value > i ? 'filled' : ''} key={i} />)}<small>{value} / {max}</small></span>;

function UpgradeRow({ symbol, title, detail, level, cost, cash, onBuy }: { symbol: string; title: string; detail: string; level: number; cost: number; cash: number; onBuy: () => void }) {
  const maxed = level >= MAX_LEVEL;
  return <div className="upgrade"><div className="upgrade-symbol" aria-hidden="true">{symbol}</div><div className="upgrade-copy"><h4>{title}</h4><p>{detail}</p><Pips value={level} max={MAX_LEVEL} label="Level" /></div>
    <button onClick={onBuy} disabled={maxed || cash < cost} aria-label={maxed ? `${title}: maxed` : `Upgrade ${title} for ${credits(cost)}`}>{maxed ? 'MAXED' : credits(cost)}</button></div>;
}

const OperativeLabel = ({ op }: { op: Operative }) =>
  <span className="op-label"><span className={`op-icon cls-${op.cls}`} aria-hidden="true">{ABILITY_ICON[CLASS_STATS[op.cls].ability]}</span><span><strong>{op.name}</strong><small>{CLASS_STATS[op.cls].title} · {ABILITY_STATS[CLASS_STATS[op.cls].ability].name}</small></span></span>;

function Shop({ campaign, onDismiss }: { campaign: Campaign; onDismiss: (op: Operative) => void }) {
  const full = campaign.roster.length >= ROSTER_CAP, cash = campaign.cash;
  return <div className="shop">
    <div className="balance"><span>AVAILABLE FUNDS</span><strong>{credits(cash)}</strong></div>
    <h3 className="section-title">Gear</h3>
    <UpgradeRow symbol="⌁" title="Smart ammunition" detail="+12 damage per level" level={campaign.weapon} cost={GEAR_COST.weapon} cash={cash} onBuy={() => sim.buy('weapon')} />
    <UpgradeRow symbol="◈" title="Dermal plating" detail="+40 health per operative / level" level={campaign.armor} cost={GEAR_COST.armor} cash={cash} onBuy={() => sim.buy('armor')} />
    <h3 className="section-title">Abilities <small>−15% cooldown · +20% effect per level</small></h3>
    {CLASSES.map(cls => { const ability = CLASS_STATS[cls].ability, level = campaign.abilities[cls];
      return <UpgradeRow key={cls} symbol={ABILITY_ICON[ability]} title={ABILITY_STATS[ability].name} detail={`${CLASS_STATS[cls].title} · ${secs(abilityCooldown(ability, level))} cooldown`} level={level} cost={ABILITY_UPGRADE_COST} cash={cash} onBuy={() => sim.buy(cls)} />; })}
    <h3 className="section-title">Recruits <small>ROSTER {campaign.roster.length} / {ROSTER_CAP}</small></h3>
    {campaign.recruits.length ? campaign.recruits.map(r => <div className="roster-row" key={r.id}><OperativeLabel op={r} />
      <button onClick={() => sim.recruit(r.id)} disabled={full || cash < RECRUIT_COST} aria-label={full ? `Recruit ${r.name}: roster full` : `Recruit ${r.name} for ${credits(RECRUIT_COST)}`}>{full ? 'ROSTER FULL' : credits(RECRUIT_COST)}</button></div>)
      : <p className="empty-note">No candidates right now. New recruits arrive after the next deployment.</p>}
    <h3 className="section-title">Roster</h3>
    {campaign.roster.map(o => <div className="roster-row" key={o.id}><OperativeLabel op={o} />
      <button className="secondary" onClick={() => onDismiss(o)} disabled={campaign.roster.length <= 1} aria-label={`Dismiss ${o.name}`}>Dismiss</button></div>)}
  </div>;
}

function ContractBoard({ state, onChoose }: { state: Snapshot; onChoose: (id: string) => void }) {
  const { campaign, contract, squadPick } = state;
  return <>
    <div className="offers" role="group" aria-label="Contracts">{campaign.offers.map(c => { const on = c.id === contract?.id, info = CONTRACTS[c.type];
      return <button key={c.id} className={`offer ${on ? 'selected' : ''}`} aria-pressed={on} onClick={() => onChoose(c.id)}>
        <span className="offer-icon" aria-hidden="true">{info.icon}</span>
        <span className="offer-copy"><strong>{info.title}</strong><small>SECTOR {pad(c.sector)} / {c.district}</small></span>
        <span className="offer-pay"><b>{credits(c.payout)}</b><Pips value={c.tier} max={MAX_TIER} label="Tier" /></span>
      </button>; })}</div>
    {contract ? <div className="contract-brief"><div className="eyebrow orange">{state.plan?.label}</div><h3>{CONTRACTS[contract.type].title}</h3><p>{CONTRACTS[contract.type].brief}</p>
      <div className="brief-stats"><div><small>PAYOUT</small><strong>{credits(contract.payout)}</strong></div><div><small>NO ALARM</small><strong className="mint">{credits(missionPayout(contract, true))}</strong></div><div><small>THREAT</small><strong>Tier {contract.tier}</strong></div></div>
      <p className="stealth-note">Extract without raising the alarm for a +{STEALTH_PERCENT}% stealth bonus.</p></div> : <p className="empty-note">No contracts on the board.</p>}
    <fieldset className="squad-pick"><legend>SQUAD <span>{squadPick.length} / {SQUAD_MAX}</span></legend>
      {campaign.roster.map(o => { const on = squadPick.includes(o.id), locked = on ? squadPick.length <= 1 : squadPick.length >= SQUAD_MAX;
        return <button key={o.id} className={`pick ${on ? 'on' : ''}`} aria-pressed={on} aria-disabled={locked} aria-describedby={locked ? 'squad-rule' : undefined} onClick={() => { if (!locked) sim.toggleSquad(o.id); }}>
          <span className="pick-mark" aria-hidden="true">{on ? pad(squadPick.indexOf(o.id) + 1) : '+'}</span><OperativeLabel op={o} /></button>; })}
      <small id="squad-rule" className="pick-rule">Deploy 1 to {SQUAD_MAX} operatives.</small>
    </fieldset>
  </>;
}

function MissionPanel({ state }: { state: Snapshot }) {
  const c = state.contract; if (!c) return null;
  const current = state.objectives.findIndex(o => !o.done);
  return <section className="mission-panel" aria-label="Mission status">
    <div className="eyebrow">CONTRACT {pad(state.campaign.completed + 1)} <span>TIER {c.tier}</span></div>
    <h1>{CONTRACTS[c.type].title}</h1>
    <div className="payout-line"><span>{credits(c.payout)}</span><span className={state.alarm ? 'lost' : 'mint'}>NO ALARM {credits(missionPayout(c, true))}</span></div>
    <ol className="objectives">{state.objectives.map((o, i) => { const done = o.done, now = i === current, timed = o.kind === 'terminal' || o.kind === 'charge';
      return <li key={i} className={done ? 'done' : now ? 'current' : ''}><span>{done ? '✓' : pad(i + 1)}</span><div>{o.label}
        {timed && !done ? <i className="obj-progress" role="progressbar" aria-label={`${o.label} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(o.progress * 100)}><b style={{ width: `${o.progress * 100}%` }} /></i> : null}</div></li>; })}</ol>
    <div className={`alarm-badge ${state.alarm ? 'on' : ''}`}>{state.alarm
      ? <><strong>▲ ALARM</strong><span>{state.reinforced >= REINFORCE_CAP ? 'No more reinforcements' : `Reinforcements in ${Math.ceil(state.reinforceIn)} s`}</span></>
      : <><strong>● QUIET</strong><span>Stealth bonus intact</span></>}</div>
  </section>;
}

function SquadCard({ unit, slot, selected, campaign, pending }: { unit: Unit; slot: number; selected: boolean; campaign: Campaign; pending: Pending }) {
  const cls = unit.kind as ClassId, ability = unit.ability ?? CLASS_STATS[cls].ability, name = ABILITY_STATS[ability].name;
  const max = abilityCooldown(ability, campaign.abilities[cls]), down = unit.hp <= 0, ready = unit.abilityCd <= 0, aiming = pending?.unitId === unit.id;
  const status = aiming ? 'AIM' : ready ? 'READY' : `${Math.ceil(unit.abilityCd)} s`;
  return <div className={`agent-card ${selected ? 'selected' : ''} ${down ? 'down' : ''}`}>
    <button className="agent-select" disabled={down} aria-pressed={selected} aria-keyshortcuts={String(slot + 1)} onClick={e => sim.select(unit.id, e.shiftKey)}>
      <span className={`portrait cls-${cls}`} aria-hidden="true"><i /><b>{slot + 1}</b></span>
      <span className="agent-info"><span className="agent-name"><span className="slot-key" aria-hidden="true">{slot + 1}</span><b>{unit.name}</b><span className="agent-state">{down ? 'DOWN' : 'ACTIVE'}</span></span><span className="agent-class">{CLASS_STATS[cls].title}</span>
        <span className="health-track"><span style={{ width: `${unit.hp / unit.maxHp * 100}%` }} /></span><span className="hp">{Math.ceil(unit.hp)} / {unit.maxHp} HP</span></span>
    </button>
    {down ? <p className="down-hint">Select a teammate, click the body to revive</p>
      : <button className={`ability-button ${ready ? 'ready' : ''} ${aiming ? 'aiming' : ''}`} style={{ '--charge': ready ? 1 : 1 - unit.abilityCd / max } as CSSProperties} aria-keyshortcuts={`Shift+${slot + 1}`}
        aria-label={`${name}: ${aiming ? 'choose a target' : ready ? 'ready' : `recharging, ${Math.ceil(unit.abilityCd)} seconds`}`} onClick={() => { if (aiming) sim.cancelAbility(); else sim.ability(slot); }}>
        <span className="ability-icon" aria-hidden="true">{ABILITY_ICON[ability]}</span><span className="ability-name">{name}</span><span className="ability-state">{status}</span></button>}
  </div>;
}

function OpsPanel({ state, titleRef, tab, setTab, onChoose, onDeploy, onDismiss, deployBlocked, connecting, saveArea }: {
  state: Snapshot; titleRef: RefObject<HTMLHeadingElement | null>; tab: 'contracts' | 'shop'; setTab: (tab: 'contracts' | 'shop') => void;
  onChoose: (id: string) => void; onDeploy: () => void; onDismiss: (op: Operative) => void; deployBlocked: boolean; connecting: boolean; saveArea: (load: boolean) => ReactNode;
}) {
  const campaign = state.campaign, briefing = state.phase === 'briefing', success = state.result === 'success', c = state.contract;
  return <aside className="ops-panel" aria-labelledby="ops-title">
    <div className="modal-topline">NEON DIRECTIVE <span>{briefing ? 'OPERATIONS BRIEF' : 'AFTER-ACTION REPORT'}</span></div>
    {briefing ? <div className="ops-tabs" role="group" aria-label="Operations view">
      <button aria-pressed={tab === 'contracts'} onClick={() => setTab('contracts')}>Contracts</button><button aria-pressed={tab === 'shop'} onClick={() => setTab('shop')}>Headquarters</button></div> : null}
    <div className="ops-body">
      {briefing && tab === 'contracts' ? <>
        <div className="eyebrow orange">CONTRACT {pad(campaign.completed + 1)} / CHOOSE A JOB</div>
        <h2 id="ops-title" ref={titleRef} tabIndex={-1}>Contract board<span>.</span></h2>
        <ContractBoard state={state} onChoose={onChoose} />
        <button className="primary" onClick={onDeploy} disabled={deployBlocked || !c}>{connecting ? 'Connecting…' : `Deploy squad (${state.squadPick.length})`} <span>↗</span></button>
        {saveArea(true)}
      </> : null}
      {briefing && tab === 'shop' ? <>
        <div className="eyebrow">CORPORATE HEADQUARTERS</div>
        <h2 id="ops-title" ref={titleRef} tabIndex={-1}>Refit the squad<span>.</span></h2>
        <Shop campaign={campaign} onDismiss={onDismiss} />
      </> : null}
      {!briefing ? <>
        <div className={`eyebrow ${success ? 'mint' : 'orange'}`}>{success ? `CONTRACT COMPLETE / +${credits(state.payout)}` : 'OPERATION FAILED / NO PAYOUT'}</div>
        <h2 id="ops-title" ref={titleRef} tabIndex={-1}>{success ? 'Business is good.' : 'Recover. Refit.'}</h2>
        {c ? <div className="report-line">{CONTRACTS[c.type].title} · Tier {c.tier} · {state.plan?.label}</div> : null}
        {success ? (state.stealth ? <p className="stealth-earned">+{STEALTH_PERCENT}% STEALTH BONUS <small>No alarm was raised.</small></p> : <p className="report-copy">The alarm was raised: base payout only.</p>)
          : <p className="report-copy">{state.failReason} The contract is lost; purchased upgrades are kept.</p>}
        <button className="primary" onClick={sim.openBoard}>Contract board <span>↗</span></button>
        <Shop campaign={campaign} onDismiss={onDismiss} />
        {saveArea(false)}
      </> : null}
    </div>
  </aside>;
}

function App() {
  const state = useSyncExternalStore(sim.subscribe, sim.getSnapshot);
  const [saveCode, setSaveCode] = useState<string | null>(null), [connecting, setConnecting] = useState(true), [loadingCode, setLoadingCode] = useState(false);
  useEffect(() => { connection.then(setSaveCode, () => sim.setSaveUnavailable(true)).finally(() => setConnecting(false)); }, []);
  const [cameraReset, setCameraReset] = useState(0), [help, setHelp] = useState(false), [confirmRestart, setConfirmRestart] = useState(false);
  const [tab, setTab] = useState<'contracts' | 'shop'>('contracts'), [dismissing, setDismissing] = useState<Operative | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null), lastPhase = useRef(state.phase);
  const resetCamera = () => setCameraReset(n => n + 1);
  useEffect(() => {
    if (lastPhase.current === state.phase) return;
    lastPhase.current = state.phase;
    if (state.phase === 'briefing') setTab('contracts');
    titleRef.current?.focus();
  }, [state.phase]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || help || confirmRestart || sim.phase !== 'mission') return;
      if (e.target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
      // A focused button keeps Space and Enter for itself; every other hotkey still works.
      if (e.target instanceof HTMLButtonElement && (e.code === 'Space' || e.code === 'Enter')) return;
      // e.code, because Shift turns e.key into "!" or "@" on some layouts.
      const slot = /^Digit[1-4]$/.test(e.code) ? Number(e.code.slice(5)) - 1 : -1;
      if (slot >= 0) { e.preventDefault(); if (e.shiftKey) sim.ability(slot); else sim.selectSlot(slot); }
      else if (e.code === 'Space') { e.preventDefault(); sim.togglePause(); }
      else if (e.code === 'KeyA') { e.preventDefault(); sim.selectAll(); }
      else if (e.code === 'KeyS') sim.hold();
      else if (e.code === 'KeyR') setCameraReset(n => n + 1);
      else if (e.key === 'Escape') { if (!sim.cancelAbility()) sim.pause(); }
    };
    const visibility = () => { if (document.hidden) sim.pause(); };
    window.addEventListener('keydown', key); document.addEventListener('visibilitychange', visibility);
    return () => { window.removeEventListener('keydown', key); document.removeEventListener('visibilitychange', visibility); };
  }, [help, confirmRestart]);
  const campaign = state.campaign, active = state.phase === 'mission', contract = state.contract;
  const deploy = () => { sim.deploy(); resetCamera(); };
  const choose = (id: string) => { sim.chooseContract(id); resetCamera(); };
  const saveArea = (load: boolean) => <>{saveCode ? <SaveCode code={saveCode} /> : null}{state.saveUnavailable ? <p className="save-warning">Server unreachable. Progress from this session is not saved.</p> : null}
    {load && !connecting ? <LoadSaveCode onLoaded={setSaveCode} busy={loadingCode} setBusy={setLoadingCode} /> : null}{load ? <small className="modal-footnote">Progress saves to your save code. Enter it on another device to continue there.</small> : null}</>;
  const pendingStats = state.pending ? ABILITY_STATS[state.pending.ability] : null;
  return <main className={`app phase-${state.phase} ${active && state.alarm ? 'alarm' : ''}`}>
    <div className="scene" aria-label="3D tactical city. Click operatives to select, streets to move, hostiles to attack, and downed operatives to revive." onContextMenu={e => e.preventDefault()}><RenderBoundary><GameCanvas sim={sim} reset={cameraReset} /></RenderBoundary></div>
    <header>
      <div className="brand"><span className="brand-mark">N<span>/</span></span><div>NEON DIRECTIVE<small>PRIVATE MILITARY SYSTEMS</small></div></div>
      <div className="header-status"><span className="status-dot" /> <span className="uplink">UPLINK SECURE <span className="divider">/</span></span> {state.plan?.label ?? 'NO CONTRACT'}</div>
      <div className="header-right"><span className="credit"><small>CORPORATE FUNDS</small>{credits(campaign.cash)}</span><button className="icon-button" aria-label="Open controls" onClick={() => { sim.pause(); setHelp(true); }}>?</button></div>
    </header>
    {active ? <MissionPanel state={state} /> : null}
    {contract ? <div className="sector-label" aria-hidden="true"><span>{pad(contract.sector)}</span><div>{contract.district}<br /><small>{CONTRACTS[contract.type].title.toUpperCase()} / TIER {contract.tier}</small></div></div> : null}
    <div className="camera-controls"><button title="Reset camera [R]" aria-label="Reset camera" onClick={resetCamera}>⌖</button><span>SCROLL TO ZOOM<br />RIGHT-DRAG TO PAN</span></div>
    {state.paused && active ? <div className="pause-banner"><span>Ⅱ</span> TACTICAL PAUSE <small>Orders can be queued</small><button onClick={sim.togglePause}>Resume →</button></div> : null}
    {active && state.pending && pendingStats ? <div className="pending-banner" role="status"><span className="ability-icon" aria-hidden="true">{ABILITY_ICON[state.pending.ability]}</span><span>Choose a target for <b>{pendingStats.name}</b> · Esc cancels</span><button onClick={() => sim.cancelAbility()}>Cancel</button></div> : null}
    {active ? <footer>
      <section className="squad-bar" aria-label="Squad selection">
        <div className="squad-heading"><span className="eyebrow">FIELD TEAM</span><button className="text-button" onClick={sim.selectAll}>SELECT ALL <kbd>A</kbd></button></div>
        <div className="agents">{state.squad.map((id, i) => { const u = state.units.find(v => v.id === id);
          return u ? <SquadCard key={id} unit={u} slot={i} selected={state.selected.includes(id)} campaign={campaign} pending={state.pending} /> : null; })}</div>
      </section>
      <section className="command-bar"><div className="command-message" role="status">{state.message}</div>
        <div className="commands"><button onClick={sim.hold}>◈ Hold <kbd>S</kbd></button><button onClick={sim.togglePause}>{state.paused ? '▶ Resume' : 'Ⅱ Pause'} <kbd>SPACE</kbd></button><button className="restart-button" onClick={() => { sim.pause(); setConfirmRestart(true); }}>↺ Restart</button>
          <span className="mission-clock" role="timer" aria-label="Mission time"><small>ELAPSED</small>{pad(Math.floor(state.time / 60))}:{pad(Math.floor(state.time % 60))}</span></div></section>
    </footer> : null}
    <div className="bottom-strip"><span>REACT THREE FIBER <b>3D</b></span><span>1–4 SELECT · SHIFT+1–4 ABILITY · CLICK STREET TO MOVE · HOSTILE TO ATTACK</span><span>TACTICAL PROTOTYPE / 02</span></div>
    {!active ? <OpsPanel state={state} titleRef={titleRef} tab={tab} setTab={setTab} onChoose={choose} onDeploy={deploy} onDismiss={setDismissing} deployBlocked={connecting || loadingCode} connecting={connecting} saveArea={saveArea} /> : null}
    {help ? <Dialog dismissible onClose={() => setHelp(false)}><div className="modal-body"><div className="eyebrow">OPERATOR MANUAL</div><h2 id="dialog-title">Take command.</h2>
      <dl className="controls-list"><dt>1–4 / click a card</dt><dd>Select that operative</dd><dt>Shift + click</dt><dd>Add or remove from selection</dd><dt>A / Select all</dt><dd>Select the surviving squad</dd>
        <dt>Shift + 1–4 / ability button</dt><dd>Use that operative's ability; aimed abilities then need a target on the map</dd><dt>Esc</dt><dd>Cancel an ability; otherwise pause</dd>
        <dt>Click street</dt><dd>Move around buildings</dd><dt>Click hostile</dt><dd>Approach and concentrate fire</dd><dt>Click a downed operative</dt><dd>The nearest selected teammate revives them</dd>
        <dt>S / Hold</dt><dd>Stop movement</dd><dt>Space / Pause</dt><dd>Pause and queue orders</dd><dt>Scroll / two-finger pinch</dt><dd>Zoom the view</dd><dt>Right-drag / two-finger drag</dt><dd>Pan the view</dd><dt>R / ⌖</dt><dd>Reset camera</dd></dl>
      <div className="eyebrow">STEALTH</div>
      <ul className="stealth-list"><li>Before the alarm, the squad only fires at targets you order.</li><li>Hostiles and cameras see in vision cones. Stay in one too long and the alarm sounds.</li><li>Sniper shots are silent. Grenades are loud and raise the alarm at once. A hostile that survives a hit raises it too.</li><li>After the alarm, reinforcements arrive every {REINFORCE_SECONDS} s. Extract with no alarm for +{STEALTH_PERCENT}% payout.</li></ul>
      {saveCode ? <SaveCode code={saveCode} /> : null}<button className="primary" onClick={() => setHelp(false)}>Close manual</button></div></Dialog> : null}
    {confirmRestart ? <Dialog dismissible onClose={() => setConfirmRestart(false)}><div className="modal-body"><h2 id="dialog-title">Restart this contract?</h2><p>The mission resets on the same map with the same squad. Funds and purchased upgrades are kept.</p><button className="primary" onClick={() => { sim.restart(); resetCamera(); setConfirmRestart(false); }}>Restart mission</button><button className="secondary full" onClick={() => setConfirmRestart(false)}>Keep playing</button></div></Dialog> : null}
    {dismissing ? <Dialog dismissible onClose={() => setDismissing(null)}><div className="modal-body"><h2 id="dialog-title">Dismiss {dismissing.name}?</h2><p>{dismissing.name} leaves the roster for good. There is no refund.</p><button className="primary" onClick={() => { sim.dismiss(dismissing.id); setDismissing(null); }}>Dismiss operative</button><button className="secondary full" onClick={() => setDismissing(null)}>Keep {dismissing.name}</button></div></Dialog> : null}
  </main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
