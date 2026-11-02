import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { AlwaysStencilFunc, BufferAttribute, CanvasTexture, CircleGeometry, GreaterDepth, MeshBasicMaterial, MeshStandardMaterial, NotEqualStencilFunc, PlaneGeometry, ReplaceStencilOp, RingGeometry, Shape, ShapeGeometry, SRGBColorSpace, Color, Vector2, Vector3 } from 'three';
import type { BufferGeometry, Camera, Group, Material, Mesh, Object3D, Skeleton, SkinnedMesh, Texture } from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { REVIVE_SECONDS, SUSPICIOUS, TAKEDOWN_SECONDS } from '../game/simulation.ts';
import type { Faction, Simulation, Unit, UnitKind } from '../game/simulation.ts';
import { dragged } from './drag.ts';
import { rectDistance } from './framing.ts';
import { BOX, DIAMOND, glow, ProgressRing, shield, SHIELD_COLOR, STILL } from './parts.tsx';
import { animate, CLASS_COLOR, makeRig, REACH, SCALE, skin } from './rigs.ts';
import type { Motion } from './rigs.ts';
import { BRIEFCASE, MACHINES, SHIELD, useModelFile, useUnitModel, WEAPONS } from './models.ts';
import { animateImported, animateMachine, importMachine, importRig } from './skinned.ts';
import type { Carried, ImportedMachine } from './skinned.ts';
import { mayBeHidden, viewAlong } from './view.ts';

type Vec3 = [number, number, number];
export const TOP: Record<UnitKind, number> = { assault: 1.3, support: 1.3, recon: 1.3, tech: 1.3, guard: 1.3, heavy: 1.55, camera: 2.15, turret: .75, target: 1.3, vip: 1.3 };
const HITBOX: Record<UnitKind, Vec3> = { assault: [.7, 1.35, .7], support: [.7, 1.35, .7], recon: [.7, 1.35, .7], tech: [.7, 1.35, .7], guard: [.7, 1.35, .7], heavy: [.85, 1.6, .85], camera: [.7, 2.3, .7], turret: [1.1, 1, 1.1], target: [.7, 1.35, .7], vip: [.7, 1.35, .7] };
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
// where it ends up visible. At night the body also glows faintly in its own colors, so units
// read on dark streets whichever way the moon catches them.
const NIGHT_GLOW = .4;
const nightGlow = (m: MeshStandardMaterial) => {
  m.onBeforeCompile = shader => { shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * ${NIGHT_GLOW.toFixed(2)};`); };
  m.customProgramCacheKey = () => 'night-glow';
  return m;
};
const MARKS = { stencilWrite: true, stencilRef: 1, stencilFunc: AlwaysStencilFunc, stencilZPass: ReplaceStencilOp };
const BODY = nightGlow(Object.assign(new MeshStandardMaterial({ vertexColors: true, roughness: .72, metalness: .2 }), MARKS));
// Visors, lamps and lenses are authored past 1, like the district's neon, so the bloom pass picks them out.
const GLOW_GAIN = 1.8;
const GLOW = Object.assign(new MeshBasicMaterial({ vertexColors: true, toneMapped: false }), MARKS);
GLOW.color.setScalar(GLOW_GAIN);
const BODY_DIM = nightGlow(BODY.clone()), GLOW_DIM = GLOW.clone();
BODY_DIM.color.setScalar(DIM); GLOW_DIM.color.setScalar(DIM);
// What the scene draws and poses for one unit: its procedural rig, or its imported model once that has loaded.
// Each painted mesh has a lit material and a darkened one for a downed operative; each skin gets a silhouette.
type Paint = { mesh: Mesh; lit: Material; dim: Material };
type Figure = { root: Object3D; skins: SkinnedMesh[]; skeleton: Skeleton; paints: Paint[]; pose: (m: Motion) => void };
// Imported textures are painted darker than the procedural palette, so at play scale a unit's suit sinks into the
// street and its class color fades. A gamma lift on the texture brightens the dark tones most and barely moves
// near-white parts (the med pack), which keeps them under the bloom threshold. The lift also grays the colors, so a
// saturation boost after it restores the class colors. The night glow sees the result.
const TEXTURE_LIFT = .65, TEXTURE_SATURATION = 1.7;
const lifted = (m: MeshStandardMaterial) => {
  const night = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
diffuseColor.rgb = pow(diffuseColor.rgb, vec3(${TEXTURE_LIFT.toFixed(2)}));
diffuseColor.rgb = max(mix(vec3(dot(diffuseColor.rgb, vec3(.2126, .7152, .0722))), diffuseColor.rgb, ${TEXTURE_SATURATION.toFixed(2)}), 0.);`);
    night.call(m, shader, renderer);
  };
  m.customProgramCacheKey = () => 'night-glow-lift';
  return m;
};
const textured = new Map<Texture, { lit: Material; dim: Material }>();
function texturedPaint(map: Texture) {
  let p = textured.get(map);
  if (!p) {
    const lit = lifted(nightGlow(Object.assign(new MeshStandardMaterial({ map, roughness: .72, metalness: .2 }), MARKS))), dim = lifted(nightGlow(lit.clone()));
    dim.color.setScalar(DIM);
    textured.set(map, p = { lit, dim });
  }
  return p;
}
function figureOf(kind: UnitKind, template: GLTF | null, carried: Carried, machine: ImportedMachine | null): Figure {
  if (machine) {
    const rig = importMachine(kind, machine);
    const paints = rig.paints.map(({ mesh, map, glow }): Paint => ({ mesh, ...(glow ? { lit: GLOW, dim: GLOW_DIM } : map ? texturedPaint(map) : { lit: BODY, dim: BODY_DIM }) }));
    return { root: rig.root, skins: rig.skins, skeleton: rig.skeleton, paints, pose: m => animateMachine(rig, m) };
  }
  if (template) {
    const rig = importRig(kind, template, carried), paints: Paint[] = [{ mesh: rig.body, ...(rig.map ? texturedPaint(rig.map) : { lit: BODY, dim: BODY_DIM }) }];
    for (const { body, glow, map } of rig.props) {
      paints.push({ mesh: body, ...(map ? texturedPaint(map) : { lit: BODY, dim: BODY_DIM }) });
      if (glow) paints.push({ mesh: glow, lit: GLOW, dim: GLOW_DIM });
    }
    return { root: rig.root, skins: [rig.body], skeleton: rig.skeleton, paints, pose: m => animateImported(rig, m) };
  }
  const rig = makeRig(kind, BODY, GLOW), paints: Paint[] = [{ mesh: rig.body, lit: BODY, dim: BODY_DIM }];
  if (rig.glow) paints.push({ mesh: rig.glow, lit: GLOW, dim: GLOW_DIM });
  return { root: rig.body, skins: [rig.body], skeleton: rig.skeleton, paints, pose: m => animate(rig, m) };
}
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

