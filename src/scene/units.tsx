import { memo, useCallback, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { AlwaysStencilFunc, CanvasTexture, CircleGeometry, GreaterDepth, MeshBasicMaterial, NotEqualStencilFunc, PlaneGeometry, ReplaceStencilOp, RingGeometry, SRGBColorSpace, Vector3 } from 'three';
import type { Camera, Group, Material, Mesh } from 'three';
import { REVIVE_SECONDS, SUSPICIOUS, TAKEDOWN_SECONDS } from '../game/simulation.ts';
import type { Faction, Simulation, Unit, UnitKind } from '../game/simulation.ts';
import { dragged } from './drag.ts';
import { rectDistance } from './framing.ts';
import { BOX, Box, CYLINDER, DIAMOND, dim, glow, PaintContext, ProgressRing, solid, STILL, usePaint } from './parts.tsx';
import type { Paint } from './parts.tsx';
import { mayBeHidden, viewAlong } from './view.ts';

type Vec3 = [number, number, number];
export const TOP: Record<UnitKind, number> = { assault: 1.3, support: 1.3, recon: 1.3, tech: 1.3, guard: 1.3, heavy: 1.55, camera: 2.15, turret: .75, target: 1.3, vip: 1.3 };
const HITBOX: Record<UnitKind, Vec3> = { assault: [.95, 1.5, .95], support: [.95, 1.5, .95], recon: [.95, 1.5, .95], tech: [.95, 1.5, .95], guard: [.95, 1.5, .95], heavy: [1.15, 1.8, 1.15], camera: [.7, 2.3, .7], turret: [1.1, 1, 1.1], target: [.95, 1.5, .95], vip: [.95, 1.5, .95] };
const ACCENT: Record<UnitKind, string> = { assault: '#9ff7d1', support: '#9ff7d1', recon: '#9ff7d1', tech: '#8ff0e6', guard: '#ed7e70', heavy: '#ff6d5c', camera: '#ff5a4a', turret: '#ff6d5c', target: '#ffbd83', vip: '#ffe7a8' };
const GROUND: Record<Faction, string> = { squad: '#9ff7d1', hostile: '#ed7e70', vip: '#ffe7a8' };
// Silhouette colors: operatives in their class color (the .cls-* colors in style.css), hostiles red, the VIP gold.
const CLASS_COLOR: Partial<Record<UnitKind, string>> = { assault: '#ff8a5b', support: '#5ef2c0', recon: '#ffd166', tech: '#62d0ff' };
const silhouetteColor = (kind: UnitKind, faction: Faction) => faction === 'hostile' ? '#ff5148' : faction === 'vip' ? '#ffd77a' : CLASS_COLOR[kind] ?? '#9ff7d1';
const REACH = .9; // farthest any model part (the recon's rifle) sits from the unit's center

// Occluded units: the lit pass sets the stencil under every pixel a unit covers, then the same
// model draws again flat, only where it lies behind something already drawn (GreaterDepth) and
// only on pixels with no stencil mark. The silhouette sets the mark too, so it blends once per
// pixel and never tints a unit over its own visible body or over another unit. The lit pass
// draws after the rest of the opaque scene (render order 1), so a unit only marks the pixels
// where it ends up visible.
const stenciled = new Map<string, Material>();
const LIT: Paint = {
  shadows: true, order: 1,
  material: (color, emissive) => {
    const key = `${color}|${emissive ?? ''}`;
    let m = stenciled.get(key);
    if (!m) {
      m = solid(color, emissive).clone();
      Object.assign(m, { stencilWrite: true, stencilRef: 1, stencilFunc: AlwaysStencilFunc, stencilZPass: ReplaceStencilOp });
      stenciled.set(key, m);
    }
    return m;
  },
};
const silhouettes = new Map<string, Paint>();
function silhouette(color: string): Paint {
  let paint = silhouettes.get(color);
  if (!paint) {
    const m = new MeshBasicMaterial({
      color, transparent: true, opacity: .5, depthWrite: false, depthFunc: GreaterDepth, toneMapped: false,
      stencilWrite: true, stencilRef: 1, stencilFunc: NotEqualStencilFunc, stencilZPass: ReplaceStencilOp,
    });
    paint = { shadows: false, order: 1, material: () => m };
    silhouettes.set(color, paint);
  }
  return paint;
}

// Unit hitboxes by mesh, for the canvas cursor; a unit is clickable when unitClick would act on it.
export type Hitboxes = Map<Mesh, string>;
export const clickable = (sim: Simulation, u: Unit | undefined) => !!u && (u.faction === 'squad' && u.hp > 0 || sim.phase === 'mission' && (u.faction !== 'hostile' || u.hp > 0 && u.visible));

// A click or tap that misses every hitbox still picks a clickable unit drawn this close to it (CSS pixels).
export const PICK_SLOP = 28;
const corner = new Vector3();
// The clickable unit whose on-screen hitbox lies nearest a canvas point, within PICK_SLOP. While an ability
// is aimed only hostiles count: a click on a teammate cancels the aim, so a near miss must not.
export function nearestClickable(sim: Simulation, hitboxes: Hitboxes, camera: Camera, width: number, height: number, x: number, y: number) {
  let best: string | null = null, bestEdge = PICK_SLOP, bestCenter = Infinity;
  for (const [mesh, id] of hitboxes) {
    const u = sim.units.find(v => v.id === id);
    if (!clickable(sim, u) || sim.pending && u!.faction !== 'hostile') continue;
    const r = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (let k = 0; k < 8; k++) {
      corner.set(k & 1 ? .5 : -.5, k & 2 ? .5 : -.5, k & 4 ? .5 : -.5).applyMatrix4(mesh.matrixWorld).project(camera);
      const sx = (corner.x + 1) / 2 * width, sy = (1 - corner.y) / 2 * height;
      r.x0 = Math.min(r.x0, sx); r.x1 = Math.max(r.x1, sx); r.y0 = Math.min(r.y0, sy); r.y1 = Math.max(r.y1, sy);
    }
    const edge = rectDistance(x, y, r), center = Math.hypot(x - (r.x0 + r.x1) / 2, y - (r.y0 + r.y1) / 2);
    if (edge < bestEdge || edge === bestEdge && center < bestCenter) { best = id; bestEdge = edge; bestCenter = center; }
  }
  return best;
}

// Health bars billboard toward the camera and draw over buildings so a unit behind a wall still reads.
const PLANE = new PlaneGeometry(1, 1), BAR_W = 1, BAR_H = .14;
const overlay = (color: string, opacity = 1) => new MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, toneMapped: false });
const BAR_BACK = overlay('#04090b', .8), BAR = { mint: overlay('#5ef2c0'), amber: overlay('#ffb454'), red: overlay('#ff5148'), gold: overlay('#ffd77a') };
// Selection: four rotating arc segments over a faint disc.
const ARCS = [0, 1, 2, 3].map(k => new RingGeometry(.5, .57, 10, 1, k * Math.PI / 2 + .2, Math.PI / 2 - .4)), DISC = new CircleGeometry(.5, 32);
const RING = new MeshBasicMaterial({ color: '#5ef2c0', transparent: true, opacity: .95, depthWrite: false, toneMapped: false });
const RING_FILL = new MeshBasicMaterial({ color: '#5ef2c0', transparent: true, opacity: .12, depthWrite: false });

