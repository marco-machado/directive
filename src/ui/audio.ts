// Game audio: ElevenLabs-generated samples in public/audio, played through Web Audio volume groups.
// The context starts on the first pointer or key press, so autoplay rules never block it.
import { Vector3 } from 'three';
import type { Camera } from 'three';
import type { Point } from '../game/world.ts';

export type Cue = 'click' | 'select' | 'order' | 'aim' | 'purchase' | 'deploy' | 'alarm' | 'objective' | 'down' | 'revive' | 'reinforce'
  | 'grenade' | 'emp' | 'heal' | 'snipe' | 'shot' | 'hostileShot' | 'turretShot' | 'impact' | 'kill' | 'destroy' | 'suspicious';
export type Volume = 'master' | 'music' | 'ambience' | 'sfx' | 'ui';
export type AudioSettings = Record<Volume, number> & { muted: boolean };
// What the game is doing, which decides the music and ambience loops.
export type Mood = { mission: boolean; alarm: boolean; paused: boolean };

// gain levels the generated files against each other (measured RMS and peak), before the group volume.
// gap: the fewest milliseconds between two plays, for cues that can fire many times a second.
type CueSpec = { files: string[]; group: 'sfx' | 'ui'; gain: number; gap?: number };
const variants = (name: string, n: number) => Array.from({ length: n }, (_, i) => `sfx/${name}-${i + 1}`);
const CUES: Record<Cue, CueSpec> = {
  click: { files: ['sfx/ui-click'], group: 'ui', gain: .8 },
  select: { files: ['sfx/ui-select'], group: 'ui', gain: .65 },
  order: { files: ['sfx/ui-order'], group: 'ui', gain: .55 },
  aim: { files: ['sfx/ui-aim'], group: 'ui', gain: .4 },
  purchase: { files: ['sfx/ui-purchase'], group: 'ui', gain: .75 },
  deploy: { files: ['sfx/deploy'], group: 'sfx', gain: .55 },
  alarm: { files: ['sfx/alarm'], group: 'sfx', gain: .5 },
  objective: { files: ['sfx/objective'], group: 'sfx', gain: .6 },
  down: { files: ['sfx/down'], group: 'sfx', gain: .8 },
  revive: { files: ['sfx/revive'], group: 'sfx', gain: .6 },
  reinforce: { files: ['sfx/reinforce'], group: 'sfx', gain: 1 },
  grenade: { files: ['sfx/grenade'], group: 'sfx', gain: 1 },
  emp: { files: ['sfx/emp'], group: 'sfx', gain: .6 },
  heal: { files: ['sfx/heal'], group: 'sfx', gain: .9 },
  snipe: { files: ['sfx/snipe'], group: 'sfx', gain: 1.5 },
  shot: { files: variants('shot-squad', 3), group: 'sfx', gain: .45, gap: 60 },
  hostileShot: { files: variants('shot-hostile', 3), group: 'sfx', gain: .5, gap: 60 },
  turretShot: { files: variants('shot-turret', 2), group: 'sfx', gain: .45, gap: 90 },
  impact: { files: variants('impact', 3), group: 'sfx', gain: .3, gap: 50 },
  kill: { files: variants('kill-human', 2), group: 'sfx', gain: .8 },
  destroy: { files: ['sfx/kill-machine'], group: 'sfx', gain: 1.4 },
  suspicious: { files: ['sfx/suspicious'], group: 'sfx', gain: 3, gap: 400 },
};
type Loop = 'music/menu' | 'music/stealth' | 'music/combat' | 'ambience/city' | 'ambience/sirens';
const LOOP_GAIN: Record<Loop, number> = { 'music/menu': .95, 'music/stealth': .37, 'music/combat': .73, 'ambience/city': 1.3, 'ambience/sirens': 1.5 };
const STINGERS = { success: 'music/success', failure: 'music/failure' } as const;
const FADE = 1.6, STINGER_SECONDS = 4, STINGER_GAIN = .6;

