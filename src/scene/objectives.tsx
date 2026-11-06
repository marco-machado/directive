import { useRef } from 'react';
import type { RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { AdditiveBlending, CylinderGeometry, DoubleSide } from 'three';
import type { Group, Mesh } from 'three';
import { cacheLetter, PICKUP_RADIUS, VIP_REACH } from '../game/simulation.ts';
import type { Objective, Simulation } from '../game/simulation.ts';
import { Box, ProgressRing, STILL } from './parts.tsx';

type Props = { sim: Simulation; index: number; o: Objective; labels: RefObject<HTMLDivElement> };
const progress = (sim: Simulation, index: number) => () => sim.objectives[index]?.progress ?? 0;
const open = (sim: Simulation, index: number) => () => sim.phase !== 'headquarters' && !sim.objectives[index]?.done;
const TUBE = new CylinderGeometry(1, 1, 1, 16, 1, true), BEAM_HEIGHT = 7;

// A light column over an open objective so it reads from anywhere on the map.
function Beacon({ color, active }: { color: string; active: () => boolean }) {
  const ref = useRef<Group>(null), halo = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current || !halo.current) return;
    ref.current.visible = active();
    const pulse = STILL ? 1 : 1 + Math.sin(clock.elapsedTime * 2.4) * .14;
    halo.current.scale.set(.34 * pulse, BEAM_HEIGHT, .34 * pulse);
  });
  return <group ref={ref} visible={false}>
    <mesh geometry={TUBE} position={[0, BEAM_HEIGHT / 2, 0]} scale={[.05, BEAM_HEIGHT, .05]}><meshBasicMaterial color={color} transparent opacity={.6} blending={AdditiveBlending} depthWrite={false} toneMapped={false} /></mesh>
    <mesh ref={halo} geometry={TUBE} position={[0, BEAM_HEIGHT / 2, 0]}><meshBasicMaterial color={color} transparent opacity={.07} blending={AdditiveBlending} side={DoubleSide} depthWrite={false} toneMapped={false} /></mesh>
  </group>;
}

function Label({ labels, text, done, y = 1.6 }: { labels: RefObject<HTMLDivElement>; text: string; done: boolean; y?: number }) {
  return <Html portal={labels} center position={[0, y, 0]} style={{ pointerEvents: 'none' }}><span className={`objective-label${done ? ' done' : ''}`}>{text}</span></Html>;
}

function Terminal({ sim, index, o, labels }: Props) {
  const screen = useRef<Mesh>(null);
  useFrame(({ clock }) => { if (screen.current) screen.current.visible = !!sim.objectives[index]?.done || Math.sin(clock.elapsedTime * 3) > -.85; });
  return <group position={[o.x, 0, o.z]}>
    <group rotation={[0, Math.PI / 4, 0]}>
      <Box position={[0, .38, 0]} size={[.56, .76, .4]} color="#314247" castShadow />
      <Box position={[0, .8, .06]} size={[.62, .1, .5]} color="#455350" castShadow />
      <mesh ref={screen} position={[0, 1.02, .1]} rotation={[-.45, 0, 0]}><boxGeometry args={[.52, .32, .03]} /><meshBasicMaterial color={o.done ? '#9ff7d1' : '#73dfca'} toneMapped={false} /></mesh>
      <Box position={[.29, .4, .21]} size={[.03, .5, .02]} color="#ffb17d" emissive="#ffb17d" />
    </group>
    <ProgressRing radius={1.5} color="#73dfca" value={progress(sim, index)} segments={40} />
    <Beacon color="#ffb454" active={open(sim, index)} />
    <Label labels={labels} text="VAULT TERMINAL" done={o.done} />
  </group>;
}

