import { memo, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { ComponentRef, RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import { Color, Group, InstancedMesh, Mesh, MOUSE, Object3D, Vector3 } from 'three';
import { BUILDINGS, EXTRACT } from '../game/world.ts';
import type { Building } from '../game/world.ts';
import type { Simulation } from '../game/simulation.ts';

const UP = new Vector3(0, 1, 0);
function Box({ position, size, color, emissive, ...rest }: { position: [number, number, number]; size: [number, number, number]; color: string; emissive?: string; castShadow?: boolean; receiveShadow?: boolean }) {
  return <mesh position={position} {...rest}><boxGeometry args={size} /><meshStandardMaterial color={color} roughness={.75} metalness={.18} emissive={emissive} emissiveIntensity={.7} /></mesh>;
}

function BuildingBlock({ b }: { b: Building }) {
  return <group position={[b.x, 0, b.z]}>
    <Box position={[0, .12, 0]} size={[b.w + .5, .24, b.d + .5]} color="#455350" receiveShadow />
    <Box position={[0, b.h / 2 + .24, 0]} size={[b.w, b.h, b.d]} color="#314247" castShadow receiveShadow />
    <Box position={[0, b.h + .3, 0]} size={[b.w + .12, .2, b.d + .12]} color="#526060" castShadow />
    <Box position={[0, b.h + .61, 0]} size={[b.w * .45, .45, b.d * .4]} color="#29383c" castShadow />
    <Box position={[0, .65, b.d / 2 + .03]} size={[1.2, .8, .08]} color="#162b30" />
    <Box position={[0, 1.2, b.d / 2 + .08]} size={[b.w * .7, .09, .1]} color={b.accent} emissive={b.accent} />
    <Box position={[b.w / 2 + .015, b.h * .45, 0]} size={[.06, .1, b.d * .7]} color={b.accent} emissive={b.accent} />
    <Box position={[-b.w * .28, b.h + .6, -b.d * .2]} size={[.5, .5, .8]} color="#73807c" />
  </group>;
}

function Windows() {
  const ref = useRef<InstancedMesh>(null);
  const windows = useMemo(() => BUILDINGS.flatMap((b, bi) => {
    const list: { x: number; y: number; z: number; side: boolean; color: string }[] = [];
    for (let y = 1.8; y < b.h - .3; y += .72) {
      for (let x = -b.w / 2 + .5; x < b.w / 2 - .3; x += .75) list.push({ x: b.x + x, y, z: b.z + b.d / 2 + .016, side: false, color: ((Math.round(y * 10 + x) + bi) % 4) ? '#89a9a2' : '#e6b981' });
      for (let z = -b.d / 2 + .5; z < b.d / 2 - .3; z += .75) list.push({ x: b.x + b.w / 2 + .016, y, z: b.z + z, side: true, color: '#6e9b98' });
    }
    return list;
  }), []);
  useLayoutEffect(() => {
    const dummy = new Object3D(), color = new Color();
    windows.forEach((w, i) => { dummy.position.set(w.x, w.y, w.z); dummy.rotation.y = w.side ? Math.PI / 2 : 0; dummy.updateMatrix(); ref.current!.setMatrixAt(i, dummy.matrix); ref.current!.setColorAt(i, color.set(w.color)); });
    ref.current!.instanceMatrix.needsUpdate = true;
    if (ref.current!.instanceColor) ref.current!.instanceColor.needsUpdate = true;
  }, [windows]);
  return <instancedMesh ref={ref} args={[undefined, undefined, windows.length]}><boxGeometry args={[.35, .28, .018]} /><meshBasicMaterial toneMapped={false} /></instancedMesh>;
}

const City = memo(function City() {
  return <group>
    <Box position={[0, -.35, 0]} size={[33, .65, 25]} color="#1a292e" receiveShadow />
    <Box position={[0, -.02, 0]} size={[32, .05, 24]} color="#2d3a3e" receiveShadow />
    {BUILDINGS.map(b => <BuildingBlock key={b.name} b={b} />)}
    <Windows />
    {Array.from({ length: 16 }, (_, i) => <Box key={`lane-${i}`} position={[-15 + i * 2, .015, 5.3]} size={[.8, .02, .075]} color="#647167" />)}
    {[-.5, .5].map(x => <Box key={x} position={[x, .015, -5]} size={[.065, .02, 12]} color="#7a775f" />)}
    {[-.6, 0, .6].map(z => <Box key={z} position={[8, .025, z - 1.5]} size={[2.1, .02, .22]} color="#7b8981" />)}
    {[[-14, -1], [1, 4.8], [8, -10], [7, 9]].map(([x, z], i) => <group key={i} position={[x, 0, z]}>
      <Box position={[0, 1.4, 0]} size={[.1, 2.8, .1]} color="#5c6d6a" />
      <Box position={[.25, 2.8, 0]} size={[.7, .1, .18]} color="#f2d5a1" emissive="#f2d5a1" />
    </group>)}
    <group position={[-10, 0, 1]} rotation={[0, .1, 0]}>
      <Box position={[0, .35, 0]} size={[1, .55, 2.1]} color="#4a6568" castShadow />
      <Box position={[0, .76, -.2]} size={[.85, .35, 1]} color="#203239" castShadow />
      <Box position={[0, .35, 1.06]} size={[.75, .1, .05]} color="#ffe3b0" emissive="#ffe3b0" />
    </group>
    <gridHelper args={[32, 32, '#37484a', '#37484a']} position={[0, -.002, 0]} />
  </group>;
});

function Agent({ sim, id, labels }: { sim: Simulation; id: string; labels: RefObject<HTMLDivElement> }) {
  const root = useRef<Group>(null), model = useRef<Group>(null), ring = useRef<Mesh>(null), leg = useRef<Group>(null);
  const state = useSyncExternalStore(sim.subscribe, sim.getSnapshot);
  const u = state.units.find(v => v.id === id)!;
  const color = u.enemy ? (u.executive ? '#ffbd83' : '#ed7e70') : '#9ff7d1';
  const selected = state.selected.includes(id);
  useFrame(({ clock }) => {
    const unit = sim.units.find(v => v.id === id)!;
    if (!root.current || !model.current) return;
    root.current.visible = unit.hp > 0;
    root.current.position.set(unit.x, 0, unit.z);
    model.current.rotation.y = unit.heading;
    model.current.position.y = unit.moving && !sim.paused ? Math.sin(clock.elapsedTime * 17) * .035 : 0;
    if (leg.current) leg.current.rotation.x = unit.moving && !sim.paused ? Math.sin(clock.elapsedTime * 17) * .4 : 0;
    if (ring.current) ring.current.visible = sim.selected.includes(id) && !unit.enemy;
  });
  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation(); if (e.delta > 5) return;
    if (u.enemy) sim.attack(id); else sim.select(id, e.shiftKey);
  };
  return <group ref={root} position={[u.x, 0, u.z]}>
    <group ref={model} onClick={click}>
      <mesh position={[0, .7, 0]} visible={false}><boxGeometry args={[.95, 1.5, .95]} /><meshBasicMaterial /></mesh>
      <Box position={[0, .65, 0]} size={[.47, .62, .32]} color={u.enemy ? '#673e3b' : '#466766'} castShadow />
      <Box position={[0, 1.12, .02]} size={[.29, .32, .3]} color={u.executive ? '#b0a18d' : '#697e7a'} castShadow />
      <Box position={[0, 1.16, .18]} size={[.29, .07, .035]} color={color} emissive={color} />
      <Box position={[.31, .72, .24]} size={[.13, .15, .59]} color="#122429" castShadow />
      <Box position={[-.31, .72, .03]} size={[.12, .4, .13]} color="#526b66" />
      <group ref={leg} position={[0, .35, 0]}>
        <Box position={[-.13, -.15, 0]} size={[.15, .35, .2]} color="#192f33" castShadow />
        <Box position={[.13, -.15, 0]} size={[.15, .35, .2]} color="#192f33" castShadow />
      </group>
    </group>
    <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, .045, 0]}><ringGeometry args={[.48, .53, 32]} /><meshBasicMaterial color={color} transparent opacity={.9} /></mesh>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .035, 0]}><circleGeometry args={[.32, 20]} /><meshBasicMaterial color={color} transparent opacity={.18} /></mesh>
    {u.hp > 0 && (selected || u.executive) ? <Html portal={labels} center position={[0, 1.75, 0]} style={{ pointerEvents: 'none' }}><span className={`unit-label ${u.enemy ? 'hostile' : ''}`}>{u.executive ? '◇ TARGET' : u.name}</span></Html> : null}
  </group>;
}

