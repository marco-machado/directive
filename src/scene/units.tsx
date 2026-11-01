import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { AlwaysStencilFunc, BufferAttribute, CanvasTexture, CircleGeometry, GreaterDepth, MeshBasicMaterial, MeshStandardMaterial, NotEqualStencilFunc, PlaneGeometry, ReplaceStencilOp, RingGeometry, Shape, ShapeGeometry, SRGBColorSpace, Color, Vector2, Vector3 } from 'three';
import type { BufferGeometry, Camera, Group, Material, Mesh } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { REVIVE_SECONDS, SUSPICIOUS, TAKEDOWN_SECONDS } from '../game/simulation.ts';
import type { Faction, Simulation, Unit, UnitKind } from '../game/simulation.ts';
import { dragged } from './drag.ts';
import { rectDistance } from './framing.ts';
import { BOX, DIAMOND, glow, ProgressRing, STILL } from './parts.tsx';
import { animate, CLASS_COLOR, makeRig, REACH, SCALE, skin } from './rigs.ts';
import type { Motion } from './rigs.ts';
import { mayBeHidden, viewAlong } from './view.ts';

type Vec3 = [number, number, number];
export const TOP: Record<UnitKind, number> = { assault: 1.3, support: 1.3, recon: 1.3, tech: 1.3, guard: 1.3, heavy: 1.55, camera: 2.15, turret: .75, target: 1.3, vip: 1.3 };
const HITBOX: Record<UnitKind, Vec3> = { assault: [.95, 1.5, .95], support: [.95, 1.5, .95], recon: [.95, 1.5, .95], tech: [.95, 1.5, .95], guard: [.95, 1.5, .95], heavy: [1.15, 1.8, 1.15], camera: [.7, 2.3, .7], turret: [1.1, 1, 1.1], target: [.95, 1.5, .95], vip: [.95, 1.5, .95] };
const ACCENT: Record<UnitKind, string> = { assault: '#9ff7d1', support: '#9ff7d1', recon: '#9ff7d1', tech: '#8ff0e6', guard: '#ed7e70', heavy: '#ff6d5c', camera: '#ff5a4a', turret: '#ff6d5c', target: '#ffbd83', vip: '#ffe7a8' };
const GROUND: Record<Faction, string> = { squad: '#9ff7d1', hostile: '#ed7e70', vip: '#ffe7a8' };
// Silhouette colors: operatives in their class color, hostiles red, the VIP gold.
const silhouetteColor = (kind: UnitKind, faction: Faction) => faction === 'hostile' ? '#ff5148' : faction === 'vip' ? '#ffd77a' : CLASS_COLOR[kind] ?? '#9ff7d1';
const DIM = .42; // a downed operative's colors, darkened
const dim = (color: string) => `#${new Color(color).multiplyScalar(DIM).getHexString()}`;

