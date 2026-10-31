import type { ReactNode } from 'react';
import type { ClassId } from '../game/classes.ts';

// Line icons on a 24-unit grid; stroke follows currentColor so CSS sets the tint.
// Contract types and ability ids double as icon names.
const PATHS = {
  assassination: <><circle cx="12" cy="12" r="7" /><path d="M12 2v5M12 17v5M2 12h5M17 12h5" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /></>,
  heist: <><path d="M7 7h10v10H7z" /><path d="M10 10h4v4h-4z" fill="currentColor" stroke="none" /><path d="M9.5 3v4M14.5 3v4M9.5 17v4M14.5 17v4M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4" /></>,
  sabotage: <><path d="M3 8.5h18V19H3z" /><path d="M3 13.75h18M16 8.5V4.5M7 16.5h4" /><circle cx="16" cy="3.5" r="1.2" fill="currentColor" stroke="none" /></>,
  escort: <><path d="M12 2.5l8 3v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10v-6z" /><circle cx="12" cy="10" r="2.3" /><path d="M8.3 16.6c.8-2 2.1-3 3.7-3s2.9 1 3.7 3" /></>,
  grenade: <><circle cx="11" cy="14.5" r="6.5" /><path d="M9 8V5.5h4V8M13 5.5l3-2.5 2.5 2M7.5 12.5h7M7.5 16.5h7" /></>,
  heal: <><path d="M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5z" /><path d="M12 8v8M8 12h8" /></>,
  snipe: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="3" /><path d="M12 1.5v6M12 16.5v6M1.5 12h6M16.5 12h6" /></>,
  emp: <><circle cx="12" cy="12" r="9.5" strokeDasharray="3.2 2.4" /><path d="M13.2 4.5L7.5 13h4.2l-1 6.5L16.5 11h-4.2z" /></>,
  pause: <path d="M8.5 5v14M15.5 5v14" strokeWidth="2.6" />,
  play: <path d="M7.5 4.5l12 7.5-12 7.5z" fill="currentColor" />,
  menu: <path d="M4 7h16M4 12h16M4 17h10" />,
  soundOn: <><path d="M3.5 9.5h4l5-4v13l-5-4h-4z" /><path d="M16 8.8a4.6 4.6 0 0 1 0 6.4M18.6 6.2a8.3 8.3 0 0 1 0 11.6" /></>,
  soundOff: <><path d="M3.5 9.5h4l5-4v13l-5-4h-4z" /><path d="M16 9.5l5 5M21 9.5l-5 5" /></>,
  help: <><path d="M8.8 9a3.2 3.2 0 1 1 4.8 2.8c-1 .6-1.6 1.2-1.6 2.4v.6" /><circle cx="12" cy="18.3" r="1.2" fill="currentColor" stroke="none" /></>,
  recenter: <><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" /><circle cx="12" cy="12" r="2.6" /></>,
  hold: <path d="M6.5 6.5h11v11h-11z" />,
  squad: <><circle cx="8" cy="8" r="2.6" /><circle cx="16" cy="8" r="2.6" /><path d="M3.3 18.5c.6-2.7 2.4-4.2 4.7-4.2s4.1 1.5 4.7 4.2M11.3 18.5c.6-2.7 2.4-4.2 4.7-4.2s4.1 1.5 4.7 4.2" /></>,
  restart: <><path d="M4.6 12.5A7.5 7.5 0 1 0 6.8 6.7" /><path d="M4.5 3v4.5H9" /></>,
  check: <path d="M4.5 12.5l5 5L19.5 7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  chevron: <path d="M9 4.5l7.5 7.5L9 19.5" />,
  arrow: <path d="M4 12h15M13 6l6 6-6 6" />,
  alert: <><path d="M12 3l10 18H2z" /><path d="M12 10v5" /><circle cx="12" cy="18" r="1.1" fill="currentColor" stroke="none" /></>,
  eye: <><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" /><circle cx="12" cy="12" r="2.8" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5.2l3.6 2.1" /></>,
  kills: <><path d="M12 3v4M12 17v4M3 12h4M17 12h4" /><path d="M8.5 8.5l7 7M15.5 8.5l-7 7" /></>,
  ammo: <><path d="M5.5 20V9.5l2.25-5 2.25 5V20zM14 20V9.5l2.25-5 2.25 5V20z" /><path d="M5.5 15.5H10M14 15.5h4.5" /></>,
  plating: <><path d="M12 2.5l8 3v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10v-6z" /><path d="M8 10.5h8M8 14h8" /></>,
  recruit: <><circle cx="9.5" cy="8" r="3.5" /><path d="M3 20c.8-3.6 3.3-5.5 6.5-5.5s5.7 1.9 6.5 5.5M18.5 7v6M15.5 10h6" /></>,
  dismiss: <><path d="M4 7h16M9 7V4h6v3M6.2 7l1 13h9.6l1-13" /></>,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  lock: <><path d="M5 11h14v9H5z" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="M11 12l8.5-8.5M16 7l2.5 2.5M13.5 9.5l2 2" /></>,
  copy: <><path d="M8.5 8.5h11v11h-11z" /><path d="M15.5 8.5v-4h-11v11h4" /></>,
  flag: <><path d="M5.5 21V3.5h12l-2.5 4 2.5 4h-12" /></>,
  diamond: <path d="M12 3l7 9-7 9-7-9z" />,
  guard: <><circle cx="12" cy="7" r="3.2" /><path d="M5.5 20.5c.7-4.3 3.2-7 6.5-7s5.8 2.7 6.5 7" /></>,
  heavy: <><path d="M8.5 3.5h7l1 6h-9z" /><path d="M4 20.5l1.5-7.5h13l1.5 7.5" /></>,
  camera: <><path d="M3 7.5h12.5v7H3z" /><path d="M15.5 9.5L21 7v8l-5.5-2.5M8 14.5V21" /></>,
  turret: <><path d="M4.5 20.5h15M7 20.5v-5h10v5M9 15.5V11h6v4.5" /><path d="M15 12.5h6.5" /></>,
} satisfies Record<string, ReactNode>;
export type IconName = keyof typeof PATHS;