function Effects({ sim, labels }: { sim: Simulation; labels: RefObject<HTMLDivElement> }) {
  const beams = useRef<(Mesh | null)[]>([]), marker = useRef<Mesh>(null), extract = useRef<Mesh>(null);
  const direction = useMemo(() => new Vector3(), []);
  useFrame(({ clock }) => {
    beams.current.forEach((mesh, i) => {
      if (!mesh) return;
      const shot = sim.shots[i]; mesh.visible = !!shot && sim.phase === 'mission';
      if (!shot) return;
      const { from, to } = shot;
      direction.set(to.x - from.x, 0, to.z - from.z);
      mesh.position.set((from.x + to.x) / 2, .8, (from.z + to.z) / 2);
      mesh.scale.set(1, direction.length(), 1); mesh.quaternion.setFromUnitVectors(UP, direction.normalize());
    });
    if (marker.current) { marker.current.visible = !!sim.commandPoint && sim.phase === 'mission'; if (sim.commandPoint) marker.current.position.set(sim.commandPoint.x, .06, sim.commandPoint.z); }
    if (extract.current) extract.current.rotation.z = clock.elapsedTime * .15;
  });
  return <>
    {Array.from({ length: 12 }, (_, i) => <mesh ref={el => { beams.current[i] = el; }} key={i} visible={false}><cylinderGeometry args={[.022, .022, 1, 4]} /><meshBasicMaterial color="#ffe1a1" toneMapped={false} /></mesh>)}
    <mesh ref={marker} rotation={[-Math.PI / 2, 0, 0]} visible={false}><ringGeometry args={[.25, .3, 4]} /><meshBasicMaterial color="#def6cc" /></mesh>
    <group position={[EXTRACT.x, .05, EXTRACT.z]}>
      <mesh ref={extract} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[1.7, 1.77, 6]} /><meshBasicMaterial color="#83e5c4" transparent opacity={.8} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[1.7, 40]} /><meshBasicMaterial color="#68e7bf" transparent opacity={.06} depthWrite={false} /></mesh>
      <Html portal={labels} center position={[0, .05, 1.9]} style={{ pointerEvents: 'none' }}><span className="extract-label">EXTRACTION</span></Html>
    </group>
  </>;
}