const SETTINGS_KEY = 'ndAudio';
const DEFAULTS: AudioSettings = { muted: false, master: .8, music: .5, ambience: .6, sfx: .9, ui: .7 };
let settings: AudioSettings = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as Partial<AudioSettings> | null;
    return { ...DEFAULTS, muted: localStorage.getItem('ndMuted') === '1', ...saved };
  } catch { return DEFAULTS; }
})();
const listeners = new Set<() => void>();
function change(next: Partial<AudioSettings>) {
  settings = { ...settings, ...next };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* the settings still apply for this session */ }
  applyVolumes();
  listeners.forEach(fn => fn());
}

export const sound = {
  subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
  settings: () => settings,
  toggle: () => { change({ muted: !settings.muted }); if (!settings.muted) play('click'); },
  setVolume: (volume: Volume, value: number) => change({ [volume]: value }),
};

type Graph = { ctx: AudioContext; master: GainNode; groups: Record<Exclude<Volume, 'master'>, GainNode>; duck: GainNode; muffle: BiquadFilterNode };
let graph: Graph | null = null;
const buffers = new Map<string, AudioBuffer>(), loading = new Map<string, Promise<void>>();
const loops = new Map<Loop, { src: AudioBufferSourceNode; gain: GainNode }>();
const lastPlayed = new Map<Cue, number>();
// Combat sounds still ringing, cut when the mission pauses; and the stinger, cut when a mission starts.
const combat = new Set<AudioBufferSourceNode>();
let playingStinger: AudioBufferSourceNode | null = null;
let mood: Mood = { mission: false, alarm: false, paused: false }, stingerUntil = 0, camera: Camera | null = null;

function audio() {
  if (!graph) {
    let ctx: AudioContext;
    try { ctx = new AudioContext(); } catch { return null; }
    const limiter = ctx.createDynamicsCompressor(), master = ctx.createGain();
    master.connect(limiter).connect(ctx.destination);
    // Music and ambience pass through a duck that muffles them while the mission is paused.
    const duck = ctx.createGain(), muffle = ctx.createBiquadFilter();
    muffle.type = 'lowpass'; muffle.frequency.value = 20000;
    muffle.connect(duck).connect(master);
    const group = (to: AudioNode) => { const g = ctx.createGain(); g.connect(to); return g; };
    graph = { ctx, master, duck, muffle, groups: { music: group(muffle), ambience: group(muffle), sfx: group(master), ui: group(master) } };
    applyVolumes();
    for (const spec of Object.values(CUES)) spec.files.forEach(load);
    Object.values(STINGERS).forEach(load);
    applyMood();
  }
  if (graph.ctx.state === 'suspended' && !document.hidden) void graph.ctx.resume();
  return graph;
}

function load(file: string) {
  if (!loading.has(file)) loading.set(file, fetch(`${import.meta.env.BASE_URL}audio/${file}.mp3`)
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
    .then(data => graph!.ctx.decodeAudioData(data))
    .then(buffer => { buffers.set(file, buffer); }, err => { console.warn(`Audio ${file} failed to load`, err); }));
  return loading.get(file)!;
}

function applyVolumes() {
  if (!graph) return;
  const t = graph.ctx.currentTime;
  graph.master.gain.setTargetAtTime(settings.muted ? 0 : settings.master, t, .03);
  (['music', 'ambience', 'sfx', 'ui'] as const).forEach(v => graph!.groups[v].gain.setTargetAtTime(settings[v], t, .03));
}

// Places a world point in the stereo field and fades it as it leaves the camera's view.
const projected = new Vector3();
function placement(at: Point | undefined) {
  if (!at || !camera) return { pan: 0, level: 1 };
  projected.set(at.x, .5, at.z).project(camera);
  const off = Math.max(Math.abs(projected.x), Math.abs(projected.y));
  return { pan: Math.max(-1, Math.min(1, projected.x)) * .7, level: off <= 1 ? 1 : Math.max(.12, 1 / (1 + (off - 1) * 3)) };
}
export const setAudioCamera = (next: Camera | null) => { camera = next; };