// Occluded units: the lit pass sets the stencil under every pixel a unit covers, then the same
// model draws again flat, only where it lies behind something already drawn (GreaterDepth) and
// only on pixels with no stencil mark. The silhouette sets the mark too, so it blends once per
// pixel and never tints a unit over its own visible body or over another unit. The lit pass
// draws after the rest of the opaque scene (render order 1), so a unit only marks the pixels
// where it ends up visible.
const MARKS = { stencilWrite: true, stencilRef: 1, stencilFunc: AlwaysStencilFunc, stencilZPass: ReplaceStencilOp };
const BODY = Object.assign(new MeshStandardMaterial({ vertexColors: true, roughness: .72, metalness: .2 }), MARKS);
const GLOW = Object.assign(new MeshBasicMaterial({ vertexColors: true, toneMapped: false }), MARKS);
const BODY_DIM = BODY.clone(), GLOW_DIM = GLOW.clone();
BODY_DIM.color.setScalar(DIM); GLOW_DIM.color.setScalar(DIM);
const silhouettes = new Map<string, Material>();
function silhouette(color: string) {
  let m = silhouettes.get(color);
  if (!m) {
    m = new MeshBasicMaterial({
      color, transparent: true, opacity: .5, depthWrite: false, depthFunc: GreaterDepth, toneMapped: false,
      stencilWrite: true, stencilRef: 1, stencilFunc: NotEqualStencilFunc, stencilZPass: ReplaceStencilOp,
    });
    silhouettes.set(color, m);
  }
  return m;
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

// Faction marks: a chevron in the class color over each operative and a red diamond over each visible
// hostile, outlined in black. Like the detection marker they are built in screen pixels and drawn over
// buildings, so a unit's side reads even when its model is a few pixels tall.
function mark(points: [number, number][], color: string) {
  const layer = (scale: number, tint: string) => {
    const g = new ShapeGeometry(new Shape(points.map(([x, y]) => new Vector2(x * scale, y * scale))));
    const c = new Color(tint), n = g.getAttribute('position').count;
    g.setAttribute('color', new BufferAttribute(new Float32Array(Array.from({ length: n }, () => [c.r, c.g, c.b]).flat()), 3));
    g.deleteAttribute('uv');
    return g;
  };
  // The outline draws first; the mark draws over it in the same call.
  return mergeGeometries([layer(1.4, '#04090b'), layer(1, color)])!;
}
const CHEVRON: [number, number][] = [[-6, 4], [0, -1.5], [6, 4], [6, .5], [0, -5], [-6, .5]];
const MARK_SHAPES = new Map<string, BufferGeometry>();
const markShape = (faction: Faction, kind: UnitKind) => {
  const key = faction === 'squad' ? kind : 'hostile';
  let g = MARK_SHAPES.get(key);
  if (!g) { g = faction === 'squad' ? mark(CHEVRON, CLASS_COLOR[kind] ?? GROUND.squad) : mark([[0, 5.5], [4.5, 0], [0, -5.5], [-4.5, 0]], '#ff5148'); MARK_SHAPES.set(key, g); }
  return g;
};
const MARK_PAINT = new MeshBasicMaterial({ vertexColors: true, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
const MARK_LIFT = 12; // pixels above the health bar
function FactionMark({ sim, id, kind, faction, top }: { sim: Simulation; id: string; kind: UnitKind; faction: Faction; top: number }) {
  const ref = useRef<Mesh>(null);
  useFrame(({ camera }) => {
    const u = sim.units.find(v => v.id === id), m = ref.current;
    if (!m) return;
    // A hostile's detection or ability mark takes the diamond's place.
    const show = !!u && u.hp > 0 && sim.phase === 'mission' && (u.faction === 'squad' || u.visible && u.detect <= 0 && u.marked <= 0);
    m.visible = show;
    if (!show) return;
    const px = 1 / camera.zoom;
    m.quaternion.copy(camera.quaternion); m.scale.setScalar(px);
    m.position.set(0, top + .22, 0).addScaledVector(screenUp.set(0, 1, 0).applyQuaternion(camera.quaternion), .1 + MARK_LIFT * px);
  });
  return <mesh ref={ref} geometry={markShape(faction, kind)} material={MARK_PAINT} renderOrder={22} visible={false} />;
}

// Animation state the scene keeps per unit, read off the simulation's changes: a new shot from the unit's
// position kicks, lost health flinches, a hostile's death plays out before it disappears.
const DEATH_SHOWN = 1.6, DEATH_FALL = .55, DOWN_FALL = .45, STEP_RATE = 14, AIM_HOLD = 1.6;
const ease = (k: number) => k * k * (3 - 2 * k);
const newestShot = (sim: Simulation) => sim.shots.reduce((n, s) => Math.max(n, s.id), -1);

function Agent({ sim, unit, selected, slot, tagged, labels, hitboxes }: { sim: Simulation; unit: Unit; selected: boolean; slot: number; tagged: boolean; labels: RefObject<HTMLDivElement>; hitboxes: Hitboxes }) {
  const { id, kind, faction } = unit;
  const root = useRef<Group>(null), model = useRef<Group>(null), pose = useRef<Group>(null), ring = useRef<Group>(null), spin = useRef<Group>(null), look = useRef(new Vector3()).current;
  const bar = useRef<Group>(null), fill = useRef<Mesh>(null);
  const stun = useRef<Group>(null), markRef = useRef<Mesh>(null), revive = useRef<Group>(null), hold = useRef<Group>(null);
  const downed = faction === 'squad' && unit.hp <= 0, top = TOP[kind], hitbox = HITBOX[kind];
  const register = useCallback((mesh: Mesh) => { hitboxes.set(mesh, id); return () => { hitboxes.delete(mesh); }; }, [hitboxes, id]);
  const c = (color: string) => downed ? dim(color) : color;
  // The rig and its silhouette skin share one skeleton; only their materials follow the downed state.
  const { rig, ghost } = useMemo(() => {
    const rig = makeRig(kind, BODY, GLOW), ghost = skin(rig, BODY);
    rig.body.castShadow = true; rig.body.add(ghost);
    for (const m of [rig.body, rig.glow, ghost]) if (m) m.renderOrder = 1;
    return { rig, ghost };
  }, [kind]);
  useEffect(() => () => rig.skeleton.dispose(), [rig]);
  rig.body.material = downed ? BODY_DIM : BODY;
  if (rig.glow) rig.glow.material = downed ? GLOW_DIM : GLOW;
  ghost.material = silhouette(c(silhouetteColor(kind, faction)));
  const motion = useRef<Motion>({ t: 0, walk: 0, phase: 0, aim: 0, kick: 0, kickSide: 0, flinch: 0, down: downed ? 1 : 0, die: 0 }).current;
  const seen = useRef({ hp: unit.hp, shot: newestShot(sim), fired: -Infinity, diedAt: -1, shown: false }).current;
  const reviveProgress = () => { let p = 0; for (const v of sim.units) if (v.reviveTarget === id) p = Math.max(p, v.revive / REVIVE_SECONDS); return p; };
  const takedownProgress = () => (sim.units.find(v => v.id === id)?.held ?? 0) / TAKEDOWN_SECONDS;
  useFrame(({ clock, camera }, frame) => {
    const u = sim.units.find(v => v.id === id);
    if (!root.current || !model.current || !pose.current) return;
    if (!u) { root.current.visible = false; return; }
    const t = clock.elapsedTime, dt = Math.min(frame, .1);
    let newest = seen.shot;
    for (const s of sim.shots) if (s.id > seen.shot) {
      newest = Math.max(newest, s.id);
      if (Math.hypot(s.from.x - u.x, s.from.z - u.z) < .3) { motion.kick = 1; motion.kickSide ^= 1; seen.fired = t; }
    }
    seen.shot = newest;
    if (u.hp < seen.hp - .001) motion.flinch = 1;
    if (u.faction === 'hostile' && seen.hp > 0 && u.hp <= 0 && seen.shown) seen.diedAt = t;
    seen.hp = u.hp;
    const dying = seen.diedAt >= 0 && t - seen.diedAt < DEATH_SHOWN;
    const hidden = u.faction === 'hostile' && (u.hp > 0 ? !u.visible : !dying);
    root.current.visible = seen.shown = !hidden;
    if (hidden) return;
    const down = u.faction === 'squad' && u.hp <= 0, walking = u.moving && !sim.paused && u.hp > 0;
    root.current.position.set(u.x, 0, u.z);
    model.current.rotation.y = u.heading;
    // Animation layers: walk, aim, recoil and flinch on the bones; the fall to the ground on the whole model.
    const toward = (from: number, to: number, rate: number) => from + (to - from) * Math.min(1, dt * rate);
    const aiming = u.hp > 0 && (t - seen.fired < AIM_HOLD || u.faction === 'squad' && !!u.targetId && !u.moving);
    motion.t = t;
    motion.walk = toward(motion.walk, walking ? 1 : 0, 10);
    motion.phase += dt * STEP_RATE * motion.walk;
    motion.aim = toward(motion.aim, aiming ? 1 : 0, 8);
    motion.kick *= Math.exp(-dt * 10); motion.flinch *= Math.exp(-dt * 6);
    motion.down = Math.max(0, Math.min(1, motion.down + (down ? dt : -dt) / DOWN_FALL));
    motion.die = dying ? Math.min(1, (t - seen.diedAt) / DEATH_FALL) : 0;
    animate(rig, motion);
    const fallen = ease(motion.down), dead = motion.die * motion.die, standing = kind !== 'camera' && kind !== 'turret';
    // Downed operatives lie on their side, hostiles fall on their backs; both settle centered on the unit.
    pose.current.rotation.set(standing ? -dead * Math.PI / 2 : 0, 0, fallen * Math.PI / 2);
    pose.current.position.set(fallen * .6, (fallen + dead) * .15 - (standing ? 0 : dead * .1), standing ? dead * .6 : 0);
    // The silhouette only draws when a building or barrier could be in front of the unit.
    const world = sim.plan?.world, d = camera.getWorldDirection(look);
    ghost.visible = !!world && mayBeHidden(world.buildings, world.cover, viewAlong(d.x, d.y, d.z), u, REACH);
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
      stun.current.visible = u.hp > 0 && u.stunned > 0; stun.current.rotation.y = t * 5;
      stun.current.children.forEach((spark, k) => { spark.visible = Math.sin(t * 31 + k * 2.1) > -.3; });
    }
    if (markRef.current) { markRef.current.visible = u.hp > 0 && u.marked > 0; markRef.current.rotation.y = t * 2.4; markRef.current.position.y = top + .5 + Math.sin(t * 4) * .05; }
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
        <group scale={SCALE[kind] ?? 1}><primitive object={rig.body} /></group>
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
    {faction !== 'vip' ? <FactionMark sim={sim} id={id} kind={kind} faction={faction} top={top} /> : null}
    {kind !== 'camera' ? <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .035, 0]}><circleGeometry args={[kind === 'heavy' || kind === 'turret' ? .45 : .32, 20]} /><meshBasicMaterial color={ground} transparent opacity={.18} depthWrite={false} /></mesh> : null}
    {faction === 'hostile' ? <>
      <group ref={stun} position={[0, top - .1, 0]} visible={false}>
        {[0, 1, 2, 3].map(k => <mesh key={k} position={[Math.sin(k * 1.57) * .34, (k % 2) * .18, Math.cos(k * 1.57) * .34]} rotation={[k * .7, 0, k * .4]} scale={[.05, .16, .05]} geometry={BOX} material={glow('#8fd8ff')} />)}
      </group>
      <mesh ref={markRef} geometry={DIAMOND} material={glow('#ffb17d')} scale={[1, 1.5, 1]} visible={false} />
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