function CameraRig({ reset }: { reset: number }) {
  const ref = useRef<ComponentRef<typeof OrbitControls>>(null), camera = useThree(s => s.camera), size = useThree(s => s.size);
  useEffect(() => {
    camera.position.set(29, 34, 32); camera.lookAt(0, 0, 0);
    if ('zoom' in camera) { camera.zoom = Math.min(size.width / 45, size.height / 36); camera.updateProjectionMatrix(); }
    ref.current?.target.set(0, 0, 0); ref.current?.update();
  }, [camera, reset, size.width, size.height]);
  return <OrbitControls ref={ref} makeDefault enableRotate={false} minZoom={4} maxZoom={65} enableDamping dampingFactor={.12} mouseButtons={{ LEFT: undefined, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }} />;
}

function World({ sim, reset, labels }: { sim: Simulation; reset: number; labels: RefObject<HTMLDivElement> }) {
  useFrame((_, dt) => sim.update(dt), -1);
  return <>
    <color attach="background" args={['#101c21']} />
    <ambientLight intensity={1.25} color="#d6e6dc" />
    <hemisphereLight args={['#abcacc', '#233c42', 1.5]} />
    <directionalLight position={[-10, 22, 10]} intensity={2.7} color="#ffd9b6" castShadow shadow-mapSize={[1024, 1024]} shadow-camera-left={-22} shadow-camera-right={22} shadow-camera-top={20} shadow-camera-bottom={-20} shadow-bias={-.001} />
    <CameraRig reset={reset} />
    <City />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .04, 0]} onClick={(e) => { if (e.delta <= 5) { e.stopPropagation(); sim.move({ x: e.point.x, z: e.point.z }); } }}>
      <planeGeometry args={[32, 24]} /><meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
    {['vex', 'rook', 'g1', 'g2', 'g3', 'target'].map(id => <Agent sim={sim} key={id} id={id} labels={labels} />)}
    <Effects sim={sim} labels={labels} />
  </>;
}

export const GameCanvas = memo(function GameCanvas({ sim, reset }: { sim: Simulation; reset: number }) {
  // Labels need a fixed parent: drei's Html rebuilds its React root whenever its parent changes,
  // and R3F swaps the default parent once events connect, which blanked the first label.
  const labels = useRef<HTMLDivElement>(null!);
  return <><Canvas shadows orthographic camera={{ position: [29, 34, 32], zoom: 24, near: .1, far: 150 }} dpr={[1, 1.5]} gl={{ antialias: true, alpha: false }} fallback={<div className="render-error">WebGL is unavailable. Enable hardware acceleration or try a WebGL-capable browser.</div>}>
    <World sim={sim} reset={reset} labels={labels} />
  </Canvas><div ref={labels} className="scene-labels" /></>;
});
