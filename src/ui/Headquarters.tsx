import type { RefObject } from 'react';
import { sim } from '../app.ts';
import { ABILITY_UPGRADE_COST, ARMOR_MODES, BADGES, GEAR_COST, MAX_LEVEL, RECRUIT_COST, ROSTER_CAP, unlockedCountermeasures, WEAPON_MODES } from '../game/campaign.ts';
import type { ArmorMode, Campaign, Operative, WeaponMode } from '../game/campaign.ts';
import { abilityCooldown, ABILITY_STATS, CLASSES, CLASS_STATS, effectScale } from '../game/classes.ts';
import { EXTENDED_RANGE, HEAVY_HP, LIGHT_CONCEALMENT, PIERCING_BONUS, SUPPRESSOR_STEP } from '../game/simulation.ts';
import { BADGE_COPY, CM_LEVEL, credits, Credits, LoadSaveCode, OperativeLabel, Pips, SaveCode, secs } from './common.tsx';
import { Icon } from './icons.tsx';
import type { IconName } from './icons.tsx';
import { play } from './audio.ts';

// How a gear level is spent in each mode, and what the stat line shows at a given level.
type ModeCopy = { label: string; detail: string; stat: string; value: (level: number) => string };
const WEAPON: Record<WeaponMode, ModeCopy> = {
  piercing: { label: 'Piercing', detail: 'Armor-piercing rounds hit harder', stat: 'Damage', value: l => `+${l * PIERCING_BONUS}` },
  suppressed: { label: 'Suppressed', detail: 'A hostile that survives a hit turns suspicious instead of raising the alarm', stat: 'Alert on a hit', value: l => `${Math.round((1 - SUPPRESSOR_STEP * l) * 100)}%` },
  extended: { label: 'Extended', detail: 'Longer barrels reach farther', stat: 'Range', value: l => `+${(l * EXTENDED_RANGE).toFixed(1)} m` },
};
const ARMOR: Record<ArmorMode, ModeCopy> = {
  heavy: { label: 'Heavy', detail: 'Subdermal armor soaks up fire', stat: 'Health', value: l => `+${l * HEAVY_HP}` },
  light: { label: 'Light', detail: 'A light weave keeps the squad out of notice', stat: 'Detection time', value: l => `+${Math.round(l * LIGHT_CONCEALMENT * 100)}%` },
};

