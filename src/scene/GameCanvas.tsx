import { memo, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { ComponentRef, RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { DirectionalLight, MOUSE } from 'three';
import type { MissionPlan } from '../game/mapgen.ts';
import type { Bounds } from '../game/world.ts';
import type { Simulation } from '../game/simulation.ts';
import { City } from './city.tsx';
import { Effects, Targeting } from './effects.tsx';
import type { Pointer } from './effects.tsx';
import { Objectives } from './objectives.tsx';
import { Units } from './units.tsx';
import './scene.css';

const FALLBACK: Bounds = { minX: -16, maxX: 16, minZ: -12, maxZ: 12 };
const planKeys = new WeakMap<MissionPlan, number>();
let nextPlanKey = 0;
const planKey = (plan: MissionPlan) => { let key = planKeys.get(plan); if (key === undefined) { key = nextPlanKey++; planKeys.set(plan, key); } return key; };
const extent = (b: Bounds) => ({ cx: (b.minX + b.maxX) / 2, cz: (b.minZ + b.maxZ) / 2, w: b.maxX - b.minX, d: b.maxZ - b.minZ });

function CameraRig({ reset, bounds }: { reset: number; bounds: Bounds }) {
  const ref = useRef<ComponentRef<typeof OrbitControls>>(null), camera = useThree(s => s.camera), size = useThree(s => s.size);
  useEffect(() => {
    const { cx, cz, w, d } = extent(bounds);
    camera.position.set(cx + 29, 34, cz + 32); camera.lookAt(cx, 0, cz);
    if ('zoom' in camera) { camera.zoom = Math.min(size.width / (w * 1.4), size.height / (d * 1.5)); camera.updateProjectionMatrix(); }
    ref.current?.target.set(cx, 0, cz); ref.current?.update();
  }, [camera, reset, size.width, size.height, bounds]);
  return <OrbitControls ref={ref} makeDefault enableRotate={false} minZoom={4} maxZoom={65} enableDamping dampingFactor={.12} mouseButtons={{ LEFT: undefined, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }} />;
}

function Sun({ bounds }: { bounds: Bounds }) {
  const ref = useRef<DirectionalLight>(null);
  useLayoutEffect(() => {
    const { cx, cz, w, d } = extent(bounds), light = ref.current!, shadow = light.shadow.camera, half = Math.max(w, d) * .75;
    light.position.set(cx - 10, 22, cz + 10); light.target.position.set(cx, 0, cz); light.target.updateMatrixWorld();
    shadow.left = -half; shadow.right = half; shadow.top = half; shadow.bottom = -half; shadow.updateProjectionMatrix();
  }, [bounds]);
  return <directionalLight ref={ref} intensity={2.7} color="#ffd9b6" castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-.001} />;
}

function World({ sim, reset, labels }: { sim: Simulation; reset: number; labels: RefObject<HTMLDivElement> }) {
  useFrame((_, dt) => sim.update(dt), -1);
  const state = useSyncExternalStore(sim.subscribe, sim.getSnapshot), { plan, pending } = state;
  const bounds = plan?.world.bounds ?? FALLBACK, { cx, cz, w, d } = extent(bounds);
  const pointer = useRef<Pointer>({ x: 0, z: 0, on: false }), gl = useThree(s => s.gl);
  useEffect(() => { gl.domElement.style.cursor = pending ? 'crosshair' : ''; }, [gl, pending]);
  return <>
    <color attach="background" args={['#101c21']} />
    <ambientLight intensity={1.25} color="#d6e6dc" />
    <hemisphereLight args={['#abcacc', '#233c42', 1.5]} />
    <Sun bounds={bounds} />
    <CameraRig reset={reset} bounds={bounds} />
    {plan ? <>
      <City key={planKey(plan)} plan={plan} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, .04, cz]} visible={false}
        onClick={e => { if (e.delta <= 5) { e.stopPropagation(); sim.groundClick({ x: e.point.x, z: e.point.z }); } }}
        onPointerMove={e => { pointer.current.x = e.point.x; pointer.current.z = e.point.z; pointer.current.on = true; }}
        onPointerOut={() => { pointer.current.on = false; }}>
        <planeGeometry args={[w, d]} />
      </mesh>
      <Objectives sim={sim} objectives={state.objectives} labels={labels} />
      <Units sim={sim} units={state.units} selected={state.selected} labels={labels} />
      <Effects sim={sim} />
      {pending ? <Targeting key={`${pending.unitId}:${pending.ability}`} sim={sim} pending={pending} pointer={pointer} /> : null}
    </> : null}
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