export const Icon = ({ name, className }: { name: IconName; className?: string }) =>
  <svg className={`icon${className ? ` ${className}` : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true">{PATHS[name]}</svg>;


export const Logo = ({ className }: { className?: string }) =>
  <svg className={`logo${className ? ` ${className}` : ''}`} viewBox="0 0 40 40" aria-hidden="true">
    <path d="M20 2.5l15.2 8.75v17.5L20 37.5 4.8 28.75v-17.5z" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <path d="M13.5 27V13.5l13 13V13" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="square" />
    <path d="M26.5 6.5L15.5 33.5" stroke="var(--amber)" strokeWidth="2.4" />
  </svg>;

// Helmet silhouettes per class; the visor glows in the class color set by the .cls-* parent.
const HELMET: Record<ClassId, ReactNode> = {
  assault: <>
    <path d="M10 66l4-13 10-5h16l10 5 4 13z" fill="#1a2c30" />
    <path d="M8 56l9-7 6 4-7 9zM56 56l-9-7-6 4 7 9z" fill="#2a4246" />
    <path d="M19 25l4-11h18l4 11v15l-6 8H25l-6-8z" fill="#2c4448" />
    <path d="M21 27h22v6H21z" fill="var(--cls)" className="visor" />
    <path d="M23 14h18l-1 4H24z" fill="#3c5a5c" />
  </>,
  support: <>
    <path d="M10 66l4-13 10-5h16l10 5 4 13z" fill="#1a2c30" />
    <path d="M20 22c2-8 7-11 12-11s10 3 12 11v18l-6 8H26l-6-8z" fill="#2c4448" />
    <path d="M22 28h20l-2 5H24z" fill="var(--cls)" className="visor" />
    <path d="M30.5 15h3v7h-3zM28.5 17h7v3h-7z" fill="var(--cls)" opacity=".7" />
  </>,
  recon: <>
    <path d="M10 66l4-13 10-5h16l10 5 4 13z" fill="#1a2c30" />
    <path d="M13 50l5-28c3-8 8-11 14-11s11 3 14 11l5 28-8-5H21z" fill="#24393c" />
    <path d="M22 26h20v16l-4 5H26l-4-5z" fill="#33504f" />
    <path d="M23 29h18v4H23z" fill="#0d1a1d" />
    <circle cx="36" cy="31" r="3.2" fill="var(--cls)" className="visor" />
  </>,
  tech: <>
    <path d="M10 66l4-13 10-5h16l10 5 4 13z" fill="#1a2c30" />
    <path d="M42 15l6-10" stroke="#4d6a6a" strokeWidth="1.6" />
    <circle cx="48.5" cy="4.5" r="1.8" fill="var(--cls)" className="visor" />
    <path d="M20 23l4-9h16l4 9v17l-6 8H26l-6-8z" fill="#2c4448" />
    <path d="M22 28h8v4h-8zM34 28h8v4h-8z" fill="var(--cls)" className="visor" />
    <path d="M24 38h16v2H24z" fill="#1b2e31" />
  </>,
};

export const Portrait = ({ cls, className }: { cls: ClassId; className?: string }) =>
  <svg className={`portrait cls-${cls}${className ? ` ${className}` : ''}`} viewBox="0 0 64 66" preserveAspectRatio="xMidYMax slice" aria-hidden="true">{HELMET[cls]}</svg>;