// Combat looks for the lit pass: a hit turns the model white for HIT_FLASH_SECONDS, an EMP stun adds a pulsing
// blue rim, and a dead hostile dims, then fades. They swap materials on the model's meshes rather than adding
// any, so they cost no draw calls. Flash and rim materials are shared; a death clones the unit's own, to fade it.
const HIT_FLASH_SECONDS = .1, COLLAPSE_SECONDS = .4, FADE_AFTER = 1.5, FADE_SECONDS = .6;
type Look = 'normal' | 'flash' | 'stun' | 'dead';
type Tinted = MeshStandardMaterial | MeshBasicMaterial;
const variants = new WeakSet<Material>();
const HIT_FLASH = Object.assign(new MeshBasicMaterial({ color: '#fff3e2', toneMapped: false }), MARKS);
variants.add(HIT_FLASH);
const stunPulse = { value: 1 }, stunned = new Map<Material, Material>();
// The rim needs a lit material's normals; the glow keeps its own look.
function stunVariant(base: Material) {
  if (!(base as MeshStandardMaterial).isMeshStandardMaterial) return base;
  let m = stunned.get(base);
  if (!m) {
    m = base.clone();
    m.onBeforeCompile = shader => {
      shader.uniforms.uStun = stunPulse;
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uStun;').replace('#include <opaque_fragment>',
        'outgoingLight += vec3(.3, .7, 1.) * (pow(1. - abs(dot(geometryViewDir, normal)), 1.5) * 1.6 + .12) * uStun;\n#include <opaque_fragment>');
    };
    m.customProgramCacheKey = () => 'stun-rim';
    stunned.set(base, m); variants.add(m);
  }
  return m;
}
function deadVariant(cache: Map<Material, Tinted>, base: Material) {
  let m = cache.get(base);
  if (!m) {
    m = (base as Tinted).clone();
    m.color.multiplyScalar(.42); if ('emissive' in m) m.emissive.multiplyScalar(.12); m.transparent = true;
    cache.set(base, m); variants.add(m);
  }
  return m;
}
// Puts `look` on every mesh under `model`, remembering each mesh's own material to restore it.
function dress(model: Object3D, look: Look, base: Map<Mesh, Material>, dead: Map<Material, Tinted>) {
  model.traverse(o => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    if (!variants.has(mesh.material as Material)) base.set(mesh, mesh.material as Material);
    const own = base.get(mesh)!;
    mesh.material = look === 'flash' ? HIT_FLASH : look === 'stun' ? stunVariant(own) : look === 'dead' ? deadVariant(dead, own) : own;
  });
}
const HUMAN = (kind: UnitKind) => kind !== 'camera' && kind !== 'turret';

