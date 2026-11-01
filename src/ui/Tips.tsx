import { useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { CALM_SECONDS, FIRST_WAVE_SECONDS, REVIVE_SECONDS } from '../game/simulation.ts';
import type { Milestone } from '../game/simulation.ts';
import { Icon } from './icons.tsx';
import type { IconName } from './icons.tsx';
import { tipStore } from './tipStore.ts';

const TIPS: Record<Milestone, [IconName, string, ReactNode]> = {
  hostileSeen: ['guard', 'Hostile in sight', <>Cones show what guards see. <kbd>Space</kbd> pauses.</>],
  suspicious: ['eye', 'You are being noticed', <>The ring over a hostile fills while it sees you; full means the alarm. Get out of its cone or behind a building and the ring drains.</>],
  alarm: ['alert', 'Alarm raised', <>Reinforcements arrive in {FIRST_WAVE_SECONDS} s. Stay out of every hostile's sight and range for {CALM_SECONDS} s and the alarm stands down.</>],
  abilityReady: ['snipe', 'Ability ready', <>Each operative has one. Press <kbd>Shift</kbd>+<kbd>1</kbd>–<kbd>4</kbd> or the button on its card; aimed abilities then need a target.</>],
  downed: ['squad', 'Operative down', <>Select a teammate and click the body to revive them ({REVIVE_SECONDS} s). Extraction waits for everyone.</>],
  extractOpen: ['flag', 'Extraction open', <>It counts only when every operative, downed ones included, stands in the zone.</>],
};

// Docked under the tracker, outside the play area. One tip at a time: the newest situation not yet dismissed,
// so dismissing it brings back an older one still waiting.
export function TipDock({ milestones }: { milestones: Milestone[] }) {
  const { enabled, seen } = useSyncExternalStore(tipStore.subscribe, tipStore.get);
  const id = enabled ? milestones.findLast(m => !seen.includes(m)) : undefined;
  if (!id) return <div className="tip-dock" aria-live="polite" />;
  const [icon, title, body] = TIPS[id];
  return <div className="tip-dock" aria-live="polite"><section key={id} className="tip panel" aria-label="Tip">
    <span className="tip-icon"><Icon name={icon} /></span>
    <span className="tip-copy"><small>Tip</small><strong>{title}</strong><span>{body}</span></span>
    <button className="tip-close icon-button" aria-label="Dismiss tip" onClick={() => tipStore.dismiss(id)}><Icon name="close" /></button>
  </section></div>;
}
