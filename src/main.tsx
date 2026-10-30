import { Component, StrictMode, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { GameCanvas } from './scene/GameCanvas.tsx';
import { parseCampaign, Simulation } from './game/simulation.ts';
import type { Campaign } from './game/simulation.ts';
import './style.css';

function createGame() {
  let campaign: Campaign | undefined, unavailable = false;
  try { campaign = parseCampaign(localStorage.getItem('ndSave')); } catch { unavailable = true; }
  const sim = new Simulation(campaign, c => localStorage.setItem('ndSave', JSON.stringify(c)));
  sim.saveUnavailable = unavailable;
  return sim;
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

function App() {
  const [sim] = useState(createGame);
  const state = useSyncExternalStore(sim.subscribe, sim.getSnapshot);
  const [cameraReset, setCameraReset] = useState(0), [help, setHelp] = useState(false), [confirmRestart, setConfirmRestart] = useState(false);
  const resetCamera = () => setCameraReset(n => n + 1);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || help || confirmRestart || sim.phase !== 'mission') return;
      if (e.target instanceof HTMLElement && ['BUTTON', 'INPUT', 'SELECT'].includes(e.target.tagName)) return;
      if (e.code === 'Space') { e.preventDefault(); sim.togglePause(); }
      else if (e.key.toLowerCase() === 'a') { e.preventDefault(); sim.selectAll(); }
      else if (e.key === '1' || e.key === '2') sim.select(e.key === '1' ? 'vex' : 'rook', e.shiftKey);
      else if (e.key.toLowerCase() === 's') sim.hold();
      else if (e.key.toLowerCase() === 'r') setCameraReset(n => n + 1);
      else if (e.key === 'Escape') sim.pause();
    };
    const visibility = () => { if (document.hidden) sim.pause(); };
    window.addEventListener('keydown', key); document.addEventListener('visibilitychange', visibility);
    return () => { window.removeEventListener('keydown', key); document.removeEventListener('visibilitychange', visibility); };
  }, [sim, help, confirmRestart]);
  const campaign = state.campaign, active = state.phase === 'mission';
  const guards = state.units.filter(u => u.enemy && !u.executive && u.hp > 0).length;
  const deploy = () => { sim.deploy(); resetCamera(); };
  return <main className="app">
    <div className="scene" aria-label="3D tactical city. Click agents to select, streets to move, and hostiles to attack." onContextMenu={e => e.preventDefault()}><RenderBoundary><GameCanvas sim={sim} reset={cameraReset} /></RenderBoundary></div>
    <header>
      <div className="brand"><span className="brand-mark">N<span>/</span></span><div>NEON DIRECTIVE<small>PRIVATE MILITARY SYSTEMS</small></div></div>
      <div className="header-status"><span className="status-dot" /> UPLINK SECURE <span className="divider">/</span> SECTOR 04</div>
      <div className="header-right"><span className="credit"><small>CORPORATE FUNDS</small>₡ {campaign.cash.toLocaleString()}</span><button className="icon-button" aria-label="Open controls" onClick={() => { sim.pause(); setHelp(true); }}>?</button></div>
    </header>
    <section className="mission-panel">
      <div className="eyebrow">CONTRACT {String(campaign.completed + 1).padStart(2, '0')} <span>₡ 500</span></div>
      <h1>The Glass District</h1>
      <ol className="objectives"><li className={state.targetDown ? 'done' : 'current'}><span>{state.targetDown ? '✓' : '01'}</span>Neutralize the executive</li><li className={state.targetDown ? 'current' : ''}><span>02</span>Reach extraction</li></ol>
      <div className="intel"><span>{guards} SECURITY UNITS</span><span className="threat">ARMED</span></div>
    </section>
    <div className="sector-label" aria-hidden="true"><span>04</span><div>GLASS DISTRICT<br /><small>KESSLER INDUSTRIAL ZONE</small></div></div>
    <div className="camera-controls"><button title="Reset camera [R]" aria-label="Reset camera" onClick={resetCamera}>⌖</button><span>SCROLL TO ZOOM<br />RIGHT-DRAG TO PAN</span></div>
    {state.paused && active ? <div className="pause-banner"><span>Ⅱ</span> TACTICAL PAUSE <small>Orders can be queued</small><button onClick={sim.togglePause}>Resume →</button></div> : null}
    <footer>
      <section className="squad-bar" aria-label="Squad selection">
        <div className="squad-heading"><span className="eyebrow">FIELD TEAM</span><button className="text-button" onClick={sim.selectAll}>SELECT ALL <kbd>A</kbd></button></div>
        <div className="agents">{state.units.filter(u => !u.enemy).map((u, i) => <button key={u.id} className={`agent-card ${state.selected.includes(u.id) ? 'selected' : ''}`} disabled={u.hp <= 0} onClick={e => sim.select(u.id, e.shiftKey)} aria-pressed={state.selected.includes(u.id)}>
          <span className={`portrait portrait-${i}`} aria-hidden="true"><i /><b>{String(i + 1).padStart(2, '0')}</b></span>
          <span className="agent-info"><span className="agent-name">{u.name}<span>{u.hp > 0 ? 'ACTIVE' : 'DOWN'}</span></span><span className="agent-class">{i === 0 ? 'ASSAULT OPERATIVE' : 'SUPPORT OPERATIVE'}</span><span className="health-track"><span style={{ width: `${u.hp / u.maxHp * 100}%` }} /></span><span className="hp">{Math.ceil(u.hp)} / {u.maxHp} HP</span></span>
        </button>)}</div>
      </section>
      <section className="command-bar"><div className="command-message" role="status">{state.message}</div><div className="commands"><button disabled={!active} onClick={sim.hold}>◈ Hold <kbd>S</kbd></button><button disabled={!active} onClick={sim.togglePause}>{state.paused ? '▶ Resume' : 'Ⅱ Pause'} <kbd>SPACE</kbd></button><button className="restart-button" disabled={!active} onClick={() => { sim.pause(); setConfirmRestart(true); }}>↺ Restart</button></div></section>
      <div className="mission-clock"><span className="eyebrow">ELAPSED</span><strong>{String(Math.floor(state.time / 60)).padStart(2, '0')}:{String(Math.floor(state.time % 60)).padStart(2, '0')}</strong></div>
    </footer>
    <div className="bottom-strip"><span>REACT THREE FIBER <b>3D</b></span><span>CLICK TO SELECT · STREET TO MOVE · HOSTILE TO ATTACK</span><span>TACTICAL PROTOTYPE / 02</span></div>
    {state.phase === 'briefing' ? <Dialog><div className="modal-topline">NEON DIRECTIVE <span>OPERATIONS BRIEF</span></div><div className="modal-body"><div className="eyebrow orange">CONTRACT {String(campaign.completed + 1).padStart(2, '0')} / KESSLER INDUSTRIES</div><h2 id="dialog-title">A hostile<br />takeover<span>.</span></h2><p>Two augmented agents. One corporate executive. Eliminate the target in the Glass District, then return to extraction.</p><div className="brief-stats"><div><small>CONTRACT VALUE</small><strong>₡ 500</strong></div><div><small>TEAM SIZE</small><strong>02 agents</strong></div><div><small>ENGAGEMENT</small><strong>Real time</strong></div></div><div className="quick-guide"><span><b>01</b>Select your squad</span><span><b>02</b>Click to command</span><span><b>03</b>Extract & upgrade</span></div><button className="primary" onClick={deploy}>Deploy squad <span>↗</span></button><small className="modal-footnote">Progress saves in this browser. Existing upgrades carry over.</small></div></Dialog> : null}
    {state.phase === 'headquarters' ? <Dialog><div className="modal-topline">CORPORATE HEADQUARTERS <span>AFTER-ACTION REPORT</span></div><div className="modal-body"><div className={`eyebrow ${state.result === 'success' ? 'mint' : 'orange'}`}>{state.result === 'success' ? 'CONTRACT COMPLETE / +₡ 500' : 'OPERATION FAILED / NO PAYOUT'}</div><h2 id="dialog-title">{state.result === 'success' ? 'Business is good.' : 'Recover. Refit.'}</h2><p>{state.result === 'success' ? 'Payment received. Invest in the squad before the next contract.' : 'Your squad was lost. Replacements retain purchased equipment; retry at no cost.'}</p><div className="balance"><span>AVAILABLE FUNDS</span><strong>₡ {campaign.cash.toLocaleString()}</strong></div>
      {(['weapon', 'armor'] as const).map(type => <div className="upgrade" key={type}><div className="upgrade-symbol">{type === 'weapon' ? '⌁' : '◈'}</div><div className="upgrade-copy"><h3>{type === 'weapon' ? 'Smart ammunition' : 'Dermal plating'}</h3><p>{type === 'weapon' ? '+12 damage per level' : '+40 health per agent / level'}</p><div className="level-pips" aria-label={`Level ${campaign[type]} of 3`}>{[1, 2, 3].map(n => <i className={campaign[type] >= n ? 'filled' : ''} key={n} />)}<small>{campaign[type]} / 3</small></div></div><button onClick={() => sim.buy(type)} disabled={campaign[type] >= 3 || campaign.cash < (type === 'weapon' ? 300 : 250)}>{campaign[type] >= 3 ? 'MAXED' : `₡ ${type === 'weapon' ? 300 : 250}`}</button></div>)}
      <button className="primary" onClick={deploy}>{state.result === 'success' ? 'Deploy next contract' : 'Retry contract'} <span>↗</span></button><small className="modal-footnote">Prototype campaign: replay the district with persistent upgrades.</small>{state.saveUnavailable ? <p className="save-warning">Browser storage is unavailable. Progress will last only for this session.</p> : null}</div></Dialog> : null}
    {help ? <Dialog dismissible onClose={() => setHelp(false)}><div className="modal-body"><div className="eyebrow">OPERATOR MANUAL</div><h2 id="dialog-title">Take command.</h2><dl className="controls-list"><dt>Click agent / 1 / 2</dt><dd>Select an operative</dd><dt>Shift + click</dt><dd>Add or remove from selection</dd><dt>A / Select all</dt><dd>Select the surviving squad</dd><dt>Click street</dt><dd>Move around buildings; auto-fire at threats</dd><dt>Click hostile</dt><dd>Approach and concentrate fire</dd><dt>S / Hold</dt><dd>Stop movement; keep firing</dd><dt>Space / Pause</dt><dd>Pause and queue orders</dd><dt>Scroll / two-finger pinch</dt><dd>Zoom the view</dd><dt>Right-drag / two-finger drag</dt><dd>Pan the view</dd><dt>R / ⌖</dt><dd>Reset camera</dd></dl><button className="primary" onClick={() => setHelp(false)}>Close manual</button></div></Dialog> : null}
    {confirmRestart ? <Dialog dismissible onClose={() => setConfirmRestart(false)}><div className="modal-body"><h2 id="dialog-title">Restart this contract?</h2><p>The current mission resets. Credits and purchased upgrades are kept.</p><button className="primary" onClick={() => { deploy(); setConfirmRestart(false); }}>Restart mission</button><button className="secondary full" onClick={() => setConfirmRestart(false)}>Keep playing</button></div></Dialog> : null}
  </main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