// Unit hitboxes by mesh, for the canvas cursor; a unit is clickable when unitClick would act on it.
export type Hitboxes = Map<Mesh, string>;
export const clickable = (sim: Simulation, u: Unit | undefined) => !!u && (u.faction === 'squad' && u.hp > 0 || sim.phase === 'mission' && (u.faction !== 'hostile' || u.hp > 0 && u.visible));

// A click or tap that misses every hitbox still picks a clickable unit drawn this close to it (CSS pixels).
export const PICK_SLOP = 12;
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

// The cover shield, just right of an operative's health bar, a fixed size on screen.
const SHIELD_PX = 18, screenRight = new Vector3();
function CoverMarker({ sim, id, top }: { sim: Simulation; id: string; top: number }) {
  const icon = useRef<Mesh>(null);
  useFrame(({ camera }) => {
    const u = sim.units.find(v => v.id === id), m = icon.current;
    if (!m) return;
    const status = u && sim.phase === 'mission' ? sim.coverStatus(u).shield : null;
    m.visible = !!status;
    if (!status) return;
    const px = 1 / camera.zoom;
    m.material = shield(SHIELD_COLOR[status]);
    m.quaternion.copy(camera.quaternion); m.scale.set(SHIELD_PX * px, SHIELD_PX * px, 1);
    m.position.set(0, top + .22, 0).addScaledVector(screenRight.set(1, 0, 0).applyQuaternion(camera.quaternion), BAR_W / 2 + .03 + (SHIELD_PX / 2 + 3) * px);
  });
  return <mesh ref={icon} geometry={PLANE} material={shield(SHIELD_COLOR.covered)} visible={false} renderOrder={22} />;
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
// position kicks and raises the weapon, lost health flinches.
const STEP_RATE = 14, AIM_HOLD = 1.6;
const newestShot = (sim: Simulation) => sim.shots.reduce((n, s) => Math.max(n, s.id), -1);

function Agent({ sim, unit, selected, slot, tagged, labels, hitboxes }: { sim: Simulation; unit: Unit; selected: boolean; slot: number; tagged: boolean; labels: RefObject<HTMLDivElement>; hitboxes: Hitboxes }) {
  const { id, kind, faction } = unit;
  const root = useRef<Group>(null), model = useRef<Group>(null), pose = useRef<Group>(null), ring = useRef<Group>(null), spin = useRef<Group>(null), look = useRef(new Vector3()).current;
  const bar = useRef<Group>(null), fill = useRef<Mesh>(null);
  const stun = useRef<Group>(null), markRef = useRef<Mesh>(null), revive = useRef<Group>(null), hold = useRef<Group>(null), lit = useRef<Group>(null), disc = useRef<Mesh>(null);
  const downed = faction === 'squad' && unit.hp <= 0, top = TOP[kind], hitbox = HITBOX[kind];
  const register = useCallback((mesh: Mesh) => { hitboxes.set(mesh, id); return () => { hitboxes.delete(mesh); }; }, [hitboxes, id]);
  const c = (color: string) => downed ? dim(color) : color;
  // The figure and its silhouette skin share one skeleton; only their materials follow the downed state.
  const template = useUnitModel(kind), weaponFile = WEAPONS[kind], shieldFile = kind === 'heavy' ? SHIELD : undefined, caseFile = kind === 'target' ? BRIEFCASE : undefined;
  const weapon = useModelFile(weaponFile?.url), shield = useModelFile(shieldFile?.url), briefcase = useModelFile(caseFile?.url);
  // A machine swaps in only once all its parts have loaded.
  const machineFile = MACHINES[kind], machineBase = useModelFile(machineFile?.base?.url), machineHead = useModelFile(machineFile?.head.url);
  const { figure, ghosts } = useMemo(() => {
    const carried: Carried = {
      weapon: weapon && weaponFile ? { gltf: weapon, file: weaponFile } : null,
      shield: shield && shieldFile ? { gltf: shield, file: shieldFile } : null,
      briefcase: briefcase && caseFile ? { gltf: briefcase, file: caseFile } : null,
    };
    const machine = machineFile && machineHead && (!machineFile.base || machineBase) ? { machine: machineFile, base: machineBase, head: machineHead } : null;
    const figure = figureOf(kind, template, carried, machine), ghosts = figure.skins.map(body => skin({ body, skeleton: figure.skeleton }, BODY));
    for (const { mesh, lit } of figure.paints) { mesh.renderOrder = 1; mesh.castShadow = lit !== GLOW; }
    ghosts.forEach((ghost, k) => { ghost.renderOrder = 1; ghost.frustumCulled = figure.skins[k].frustumCulled; });
    return { figure, ghosts };
  }, [kind, template, weapon, shield, briefcase, machineBase, machineHead]);
  useEffect(() => () => figure.skeleton.dispose(), [figure]);
  // Set once per change, not every render, so a combat look swapped in by dress() survives snapshots.
  useEffect(() => { for (const p of figure.paints) p.mesh.material = downed ? p.dim : p.lit; }, [figure, downed]);
  for (const ghost of ghosts) ghost.material = silhouette(c(silhouetteColor(kind, faction)));
  const motion = useRef<Motion>({ t: 0, walk: 0, phase: 0, aim: 0, kick: 0, kickSide: 0, flinch: 0, down: 0, die: 0 }).current;
  const seen = useRef({ shot: newestShot(sim), fired: -Infinity }).current;
  // Combat state, kept in mission time: when the last hit landed and when the unit went down (-Infinity: before this view saw it).
  // It resets for a new plan or when the clock runs back, since a restart keeps the plan and rewinds time.
  const combat = useRef({ plan: null as Simulation['plan'], time: 0, hp: 0, hitAt: -Infinity, downAt: null as number | null, look: 'normal' as Look, base: new Map<Mesh, Material>(), dead: new Map<Material, Tinted>() }).current;
  useEffect(() => () => combat.dead.forEach(m => m.dispose()), [combat]);
  const reviveProgress = () => { let p = 0; for (const v of sim.units) if (v.reviveTarget === id) p = Math.max(p, v.revive / REVIVE_SECONDS); return p; };
  const takedownProgress = () => (sim.units.find(v => v.id === id)?.held ?? 0) / TAKEDOWN_SECONDS;
  useFrame(({ clock, camera }, frame) => {
    const u = sim.units.find(v => v.id === id);
    if (!root.current || !model.current || !pose.current) return;
    if (!u) { root.current.visible = false; return; }
    const t = clock.elapsedTime, dt = Math.min(frame, .1);
    if (combat.plan !== sim.plan || sim.time < combat.time) {
      combat.plan = sim.plan; combat.hp = u.hp; combat.hitAt = -Infinity; combat.downAt = u.hp > 0 ? null : -Infinity;
      combat.dead.forEach(m => m.dispose()); combat.dead.clear();
      if (lit.current && combat.look !== 'normal') dress(lit.current, combat.look = 'normal', combat.base, combat.dead);
      seen.fired = -Infinity; motion.kick = motion.flinch = 0;
    }
    if (u.hp < combat.hp) { combat.hitAt = sim.time; motion.flinch = 1; }
    if (u.hp <= 0 && combat.downAt === null) combat.downAt = sim.time;
    if (u.hp > 0) combat.downAt = null;
    combat.hp = u.hp; combat.time = sim.time;
    let newest = seen.shot;
    for (const s of sim.shots) if (s.id > seen.shot) {
      newest = Math.max(newest, s.id);
      if (Math.hypot(s.from.x - u.x, s.from.z - u.z) < .3) { motion.kick = 1; motion.kickSide ^= 1; seen.fired = t; }
    }
    seen.shot = newest;
    const downFor = combat.downAt === null ? -1 : sim.time - combat.downAt, dead = u.faction === 'hostile' && u.hp <= 0;
    const gone = dead && (combat.downAt === -Infinity || HUMAN(kind) && downFor >= FADE_AFTER + FADE_SECONDS);
    const hidden = u.faction === 'hostile' && (!u.visible || gone);
    root.current.visible = !hidden;
    if (hidden) return;
    const down = u.hp <= 0, walking = u.moving && !sim.paused && !down;
    const dressed: Look = sim.time - combat.hitAt < HIT_FLASH_SECONDS ? 'flash' : dead ? 'dead' : u.stunned > 0 ? 'stun' : 'normal';
    if (lit.current && dressed !== combat.look) dress(lit.current, combat.look = dressed, combat.base, combat.dead);
    if (dressed === 'stun') stunPulse.value = .7 + .3 * Math.sin(t * 16);
    if (dead && HUMAN(kind)) { const fade = 1 - Math.min(1, Math.max(0, (downFor - FADE_AFTER) / FADE_SECONDS)); combat.dead.forEach(m => { m.opacity = fade; }); }
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
    // A unit that goes down falls over COLLAPSE_SECONDS, accelerating like a body would; a camera or turret droops.
    const collapse = down ? Math.min(1, downFor / COLLAPSE_SECONDS) : 0, fall = collapse * collapse;
    motion.down = dead ? 0 : fall;
    motion.die = dead ? HUMAN(kind) ? fall : collapse : 0;
    figure.pose(motion);
    // Downed operatives lie on their side, hostiles fall on their backs; both settle centered on the unit.
    const side = motion.down, back = HUMAN(kind) ? motion.die : 0;
    pose.current.rotation.set(-back * Math.PI / 2, 0, side * Math.PI / 2);
    pose.current.position.set(side * .6, (side + back) * .15 - (HUMAN(kind) ? 0 : motion.die * .1), back * .6);
    if (disc.current) disc.current.visible = !dead;
    // The silhouette only draws when a building or barrier could be in front of the unit.
    const world = sim.plan?.world, d = camera.getWorldDirection(look);
    const hiding = !dead && !!world && mayBeHidden(world.buildings, world.cover, viewAlong(d.x, d.y, d.z), u, REACH);
    for (const ghost of ghosts) ghost.visible = hiding;
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
        <group scale={SCALE[kind] ?? 1}><group ref={lit}><primitive object={figure.root} /></group>{ghosts.map((ghost, k) => <primitive key={k} object={ghost} />)}</group>
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
    {kind !== 'camera' ? <mesh ref={disc} rotation={[-Math.PI / 2, 0, 0]} position={[0, .035, 0]}><circleGeometry args={[kind === 'heavy' || kind === 'turret' ? .45 : .32, 20]} /><meshBasicMaterial color={ground} transparent opacity={.18} depthWrite={false} /></mesh> : null}
    {faction === 'hostile' ? <>
      <group ref={stun} position={[0, top - .1, 0]} visible={false}>
        {[0, 1, 2, 3].map(k => <mesh key={k} position={[Math.sin(k * 1.57) * .34, (k % 2) * .18, Math.cos(k * 1.57) * .34]} rotation={[k * .7, 0, k * .4]} scale={[.05, .16, .05]} geometry={BOX} material={glow('#8fd8ff')} />)}
      </group>
      <mesh ref={markRef} geometry={DIAMOND} material={glow('#ffb17d')} scale={[1, 1.5, 1]} visible={false} />
      <group ref={hold} visible={false}><ProgressRing radius={.7} color="#9ff7d1" value={takedownProgress} segments={24} /></group>
      <DetectMarker sim={sim} id={id} top={top} />
    </> : null}
    {faction === 'squad' ? <CoverMarker sim={sim} id={id} top={top} /> : null}
    {downed ? <group ref={revive} visible={false}><ProgressRing radius={.7} color="#9ff7d1" value={reviveProgress} segments={24} /></group> : null}
    {label ? <Html portal={labels} center position={[0, top + .62, 0]} style={{ pointerEvents: 'none' }}><span className={`unit-label${kind === 'target' ? ' hostile' : kind === 'vip' ? ' vip' : ` squad cls-${kind}`}`}>{label}</span></Html> : null}
  </group>;
}

export function Units({ sim, units, selected, squad, live, labels, hitboxes }: { sim: Simulation; units: Unit[]; selected: string[]; squad: string[]; live: boolean; labels: RefObject<HTMLDivElement>; hitboxes: Hitboxes }) {
  // Hotkey tags mark a partial selection; with the whole squad selected they would only stack up over the group.
  const partial = live && units.some(u => u.faction === 'squad' && u.hp > 0 && !selected.includes(u.id));
  return <>{units.map(u => <Agent key={`${u.id}:${u.kind}`} sim={sim} unit={u} selected={selected.includes(u.id)} slot={squad.indexOf(u.id)} tagged={partial} labels={labels} hitboxes={hitboxes} />)}</>;
}
