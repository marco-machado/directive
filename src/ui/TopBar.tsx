import { sim } from '../app.ts';
import { CALM_SECONDS, REINFORCE_CAP } from '../game/simulation.ts';
import type { Snapshot } from '../game/simulation.ts';
import { AudioButton, clock, Credits } from './common.tsx';
import { Icon, Logo } from './icons.tsx';

export type Screen = 'title' | 'select' | 'hq' | 'mission' | 'debrief';
export type Tab = 'missions' | 'hq';

export function Uplink({ connecting, offline }: { connecting: boolean; offline: boolean }) {
  const [tone, label] = connecting ? ['wait', 'Connecting'] : offline ? ['down', 'Offline · not saving'] : ['up', 'Uplink secure'];
  return <span className={`uplink ${tone}`} title={offline ? 'Server unreachable. Progress from this session is not saved.' : undefined}><i aria-hidden="true" />{label}</span>;
}

function Status({ state }: { state: Snapshot }) {
  return <div className={`status${state.alarm ? ' alarm' : ''}`}>
    {state.paused ? <span className="status-pause"><Icon name="pause" /><strong>Paused</strong></span> : null}
    <span className="status-state"><Icon name={state.alarm ? 'alert' : 'eye'} /><strong>{state.alarm ? 'Alarm' : state.stealth ? 'Undetected' : 'Evaded'}</strong></span>
    <span className="status-detail">{state.alarm
      ? state.calmIn < CALM_SECONDS - 1 ? <>Contact lost · standing down <b>{Math.ceil(state.calmIn)} s</b></>
      : state.reinforced >= REINFORCE_CAP ? 'No more reinforcements' : <>Reinforcements <b>{Math.ceil(state.reinforceIn)} s</b></>
      : state.stealth ? 'Stealth bonus intact' : 'Stealth bonus lost'}</span>
    <span className="status-clock" role="timer" aria-label="Mission time">{clock(state.time)}</span>
  </div>;
}

export function TopBar({ state, screen, tab, setTab, connecting, onManual, onAudio, onMenu }: {
  state: Snapshot; screen: Screen; tab: Tab; setTab: (tab: Tab) => void; connecting: boolean; onManual: () => void; onAudio: () => void; onMenu: () => void;
}) {
  const mission = screen === 'mission';
  return <header className="topbar">
    <div className="brand"><Logo /><span className="brand-name">NEON DIRECTIVE<small>Private military systems</small></span></div>
    {mission ? <Status state={state} />
      : screen === 'debrief' ? <div className="topbar-title">After-action report</div>
      : <nav className="tabs" aria-label="Operations">
        <button aria-pressed={tab === 'missions'} onClick={() => setTab('missions')}><Icon name="assassination" />Missions</button>
        <button aria-pressed={tab === 'hq'} onClick={() => setTab('hq')}><Icon name="recruit" />Headquarters</button>
      </nav>}
    <div className="topbar-right">
      {mission ? null : <><Uplink connecting={connecting} offline={state.saveUnavailable} /><span className="funds"><small>Funds</small><Credits value={state.campaign.cash} /></span></>}
      {mission ? <button className="icon-button" aria-label={state.paused ? 'Resume' : 'Pause'} aria-keyshortcuts="Space" onClick={sim.togglePause}><Icon name={state.paused ? 'play' : 'pause'} /></button> : null}
      <AudioButton className="optional" onOpen={onAudio} />
      <button className="icon-button optional" aria-label="Operator manual" onClick={onManual}><Icon name="help" /></button>
      {mission ? <button className="icon-button" aria-label="Mission menu" onClick={onMenu}><Icon name="menu" /></button> : null}
    </div>
  </header>;
}
