import { useRef } from 'react';
import type { RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { AdditiveBlending, CylinderGeometry, DoubleSide } from 'three';
import type { Group, Mesh } from 'three';
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

function Extraction({ sim, o, labels }: Props) {
  const ring = useRef<Mesh>(null);
  useFrame(({ clock }) => { if (ring.current) ring.current.rotation.z = clock.elapsedTime * .15; });
  const ready = () => sim.phase === 'mission' && sim.extractReady;
  return <group position={[o.x, .05, o.z]}>
    <Beacon color="#5ef2c0" active={ready} />
    <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[1.7, 1.77, 6]} /><meshBasicMaterial color="#83e5c4" transparent opacity={.8} /></mesh>
    <mesh rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[1.7, 40]} /><meshBasicMaterial color="#68e7bf" transparent opacity={.06} depthWrite={false} /></mesh>
    <Html portal={labels} center position={[0, .05, 1.9]} style={{ pointerEvents: 'none' }}><span className="extract-label">EXTRACTION</span></Html>
  </group>;
}

export function Objectives({ sim, objectives, labels }: { sim: Simulation; objectives: Objective[]; labels: RefObject<HTMLDivElement> }) {
  let charges = 0;
  return <>{objectives.map((o, i) => {
    const key = `${o.kind}-${i}`, props = { sim, index: i, o, labels };
    if (o.kind === 'terminal') return <Terminal key={key} {...props} />;
    if (o.kind === 'charge') return <Charge key={key} {...props} letter={'AB'[charges++] ?? ''} />;
    if (o.kind === 'extract') return <Extraction key={key} {...props} />;
    return null;
  })}</>;
}
