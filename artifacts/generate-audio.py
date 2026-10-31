"""Generates the Neon Directive audio set through the ElevenLabs sound-effects endpoint. Skips files that exist.
Usage: python3 artifacts/generate-audio.py <project root>, with ELEVENLABS_API_KEY set."""
import os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

ROOT = sys.argv[1]
SCRIPT = os.path.join(ROOT, '.claude/skills/threejs-audio-generator/scripts/threejs_audio_asset.py')
NV = 'no music, no voice'
SHOT = f'short suppressed tactical rifle shot for top-down cyberpunk squad tactics game, tight mechanical crack, subtle sci-fi electric zip, clear transient, 0.3s tail, {NV}, readable under gameplay mix'
HOSTILE = f'short security guard submachine gun shot, harsher and dirtier than a suppressed rifle, sharp punchy crack, top-down cyberpunk tactics game, 0.3s tail, {NV}'
TURRET = f'automated security turret firing a short three-round burst, heavy mechanical servo rattle, electric gun discharge, cyberpunk, {NV}'
IMPACT = f'bullet impact hitting body armor and concrete, short dull thwack with a small ricochet, {NV}'
KILL = f'enemy security guard collapses after being shot, armored body drops on concrete, weapon clatters, {NV}'
MUSIC = 'dark synthwave instrumental music loop, 100 BPM, minor key, neon cyberpunk, seamless loop, steady energy, no intro, no fade-out, no vocals'

# (path, seconds, prompt influence, loop, prompt), in priority order
ITEMS = [
  ('sfx/shot-squad-1', .5, .7, False, SHOT), ('sfx/shot-squad-2', .5, .7, False, SHOT),
  ('sfx/shot-squad-3', .5, .7, False, SHOT),
  ('sfx/shot-hostile-1', .5, .7, False, HOSTILE), ('sfx/shot-hostile-2', .5, .7, False, HOSTILE), ('sfx/shot-hostile-3', .5, .7, False, HOSTILE),
  ('sfx/shot-turret-1', .7, .7, False, TURRET), ('sfx/shot-turret-2', .7, .7, False, TURRET),
  ('sfx/impact-1', .5, .7, False, IMPACT), ('sfx/impact-2', .5, .7, False, IMPACT), ('sfx/impact-3', .5, .7, False, IMPACT),
  ('sfx/kill-human-1', 1, .65, False, KILL), ('sfx/kill-human-2', 1, .65, False, KILL),
  ('sfx/kill-machine', 1.2, .65, False, f'security camera or gun turret destroyed, electronics spark burst, short electric fizzle and metal clank, {NV}'),
  ('sfx/suspicious', .8, .75, False, f'stealth game suspicion alert sting, short tense rising synth blip, a guard noticed something, subtle, {NV}'),
  ('sfx/snipe', 1.2, .65, False, f'suppressed high-powered sniper rifle shot, sharp crack and heavy mechanical bolt cycle, subtle electric hum, short echo off city buildings, {NV}'),
  ('sfx/grenade', 2, .6, False, 'frag grenade explosion in a city street, punchy blast, debris and glass scatter, deep low end, short concrete reverb tail, no music'),
  ('sfx/emp', 1.5, .65, False, 'EMP pulse detonation, sci-fi electric discharge, crackling static burst with a descending power-down whine of electronics, no music'),
  ('sfx/heal', 1.2, .65, False, f'field heal nanite burst, soft shimmering sci-fi swell with a gentle pulse, calming, short tail, {NV}'),
  ('sfx/down', 1.2, .65, False, f'operative knocked down in combat, body falls on concrete with gear clatter and an armor thud, {NV}'),
  ('sfx/revive', 1.2, .65, False, f'medical revive cue, defibrillator charge whine and a soft electric pulse thump, hopeful bright tail, sci-fi, {NV}'),
  ('sfx/deploy', 1.8, .6, False, 'mission start sound for cyberpunk squad tactics, dropship door hydraulics opening, power-up whoosh and rising synth swell, no voice, no melody'),
  ('sfx/alarm', 2, .7, False, f'corporate security alarm klaxon burst in a neon cyberpunk tower, two-tone electronic warning, urgent, {NV}'),
  ('sfx/objective', 1.2, .7, False, 'objective complete cue for a tactical game, clean digital data-confirm chime with soft rising tones, satisfying, no voice'),
  ('sfx/reinforce', 1.6, .6, False, f'enemy reinforcements arriving, heavy armored van doors slam and boots on concrete, distant, tense, {NV}'),
  ('sfx/ui-click', .5, .8, False, f'tiny premium holographic interface click for a cyberpunk game menu, soft crisp tick, very short glassy tail, no harsh beep, {NV}'),
  ('sfx/ui-select', .5, .8, False, f'short operative select chirp for a cyberpunk squad tactics interface, two quick soft digital blips rising, clean, {NV}'),
  ('sfx/ui-order', .5, .8, False, f'short move order confirm for a tactical squad game, soft radio click and a bright digital acknowledge tick, {NV}'),
  ('sfx/ui-aim', .5, .8, False, f'short targeting reticle lock-on sound, descending digital sweep, tense, cyberpunk tactical interface, {NV}'),
  ('sfx/ui-purchase', .7, .8, False, f'short purchase confirm for a futuristic armory upgrade, credit chip transaction chime with a mechanical latch, bright, {NV}'),
  ('ambience/city', 30, .4, True, f'seamless looping night city ambience in a rainy cyberpunk corporate district, distant traffic hum, light rain, buzzing neon signs, faint ventilation, {NV}'),
  ('ambience/sirens', 20, .4, True, f'seamless looping distant police sirens wailing across a city at night, far away, overlapping, faint helicopter, {NV}'),
  ('music/stealth', 30, .5, True, f'{MUSIC}, low pulsing analog bass, sparse muted drums, cold arpeggio, tense restrained stealth infiltration'),
  ('music/combat', 30, .5, True, f'{MUSIC}, driving drums, aggressive distorted analog bass, fast arpeggio, urgent firefight, high energy'),
  ('music/menu', 30, .5, True, f'{MUSIC}, moody analog pads, slow pulsing bass, distant arpeggio, brooding briefing room theme'),
  ('music/success', 4, .55, False, 'short dark synthwave victory stinger, triumphant analog synth chord rise, ends cleanly, instrumental, no vocals'),
  ('music/failure', 4, .55, False, 'short dark synthwave defeat stinger, descending minor analog synth chords, somber, ends cleanly, instrumental, no vocals'),
]

def run(item):
    path, seconds, influence, loop, prompt = item
    out = os.path.join(ROOT, 'public/audio', path + '.mp3')
    if os.path.exists(out): return f'skip {path}'
    cmd = [sys.executable, SCRIPT, 'sfx', '--prompt', prompt, '--duration', str(seconds), '--prompt-influence', str(influence), '--out', out]
    if loop: cmd.append('--loop')
    r = subprocess.run(cmd, capture_output=True, text=True)
    return f'{"ok" if r.returncode == 0 else "FAIL"} {path} {r.stderr.strip()[-300:]}'

with ThreadPoolExecutor(3) as pool:
    for line in pool.map(run, ITEMS): print(line, flush=True)
