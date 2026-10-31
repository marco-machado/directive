import { useSyncExternalStore } from 'react';
import { preview, sound } from './audio.ts';
import type { Cue, Volume } from './audio.ts';
import { Dialog } from './common.tsx';
import { Icon } from './icons.tsx';

// Each slider previews its group with a short cue; music and ambience are heard through their loops.
const VOLUMES: [Volume, string, Cue | null][] = [
  ['master', 'Master', 'click'], ['music', 'Music', null], ['ambience', 'Ambience', null], ['sfx', 'Effects', 'shot'], ['ui', 'Interface', 'click'],
];

export function AudioDialog({ onClose }: { onClose: () => void }) {
  const settings = useSyncExternalStore(sound.subscribe, sound.settings);
  return <Dialog onClose={onClose} className="audio-dialog"><div className="dialog-body">
    <p className="kicker">Settings</p><h2 id="dialog-title">Audio</h2>
    <button className="menu-item" data-autofocus data-cue="own" aria-pressed={!settings.muted} onClick={sound.toggle}>
      <span className="menu-item-copy"><strong>Sound</strong><small>{settings.muted ? 'Off' : 'On'}</small></span><Icon name={settings.muted ? 'soundOff' : 'soundOn'} />
    </button>
    <div className="volumes">
      {VOLUMES.map(([volume, label, cue]) => {
        const percent = Math.round(settings[volume] * 100);
        return <label className="volume" key={volume}>
          <span>{label}</span>
          <input type="range" min={0} max={100} step={5} value={percent} disabled={settings.muted}
            onChange={e => { sound.setVolume(volume, Number(e.target.value) / 100); if (cue) preview(cue); }} />
          <output>{percent}%</output>
        </label>;
      })}
    </div>
  </div></Dialog>;
}
