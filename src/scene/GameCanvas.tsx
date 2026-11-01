import { memo, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { ComponentRef, RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { DirectionalLight, MOUSE, Spherical, TOUCH, Vector3 } from 'three';
import type { MissionPlan } from '../game/mapgen.ts';
import type { Bounds } from '../game/world.ts';
import type { Simulation } from '../game/simulation.ts';
import { setAudioCamera } from '../ui/audio.ts';
import { City } from './city.tsx';
import { dragged, trackDrags } from './drag.ts';
import { Effects, Targeting } from './effects.tsx';
import { focusPoint, missionMinZoom, overviewZoom, smoothstep, tacticalZoom } from './framing.ts';
import type { Pointer } from './effects.tsx';
import { Objectives } from './objectives.tsx';
import { Pointers } from './pointers.tsx';
import type { Insets } from './pointers.tsx';
import { nearestClickable, Units } from './units.tsx';
import type { Hitboxes } from './units.tsx';
import './scene.css';

const FALLBACK: Bounds = { minX: -16, maxX: 16, minZ: -12, maxZ: 12 };
const planKeys = new WeakMap<MissionPlan, number>();
let nextPlanKey = 0;
const planKey = (plan: MissionPlan) => { let key = planKeys.get(plan); if (key === undefined) { key = nextPlanKey++; planKeys.set(plan, key); } return key; };
const extent = (b: Bounds) => ({ cx: (b.minX + b.maxX) / 2, cz: (b.minZ + b.maxZ) / 2, w: b.maxX - b.minX, d: b.maxZ - b.minZ });

// The projection is offset so the orbit target sits at the center of the HUD's free frame (the .view-frame
// element). Missions open on the tactical view: the selection centered, about 22 m of street across the frame.
// The overview fits the whole district; the briefing preview and the title's attract mode always use it, and
// the overview prop swaps it in during a mission. Focus glides the target to the selection. Left-drag orbits.
type Pose = { target: Vector3; offset: Spherical; zoom: number };
const ORBIT = new Spherical().setFromVector3(new Vector3(29, 34, 32)), GLIDE_SECONDS = .4;
function CameraRig({ sim, reset, focus, overview, bounds, layout, attract, frame, insets }: { sim: Simulation; reset: number; focus: number; overview: boolean; bounds: Bounds; layout: string; attract: boolean; frame: RefObject<HTMLDivElement | null>; insets: RefObject<Insets> }) {
  const ref = useRef<ComponentRef<typeof OrbitControls>>(null), camera = useThree(s => s.camera), size = useThree(s => s.size), gl = useThree(s => s.gl), look = useMemo(() => new Vector3(), []);
  const free = useRef({ w: 1, h: 1 }), glide = useRef<{ from: Pose; to: Pose; t: number } | null>(null), mission = layout === 'mission';
  useEffect(() => trackDrags(gl.domElement), [gl]);
  // Without damping, one update applies the rest of a drag's glide, so it can't carry on past a reset.
  const settle = () => { const c = ref.current; if (c) { c.enableDamping = false; c.update(); c.enableDamping = true; } };
  // Screen-space panning lifts the pivot off the street; slide it back along the view ray. The orthographic
  // image doesn't change, and rotation then turns around the street.
  const ground = () => {
    const c = ref.current;
    if (!c || !c.target.y) return;
    const k = -c.target.y / camera.getWorldDirection(look).y;
    c.target.addScaledVector(look, k); camera.position.addScaledVector(look, k);
  };
  const floor = (polar: number) => mission ? missionMinZoom(polar) : 4, ceiling = () => Math.max(65, tacticalZoom(free.current.w) * 1.5);
  const fit = (zoom: number) => Math.max(floor(ORBIT.phi), Math.min(ceiling(), zoom));
  const squad = () => focusPoint(sim.units, sim.selected, sim.squad);
  const preset = (): Pose => {
    const { cx, cz } = extent(bounds), at = mission && !overview ? squad() : null;
    return { target: new Vector3(at?.x ?? cx, 0, at?.z ?? cz), offset: ORBIT.clone(), zoom: fit(at ? tacticalZoom(free.current.w) : overviewZoom(free.current.w, free.current.h, bounds)) };
  };
  const current = (): Pose => { ground(); const target = ref.current!.target.clone(); return { target, offset: new Spherical().setFromVector3(look.subVectors(camera.position, target)), zoom: camera.zoom }; };
  const place = ({ target, offset, zoom }: Pose) => {
    camera.position.setFromSpherical(offset).add(target); camera.lookAt(target);
    camera.zoom = zoom; camera.updateProjectionMatrix();
    ref.current?.target.copy(target);
  };
  const glideTo = (to: Pose) => { if (!ref.current) return; settle(); glide.current = { from: current(), to, t: 0 }; };
  // A reset, a resize or a new screen snaps to the preset; the overview toggle and focus glide.
  useEffect(() => {
    settle(); glide.current = null;
    const box = gl.domElement.getBoundingClientRect(), f = frame.current?.getBoundingClientRect() ?? box;
    const l = Math.max(0, f.left - box.left), t = Math.max(0, f.top - box.top), r = Math.max(0, box.right - f.right), b = Math.max(0, box.bottom - f.bottom);
    insets.current = { l, t, r, b }; free.current = { w: Math.max(1, size.width - l - r), h: Math.max(1, size.height - t - b) };
    camera.setViewOffset(size.width, size.height, (r - l) / 2, (b - t) / 2, size.width, size.height);
    place(preset()); ref.current?.update();
  }, [camera, gl, reset, size.width, size.height, bounds, layout, frame, insets]);
  const toggled = useRef(overview), focused = useRef(focus);
  useEffect(() => { if (toggled.current !== overview) { toggled.current = overview; if (mission) glideTo(preset()); } }, [overview]);
  useEffect(() => {
    if (focused.current === focus) return;
    focused.current = focus;
    const at = squad();
    if (at) glideTo({ ...current(), target: new Vector3(at.x, 0, at.z) });
  }, [focus]);
  // Positional sound is panned and faded by where its source sits in this view.
  useEffect(() => { setAudioCamera(camera); return () => setAudioCamera(null); }, [camera]);
  // After the controls' own update (priority -1): step a glide, then hold the zoom limits for the current tilt.
  useFrame((_, dt) => {
    const c = ref.current, g = glide.current;
    if (!c) return;
    if (g) {
      g.t = Math.min(1, g.t + dt / GLIDE_SECONDS);
      const k = smoothstep(g.t), { from, to } = g, turn = Math.atan2(Math.sin(to.offset.theta - from.offset.theta), Math.cos(to.offset.theta - from.offset.theta));
      place({
        target: look.lerpVectors(from.target, to.target, k).clone(),
        offset: new Spherical(from.offset.radius + (to.offset.radius - from.offset.radius) * k, from.offset.phi + (to.offset.phi - from.offset.phi) * k, from.offset.theta + turn * k),
        zoom: from.zoom * (to.zoom / from.zoom) ** k,
      });
      if (g.t >= 1) glide.current = null;
    }
    c.minZoom = floor(c.getPolarAngle()); c.maxZoom = ceiling();
    const zoom = Math.max(c.minZoom, Math.min(c.maxZoom, camera.zoom));
    if (zoom !== camera.zoom) { camera.zoom = zoom; camera.updateProjectionMatrix(); }
  });
  return <OrbitControls ref={ref} makeDefault autoRotate={attract} autoRotateSpeed={.35} enableDamping dampingFactor={.12} onStart={() => { glide.current = null; ground(); }}
    rotateSpeed={.7} minPolarAngle={Math.PI / 6} maxPolarAngle={Math.PI * 13 / 36}
    mouseButtons={{ LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }} touches={{ ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN }} />;
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

type Props = { sim: Simulation; reset: number; focus: number; overview: boolean; layout: string; attract: boolean; frame: RefObject<HTMLDivElement | null> };
function World({ sim, reset, focus, overview, layout, attract, frame, labels, missed }: Props & { labels: RefObject<HTMLDivElement>; missed: RefObject<(e: MouseEvent) => void> }) {
  useFrame((_, dt) => sim.update(dt), -1);
  const state = useSyncExternalStore(sim.subscribe, sim.getSnapshot), { plan, pending } = state;
  const bounds = plan?.world.bounds ?? FALLBACK, { cx, cz, w, d } = extent(bounds);
  const pointer = useRef<Pointer>({ x: 0, z: 0, on: false }), insets = useRef<Insets>({ l: 0, t: 0, r: 0, b: 0 }), gl = useThree(s => s.gl), camera = useThree(s => s.camera);
  // The canvas cursor: a crosshair while aiming, a hand wherever a click would act on a unit (on its hitbox or
  // within PICK_SLOP of it). Re-picked every frame, since units walk under a resting pointer and hostiles drop out of sight.
  const hitboxes = useRef<Hitboxes>(new Map()).current, inside = useRef(false), cursor = useRef('');
  useEffect(() => {
    const el = gl.domElement, enter = () => { inside.current = true; }, leave = () => { inside.current = false; };
    el.addEventListener('pointerenter', enter); el.addEventListener('pointerleave', leave);
    return () => { el.removeEventListener('pointerenter', enter); el.removeEventListener('pointerleave', leave); };
  }, [gl]);
  useFrame(({ pointer: ndc, camera, size }) => {
    let next = '';
    if (sim.pending) next = 'crosshair';
    else if (inside.current && nearestClickable(sim, hitboxes, camera, size.width, size.height, (ndc.x + 1) / 2 * size.width, (1 - ndc.y) / 2 * size.height)) next = 'pointer';
    if (next !== cursor.current) gl.domElement.style.cursor = cursor.current = next;
  });
  // A click or tap that hits no unit, on the street or off the district, still picks one drawn near it.
  const nearMiss = (e: MouseEvent) => {
    const box = gl.domElement.getBoundingClientRect(), id = nearestClickable(sim, hitboxes, camera, box.width, box.height, e.clientX - box.left, e.clientY - box.top);
    if (id) sim.unitClick(id, e.shiftKey);
    return !!id;
  };
  missed.current = e => { if (e.type === 'click' && !dragged()) nearMiss(e); };
  return <>
    <color attach="background" args={['#101c21']} />
    <ambientLight intensity={1.25} color="#d6e6dc" />
    <hemisphereLight args={['#abcacc', '#233c42', 1.5]} />
    <Sun bounds={bounds} />
    <CameraRig sim={sim} reset={reset} focus={focus} overview={overview} bounds={bounds} layout={layout} attract={attract} frame={frame} insets={insets} />
    {plan ? <>
      <City key={planKey(plan)} plan={plan} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, .04, cz]} visible={false}
        onClick={e => { if (!dragged()) { e.stopPropagation(); if (!nearMiss(e.nativeEvent)) sim.groundClick({ x: e.point.x, z: e.point.z }); } }}
        onPointerMove={e => { pointer.current.x = e.point.x; pointer.current.z = e.point.z; pointer.current.on = true; }}
        onPointerOut={() => { pointer.current.on = false; }}>
        <planeGeometry args={[w, d]} />
      </mesh>
      <Objectives sim={sim} objectives={state.objectives} labels={labels} />
      <Units sim={sim} units={state.units} selected={state.selected} squad={state.squad} live={state.phase === 'mission'} labels={labels} hitboxes={hitboxes} />
      <Effects sim={sim} />
      <Pointers sim={sim} labels={labels} insets={insets} />
      {pending ? <Targeting key={`${pending.unitId}:${pending.ability}`} sim={sim} pending={pending} pointer={pointer} /> : null}
    </> : null}
  </>;
}

export const GameCanvas = memo(function GameCanvas(props: Props) {
  // Labels need a fixed parent: drei's Html rebuilds its React root whenever its parent changes,
  // and R3F swaps the default parent once events connect, which blanked the first label.
  const labels = useRef<HTMLDivElement>(null!), missed = useRef<(e: MouseEvent) => void>(() => {});
  return <><Canvas shadows="percentage" orthographic camera={{ position: [29, 34, 32], zoom: 24, near: .1, far: 150 }} dpr={[1, 1.5]} gl={{ antialias: true, alpha: false }} onPointerMissed={e => missed.current(e)} fallback={<div className="render-error">WebGL is unavailable. Enable hardware acceleration or try a WebGL-capable browser.</div>}>
    <World {...props} labels={labels} missed={missed} />
  </Canvas><div ref={labels} className="scene-labels" /></>;
});