function Charge({ sim, index, o, labels, letter }: Props & { letter: string }) {
  const charge = useRef<Group>(null), light = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    const done = !!sim.objectives[index]?.done;
    if (charge.current) charge.current.visible = done;
    if (light.current) light.current.visible = Math.sin(clock.elapsedTime * 9) > 0;
  });
  return <group position={[o.x, 0, o.z]}>
    <ProgressRing radius={1.2} color="#ffb17d" value={progress(sim, index)} segments={32} />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .035, 0]}><circleGeometry args={[1.2, 40]} /><meshBasicMaterial color="#ffb17d" transparent opacity={.05} depthWrite={false} /></mesh>
    <group ref={charge} visible={false}>
      <Box position={[0, .14, 0]} size={[.4, .28, .3]} color="#3b3330" castShadow />
      <Box position={[0, .29, 0]} size={[.3, .03, .2]} color="#1c2427" />
      <mesh ref={light} position={[.08, .32, .05]}><boxGeometry args={[.08, .05, .08]} /><meshBasicMaterial color="#ff5a4a" toneMapped={false} /></mesh>
    </group>
    <Beacon color="#ffb454" active={open(sim, index)} />
    <Label labels={labels} text={`CHARGE ${letter}`} done={o.done} y={1} />
  </group>;
}

// A Smash and grab cache: a crate that springs open, with a lid that lifts once it is done.
function Cache({ sim, index, o, labels }: Props) {
  const lid = useRef<Group>(null);
  useFrame(() => { if (lid.current) { const done = !!sim.objectives[index]?.done; lid.current.rotation.x = done ? -1.1 : 0; } });
  return <group position={[o.x, 0, o.z]}>
    <ProgressRing radius={1.2} color="#ffd77a" value={progress(sim, index)} segments={32} />
    <Box position={[0, .25, 0]} size={[.7, .5, .5]} color="#4a4034" castShadow />
    <group ref={lid} position={[0, .5, -.25]}><Box position={[0, .03, .25]} size={[.72, .06, .52]} color="#5c5040" /></group>
    <Box position={[0, .3, .26]} size={[.12, .1, .02]} color="#ffd77a" emissive="#ffd77a" />
    <Beacon color="#ffd77a" active={open(sim, index)} />
    <Label labels={labels} text={`CACHE ${cacheLetter(o)}`} done={o.done} y={1.1} />
  </group>;
}

// A Surveillance executive: a ring at its feet that fills as an operative watches it, over it while seen and at the
// last place it was seen otherwise. It goes once the executive is tagged or lost.
const TAG_BLUE = '#8fd3ff';
function Tag({ sim, index, o, labels }: Props) {
  const ref = useRef<Group>(null);
  useFrame(() => {
    const live = sim.objectives[index], u = live?.unit ? sim.units.find(v => v.id === live.unit) : undefined;
    if (!ref.current || !live) return;
    ref.current.visible = sim.phase === 'mission' && !live.done && !live.lost;
    const at = u?.visible ? u : live;
    ref.current.position.set(at.x, 0, at.z);
  });
  return <group ref={ref} position={[o.x, 0, o.z]}>
    <ProgressRing radius={.9} color={TAG_BLUE} value={progress(sim, index)} segments={32} />
    <Beacon color={TAG_BLUE} active={open(sim, index)} />
    <Label labels={labels} text={`EXEC ${cacheLetter(o)}`} done={false} y={2.1} />
  </group>;
}

// The VIP's hold: the ring fills while an operative stands within reach, and goes once they are free.
function VipHold({ sim, index, o }: Props) {
  const ref = useRef<Group>(null);
  useFrame(() => { if (ref.current) ref.current.visible = !sim.objectives[index]?.done; });
  return <group ref={ref} position={[o.x, 0, o.z]}><ProgressRing radius={VIP_REACH} color="#ffe7a8" value={progress(sim, index)} segments={48} /></group>;
}

