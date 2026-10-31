import { useEffect, useRef, useState } from 'react';
import type { Campaign } from '../game/campaign.ts';
import { credits, LoadSaveCode, pad, SaveCode, SoundToggle } from './common.tsx';
import { Icon, Logo } from './icons.tsx';
import { Uplink } from './TopBar.tsx';

export function TitleScreen({ campaign, connecting, offline, saveCode, loadingCode, setLoadingCode, onLoaded, onContinue, onManual }: {
  campaign: Campaign; connecting: boolean; offline: boolean; saveCode: string | null;
  loadingCode: boolean; setLoadingCode: (busy: boolean) => void; onLoaded: (code: string) => void; onContinue: () => void; onManual: () => void;
}) {
  const [loading, setLoading] = useState(false), start = useRef<HTMLButtonElement>(null);
  useEffect(() => { start.current?.focus(); }, []);
  const fresh = campaign.completed === 0 && campaign.cash === 0;
  return <section className="title-screen" aria-labelledby="title-heading">
    <div className="title-stack">
      <Logo className="title-logo" />
      <p className="title-kicker">Private military systems</p>
      <h1 id="title-heading" className="title-name">Neon<span>Directive</span></h1>
      <p className="title-tagline">Run a covert squad through a hostile corporate city. Ghost it for the bonus, or go loud and survive the response.</p>
      <nav className="title-menu" aria-label="Main menu">
        <button ref={start} className="menu-item primary" onClick={onContinue} disabled={loadingCode}>
          <span className="menu-item-copy"><strong>{fresh ? 'Start campaign' : 'Continue campaign'}</strong>
            <small>{connecting ? 'Establishing uplink…' : `Contract ${pad(campaign.completed + 1)} · ${credits(campaign.cash)} · ${campaign.roster.length} operatives`}</small></span>
          <Icon name="chevron" />
        </button>
        <button className="menu-item" aria-expanded={loading && !connecting} disabled={connecting} onClick={() => setLoading(v => !v)}>
          <span className="menu-item-copy"><strong>Load save code</strong><small>{connecting ? 'Available once the uplink is up' : 'Continue a campaign from another device'}</small></span><Icon name="key" />
        </button>
        {loading && !connecting ? <LoadSaveCode onLoaded={code => { setLoading(false); onLoaded(code); }} busy={loadingCode} setBusy={setLoadingCode} /> : null}
        <button className="menu-item" onClick={onManual}>
          <span className="menu-item-copy"><strong>Operator manual</strong><small>Controls and stealth rules</small></span><Icon name="help" />
        </button>
      </nav>
    </div>
    <footer className="title-foot">
      <Uplink connecting={connecting} offline={offline} />
      {saveCode ? <SaveCode code={saveCode} /> : null}
      <SoundToggle />
    </footer>
  </section>;
}
