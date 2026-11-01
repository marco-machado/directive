import { Component, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, ErrorInfo, FormEvent, ReactNode } from 'react';
import { client, sim } from '../app.ts';
import type { ContractType, Operative } from '../game/campaign.ts';
import { ABILITY_STATS, CLASS_STATS } from '../game/classes.ts';
import { formatSaveCode, normalizeSaveCode } from '../game/saveCode.ts';
import { HACK_SECONDS, VIP_SECURE_SECONDS } from '../game/simulation.ts';
import { ApiError, fetchCampaign, rememberSaveCode } from '../net/campaignClient.ts';
import { Icon, Portrait } from './icons.tsx';
import { sound } from './audio.ts';

export const CONTRACTS: Record<ContractType, { title: string; brief: string }> = {
  assassination: { title: 'Assassination', brief: 'Neutralize the target, then extract. Once the alarm sounds, the target runs for an exit.' },
  heist: { title: 'Data heist', brief: `Hold the vault terminal for ${HACK_SECONDS} seconds to download the data, then extract.` },
  sabotage: { title: 'Sabotage', brief: 'Plant a charge at every site, then extract.' },
  escort: { title: 'Escort', brief: `Stay beside the VIP for ${VIP_SECURE_SECONDS} seconds to free them, then escort them to extraction. Under fire, the VIP ducks behind cover near the squad; if they die, the contract fails.` },
};
export const pad = (n: number) => String(n).padStart(2, '0');
export const clock = (seconds: number) => `${pad(Math.floor(seconds / 60))}:${pad(Math.floor(seconds % 60))}`;
export const secs = (n: number) => `${Number(n.toFixed(1))} s`;
export const credits = (n: number) => `₡ ${n.toLocaleString()}`;
// Threat color per tier, from a soft mint to alarm red.
const THREAT = ['', 'var(--mint)', 'var(--mint)', 'var(--amber)', 'var(--red)', 'var(--red)'];
export const threat = (tier: number) => ({ '--threat': THREAT[tier] ?? 'var(--red)' }) as CSSProperties;

export const Credits = ({ value, className }: { value: number; className?: string }) =>
  <span className={`credits${className ? ` ${className}` : ''}`}><i aria-hidden="true">₡</i>{value.toLocaleString()}</span>;

export const Pips = ({ value, max, label, className = '' }: { value: number; max: number; label: string; className?: string }) =>
  <span className={`pips ${className}`} role="img" aria-label={`${label} ${value} of ${max}`}>{Array.from({ length: max }, (_, i) => <i className={value > i ? 'on' : ''} key={i} />)}</span>;

export const SaveWarning = () => <p className="warning"><Icon name="alert" />Server unreachable. Progress from this session is not saved.</p>;

export function AudioButton({ onOpen, className = '' }: { onOpen: () => void; className?: string }) {
  const { muted } = useSyncExternalStore(sound.subscribe, sound.settings);
  return <button className={`icon-button ${className}`} aria-label={muted ? 'Audio settings, sound off' : 'Audio settings'} aria-haspopup="dialog" onClick={onOpen}><Icon name={muted ? 'soundOff' : 'soundOn'} /></button>;
}

export const OperativeLabel = ({ op }: { op: Operative }) =>
  <span className={`op cls-${op.cls}`}>
    <Portrait cls={op.cls} />
    <span className="op-copy"><strong>{op.name}</strong><small>{CLASS_STATS[op.cls].title} · {ABILITY_STATS[CLASS_STATS[op.cls].ability].name}</small></span>
  </span>;

export function SaveCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const pretty = formatSaveCode(code);
  const copy = () => navigator.clipboard.writeText(pretty).then(() => setCopied(true), () => setCopied(false));
  return <div className="save-code"><Icon name="key" /><span className="save-code-copy"><small>SAVE CODE</small><strong>{pretty}</strong></span>
    <button className="btn ghost small" onClick={copy}><Icon name={copied ? 'check' : 'copy'} />{copied ? 'Copied' : 'Copy'}</button></div>;
}

// Loading a code drops actions not yet sent, so Load is disabled while they sync.
export function LoadSaveCode({ onLoaded, busy, setBusy, syncing }: { onLoaded: (code: string) => void; busy: boolean; setBusy: (busy: boolean) => void; syncing: boolean }) {
  const [value, setValue] = useState(''), [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const code = normalizeSaveCode(value);
    if (!code) { setError('Save codes have 12 letters and digits, like 7KQ2-M9XD-4TRB.'); return; }
    setBusy(true); setError('');
    try {
      const campaign = await fetchCampaign(code);
      rememberSaveCode(code); client.attach(sim, code); sim.applyCampaign(campaign); sim.setSaveUnavailable(false);
      setValue(''); onLoaded(code);
    } catch (err) { setError(err instanceof ApiError && err.status === 404 ? 'No campaign uses that code.' : 'Server unreachable. Try again.'); }
    finally { setBusy(false); }
  };
  return <form className="load-code" onSubmit={submit}>
    <label htmlFor="load-code-input">Enter a save code from another device</label>
    <div><input id="load-code-input" value={value} onChange={e => setValue(e.target.value)} placeholder="XXXX-XXXX-XXXX" autoComplete="off" spellCheck={false} />
      <button className="btn" type="submit" disabled={busy || syncing || !value.trim()}>{busy ? 'Loading…' : syncing ? 'Saving…' : 'Load'}</button></div>
    {error ? <p className="warning" role="alert"><Icon name="alert" />{error}</p> : null}
  </form>;
}

export class RenderBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('3D renderer failed', error, info.componentStack); }
  render() { return this.state.failed ? <div className="render-error"><h2>The 3D renderer could not start.</h2><p>Enable hardware acceleration and reload the page.</p><button className="btn primary" onClick={() => location.reload()}>Reload game</button></div> : this.props.children; }
}

// Native modal: the browser traps focus, inerts the page and returns focus on close.
export function Dialog({ children, onClose, className = '' }: { children: ReactNode; onClose: () => void; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current; el?.showModal();
    el?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => el?.close();
  }, []);
  return <dialog ref={ref} className={className} aria-labelledby="dialog-title" onCancel={e => { e.preventDefault(); onClose(); }}>
    <button className="dialog-close icon-button" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
    {children}
  </dialog>;
}