// A called extraction's zone appears only once the pickup is called, where it was called, with its countdown.
function Extraction({ sim, o, labels }: Props) {
  const ring = useRef<Mesh>(null), root = useRef<Group>(null), disk = useRef<Group>(null), label = useRef<HTMLSpanElement>(null);
  useFrame(({ clock }) => {
    if (ring.current) ring.current.rotation.z = clock.elapsedTime * .15;
    const zone = sim.objectives.at(-1), called = sim.calledExtraction, p = sim.pickup;
    if (root.current) { root.current.visible = !called || !!p; if (zone) root.current.position.set(zone.x, .05, zone.z); }
    if (disk.current) disk.current.scale.setScalar(called ? PICKUP_RADIUS / 2 : 1);
    const text = !called ? 'EXTRACTION' : p && p.in > 0 ? `PICKUP ${Math.ceil(p.in)} s` : 'PICKUP';
    if (label.current && label.current.textContent !== text) label.current.textContent = text;
  });
  const ready = () => sim.phase === 'mission' && sim.extractReady && (!sim.calledExtraction || !!sim.pickup && sim.pickup.in <= 0);
  return <group ref={root} position={[o.x, .05, o.z]}>
    <Beacon color="#5ef2c0" active={ready} />
    <group ref={disk}>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[1.7, 1.77, 6]} /><meshBasicMaterial color="#83e5c4" transparent opacity={.8} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[1.7, 40]} /><meshBasicMaterial color="#68e7bf" transparent opacity={.06} depthWrite={false} /></mesh>
    </group>
    <Html portal={labels} center position={[0, .05, 1.9]} style={{ pointerEvents: 'none' }}><span ref={label} className="extract-label">EXTRACTION</span></Html>
  </group>;
}

const TARGET_RED = '#ff6d5c', EXIT_RED = '#ff5148';
const targetUnit = (sim: Simulation) => sim.units.find(u => u.kind === 'target');

// The target's last known area while it is out of sight, a reticle on it once seen, and its exit once it runs.
function Target({ sim, index, labels }: Props) {
  const area = useRef<Group>(null), spin = useRef<Mesh>(null), reticle = useRef<Group>(null), exit = useRef<Group>(null);
  const areaLabel = useRef<HTMLSpanElement>(null), exitLabel = useRef<HTMLSpanElement>(null);
  const r = sim.targetArea?.r ?? 6;
  const show = (el: HTMLElement | null, on: boolean) => { if (el && el.hidden === on) el.hidden = !on; };
  useFrame(({ clock }) => {
    const u = targetUnit(sim), live = open(sim, index)() && !!u && u.hp > 0, seen = live && sim.phase === 'mission' && !!u?.visible && !u.guise, a = sim.targetArea;
    if (area.current) { area.current.visible = live && !seen && !!a; if (a) area.current.position.set(a.x, .05, a.z); }
    if (spin.current) spin.current.rotation.z = STILL ? 0 : clock.elapsedTime * -.12;
    show(areaLabel.current, live && !seen && !!a);
    if (reticle.current) {
      reticle.current.visible = seen;
      if (u) reticle.current.position.set(u.x, .05, u.z);
      reticle.current.rotation.y = STILL ? 0 : clock.elapsedTime * 1.2;
    }
    const to = live && sim.phase === 'mission' ? u?.exit : null;
    if (exit.current) { exit.current.visible = !!to; if (to) exit.current.position.set(to.x, 0, to.z); }
    show(exitLabel.current, !!to);
  });
  return <>
    <group ref={area} visible={false}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[r - .09, r, 64]} /><meshBasicMaterial color={TARGET_RED} transparent opacity={.75} depthWrite={false} toneMapped={false} /></mesh>
      <mesh ref={spin} rotation={[-Math.PI / 2, 0, 0]} position={[0, .005, 0]}><ringGeometry args={[r + .18, r + .3, 48, 1, 0, Math.PI / 6]} /><meshBasicMaterial color={TARGET_RED} transparent opacity={.55} depthWrite={false} toneMapped={false} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[r, 64]} /><meshBasicMaterial color={TARGET_RED} transparent opacity={.06} depthWrite={false} /></mesh>
      <Html portal={labels} center position={[0, .05, 0]} style={{ pointerEvents: 'none' }}><span ref={areaLabel} hidden className="objective-label target">{sim.plan?.contract.type === 'intercept' ? 'COURIER AREA' : 'TARGET AREA'}</span></Html>
    </group>
    <group ref={reticle} visible={false}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[.85, .95, 4, 1, Math.PI / 4]} /><meshBasicMaterial color={TARGET_RED} transparent opacity={.9} depthWrite={false} toneMapped={false} /></mesh>
      <Beacon color={TARGET_RED} active={() => true} />
    </group>
    <group ref={exit} visible={false}>
      <Box position={[0, 1.2, 0]} size={[.08, 2.4, .08]} color="#2a1f1e" />
      <mesh position={[.48, 2.1, 0]}><planeGeometry args={[.95, .6]} /><meshBasicMaterial color={EXIT_RED} side={DoubleSide} toneMapped={false} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .05, 0]}><ringGeometry args={[1, 1.08, 40]} /><meshBasicMaterial color={EXIT_RED} transparent opacity={.8} depthWrite={false} toneMapped={false} /></mesh>
      <Beacon color={EXIT_RED} active={() => true} />
      <Html portal={labels} center position={[0, .05, 1.6]} style={{ pointerEvents: 'none' }}><span ref={exitLabel} hidden className="objective-label exit">TARGET EXIT</span></Html>
    </group>
  </>;
}