type Modes = { label: string; options: { id: string; label: string }[]; value: string; onPick: (id: string) => void };
function Upgrade({ icon, title, detail, stat, now, next, level, cost, cash, cls, locked, modes, onBuy }: {
  icon: IconName; title: string; detail: string; stat: string; now: string; next: string; level: number; cost: number; cash: number; cls?: string; locked: boolean; modes?: Modes; onBuy: () => boolean;
}) {
  const maxed = level >= MAX_LEVEL, short = !maxed && cash < cost;
  return <div className={`upgrade${cls ? ` cls-${cls}` : ''}${maxed ? ' maxed' : ''}${modes ? ' has-modes' : ''}`}>
    <span className="upgrade-icon"><Icon name={icon} /></span>
    <div className="upgrade-copy">
      <h4>{title}</h4><p>{detail}</p>
      <p className="upgrade-stat"><small>{stat}</small>{now}{maxed ? null : <><Icon name="chevron" /><b>{next}</b></>}</p>
    </div>
    {modes ? <div className="upgrade-modes" role="group" aria-label={modes.label}>{modes.options.map(m =>
      <button key={m.id} className="btn ghost small" aria-pressed={modes.value === m.id} disabled={locked} onClick={() => { if (modes.value !== m.id) modes.onPick(m.id); }}>{m.label}</button>)}</div> : null}
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
  const loadout = campaign.loadout, weapon = WEAPON[loadout.weapon], armor = ARMOR[loadout.armor];
  return <div className="hq">
    <section className="hq-armory panel" aria-labelledby="ops-title">
      <header className="panel-head"><h2 id="ops-title" ref={titleRef} tabIndex={-1}>Armory</h2><span className="panel-meta">Upgrades apply to every operative</span></header>
      <div className="panel-scroll">
        <h3 className="section-title">Squad gear</h3>
        <div className="upgrades">
          <Upgrade icon="ammo" title="Smart ammunition" detail={weapon.detail} stat={weapon.stat} now={weapon.value(campaign.weapon)} next={weapon.value(campaign.weapon + 1)}
            level={campaign.weapon} cost={GEAR_COST.weapon} cash={cash} locked={locked} onBuy={() => sim.buy('weapon')}
            modes={{ label: 'Ammunition', options: WEAPON_MODES.map(id => ({ id, label: WEAPON[id].label })), value: loadout.weapon, onPick: id => sim.equip({ ...loadout, weapon: id as WeaponMode }) }} />
          <Upgrade icon="plating" title="Dermal plating" detail={armor.detail} stat={armor.stat} now={armor.value(campaign.armor)} next={armor.value(campaign.armor + 1)}
            level={campaign.armor} cost={GEAR_COST.armor} cash={cash} locked={locked} onBuy={() => sim.buy('armor')}
            modes={{ label: 'Plating', options: ARMOR_MODES.map(id => ({ id, label: ARMOR[id].label })), value: loadout.armor, onPick: id => sim.equip({ ...loadout, armor: id as ArmorMode }) }} />
        </div>
        <h3 className="section-title">Class abilities</h3>
        <div className="upgrades">{CLASSES.map(cls => {
          const ability = CLASS_STATS[cls].ability, level = campaign.abilities[cls];
          return <Upgrade key={cls} cls={cls} icon={ability} title={ABILITY_STATS[ability].name} detail={`${CLASS_STATS[cls].title} ability`} stat="Cooldown · effect"
            now={`${secs(abilityCooldown(ability, level))} · ${Math.round(effectScale(level) * 100)}%`} next={`${secs(abilityCooldown(ability, level + 1))} · ${Math.round(effectScale(level + 1) * 100)}%`}
            level={level} cost={ABILITY_UPGRADE_COST} cash={cash} locked={locked} onBuy={() => sim.buy(cls)} />;
        })}</div>
      </div>
    </section>

    <section className="hq-roster panel" aria-label="Roster">
      <header className="panel-head"><h3>Roster</h3><span className="panel-meta">{campaign.roster.length} / {ROSTER_CAP} operatives</span></header>
      <div className="panel-scroll">
        <ul className="roster-list">{campaign.roster.map(o => <li className="roster-row" key={o.id}><OperativeLabel op={o} />
          <button className="btn ghost small danger" onClick={() => onDismiss(o)} disabled={campaign.roster.length <= 1 || locked} aria-label={`Dismiss ${o.name}`}><Icon name="dismiss" />Dismiss</button></li>)}</ul>
        <h3 className="section-title">Recruits <small>New candidates after every deployment</small></h3>
        {campaign.recruits.length ? <ul className="roster-list recruits">{campaign.recruits.map(r => <li className="roster-row" key={r.id}><OperativeLabel op={r} />
          <button className="btn buy" data-cue="own" onClick={() => { if (sim.recruit(r.id)) play('purchase'); }} disabled={full || cash < RECRUIT_COST || locked}
            aria-label={full ? `Recruit ${r.name}: roster full` : `Recruit ${r.name} for ${credits(RECRUIT_COST)}`}>{full ? 'Roster full' : <><Icon name="recruit" /><Credits value={RECRUIT_COST} /></>}</button></li>)}</ul>
          : <p className="empty-note">No candidates right now. New recruits arrive after the next deployment.</p>}
        <h3 className="section-title">Countermeasures</h3>
        <p className="hq-note">{unlockedCountermeasures(campaign)
          ? `Open up to level ${CM_LEVEL[unlockedCountermeasures(campaign)]}; ${campaign.countermeasures ? `level ${CM_LEVEL[campaign.countermeasures]} cleared` : 'none cleared yet'}. Pick a level on the briefing: each makes contracts harder, and winning the highest open one with a badge opens the next.`
          : 'Max out every upgrade to open Countermeasures: an opt-in ladder of harder contracts.'}</p>
        <h3 className="section-title">Service record <small>Each badge counts half a contract toward clearance</small></h3>
        <ul className="badge-grid" aria-label="Badges earned">{BADGES.map(b => <li key={b}><Icon name={BADGE_COPY[b].icon} /><b>{campaign.badges[b]}</b><small>{BADGE_COPY[b].title}</small></li>)}</ul>
        {saveCode ? <SaveCode code={saveCode} /> : null}
        {connecting ? null : <div className="hq-load"><LoadSaveCode onLoaded={onLoaded} busy={loadingCode} setBusy={setLoadingCode} syncing={syncing} /></div>}
        <small className="footnote">Progress saves to your save code. Enter it on another device to continue there.</small>
      </div>
    </section>
  </div>;
}
