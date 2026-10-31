// Synthesized UI and combat cues (Web Audio, no files). The context starts on the first cue,
// which always follows a click, so autoplay rules never block it.
export type Cue = 'click' | 'select' | 'order' | 'deploy' | 'alarm' | 'objective' | 'down' | 'revive' | 'reinforce'
  | 'success' | 'failure' | 'purchase' | 'aim' | 'grenade' | 'emp' | 'heal' | 'snipe' | 'shot';

const MUTE_KEY = 'ndMuted';
let muted = (() => { try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; } })();
const listeners = new Set<() => void>();
let ctx: AudioContext | null = null, out: GainNode | null = null, noise: AudioBuffer | null = null, lastShot = 0;

export const sound = {
  subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
  muted: () => muted,
  toggle: () => {
    muted = !muted;
    try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* the toggle still works for this session */ }
    listeners.forEach(fn => fn());
    if (!muted) play('click');
  },
};

function audio() {
  if (!ctx) {
    try { ctx = new AudioContext(); } catch { return null; }
    const limiter = ctx.createDynamicsCompressor();
    out = ctx.createGain(); out.gain.value = .32;
    out.connect(limiter).connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

type Tone = { f: number; to?: number; at?: number; dur: number; type?: OscillatorType; gain?: number };
function tone(c: AudioContext, { f, to, at = 0, dur, type = 'square', gain = .18 }: Tone) {
  const t = c.currentTime + at, osc = c.createOscillator(), env = c.createGain();
  osc.type = type; osc.frequency.setValueAtTime(f, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(gain, t + .006); env.gain.exponentialRampToValueAtTime(.0001, t + dur);
  osc.connect(env).connect(out!); osc.start(t); osc.stop(t + dur + .02);
}
type Hiss = { at?: number; dur: number; filter: BiquadFilterType; f: number; to?: number; gain?: number };
function hiss(c: AudioContext, { at = 0, dur, filter, f, to, gain = .2 }: Hiss) {
  const t = c.currentTime + at, src = c.createBufferSource(), biquad = c.createBiquadFilter(), env = c.createGain();
  src.buffer = noise; biquad.type = filter; biquad.frequency.setValueAtTime(f, t);
  if (to) biquad.frequency.exponentialRampToValueAtTime(to, t + dur);
  env.gain.setValueAtTime(gain, t); env.gain.exponentialRampToValueAtTime(.0001, t + dur);
  src.connect(biquad).connect(env).connect(out!); src.start(t); src.stop(t + dur + .02);
}

const CUES: Record<Cue, (c: AudioContext) => void> = {
  click: c => tone(c, { f: 1500, to: 1100, dur: .035, gain: .05 }),
  select: c => { tone(c, { f: 660, dur: .06, type: 'triangle', gain: .12 }); tone(c, { f: 990, at: .05, dur: .07, type: 'triangle', gain: .1 }); },
  order: c => { tone(c, { f: 520, to: 820, dur: .08, type: 'triangle', gain: .12 }); tone(c, { f: 1640, at: .07, dur: .03, gain: .03 }); },
  aim: c => tone(c, { f: 1300, to: 700, dur: .12, type: 'sine', gain: .12 }),
  deploy: c => {
    tone(c, { f: 110, to: 440, dur: .55, type: 'sawtooth', gain: .08 });
    [440, 554, 659].forEach((f, i) => tone(c, { f, at: .35 + i * .07, dur: .4, type: 'triangle', gain: .09 }));
  },
  alarm: c => { for (let i = 0; i < 4; i++) tone(c, { f: i % 2 ? 620 : 880, at: i * .19, dur: .18, gain: .1 }); },
  objective: c => [784, 1047, 1319].forEach((f, i) => tone(c, { f, at: i * .09, dur: .3, type: 'sine', gain: .14 })),
  down: c => { tone(c, { f: 160, to: 55, dur: .4, type: 'sawtooth', gain: .12 }); hiss(c, { dur: .25, filter: 'lowpass', f: 600, gain: .12 }); },
  revive: c => { tone(c, { f: 440, to: 880, dur: .25, type: 'sine', gain: .12 }); tone(c, { f: 1320, at: .2, dur: .2, type: 'sine', gain: .08 }); },
  reinforce: c => { for (let i = 0; i < 3; i++) tone(c, { f: 98, at: i * .16, dur: .14, gain: .12 }); },
  success: c => [523, 659, 784, 1047].forEach((f, i) => tone(c, { f, at: i * .1, dur: i === 3 ? .6 : .2, type: 'triangle', gain: .13 })),
  failure: c => [392, 311, 233].forEach((f, i) => tone(c, { f, at: i * .18, dur: .34, type: 'sawtooth', gain: .08 })),
  purchase: c => { tone(c, { f: 988, dur: .07, gain: .07 }); tone(c, { f: 1319, at: .07, dur: .16, gain: .07 }); },
  grenade: c => { hiss(c, { dur: .7, filter: 'lowpass', f: 1400, to: 120, gain: .5 }); tone(c, { f: 90, to: 38, dur: .5, type: 'sine', gain: .35 }); },
  emp: c => { tone(c, { f: 1800, to: 120, dur: .45, type: 'sawtooth', gain: .07 }); hiss(c, { dur: .35, filter: 'highpass', f: 3000, gain: .1 }); },
  heal: c => [523, 784, 1047].forEach((f, i) => tone(c, { f, at: i * .06, dur: .35, type: 'sine', gain: .09 })),
  snipe: c => { hiss(c, { dur: .18, filter: 'highpass', f: 1800, gain: .3 }); tone(c, { f: 2200, to: 180, dur: .16, type: 'triangle', gain: .1 }); },
  shot: c => hiss(c, { dur: .05, filter: 'bandpass', f: 2600, gain: .06 }),
};

export function play(cue: Cue) {
  if (muted) return;
  if (cue === 'shot') { const now = performance.now(); if (now - lastShot < 70) return; lastShot = now; }
  const c = audio(); if (c) CUES[cue](c);
}
