import type { ReactNode } from 'react';
import { STEALTH_BONUS } from '../game/campaign.ts';
import { CALM_SECONDS, REINFORCE_SECONDS } from '../game/simulation.ts';
import { Dialog, SaveCode } from './common.tsx';
import { Icon } from './icons.tsx';
import type { IconName } from './icons.tsx';

const CONTROLS: [ReactNode, string][] = [
  [<><kbd>1</kbd>–<kbd>4</kbd> or click a card</>, 'Select that operative'],
  [<><kbd>Shift</kbd> + click</>, 'Add or remove from the selection'],
  [<><kbd>A</kbd></>, 'Select the surviving squad'],
  [<><kbd>Shift</kbd> + <kbd>1</kbd>–<kbd>4</kbd></>, "Use that operative's ability; aimed abilities then need a target on the map"],
  [<><kbd>Esc</kbd></>, 'Cancel an ability; otherwise pause'],
  ['Click street', 'Move around buildings'],
  ['Click hostile', 'Approach and concentrate fire'],
  ['Click a downed operative', 'The nearest selected teammate revives them'],
  [<><kbd>S</kbd></>, 'Hold position'],
  [<><kbd>Space</kbd></>, 'Pause and queue orders'],
  ['Drag / one-finger drag', 'Rotate and tilt the view'],
  ['Scroll / pinch', 'Zoom the view'],
  ['Right-drag / two-finger drag', 'Pan the view'],
  [<><kbd>R</kbd></>, 'Recenter the view'],
];
const RULES: [IconName, string][] = [
  ['eye', 'Before the alarm, the squad only fires at targets you order.'],
  ['camera', 'Hostiles and cameras see in vision cones. Stay in one too long and the alarm sounds.'],
  ['snipe', 'Sniper shots are silent. Grenades are loud and raise the alarm at once. A hostile that survives a hit raises it too.'],
  ['flag', 'Extraction counts only when every operative, downed ones included, is in the zone. Revive the fallen first.'],
  ['alert', `After the alarm, reinforcements arrive every ${REINFORCE_SECONDS} s. Stay out of every hostile's sight and range for ${CALM_SECONDS} s and it stands down.`],
  ['check', `Extract without ever raising the alarm for +${Math.round(STEALTH_BONUS * 100)}% payout. A stood-down alarm still voids the bonus.`],
];

export function Manual({ saveCode, onClose }: { saveCode: string | null; onClose: () => void }) {
  return <Dialog onClose={onClose} className="manual">
    <div className="dialog-body">
      <p className="kicker">Operator manual</p>
      <h2 id="dialog-title">Take command</h2>
      <div className="manual-grid">
        <section aria-labelledby="manual-controls"><h3 id="manual-controls" className="section-title">Controls</h3>
          <dl className="controls-list">{CONTROLS.map(([key, action], i) => <div key={i}><dt>{key}</dt><dd>{action}</dd></div>)}</dl></section>
        <section aria-labelledby="manual-stealth"><h3 id="manual-stealth" className="section-title">Stealth</h3>
          <ul className="rules">{RULES.map(([icon, text]) => <li key={icon}><Icon name={icon} />{text}</li>)}</ul>
          {saveCode ? <SaveCode code={saveCode} /> : null}</section>
      </div>
      <button className="btn primary" data-autofocus onClick={onClose}><span>Close manual</span><Icon name="check" /></button>
    </div>
  </Dialog>;
}