// A carry contract's package: a case at its carrier's side, or on the ground under a beacon once dropped.
const PACKAGE_GOLD = '#ffd77a';
function Package({ sim, labels }: { sim: Simulation; labels: RefObject<HTMLDivElement> }) {
  const root = useRef<Group>(null), ground = useRef<Group>(null), label = useRef<HTMLSpanElement>(null);
  useFrame(() => {
    const c = sim.phase === 'mission' ? sim.cargo : null, carrier = c?.carrier ? sim.units.find(u => u.id === c.carrier) : undefined;
    if (!root.current || !ground.current) return;
    root.current.visible = !!c;
    if (!c) { if (label.current) label.current.hidden = true; return; }
    const side = carrier ? carrier.heading + Math.PI / 2 : 0;
    root.current.position.set(c.x + (carrier ? Math.sin(side) * .32 : 0), carrier ? .55 : .14, c.z + (carrier ? Math.cos(side) * .32 : 0));
    root.current.rotation.y = carrier ? carrier.heading : 0;
    ground.current.visible = !carrier;
    if (label.current && label.current.hidden === !carrier) label.current.hidden = !!carrier;
  });
  return <group ref={root} visible={false}>
    <Box position={[0, 0, 0]} size={[.42, .28, .16]} color="#5a4a2a" castShadow />
    <Box position={[0, .17, 0]} size={[.16, .05, .04]} color="#2a2421" />
    <group ref={ground}>
      <Beacon color={PACKAGE_GOLD} active={() => true} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -.1, 0]}><ringGeometry args={[.6, .67, 32]} /><meshBasicMaterial color={PACKAGE_GOLD} transparent opacity={.8} depthWrite={false} toneMapped={false} /></mesh>
      <Html portal={labels} center position={[0, 1.2, 0]} style={{ pointerEvents: 'none' }}><span ref={label} hidden className="objective-label">PACKAGE</span></Html>
    </group>
  </group>;
}

export function Objectives({ sim, objectives, labels }: { sim: Simulation; objectives: Objective[]; labels: RefObject<HTMLDivElement> }) {
  let charges = 0;
  return <><Package sim={sim} labels={labels} />{objectives.map((o, i) => {
    const key = `${o.kind}-${i}`, props = { sim, index: i, o, labels };
    if (o.kind === 'target') return <Target key={key} {...props} />;
    if (o.kind === 'terminal') return <Terminal key={key} {...props} />;
    if (o.kind === 'charge') return <Charge key={key} {...props} letter={'AB'[charges++] ?? ''} />;
    if (o.kind === 'cache') return <Cache key={key} {...props} />;
    if (o.kind === 'extract') return <Extraction key={key} {...props} />;
    if (o.kind === 'vip') return <VipHold key={key} {...props} />;
    if (o.kind === 'tag') return <Tag key={key} {...props} />;
    return null;
  })}</>;
}
