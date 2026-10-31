import type { RefObject } from 'react';
import { sim } from '../app.ts';
import { MAX_TIER, missionPayout, SQUAD_MAX } from '../game/campaign.ts';
import { ABILITY_STATS, CLASS_STATS } from '../game/classes.ts';
import type { EnemyKind } from '../game/mapgen.ts';
import type { Snapshot } from '../game/simulation.ts';
import { CONTRACTS, Credits, pad, Pips, SaveWarning, threat } from './common.tsx';
import { Icon, Portrait } from './icons.tsx';
import type { IconName } from './icons.tsx';

const INTEL: { kind: EnemyKind; label: string; icon: IconName }[] = [
  { kind: 'guard', label: 'Guards', icon: 'guard' }, { kind: 'heavy', label: 'Heavies', icon: 'heavy' },
  { kind: 'camera', label: 'Cameras', icon: 'camera' }, { kind: 'turret', label: 'Turrets', icon: 'turret' },
];

export function MissionSelect({ state, titleRef, onChoose, onDeploy, onRecenter, deployBlocked, connecting }: {
  state: Snapshot; titleRef: RefObject<HTMLHeadingElement | null>; onChoose: (id: string) => void; onDeploy: () => void; onRecenter: () => void; deployBlocked: boolean; connecting: boolean;
}) {
  const { campaign, contract, squadPick, plan, objectives } = state;
  return <div className="select">
    <section className="select-offers panel" aria-labelledby="ops-title">
      <header className="panel-head"><h2 id="ops-title" ref={titleRef} tabIndex={-1}>Contracts</h2><span className="panel-meta">Contract {pad(campaign.completed + 1)}</span></header>
      <div className="offers" role="group" aria-label="Contracts">{campaign.offers.map(c => {
        const on = c.id === contract?.id;
        return <button key={c.id} className={`offer${on ? ' selected' : ''}`} aria-pressed={on} style={threat(c.tier)} onClick={() => onChoose(c.id)}>
          <span className="offer-icon"><Icon name={c.type} /></span>
          <span className="offer-copy"><strong>{CONTRACTS[c.type].title}</strong><small>Sector {pad(c.sector)} · {c.district}</small></span>
          <span className="offer-side"><Credits value={c.payout} /><span className="offer-tier">T{c.tier}<Pips value={c.tier} max={MAX_TIER} label="Threat tier" /></span></span>
        </button>;
      })}</div>
      {campaign.offers.length ? null : <p className="empty-note">No contracts on the board.</p>}
    </section>

    <div className="select-center">
      {contract ? <div className="sector-tag" aria-hidden="true"><small>Sector {pad(contract.sector)}</small><strong>{contract.district}</strong></div> : null}
      <div className="map-hint"><button className="icon-button" aria-label="Recenter the map" title="Recenter the map" onClick={onRecenter}><Icon name="recenter" /></button><span>Scroll to zoom · right-drag to pan</span></div>
    </div>

    <section className="select-brief panel" aria-label="Briefing">
      <div className="brief-scroll">
        {contract ? <div className="brief" style={threat(contract.tier)}>
          <p className="kicker"><Icon name={contract.type} />Briefing · Tier {contract.tier}</p>
          <h3>{CONTRACTS[contract.type].title}</h3>
          <p className="brief-copy">{CONTRACTS[contract.type].brief}</p>
          <ol className="brief-objectives">{objectives.map((o, i) => <li key={i}><Icon name={o.kind === 'extract' ? 'flag' : 'diamond'} />{o.label}</li>)}</ol>
          <ul className="intel" aria-label="Known hostiles">{INTEL.map(({ kind, label, icon }) => {
            const n = plan?.enemies.filter(e => e.kind === kind).length ?? 0;
            return <li key={kind} className={n ? '' : 'none'}><Icon name={icon} /><b>{n}</b><small>{label}</small></li>;
          })}</ul>
          <div className="brief-pay">
            <div><small>Payout</small><Credits value={contract.payout} /></div>
            <div className="bonus"><small>No alarm</small><Credits value={missionPayout(contract, true)} /></div>
          </div>
        </div> : null}
        <fieldset className="squad-pick">
          <legend>Squad <span>{squadPick.length} / {SQUAD_MAX}</span></legend>
          <div className="roster-grid">{campaign.roster.map(o => {
            const on = squadPick.includes(o.id), locked = on ? squadPick.length <= 1 : squadPick.length >= SQUAD_MAX;
            return <button key={o.id} className={`pick cls-${o.cls}${on ? ' on' : ''}`} aria-pressed={on} aria-disabled={locked} aria-describedby={locked ? 'squad-rule' : undefined} onClick={() => { if (!locked) sim.toggleSquad(o.id); }}>
              <Portrait cls={o.cls} />
              <span className="pick-copy"><strong>{o.name}</strong><small>{CLASS_STATS[o.cls].title}</small><small className="pick-ability">{ABILITY_STATS[CLASS_STATS[o.cls].ability].name}</small></span>
              <span className="pick-slot" aria-hidden="true">{on ? squadPick.indexOf(o.id) + 1 : <Icon name="plus" />}</span>
            </button>;
          })}</div>
          <small id="squad-rule" className="pick-rule">Deploy 1 to {SQUAD_MAX} operatives.</small>
        </fieldset>
      </div>
      <div className="deploy-dock">
        {state.saveUnavailable ? <SaveWarning /> : null}
        <button className="btn primary deploy" onClick={onDeploy} disabled={deployBlocked || !contract}>
          <span className="deploy-copy"><strong>{connecting ? 'Connecting…' : 'Deploy squad'}</strong><small>{squadPick.length} operative{squadPick.length === 1 ? '' : 's'}{contract ? ` · ${CONTRACTS[contract.type].title} · Tier ${contract.tier}` : ''}</small></span>
          <Icon name="arrow" />
        </button>
      </div>
    </section>
  </div>;
}
