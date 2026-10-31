import type { RefObject } from 'react';
import { sim } from '../app.ts';
import { ABILITY_UPGRADE_COST, GEAR_COST, MAX_LEVEL, RECRUIT_COST, ROSTER_CAP } from '../game/campaign.ts';
import type { Campaign, Operative } from '../game/campaign.ts';
import { abilityCooldown, ABILITY_STATS, CLASSES, CLASS_STATS, effectScale } from '../game/classes.ts';
import { ARMOR_BONUS, WEAPON_BONUS } from '../game/simulation.ts';
import { credits, Credits, LoadSaveCode, OperativeLabel, Pips, SaveCode, secs } from './common.tsx';
import { Icon } from './icons.tsx';
import type { IconName } from './icons.tsx';
import { play } from './sfx.ts';

function Upgrade({ icon, title, detail, stat, now, next, level, cost, cash, cls, locked, onBuy }: {
  icon: IconName; title: string; detail: string; stat: string; now: string; next: string; level: number; cost: number; cash: number; cls?: string; locked: boolean; onBuy: () => boolean;
}) {
  const maxed = level >= MAX_LEVEL, short = !maxed && cash < cost;
  return <div className={`upgrade${cls ? ` cls-${cls}` : ''}${maxed ? ' maxed' : ''}`}>
    <span className="upgrade-icon"><Icon name={icon} /></span>
    <div className="upgrade-copy">
      <h4>{title}</h4><p>{detail}</p>
      <p className="upgrade-stat"><small>{stat}</small>{now}{maxed ? null : <><Icon name="chevron" /><b>{next}</b></>}</p>
    </div>
    <Pips value={level} max={MAX_LEVEL} label="Level" className="level" />
    <button className={`btn buy${short ? ' short' : ''}`} data-cue="own" onClick={() => { if (onBuy()) play('purchase'); }} disabled={maxed || short || locked}
      aria-label={maxed ? `${title}: maxed` : `Upgrade ${title} for ${credits(cost)}`}>{maxed ? 'Max' : <Credits value={cost} />}</button>
  </div>;
}

export function Headquarters({ campaign, saveCode, titleRef, onDismiss, connecting, syncing, loadingCode, setLoadingCode, onLoaded }: {
  campaign: Campaign; saveCode: string | null; titleRef: RefObject<HTMLHeadingElement | null>; onDismiss: (op: Operative) => void;
  connecting: boolean; syncing: boolean; loadingCode: boolean; setLoadingCode: (busy: boolean) => void; onLoaded: (code: string) => void;
}) {
  const cash = campaign.cash, full = campaign.roster.length >= ROSTER_CAP;
  // Trades made while the save is still connecting, or while another one loads, can be lost.
  const locked = connecting || loadingCode;
  return <div className="hq">
    <section className="hq-armory panel" aria-labelledby="ops-title">
      <header className="panel-head"><h2 id="ops-title" ref={titleRef} tabIndex={-1}>Armory</h2><span className="panel-meta">Upgrades apply to every operative</span></header>
      <h3 className="section-title">Squad gear</h3>
      <div className="upgrades">
        <Upgrade icon="ammo" title="Smart ammunition" detail="Armor-piercing rounds for the whole squad" stat="Damage" now={`+${campaign.weapon * WEAPON_BONUS}`} next={`+${(campaign.weapon + 1) * WEAPON_BONUS}`}
          level={campaign.weapon} cost={GEAR_COST.weapon} cash={cash} locked={locked} onBuy={() => sim.buy('weapon')} />
        <Upgrade icon="plating" title="Dermal plating" detail="Subdermal armor for every operative" stat="Health" now={`+${campaign.armor * ARMOR_BONUS}`} next={`+${(campaign.armor + 1) * ARMOR_BONUS}`}
          level={campaign.armor} cost={GEAR_COST.armor} cash={cash} locked={locked} onBuy={() => sim.buy('armor')} />
      </div>
      <h3 className="section-title">Class abilities</h3>
      <div className="upgrades">{CLASSES.map(cls => {
        const ability = CLASS_STATS[cls].ability, level = campaign.abilities[cls];
        return <Upgrade key={cls} cls={cls} icon={ability} title={ABILITY_STATS[ability].name} detail={`${CLASS_STATS[cls].title} ability`} stat="Cooldown · effect"
          now={`${secs(abilityCooldown(ability, level))} · ${Math.round(effectScale(level) * 100)}%`} next={`${secs(abilityCooldown(ability, level + 1))} · ${Math.round(effectScale(level + 1) * 100)}%`}
          level={level} cost={ABILITY_UPGRADE_COST} cash={cash} locked={locked} onBuy={() => sim.buy(cls)} />;
      })}</div>
    </section>

    <section className="hq-roster panel" aria-label="Roster">
      <header className="panel-head"><h3>Roster</h3><span className="panel-meta">{campaign.roster.length} / {ROSTER_CAP} operatives</span></header>
      <ul className="roster-list">{campaign.roster.map(o => <li className="roster-row" key={o.id}><OperativeLabel op={o} />
        <button className="btn ghost small danger" onClick={() => onDismiss(o)} disabled={campaign.roster.length <= 1 || locked} aria-label={`Dismiss ${o.name}`}><Icon name="dismiss" />Dismiss</button></li>)}</ul>
      <h3 className="section-title">Recruits <small>New candidates after every deployment</small></h3>
      {campaign.recruits.length ? <ul className="roster-list recruits">{campaign.recruits.map(r => <li className="roster-row" key={r.id}><OperativeLabel op={r} />
        <button className="btn buy" data-cue="own" onClick={() => { if (sim.recruit(r.id)) play('purchase'); }} disabled={full || cash < RECRUIT_COST || locked}
          aria-label={full ? `Recruit ${r.name}: roster full` : `Recruit ${r.name} for ${credits(RECRUIT_COST)}`}>{full ? 'Roster full' : <><Icon name="recruit" /><Credits value={RECRUIT_COST} /></>}</button></li>)}</ul>
        : <p className="empty-note">No candidates right now. New recruits arrive after the next deployment.</p>}
      {saveCode ? <SaveCode code={saveCode} /> : null}
      {connecting ? null : <div className="hq-load"><LoadSaveCode onLoaded={onLoaded} busy={loadingCode} setBusy={setLoadingCode} syncing={syncing} /></div>}
      <small className="footnote">Progress saves to your save code. Enter it on another device to continue there.</small>
    </section>
  </div>;
}