export function play(cue: Cue, at?: Point) {
  const spec = CUES[cue];
  // A paused mission makes no combat sounds (positional effects); previews and interface cues still play.
  const isCombat = spec.group === 'sfx' && !!at;
  if (settings.muted || (isCombat && mood.paused)) return;
  if (spec.gap) {
    const now = performance.now();
    if (now - (lastPlayed.get(cue) ?? -Infinity) < spec.gap) return;
    lastPlayed.set(cue, now);
  }
  const g = audio(), buffer = buffers.get(spec.files[Math.floor(Math.random() * spec.files.length)]);
  if (!g || !buffer) return;
  const { pan, level } = placement(at);
  const src = g.ctx.createBufferSource(), gain = g.ctx.createGain(), panner = g.ctx.createStereoPanner();
  src.buffer = buffer; src.playbackRate.value = spec.files.length > 1 || spec.gap ? .94 + Math.random() * .12 : 1;
  gain.gain.value = spec.gain * level; panner.pan.value = pan;
  src.connect(gain).connect(panner).connect(g.groups[spec.group]); src.start();
  if (isCombat) { combat.add(src); src.onended = () => combat.delete(src); }
}

// The end-of-mission stinger; the menu music waits for it to finish.
export function stinger(result: keyof typeof STINGERS) {
  const g = audio(), buffer = buffers.get(STINGERS[result]);
  if (!g || !buffer || settings.muted) return;
  const src = g.ctx.createBufferSource(), gain = g.ctx.createGain();
  src.buffer = buffer; gain.gain.value = STINGER_GAIN; src.connect(gain).connect(g.groups.music); src.start();
  playingStinger = src; src.onended = () => { if (playingStinger === src) playingStinger = null; };
  stingerUntil = performance.now() + STINGER_SECONDS * 1000;
  applyMood();
}

export function setMood(next: Mood) {
  if (next.mission && !mood.mission) { playingStinger?.stop(); playingStinger = null; stingerUntil = 0; }
  mood = next; applyMood();
}

function applyMood() {
  if (!graph) return;
  const t = graph.ctx.currentTime, { mission, alarm, paused } = mood;
  graph.duck.gain.setTargetAtTime(paused ? .4 : 1, t, .15);
  graph.muffle.frequency.setTargetAtTime(paused ? 700 : 20000, t, .15);
  if (paused) { combat.forEach(src => src.stop()); combat.clear(); }
  const wait = Math.max(0, (stingerUntil - performance.now()) / 1000);
  setLoop('music/menu', !mission, wait);
  setLoop('music/stealth', mission && !alarm);
  setLoop('music/combat', mission && alarm);
  setLoop('ambience/city', mission);
  setLoop('ambience/sirens', mission && alarm);
}

function setLoop(id: Loop, on: boolean, delay = 0) {
  const g = graph!, t = g.ctx.currentTime, playing = loops.get(id);
  if (!on) {
    if (!playing) return;
    loops.delete(id);
    playing.gain.gain.cancelScheduledValues(t); playing.gain.gain.setValueAtTime(playing.gain.gain.value, t);
    playing.gain.gain.linearRampToValueAtTime(0, t + FADE); playing.src.stop(t + FADE + .05);
    return;
  }
  if (playing) return;
  const buffer = buffers.get(id);
  // One load attempt per loop: a file that fails stays silent instead of retrying.
  if (!buffer) { if (!loading.has(id)) void load(id).then(applyMood); return; }
  const src = g.ctx.createBufferSource(), gain = g.ctx.createGain();
  src.buffer = buffer; src.loop = true;
  gain.gain.value = 0; gain.gain.setValueAtTime(0, t + delay); gain.gain.linearRampToValueAtTime(LOOP_GAIN[id], t + delay + FADE);
  src.connect(gain).connect(g.groups[id.startsWith('music') ? 'music' : 'ambience']); src.start(t + delay);
  loops.set(id, { src, gain });
}

// The first gesture starts the context and loads the samples; a hidden page goes quiet.
const unlock = () => { if (audio()?.ctx.state === 'running') ['pointerdown', 'keydown', 'touchend'].forEach(e => window.removeEventListener(e, unlock, true)); };
['pointerdown', 'keydown', 'touchend'].forEach(e => window.addEventListener(e, unlock, true));
document.addEventListener('visibilitychange', () => {
  if (!graph) return;
  void (document.hidden ? graph.ctx.suspend() : graph.ctx.resume());
});
