import { StrictMode, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { connection, sim } from './app.ts';
import type { Operative } from './game/campaign.ts';
import { GameCanvas } from './scene/GameCanvas.tsx';
import { STILL } from './scene/parts.tsx';
import { Callouts, useCallouts } from './ui/Callouts.tsx';
import { AudioDialog } from './ui/AudioDialog.tsx';
import { Dialog, RenderBoundary } from './ui/common.tsx';
import { Debrief } from './ui/Debrief.tsx';
import { Headquarters } from './ui/Headquarters.tsx';
import { Hud } from './ui/Hud.tsx';
import { Icon } from './ui/icons.tsx';
import { Manual } from './ui/Manual.tsx';
import { MissionSelect } from './ui/MissionSelect.tsx';
import { play, setMood, sound } from './ui/audio.ts';
import { TitleScreen } from './ui/TitleScreen.tsx';
import { TooSmall, useTooSmall } from './ui/TooSmall.tsx';
import { TopBar } from './ui/TopBar.tsx';
import type { Screen, Tab } from './ui/TopBar.tsx';
import './style.css';

function App() {
  const state = useSyncExternalStore(sim.subscribe, sim.getSnapshot);
  const { muted } = useSyncExternalStore(sound.subscribe, sound.settings);
  const tooSmall = useTooSmall();
  const [saveCode, setSaveCode] = useState<string | null>(null), [connecting, setConnecting] = useState(true), [loadingCode, setLoadingCode] = useState(false);
  useEffect(() => { connection.then(setSaveCode, () => sim.setSaveUnavailable(true)).finally(() => setConnecting(false)); }, []);
  const [onTitle, setOnTitle] = useState(true), [tab, setTab] = useState<Tab>('missions');
  const [cameraReset, setCameraReset] = useState(0), [help, setHelp] = useState(false), [menu, setMenu] = useState(false), [confirmRestart, setConfirmRestart] = useState(false);
  // The Audio dialog, and whether closing it returns to the mission menu.
  const [audio, setAudio] = useState<'open' | 'from-menu' | null>(null);
  const [dismissing, setDismissing] = useState<Operative | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null), frame = useRef<HTMLDivElement>(null);
  const callout = useCallouts(state);
  const active = state.phase === 'mission';
  const screen: Screen = onTitle ? 'title' : active ? 'mission' : state.phase === 'headquarters' ? 'debrief' : tab === 'hq' ? 'hq' : 'select';
  const resetCamera = () => setCameraReset(n => n + 1);
  // After useCallouts, so a mission-end stinger is queued before the menu music returns.
  useEffect(() => { setMood({ mission: active, alarm: active && state.alarm, paused: active && state.paused }); }, [active, state.alarm, state.paused]);
  // Focus follows phase changes; switching between the Missions and Headquarters tabs keeps it on the tab.
  const focusKey = onTitle ? 'title' : state.phase;
  useEffect(() => { titleRef.current?.focus(); }, [focusKey]);
  useEffect(() => { if (tooSmall) sim.pause(); }, [tooSmall]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || tooSmall || help || menu || audio || confirmRestart || sim.phase !== 'mission') return;
      if (e.target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
      // A focused button keeps Space and Enter for itself; every other hotkey still works.
      if (e.target instanceof HTMLButtonElement && (e.code === 'Space' || e.code === 'Enter')) return;
      // e.code, because Shift turns e.key into "!" or "@" on some layouts.
      const slot = /^Digit[1-4]$/.test(e.code) ? Number(e.code.slice(5)) - 1 : -1;
      if (slot >= 0) { e.preventDefault(); if (e.shiftKey) sim.ability(slot); else { sim.selectSlot(slot); play('select'); } }
      else if (e.code === 'Space') { e.preventDefault(); sim.togglePause(); }
      else if (e.code === 'KeyA') { e.preventDefault(); sim.selectAll(); play('select'); }
      else if (e.code === 'KeyS') sim.hold();
      else if (e.code === 'KeyR') setCameraReset(n => n + 1);
      else if (e.key === 'Escape') { if (!sim.cancelAbility()) sim.pause(); }
    };
    const visibility = () => { if (document.hidden) sim.pause(); };
    window.addEventListener('keydown', key); document.addEventListener('visibilitychange', visibility);
    return () => { window.removeEventListener('keydown', key); document.removeEventListener('visibilitychange', visibility); };
  }, [tooSmall, help, menu, audio, confirmRestart]);
  const openManual = () => { sim.pause(); setHelp(true); };
  const openMenu = () => { sim.pause(); setMenu(true); };
  const openAudio = () => { sim.pause(); setAudio('open'); };
  const toBoard = (next: Tab) => { sim.openBoard(); setTab(next); };
  const loaded = (code: string) => { setSaveCode(code); setOnTitle(false); };
  const deployBlocked = connecting || loadingCode;
  return <main className={`app screen-${screen}${active && state.alarm ? ' alarm' : ''}${active && state.paused ? ' paused' : ''}`}
    onClickCapture={e => { const button = e.target instanceof Element ? e.target.closest('button') : null; if (button && !button.dataset.cue) play('click'); }}>
    <div className="scene" aria-label="3D tactical city. Click operatives to select, streets to move, hostiles to attack, and downed operatives to revive." onContextMenu={e => e.preventDefault()}>
      <RenderBoundary><GameCanvas sim={sim} reset={cameraReset} layout={screen} attract={onTitle && !STILL} frame={frame} /></RenderBoundary>
    </div>
    <div className="scene-fx" aria-hidden="true" />
    <div ref={frame} className="view-frame" aria-hidden="true" />
    {onTitle ? <TitleScreen campaign={state.campaign} connecting={connecting} offline={state.saveUnavailable} syncing={state.syncing} saveCode={saveCode} loadingCode={loadingCode} setLoadingCode={setLoadingCode}
      onLoaded={loaded} onContinue={() => setOnTitle(false)} onManual={() => setHelp(true)} onAudio={openAudio} />
      : <TopBar state={state} screen={screen} tab={tab} setTab={setTab} connecting={connecting} onManual={openManual} onAudio={openAudio} onMenu={openMenu} />}
    {screen === 'select' ? <MissionSelect state={state} titleRef={titleRef} onChoose={id => { sim.chooseContract(id); resetCamera(); }} onDeploy={sim.deploy}
      onRecenter={resetCamera} deployBlocked={deployBlocked} connecting={connecting} /> : null}
    {screen === 'hq' ? <Headquarters campaign={state.campaign} saveCode={saveCode} titleRef={titleRef} onDismiss={setDismissing}
      connecting={connecting} syncing={state.syncing} loadingCode={loadingCode} setLoadingCode={setLoadingCode} onLoaded={setSaveCode} /> : null}
    {screen === 'debrief' ? <Debrief state={state} saveCode={saveCode} titleRef={titleRef} onBoard={() => toBoard('missions')} onHeadquarters={() => toBoard('hq')} /> : null}
    {screen === 'mission' ? <Hud state={state} onRecenter={resetCamera} /> : null}
    <Callouts callout={screen === 'mission' ? callout : null} />
    {help ? <Manual saveCode={saveCode} onClose={() => setHelp(false)} /> : null}
    {menu ? <Dialog onClose={() => setMenu(false)} className="menu-dialog"><div className="dialog-body">
      <p className="kicker">Mission paused</p><h2 id="dialog-title">Mission menu</h2>
      <nav className="menu-list" aria-label="Mission menu">
        <button className="menu-item primary" data-autofocus onClick={() => { setMenu(false); if (sim.paused) sim.togglePause(); }}><span className="menu-item-copy"><strong>Resume</strong></span><Icon name="play" /></button>
        <button className="menu-item" onClick={() => { setMenu(false); setConfirmRestart(true); }}><span className="menu-item-copy"><strong>Restart contract</strong><small>Same map, same squad</small></span><Icon name="restart" /></button>
        <button className="menu-item" onClick={() => { setMenu(false); setHelp(true); }}><span className="menu-item-copy"><strong>Operator manual</strong></span><Icon name="help" /></button>
        <button className="menu-item" onClick={() => { setMenu(false); setAudio('from-menu'); }}><span className="menu-item-copy"><strong>Audio</strong><small>{muted ? 'Sound off' : 'Volume and mute'}</small></span><Icon name={muted ? 'soundOff' : 'soundOn'} /></button>
      </nav>
    </div></Dialog> : null}
    {audio ? <AudioDialog onClose={() => { if (audio === 'from-menu') setMenu(true); setAudio(null); }} /> : null}
    {confirmRestart ? <Dialog onClose={() => setConfirmRestart(false)} className="confirm"><div className="dialog-body">
      <p className="kicker">Restart</p><h2 id="dialog-title">Restart this contract?</h2>
      <p>The mission resets on the same map with the same squad. Funds and purchased upgrades are kept.</p>
      <div className="dialog-actions">
        <button className="btn" data-autofocus onClick={() => setConfirmRestart(false)}>Keep playing</button>
        <button className="btn primary" onClick={() => { sim.restart(); resetCamera(); setConfirmRestart(false); }}><span>Restart mission</span><Icon name="restart" /></button>
      </div>
    </div></Dialog> : null}
    {dismissing ? <Dialog onClose={() => setDismissing(null)} className="confirm"><div className="dialog-body">
      <p className="kicker">Roster</p><h2 id="dialog-title">Dismiss {dismissing.name}?</h2>
      <p>{dismissing.name} leaves the roster for good. There is no refund.</p>
      <div className="dialog-actions">
        <button className="btn" data-autofocus onClick={() => setDismissing(null)}>Keep {dismissing.name}</button>
        <button className="btn danger" onClick={() => { sim.dismiss(dismissing.id); setDismissing(null); }}><Icon name="dismiss" /><span>Dismiss operative</span></button>
      </div>
    </div></Dialog> : null}
    {tooSmall ? <TooSmall /> : null}
  </main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