// Detection marker: an arc over a hostile that fills clockwise as it notices the squad, with "?" once it is
// suspicious and "!" at the alarm. Billboarded and drawn over buildings like the health bars, and built in
// screen pixels (scaled by 1 / zoom) so it reads the same at every zoom.
const MARK_R = 15, ARC_STEPS = 48, ARC_IN = 10.5, ARC_OUT = 14;
const ARCS_BY_STEP = Array.from({ length: ARC_STEPS }, (_, k) => {
  const length = (k + 1) / ARC_STEPS * 2 * Math.PI;
  return new RingGeometry(ARC_IN, ARC_OUT, Math.max(4, k + 1), 1, Math.PI / 2 - length, length);
});
const MARK_DISC = new CircleGeometry(MARK_R, 32), MARK_TRACK = new RingGeometry(ARC_IN, ARC_OUT, 48);
const MARK_BACK = overlay('#04090b', .85), MARK_TRACK_FILL = overlay('#e9dcc0', .22);
const DETECT_FILL = { noticing: overlay('#ffb454'), suspicious: overlay('#ff8a3a'), alarm: overlay('#ff5148') };
function glyph(char: string, color: string) {
  const canvas = document.createElement('canvas'), g = canvas.getContext('2d')!;
  canvas.width = canvas.height = 64;
  g.font = '900 50px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = color; g.fillText(char, 32, 35);
  const map = new CanvasTexture(canvas); map.colorSpace = SRGBColorSpace;
  return new MeshBasicMaterial({ map, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
}
const QUERY = glyph('?', '#ffc27a'), BANG = glyph('!', '#ff6a5e');
const screenUp = new Vector3();
function DetectMarker({ sim, id, top }: { sim: Simulation; id: string; top: number }) {
  const root = useRef<Group>(null), arc = useRef<Mesh>(null), sign = useRef<Mesh>(null);
  useFrame(({ camera }) => {
    const u = sim.units.find(v => v.id === id), g = root.current;
    if (!g || !arc.current || !sign.current) return;
    const show = !!u && u.hp > 0 && u.detect > 0 && sim.phase === 'mission';
    g.visible = show;
    if (!show) return;
    // Anchored on the health bar's top edge (top + .32), then lifted clear of it, and of the target's label, in screen pixels.
    const px = 1 / camera.zoom, lift = MARK_R + 4 + (u.kind === 'target' ? 24 : 0);
    g.quaternion.copy(camera.quaternion); g.scale.setScalar(px);
    g.position.set(0, top + .22, 0).addScaledVector(screenUp.set(0, 1, 0).applyQuaternion(camera.quaternion), .1 + lift * px);
    const level = u.detect >= 1 ? 'alarm' : u.detect > SUSPICIOUS ? 'suspicious' : 'noticing';
    arc.current.geometry = ARCS_BY_STEP[Math.min(ARC_STEPS, Math.max(1, Math.round(u.detect * ARC_STEPS))) - 1];
    arc.current.material = DETECT_FILL[level];
    sign.current.visible = level !== 'noticing'; sign.current.material = level === 'alarm' ? BANG : QUERY;
  });
  return <group ref={root} visible={false}>
    <mesh geometry={MARK_DISC} material={MARK_BACK} renderOrder={22} />
    <mesh geometry={MARK_TRACK} material={MARK_TRACK_FILL} renderOrder={23} />
    <mesh ref={arc} geometry={ARCS_BY_STEP[0]} material={DETECT_FILL.noticing} renderOrder={24} />
    <mesh ref={sign} geometry={PLANE} material={QUERY} scale={[21, 21, 1]} renderOrder={25} />
  </group>;
}

function Humanoid({ body, head, visor, legs, legColor = '#192f33', torso = [.47, .62, .32], children }: { body: string; head: string; visor: string; legs: RefObject<Group | null>; legColor?: string; torso?: Vec3; children?: ReactNode }) {
  return <>
    <Box position={[0, .65, 0]} size={torso} color={body} castShadow />
    <Box position={[0, 1.12, .02]} size={[.29, .32, .3]} color={head} castShadow />
    <Box position={[0, 1.16, .18]} size={[.29, .07, .035]} color={visor} emissive={visor} />
    <group ref={legs} position={[0, .35, 0]}>
      <Box position={[-.13, -.15, 0]} size={[.15, .35, .2]} color={legColor} castShadow />
      <Box position={[.13, -.15, 0]} size={[.15, .35, .2]} color={legColor} castShadow />
    </group>
    {children}
  </>;
}

// Forward is +z: rotation.y = heading turns the model toward (sin h, cos h). Round bases hide that turn for fixed hostiles.
const Model = memo(function Model({ kind, legs, downed }: { kind: UnitKind; legs: RefObject<Group | null>; downed: boolean }) {
  const c = (color: string) => downed ? dim(color) : color, paint = usePaint();
  const accent = c(ACCENT[kind]), gun = c('#122429'), arm = c('#526b66'), body = c('#466766'), head = c('#697e7a'), pack = c('#3e5c5a');
  switch (kind) {
    case 'assault': return <Humanoid body={body} head={head} visor={accent} legs={legs} torso={[.56, .66, .38]}>
      <Box position={[.33, .93, 0]} size={[.18, .12, .4]} color={c('#3b5a58')} castShadow />
      <Box position={[-.33, .93, 0]} size={[.18, .12, .4]} color={c('#3b5a58')} castShadow />
      <Box position={[.36, .72, .2]} size={[.15, .18, .42]} color={gun} castShadow />
      <Box position={[-.36, .72, .03]} size={[.12, .4, .13]} color={arm} />
      <Box position={[0, .84, .2]} size={[.26, .04, .02]} color={accent} emissive={accent} />
    </Humanoid>;
    case 'support': return <Humanoid body={body} head={head} visor={accent} legs={legs}>
      <Box position={[0, .76, -.26]} size={[.38, .44, .2]} color={pack} castShadow />
      <Box position={[0, .8, -.365]} size={[.2, .06, .02]} color={accent} emissive={accent} />
      <Box position={[0, .8, -.365]} size={[.06, .2, .02]} color={accent} emissive={accent} />
      <Box position={[.31, .72, .24]} size={[.13, .15, .59]} color={gun} castShadow />
      <Box position={[-.31, .72, .03]} size={[.12, .4, .13]} color={arm} />
    </Humanoid>;
    case 'recon': return <Humanoid body={body} head={head} visor={accent} legs={legs} torso={[.4, .6, .28]}>
      <Box position={[.27, .74, .34]} size={[.09, .11, .98]} color={gun} castShadow />
      <Box position={[.27, .83, .22]} size={[.06, .07, .22]} color={c('#2a4044')} />
      <Box position={[-.27, .72, .03]} size={[.11, .4, .12]} color={arm} />
      <Box position={[0, .8, -.17]} size={[.3, .3, .06]} color={pack} />
    </Humanoid>;
    case 'tech': return <Humanoid body={body} head={head} visor={accent} legs={legs}>
      <Box position={[0, .82, -.25]} size={[.32, .26, .2]} color={pack} castShadow />
      <Box position={[0, .97, -.25]} size={[.46, .03, .07]} color={c('#2a4044')} />
      <Box position={[0, .97, -.25]} size={[.07, .03, .46]} color={c('#2a4044')} />
      <Box position={[-.14, 1.25, -.27]} size={[.03, .6, .03]} color={arm} />
      <Box position={[-.14, 1.57, -.27]} size={[.07, .07, .07]} color={accent} emissive={accent} />
      <Box position={[.31, .72, .18]} size={[.12, .14, .4]} color={gun} castShadow />
      <Box position={[-.31, .72, .03]} size={[.12, .4, .13]} color={arm} />
    </Humanoid>;
    case 'guard': return <Humanoid body="#673e3b" head="#697e7a" visor={accent} legs={legs}>
      <Box position={[.31, .72, .24]} size={[.13, .15, .59]} color="#122429" castShadow />
      <Box position={[-.31, .72, .03]} size={[.12, .4, .13]} color="#526b66" />
    </Humanoid>;
    case 'heavy': return <group scale={1.18}><Humanoid body="#5c3532" head="#5d6765" visor={accent} legs={legs} legColor="#1d2729" torso={[.58, .7, .4]}>
      <Box position={[.35, .95, 0]} size={[.2, .14, .44]} color="#4a3a3a" castShadow />
      <Box position={[-.35, .95, 0]} size={[.2, .14, .44]} color="#4a3a3a" castShadow />
      <Box position={[-.3, .68, .32]} size={[.44, .78, .07]} color="#463c3d" castShadow />
      <Box position={[-.3, .96, .36]} size={[.3, .04, .02]} color={accent} emissive={accent} />
      <Box position={[.36, .72, .26]} size={[.17, .19, .66]} color="#122429" castShadow />
    </Humanoid></group>;
    case 'camera': return <>
      <mesh position={[0, .04, 0]} scale={[.22, .08, .22]} geometry={CYLINDER} material={paint.material('#3c4a4a')} renderOrder={paint.order} />
      <Box position={[0, 1, 0]} size={[.09, 1.9, .09]} color="#5c6d6a" castShadow />
      <Box position={[0, 1.94, 0]} size={[.16, .12, .16]} color="#465452" />
      <Box position={[0, 2.02, .1]} size={[.24, .2, .42]} color="#2a3436" castShadow />
      <Box position={[0, 2.02, .32]} size={[.13, .13, .03]} color={accent} emissive={accent} />
      <Box position={[0, 2.14, -.05]} size={[.05, .04, .05]} color={accent} emissive={accent} />
    </>;
    case 'turret': return <>
      <mesh position={[0, .14, 0]} scale={[.46, .28, .46]} geometry={CYLINDER} material={paint.material('#3d4447')} castShadow={paint.shadows} renderOrder={paint.order} />
      <mesh position={[0, .33, 0]} scale={[.32, .1, .32]} geometry={CYLINDER} material={paint.material('#4b3b3a')} renderOrder={paint.order} />
      <Box position={[0, .52, 0]} size={[.5, .3, .55]} color="#5a3936" castShadow />
      <Box position={[0, .55, .55]} size={[.1, .1, .62]} color="#1c2427" castShadow />
      <Box position={[0, .62, .28]} size={[.3, .05, .02]} color={accent} emissive={accent} />
      <Box position={[.3, .5, -.05]} size={[.12, .2, .3]} color="#2e3436" />
    </>;
    case 'target': return <Humanoid body="#6e5040" head="#b0a18d" visor={accent} legs={legs} legColor="#2a2421">
      <Box position={[0, .76, .165]} size={[.07, .32, .02]} color={accent} emissive={accent} />
      <Box position={[.31, .42, .05]} size={[.1, .24, .34]} color="#3a2a22" castShadow />
      <Box position={[.31, .72, .03]} size={[.12, .4, .13]} color="#5d4637" />
      <Box position={[-.31, .72, .03]} size={[.12, .4, .13]} color="#5d4637" />
    </Humanoid>;
    case 'vip': return <Humanoid body="#2c363c" head="#c9bfae" visor={accent} legs={legs} legColor="#1d2328">
      <Box position={[0, .76, .165]} size={[.07, .32, .02]} color="#e8c574" emissive="#e8c574" />
      <Box position={[.31, .72, .03]} size={[.12, .4, .13]} color="#353f45" />
      <Box position={[-.31, .72, .03]} size={[.12, .4, .13]} color="#353f45" />
    </Humanoid>;
  }
});

function Agent({ sim, unit, selected, slot, tagged, labels, hitboxes }: { sim: Simulation; unit: Unit; selected: boolean; slot: number; tagged: boolean; labels: RefObject<HTMLDivElement>; hitboxes: Hitboxes }) {
  const { id, kind, faction } = unit;
  const root = useRef<Group>(null), model = useRef<Group>(null), pose = useRef<Group>(null), legs = useRef<Group>(null), ring = useRef<Group>(null), spin = useRef<Group>(null);
  const ghost = useRef<Group>(null), ghostLegs = useRef<Group>(null), look = useRef(new Vector3()).current;
  const bar = useRef<Group>(null), fill = useRef<Mesh>(null);
  const stun = useRef<Group>(null), mark = useRef<Mesh>(null), revive = useRef<Group>(null), hold = useRef<Group>(null);
  const downed = faction === 'squad' && unit.hp <= 0, top = TOP[kind], hitbox = HITBOX[kind];
  const register = useCallback((mesh: Mesh) => { hitboxes.set(mesh, id); return () => { hitboxes.delete(mesh); }; }, [hitboxes, id]);
  const c = (color: string) => downed ? dim(color) : color;
  const reviveProgress = () => { let p = 0; for (const v of sim.units) if (v.reviveTarget === id) p = Math.max(p, v.revive / REVIVE_SECONDS); return p; };
  const takedownProgress = () => (sim.units.find(v => v.id === id)?.held ?? 0) / TAKEDOWN_SECONDS;
  useFrame(({ clock, camera }) => {
    const u = sim.units.find(v => v.id === id);
    if (!root.current || !model.current || !pose.current) return;
    const hidden = !u || (u.faction === 'hostile' && (u.hp <= 0 || !u.visible));
    root.current.visible = !hidden;
    if (!u || hidden) return;
    const t = clock.elapsedTime, down = u.faction === 'squad' && u.hp <= 0, walking = u.moving && !sim.paused && !down;
    root.current.position.set(u.x, 0, u.z);
    model.current.rotation.y = u.heading;
    model.current.position.y = walking ? Math.sin(t * 17) * .035 : 0;
    pose.current.rotation.x = down ? -Math.PI / 2 : 0; pose.current.position.y = down ? .2 : 0;
    const stride = walking ? Math.sin(t * 17) * .4 : 0;
    if (legs.current) legs.current.rotation.x = stride;
    if (ghostLegs.current) ghostLegs.current.rotation.x = stride;
    // The silhouette only draws when a building or barrier could be in front of the unit.
    const world = sim.plan?.world;
    if (ghost.current) {
      const d = camera.getWorldDirection(look);
      ghost.current.visible = !!world && mayBeHidden(world.buildings, world.cover, viewAlong(d.x, d.y, d.z), u, REACH);
    }
    if (ring.current) ring.current.visible = sim.selected.includes(id);
    if (spin.current && !STILL) spin.current.rotation.z = t * .9;
    if (bar.current && fill.current) {
      const health = Math.max(0, Math.min(1, u.hp / u.maxHp)), show = u.hp > 0 && (u.faction !== 'hostile' || health < 1);
      bar.current.visible = show;
      if (show) {
        bar.current.quaternion.copy(camera.quaternion);
        fill.current.scale.x = Math.max(.001, BAR_W * health); fill.current.position.x = -BAR_W * (1 - health) / 2;
        fill.current.material = u.faction === 'hostile' ? BAR.red : u.faction === 'vip' ? BAR.gold : health > .5 ? BAR.mint : health > .25 ? BAR.amber : BAR.red;
      }
    }
    if (stun.current) {
      stun.current.visible = u.stunned > 0; stun.current.rotation.y = t * 5;
      stun.current.children.forEach((spark, k) => { spark.visible = Math.sin(t * 31 + k * 2.1) > -.3; });
    }
    if (mark.current) { mark.current.visible = u.marked > 0; mark.current.rotation.y = t * 2.4; mark.current.position.y = top + .5 + Math.sin(t * 4) * .05; }
    if (revive.current) revive.current.visible = down && sim.units.some(v => v.reviveTarget === id);
    if (hold.current) hold.current.visible = u.held > 0;
  });
  const click = (e: ThreeEvent<MouseEvent>) => {
    const u = sim.units.find(v => v.id === id);
    // Hidden or dead hostiles let the click fall through to the ground.
    if (!u || (u.faction === 'hostile' && (u.hp <= 0 || !u.visible))) return;
    e.stopPropagation(); if (dragged()) return;
    sim.unitClick(id, e.shiftKey);
  };
  const label = kind === 'target' ? (unit.hp > 0 && unit.visible ? 'TARGET' : null) : kind === 'vip' ? (unit.hp > 0 ? 'VIP' : null) : tagged && faction === 'squad' && selected && unit.hp > 0 ? String(slot + 1) : null;
  const ground = c(kind === 'target' ? ACCENT.target : GROUND[faction]);
  return <group ref={root} position={[unit.x, 0, unit.z]}>
    <group ref={model}>
      <group ref={pose} onClick={click}>
        <mesh ref={register} position={[0, hitbox[1] / 2, 0]} scale={hitbox} geometry={BOX} visible={false} />
        <PaintContext.Provider value={LIT}><Model kind={kind} legs={legs} downed={downed} /></PaintContext.Provider>
        <group ref={ghost} visible={false}>
          <PaintContext.Provider value={silhouette(c(silhouetteColor(kind, faction)))}><Model kind={kind} legs={ghostLegs} downed={downed} /></PaintContext.Provider>
        </group>
      </group>
    </group>
    {faction === 'squad' ? <group ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, .045, 0]} visible={false}>
      <group ref={spin}>{ARCS.map((g, k) => <mesh key={k} geometry={g} material={RING} />)}</group>
      <mesh geometry={DISC} material={RING_FILL} />
    </group> : null}
    <group ref={bar} position={[0, top + .22, 0]} visible={false}>
      <mesh geometry={PLANE} material={BAR_BACK} scale={[BAR_W + .06, BAR_H + .06, 1]} renderOrder={20} />
      <mesh ref={fill} geometry={PLANE} material={BAR.mint} scale={[BAR_W, BAR_H, 1]} position={[0, 0, .001]} renderOrder={21} />
    </group>
    {kind !== 'camera' ? <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .035, 0]}><circleGeometry args={[kind === 'heavy' || kind === 'turret' ? .45 : .32, 20]} /><meshBasicMaterial color={ground} transparent opacity={.18} depthWrite={false} /></mesh> : null}
    {faction === 'hostile' ? <>
      <group ref={stun} position={[0, top - .1, 0]} visible={false}>
        {[0, 1, 2, 3].map(k => <mesh key={k} position={[Math.sin(k * 1.57) * .34, (k % 2) * .18, Math.cos(k * 1.57) * .34]} rotation={[k * .7, 0, k * .4]} scale={[.05, .16, .05]} geometry={BOX} material={glow('#8fd8ff')} />)}
      </group>
      <mesh ref={mark} geometry={DIAMOND} material={glow('#ffb17d')} scale={[1, 1.5, 1]} visible={false} />
      <group ref={hold} visible={false}><ProgressRing radius={.7} color="#9ff7d1" value={takedownProgress} segments={24} /></group>
      <DetectMarker sim={sim} id={id} top={top} />
    </> : null}
    {downed ? <group ref={revive} visible={false}><ProgressRing radius={.7} color="#9ff7d1" value={reviveProgress} segments={24} /></group> : null}
    {label ? <Html portal={labels} center position={[0, top + .62, 0]} style={{ pointerEvents: 'none' }}><span className={`unit-label${kind === 'target' ? ' hostile' : kind === 'vip' ? ' vip' : ` squad cls-${kind}`}`}>{label}</span></Html> : null}
  </group>;
}

export function Units({ sim, units, selected, squad, live, labels, hitboxes }: { sim: Simulation; units: Unit[]; selected: string[]; squad: string[]; live: boolean; labels: RefObject<HTMLDivElement>; hitboxes: Hitboxes }) {
  // Hotkey tags mark a partial selection; with the whole squad selected they would only stack up over the group.
  const partial = live && units.some(u => u.faction === 'squad' && u.hp > 0 && !selected.includes(u.id));
  return <>{units.map(u => <Agent key={`${u.id}:${u.kind}`} sim={sim} unit={u} selected={selected.includes(u.id)} slot={squad.indexOf(u.id)} tagged={partial} labels={labels} hitboxes={hitboxes} />)}</>;
}
