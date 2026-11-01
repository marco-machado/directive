import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending, BoxGeometry, BufferAttribute, CanvasTexture, Color, DoubleSide, DynamicDrawUsage, Euler, Group, InstancedBufferAttribute, InstancedBufferGeometry,
  InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, NormalBlending, Quaternion, ShaderMaterial, Vector2, Vector3,
} from 'three';
import type { Blast, Faction, Shot, Simulation, Unit, UnitKind } from '../game/simulation.ts';
import { play } from '../ui/audio.ts';
import type { Cue } from '../ui/audio.ts';
import { kickCamera } from './kick.ts';

// Combat effects, driven by the simulation's shots, blasts and unit hp. Every effect lives in a fixed pool that
// recycles its oldest entry, and every pool draws as one instanced batch, so a firefight adds seven draw calls
// however busy it gets: beams (tracers and EMP arcs), sparks, flashes, smoke, debris, ground rings and decals.
// Ages run on mission time (Simulation.time), so effects freeze with the pause.

const gunfire = (shot: Shot): Cue => shot.kind === 'snipe' ? 'snipe' : shot.shooter === 'turret' ? 'turretShot' : shot.faction === 'squad' ? 'shot' : 'hostileShot';
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const ease = (k: number) => 1 - (1 - k) ** 3;
const clamp01 = (k: number) => Math.min(1, Math.max(0, k));
const lerp = (k: number, a: number, b: number) => a + (b - a) * k;

// Where each shooter's muzzle sits in model space (right, up, forward), matching the guns in units.tsx.
type Vec3 = [number, number, number];
const MUZZLE: Partial<Record<UnitKind, Vec3>> = {
  assault: [.36, .72, .45], support: [.31, .72, .56], recon: [.27, .74, .86], tech: [.31, .72, .4], guard: [.31, .72, .56], heavy: [.42, .85, .72], turret: [0, .55, .88],
};
// The height a round strikes each kind of unit, and where a wreck smokes from.
const HIT_Y: Record<UnitKind, number> = { assault: .85, support: .85, recon: .85, tech: .85, guard: .85, heavy: 1, camera: 2.02, turret: .52, target: .85, vip: .85 };
const HUMAN = (kind: UnitKind) => kind !== 'camera' && kind !== 'turret';

const TRACER: Record<Faction, Color> = { squad: new Color('#5effc4'), hostile: new Color('#ff6a3a'), vip: new Color('#ffd27a') };
const SNIPE = new Color('#d8efff'), SNIPE_TRAIL = new Color('#a8d8ff'), WHITE = new Color('#ffffff');
const FIRE = new Color('#ffcf8a'), BLAST_ORANGE = new Color('#ff7a2e'), HEAL = new Color('#5ef2c0'), EMP = new Color('#79c6ff'), ARC = new Color('#a9dcff');
const SCORCH = new Color('#07090a'), BODY_MARK = new Color('#0d0a09');

// Timings, in seconds.
const MUZZLE_SECONDS = .06, IMPACT_SECONDS = .05, SNIPE_TRAIL_SECONDS = 1.1, EMP_ARC_SECONDS = .5, WRECK_SMOKE_SECONDS = 6, WRECK_SPARK_SECONDS = 3;
const BULLET_SPEED = 60, BULLET_STREAK = 3, SNIPE_SPEED = 200, SNIPE_STREAK = 5; // m/s and m
const GRAVITY = 12;

// Canvas textures: alpha masks the shaders tint.
function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  draw(canvas.getContext('2d')!, size);
  return new CanvasTexture(canvas);
}
const radial = (g: CanvasRenderingContext2D, x: number, y: number, r: number, stops: [number, number][]) => {
  const grad = g.createRadialGradient(x, y, 0, x, y, r);
  for (const [at, a] of stops) grad.addColorStop(at, `rgba(255,255,255,${a})`);
  g.fillStyle = grad; g.fillRect(0, 0, g.canvas.width, g.canvas.height);
};
// A hot core with eight spikes, long and short: muzzle flashes, impact glints, blast flashes.
const STAR = canvasTexture(128, (g, s) => {
  const c = s / 2;
  radial(g, c, c, c, [[0, 1], [.16, .85], [.42, .16], [1, 0]]);
  g.translate(c, c);
  for (let k = 0; k < 8; k++) {
    const reach = c * (k % 2 ? .5 : .98), spike = g.createLinearGradient(0, 0, reach, 0);
    spike.addColorStop(0, 'rgba(255,255,255,.95)'); spike.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = spike; g.beginPath(); g.moveTo(0, -s * .04); g.lineTo(reach, 0); g.lineTo(0, s * .04); g.closePath(); g.fill();
    g.rotate(Math.PI / 4);
  }
});
// A lumpy, soft puff of overlapping blobs.
const PUFF = canvasTexture(128, (g, s) => {
  const c = s / 2;
  for (let k = 0; k < 7; k++) {
    const a = k * 2.4, r = k ? s * .15 : 0;
    radial(g, c + Math.cos(a) * r, c + Math.sin(a) * r, s * (k ? .2 : .3), [[0, .5], [.6, .22], [1, 0]]);
  }
});
// A burn mark: a dark center fading out, crossed by radial streaks.
const BURN = canvasTexture(128, (g, s) => {
  const c = s / 2;
  radial(g, c, c, c * .95, [[0, .95], [.45, .7], [.8, .2], [1, 0]]);
  g.translate(c, c); g.lineCap = 'round';
  for (let k = 0; k < 24; k++) {
    g.rotate(2.39996);
    g.strokeStyle = 'rgba(255,255,255,.3)'; g.lineWidth = s * (.012 + (k % 3) * .008);
    g.beginPath(); g.moveTo(c * .25, 0); g.lineTo(c * (.55 + (k * 37 % 10) / 22), 0); g.stroke();
  }
});
// The cross-section of a tracer: a hot core with soft falloff.
const PROFILE = canvasTexture(64, (g, s) => {
  const grad = g.createLinearGradient(0, 0, 0, s);
  [[0, 0], [.22, .12], [.4, .55], [.5, 1], [.6, .55], [.78, .12], [1, 0]].forEach(([at, a]) => grad.addColorStop(at, `rgba(255,255,255,${a})`));
  g.fillStyle = grad; g.fillRect(0, 0, s, s);
});

// Instanced unit quads (corners at ±1) with per-instance attributes, refilled from scratch every frame.
class Quads {
  readonly geometry = new InstancedBufferGeometry();
  readonly data: Record<string, Float32Array> = {};
  private attributes: InstancedBufferAttribute[] = [];
  n = 0;
  constructor(readonly capacity: number, attrs: Record<string, number>) {
    this.geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    this.geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.geometry.instanceCount = 0;
    for (const [name, size] of Object.entries(attrs)) {
      const attribute = new InstancedBufferAttribute(new Float32Array(capacity * size), size).setUsage(DynamicDrawUsage);
      this.geometry.setAttribute(name, attribute); this.attributes.push(attribute); this.data[name] = attribute.array as Float32Array;
    }
  }
  // The next free instance, or -1 once the batch is full.
  add() { return this.n < this.capacity ? this.n++ : -1; }
  flush() {
    this.geometry.instanceCount = this.n;
    for (const a of this.attributes) { a.clearUpdateRanges(); a.addUpdateRange(0, this.n * a.itemSize); a.needsUpdate = true; }
    this.n = 0;
  }
}
const set4 = (array: Float32Array, i: number, a: number, b: number, c: number, d: number) => { array[4 * i] = a; array[4 * i + 1] = b; array[4 * i + 2] = c; array[4 * i + 3] = d; };
const set3 = (array: Float32Array, i: number, a: number, b: number, c: number) => { array[3 * i] = a; array[3 * i + 1] = b; array[3 * i + 2] = c; };
const set2 = (array: Float32Array, i: number, a: number, b: number) => { array[2 * i] = a; array[2 * i + 1] = b; };

// Beams: a quad from aStart to aEnd that always faces the camera and is aShape.x CSS pixels wide, so a tracer
// never thins below its width at any zoom. aShape.y is the alpha at the start end, for a streak that fades
// toward its tail.
const BEAM_VERTEX = /* glsl */ `
attribute vec3 aStart; attribute vec3 aEnd; attribute vec4 aColor; attribute vec2 aShape;
uniform vec2 uResolution;
varying vec2 vUv; varying vec4 vColor; varying float vTail;
void main() {
  vec4 a = projectionMatrix * viewMatrix * vec4(aStart, 1.), b = projectionMatrix * viewMatrix * vec4(aEnd, 1.);
  vec2 d = (b.xy / b.w - a.xy / a.w) * uResolution;
  float len = length(d);
  d = len > 1e-5 ? d / len : vec2(1., 0.);
  float along = position.x * .5 + .5;
  vec4 p = mix(a, b, along);
  p.xy += vec2(-d.y, d.x) * position.y * aShape.x / uResolution * p.w;
  gl_Position = p;
  vUv = vec2(along, position.y); vColor = aColor; vTail = aShape.y;
}`;
const BEAM_FRAGMENT = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv; varying vec4 vColor; varying float vTail;
void main() {
  float across = texture2D(map, vec2(.5, vUv.y * .5 + .5)).a;
  gl_FragColor = vec4(mix(vColor.rgb, vec3(1.), across * across * .6), across * mix(vTail, 1., vUv.x) * vColor.a);
  #include <colorspace_fragment>
}`;
// Billboards: a camera-facing square of half-size aSizeRot.x (m), turned aSizeRot.y in the view plane.
const BILLBOARD_VERTEX = /* glsl */ `
attribute vec3 aCenter; attribute vec2 aSizeRot; attribute vec4 aColor;
varying vec2 vUv; varying vec4 vColor;
void main() {
  vec4 mv = viewMatrix * vec4(aCenter, 1.);
  float c = cos(aSizeRot.y), s = sin(aSizeRot.y);
  mv.xy += mat2(c, s, -s, c) * position.xy * aSizeRot.x;
  gl_Position = projectionMatrix * mv;
  vUv = position.xy * .5 + .5; vColor = aColor;
}`;
// Ground quads: flat on the street at aCenter, the same size and turn.
const GROUND_VERTEX = /* glsl */ `
attribute vec3 aCenter; attribute vec2 aSizeRot; attribute vec4 aColor; attribute vec3 aRing;
varying vec2 vUv; varying vec2 vP; varying vec4 vColor; varying vec3 vRing;
void main() {
  float c = cos(aSizeRot.y), s = sin(aSizeRot.y);
  vec2 p = mat2(c, s, -s, c) * position.xy * aSizeRot.x;
  gl_Position = projectionMatrix * viewMatrix * vec4(aCenter + vec3(p.x, 0., p.y), 1.);
  vUv = position.xy * .5 + .5; vP = position.xy; vColor = aColor; vRing = aRing;
}`;
const TEXTURED_FRAGMENT = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv; varying vec4 vColor;
void main() {
  gl_FragColor = vec4(vColor.rgb, texture2D(map, vUv).a * vColor.a);
  #include <colorspace_fragment>
}`;
// A blast ring: aRing = (ring radius, ring width, fill), all as shares of the quad's half-size.
const RING_FRAGMENT = /* glsl */ `
varying vec2 vP; varying vec4 vColor; varying vec3 vRing;
void main() {
  float r = length(vP);
  if (r > 1.) discard;
  float ring = smoothstep(vRing.y, 0., abs(r - vRing.x));
  float fill = vRing.z * (1. - smoothstep(vRing.x - .05, vRing.x + .02, r)) * (.35 + .65 * r / max(vRing.x, .01));
  gl_FragColor = vec4(vColor.rgb, (ring + fill) * vColor.a);
  #include <colorspace_fragment>
}`;

const resolution = { value: new Vector2(1, 1) };
const shader = (vertexShader: string, fragmentShader: string, additive: boolean, map?: CanvasTexture) => new ShaderMaterial({
  vertexShader, fragmentShader, uniforms: { map: { value: map ?? null }, uResolution: resolution },
  transparent: true, depthWrite: false, side: DoubleSide, blending: additive ? AdditiveBlending : NormalBlending,
});

// Pooled effect records. Each pool is preallocated and hands out its oldest record, so nothing is allocated per shot.
type Tracer = { on: boolean; t0: number; ax: number; ay: number; az: number; bx: number; by: number; bz: number; len: number; snipe: boolean; hit: boolean; color: Color; fx: number; fz: number };
type Flash = { on: boolean; t0: number; life: number; x: number; y: number; z: number; size: number; rot: number; color: Color };
type Particle = { on: boolean; t0: number; life: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; size: number; grow: number; rot: number; spin: number; shade: number; alpha: number; color: Color };
type Debris = Particle & { rx: number; ry: number; rz: number };
type Ring = { on: boolean; t0: number; life: number; x: number; z: number; radius: number; kind: Blast['kind']; echo: boolean };
type Decal = { on: boolean; t0: number; x: number; z: number; size: number; rot: number; alpha: number; grow: number; color: Color };
type Emp = { on: boolean; t0: number; x: number; z: number; radius: number };
type Wreck = { on: boolean; t0: number; x: number; y: number; z: number; smoke: number; spark: number };
class Pool<T extends { on: boolean }> {
  readonly items: T[];
  private next = 0;
  constructor(size: number, make: () => T) { this.items = Array.from({ length: size }, make); }
  take() { const item = this.items[this.next]; this.next = (this.next + 1) % this.items.length; item.on = true; return item; }
  clear() { for (const item of this.items) item.on = false; }
}
const particle = (): Particle => ({ on: false, t0: 0, life: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 1, grow: 0, rot: 0, spin: 0, shade: 1, alpha: 1, color: new Color() });

const Z_AXIS = new Vector3(0, 0, 1), matrix = new Matrix4(), quaternion = new Quaternion(), euler = new Euler(), at = new Vector3(), scale = new Vector3(), dir = new Vector3(), tint = new Color();
const noRaycast = () => {};

class CombatFx {
  readonly root = new Group();
  private beams = new Quads(512, { aStart: 3, aEnd: 3, aColor: 4, aShape: 2 });
  private flashes = new Quads(96, { aCenter: 3, aSizeRot: 2, aColor: 4 });
  private smoke = new Quads(128, { aCenter: 3, aSizeRot: 2, aColor: 4 });
  private rings = new Quads(24, { aCenter: 3, aSizeRot: 2, aColor: 4, aRing: 3 });
  private decals = new Quads(192, { aCenter: 3, aSizeRot: 2, aColor: 4, aRing: 3 });
  private sparkMesh: InstancedMesh; private debrisMesh: InstancedMesh;
  private materials: (ShaderMaterial | MeshBasicMaterial | MeshStandardMaterial)[];
  private geometries: BoxGeometry[];

  private tracers = new Pool<Tracer>(64, () => ({ on: false, t0: 0, ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, len: 1, snipe: false, hit: false, color: new Color(), fx: 0, fz: 0 }));
  private flashPool = new Pool<Flash>(96, () => ({ on: false, t0: 0, life: 1, x: 0, y: 0, z: 0, size: 1, rot: 0, color: new Color() }));
  private sparkPool = new Pool<Particle>(320, particle);
  private smokePool = new Pool<Particle>(128, particle);
  private debrisPool = new Pool<Debris>(48, () => ({ ...particle(), rx: 0, ry: 0, rz: 0 }));
  private ringPool = new Pool<Ring>(24, () => ({ on: false, t0: 0, life: 1, x: 0, z: 0, radius: 1, kind: 'grenade', echo: false }));
  private decalPool = new Pool<Decal>(192, () => ({ on: false, t0: 0, x: 0, z: 0, size: 1, rot: 0, alpha: 1, grow: 1, color: new Color() }));
  private empPool = new Pool<Emp>(6, () => ({ on: false, t0: 0, x: 0, z: 0, radius: 1 }));
  private wreckPool = new Pool<Wreck>(16, () => ({ on: false, t0: 0, x: 0, y: 0, z: 0, smoke: 0, spark: 0 }));

  private plan: Simulation['plan'] = null;
  private heardShot = -1; private heardBlast = -1; private last = 0;
  private hp = new Map<string, number>();

  constructor() {
    const beamMat = shader(BEAM_VERTEX, BEAM_FRAGMENT, true, PROFILE), flashMat = shader(BILLBOARD_VERTEX, TEXTURED_FRAGMENT, true, STAR);
    const smokeMat = shader(BILLBOARD_VERTEX, TEXTURED_FRAGMENT, false, PUFF), ringMat = shader(GROUND_VERTEX, RING_FRAGMENT, true);
    const decalMat = shader(GROUND_VERTEX, TEXTURED_FRAGMENT, false, BURN);
    decalMat.polygonOffset = true; decalMat.polygonOffsetFactor = -2; decalMat.polygonOffsetUnits = -2;
    const sparkGeo = new BoxGeometry(), debrisGeo = new BoxGeometry();
    const sparkMat = new MeshBasicMaterial({ toneMapped: false, transparent: true, depthWrite: false, blending: AdditiveBlending });
    const debrisMat = new MeshStandardMaterial({ color: '#3b3836', roughness: .9, metalness: .1 });
    this.sparkMesh = new InstancedMesh(sparkGeo, sparkMat, this.sparkPool.items.length);
    this.sparkMesh.instanceColor = new InstancedBufferAttribute(new Float32Array(this.sparkPool.items.length * 3), 3).setUsage(DynamicDrawUsage);
    this.debrisMesh = new InstancedMesh(debrisGeo, debrisMat, this.debrisPool.items.length);
    this.materials = [beamMat, flashMat, smokeMat, ringMat, decalMat, sparkMat, debrisMat];
    this.geometries = [sparkGeo, debrisGeo];
    const meshes: [Mesh, number][] = [
      [new Mesh(this.decals.geometry, decalMat), 0], [new Mesh(this.rings.geometry, ringMat), 3], [this.debrisMesh, 0], [new Mesh(this.smoke.geometry, smokeMat), 4],
      [this.sparkMesh, 5], [new Mesh(this.beams.geometry, beamMat), 5], [new Mesh(this.flashes.geometry, flashMat), 6],
    ];
    for (const [mesh, order] of meshes) {
      mesh.frustumCulled = false; mesh.renderOrder = order; mesh.raycast = noRaycast;
      this.root.add(mesh);
    }
    this.sparkMesh.count = this.debrisMesh.count = 0;
  }

  dispose() {
    for (const m of this.materials) m.dispose();
    for (const g of this.geometries) g.dispose();
    for (const q of [this.beams, this.flashes, this.smoke, this.rings, this.decals]) q.geometry.dispose();
  }

  private clear() {
    for (const pool of [this.tracers, this.flashPool, this.sparkPool, this.smokePool, this.debrisPool, this.ringPool, this.decalPool, this.empPool, this.wreckPool]) pool.clear();
    this.hp.clear(); this.heardShot = this.heardBlast = -1; this.last = 0;
  }

  frame(sim: Simulation, width: number, height: number) {
    if (sim.plan !== this.plan) { this.plan = sim.plan; this.clear(); }
    const now = sim.time, dt = Math.min(.05, Math.max(0, now - this.last));
    this.last = now;
    this.root.visible = sim.phase === 'mission';
    resolution.value.set(width, height);
    for (const shot of sim.shots) if (shot.id > this.heardShot) {
      this.heardShot = shot.id;
      play(gunfire(shot), shot.from); play('impact', shot.to);
      this.fire(sim, shot, now);
    }
    for (const blast of sim.blasts) if (blast.id > this.heardBlast) { this.heardBlast = blast.id; play(blast.kind, blast); this.blast(blast, now); }
    for (const u of sim.units) {
      const was = this.hp.get(u.id);
      this.hp.set(u.id, u.hp);
      if (was !== undefined && was > 0 && u.hp <= 0 && u.faction === 'hostile') this.death(u, now);
    }
    this.draw(sim, now, dt);
  }

  // Spawning
  private flash(now: number, life: number, x: number, y: number, z: number, size: number, color: Color) {
    const f = this.flashPool.take();
    Object.assign(f, { t0: now, life, x, y, z, size, rot: Math.random() * Math.PI }); f.color.copy(color);
  }
  private sparks(now: number, n: number, x: number, y: number, z: number, bx: number, bz: number, speed: number, up: number, color: Color) {
    for (let k = 0; k < n; k++) {
      const p = this.sparkPool.take(), a = Math.random() * Math.PI * 2, s = rand(.5, 1) * speed;
      dir.set(bx + Math.cos(a) * .8, up + rand(0, .7), bz + Math.sin(a) * .8).normalize();
      Object.assign(p, { t0: now, life: rand(.22, .45), x, y, z, vx: dir.x * s, vy: dir.y * s, vz: dir.z * s });
      p.color.copy(color).lerp(WHITE, rand(.3, .7));
    }
  }
  private puff(now: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, grow: number, life: number, shade: number, alpha: number) {
    const p = this.smokePool.take();
    Object.assign(p, { t0: now, life, x, y, z, vx, vy, vz, size, grow, rot: Math.random() * 6.28, spin: rand(-.8, .8), shade, alpha });
  }
  private decal(now: number, x: number, z: number, size: number, alpha: number, grow: number, color: Color) {
    const d = this.decalPool.take();
    Object.assign(d, { t0: now, x, z, size, rot: Math.random() * 6.28, alpha, grow }); d.color.copy(color);
  }

  private fire(sim: Simulation, shot: Shot, now: number) {
    const dx = shot.to.x - shot.from.x, dz = shot.to.z - shot.from.z, flat = Math.hypot(dx, dz) || 1, fx = dx / flat, fz = dz / flat;
    const [mx, my, mz] = MUZZLE[shot.shooter] ?? MUZZLE.guard!;
    // The unit standing where the round lands, for the height it strikes.
    let victim: Unit | null = null, best = .6;
    for (const u of sim.units) {
      const d = Math.hypot(u.x - shot.to.x, u.z - shot.to.z);
      if (u.faction !== shot.faction && d < best) { best = d; victim = u; }
    }
    const t = this.tracers.take(), snipe = shot.kind === 'snipe', hitY = victim ? HIT_Y[victim.kind] : .85, stop = victim && HUMAN(victim.kind) ? .22 : .35;
    Object.assign(t, { t0: now, snipe, hit: false, fx, fz, ax: shot.from.x + fz * mx + fx * mz, ay: my, az: shot.from.z - fx * mx + fz * mz, bx: shot.to.x - fx * stop, by: hitY, bz: shot.to.z - fz * stop });
    t.len = Math.hypot(t.bx - t.ax, t.by - t.ay, t.bz - t.az) || .01;
    t.color.copy(snipe ? SNIPE : TRACER[shot.faction]);
    tint.copy(FIRE).lerp(t.color, .35);
    this.flash(now, MUZZLE_SECONDS, t.ax + fx * .08, t.ay, t.az + fz * .08, snipe ? .55 : shot.shooter === 'turret' ? .5 : .4, tint);
  }
  // The round arrives: a glint and 6 to 8 sparks thrown back toward the shooter.
  private impact(t: Tracer, now: number) {
    tint.copy(t.color).lerp(WHITE, .5);
    this.flash(now, IMPACT_SECONDS, t.bx, t.by, t.bz, t.snipe ? .45 : .3, tint);
    this.sparks(now, 6 + Math.floor(Math.random() * 3), t.bx, t.by, t.bz, -t.fx, -t.fz, t.snipe ? 6.5 : 5, .5, tint.copy(FIRE).lerp(t.color, .4));
  }
  private blast(b: Blast, now: number) {
    const ring = this.ringPool.take();
    Object.assign(ring, { t0: now, life: b.kind === 'grenade' ? .6 : .8, x: b.x, z: b.z, radius: b.radius, kind: b.kind, echo: false });
    if (b.kind === 'heal') return;
    if (b.kind === 'emp') {
      Object.assign(this.ringPool.take(), { t0: now + .12, life: .7, x: b.x, z: b.z, radius: b.radius, kind: b.kind, echo: true });
      Object.assign(this.empPool.take(), { t0: now, x: b.x, z: b.z, radius: b.radius });
      this.flash(now, .14, b.x, .5, b.z, 1.1, EMP);
      return;
    }
    // Grenade: a white-hot flash inside an orange one, sparks, tumbling debris, a smoke puff, a scorch mark and a camera kick.
    this.flash(now, .12, b.x, .6, b.z, b.radius * .75, FIRE);
    this.flash(now, .24, b.x, .5, b.z, b.radius * 1.25, BLAST_ORANGE);
    this.sparks(now, 18, b.x, .3, b.z, 0, 0, 9, 1.1, BLAST_ORANGE);
    for (let k = 0; k < 7; k++) {
      const p = this.debrisPool.take(), a = Math.random() * Math.PI * 2, s = rand(2.5, 5.5);
      Object.assign(p, { t0: now, life: rand(2.4, 3.2), x: b.x, y: .25, z: b.z, vx: Math.cos(a) * s, vy: rand(3.5, 7), vz: Math.sin(a) * s, size: rand(.08, .16), rx: 0, ry: 0, rz: 0, spin: rand(6, 14), rot: a });
    }
    for (let k = 0; k < 7; k++) {
      const a = k / 7 * Math.PI * 2 + rand(-.3, .3), r = rand(.1, .6);
      this.puff(now + k * .02, b.x + Math.cos(a) * r, rand(.3, .8), b.z + Math.sin(a) * r, Math.cos(a) * rand(.5, 1.2), rand(.5, 1.1), Math.sin(a) * rand(.5, 1.2), rand(.45, .65), rand(.9, 1.4), rand(1.6, 2.4), rand(.16, .26), .75);
    }
    this.decal(now, b.x, b.z, b.radius * .72, .82, .15, SCORCH);
    kickCamera(now, 7);
  }
  private death(u: Unit, now: number) {
    if (HUMAN(u.kind)) { this.decal(now + .3, u.x, u.z, u.kind === 'heavy' ? .7 : .55, .55, .5, BODY_MARK); return; }
    const y = HIT_Y[u.kind];
    Object.assign(this.wreckPool.take(), { t0: now, x: u.x, y, z: u.z, smoke: now, spark: now + .2 });
    this.flash(now, .16, u.x, y, u.z, .8, FIRE);
    this.sparks(now, 14, u.x, y, u.z, 0, 0, 6, .9, BLAST_ORANGE);
  }

  // Drawing
  private beam(ax: number, ay: number, az: number, bx: number, by: number, bz: number, color: Color, alpha: number, width: number, tail: number) {
    const i = this.beams.add();
    if (i < 0) return;
    const d = this.beams.data;
    set3(d.aStart, i, ax, ay, az); set3(d.aEnd, i, bx, by, bz); set4(d.aColor, i, color.r, color.g, color.b, alpha); set2(d.aShape, i, width, tail);
  }
  // A jagged arc from a to b, rebuilt every frame so it crawls.
  private arc(ax: number, ay: number, az: number, bx: number, by: number, bz: number, alpha: number) {
    const steps = 7, len = Math.hypot(bx - ax, bz - az), jag = Math.min(.35, .14 * len);
    let px = ax, py = ay, pz = az;
    for (let k = 1; k <= steps; k++) {
      const s = k / steps, off = k === steps ? 0 : jag * Math.sin(Math.PI * s);
      const x = ax + (bx - ax) * s + rand(-1, 1) * off, y = ay + (by - ay) * s + rand(-.6, 1) * off, z = az + (bz - az) * s + rand(-1, 1) * off;
      this.beam(px, py, pz, x, y, z, EMP, alpha * .35, 10, 1);
      this.beam(px, py, pz, x, y, z, ARC, alpha, 3.5, 1);
      px = x; py = y; pz = z;
    }
  }
  private draw(sim: Simulation, now: number, dt: number) {
    for (const t of this.tracers.items) {
      if (!t.on) continue;
      const age = now - t.t0, speed = t.snipe ? SNIPE_SPEED : BULLET_SPEED, travelled = age * speed, streak = t.snipe ? SNIPE_STREAK : BULLET_STREAK;
      if (!t.hit && travelled >= t.len) { t.hit = true; this.impact(t, now); }
      const head = Math.min(1, travelled / t.len), tail = Math.max(0, (travelled - streak) / t.len);
      if (tail < 1) this.beam(lerp(tail, t.ax, t.bx), lerp(tail, t.ay, t.by), lerp(tail, t.az, t.bz), lerp(head, t.ax, t.bx), lerp(head, t.ay, t.by), lerp(head, t.az, t.bz), t.color, 1, t.snipe ? 6 : 4.5, 0);
      // The sniper round leaves a vapor trail that widens as it fades.
      const trail = t.snipe ? clamp01(1 - age / SNIPE_TRAIL_SECONDS) : 0;
      if (trail > 0) this.beam(t.ax, t.ay, t.az, lerp(head, t.ax, t.bx), lerp(head, t.ay, t.by), lerp(head, t.az, t.bz), SNIPE_TRAIL, trail * trail, 3 + 7 * (1 - trail), .35);
      if (tail >= 1 && trail <= 0) t.on = false;
    }
    for (const e of this.empPool.items) {
      const age = now - e.t0;
      if (!e.on || age >= EMP_ARC_SECONDS) { e.on = false; continue; }
      if (age < 0) continue;
      const fade = 1 - age / EMP_ARC_SECONDS;
      for (let k = 0; k < 7; k++) {
        const a = Math.random() * Math.PI * 2, r = e.radius * rand(.45, 1);
        this.arc(e.x, .4, e.z, e.x + Math.cos(a) * r, .05, e.z + Math.sin(a) * r, fade * rand(.5, 1));
      }
      for (const u of sim.units) if (u.faction === 'hostile' && u.hp > 0 && u.stunned > 0 && Math.hypot(u.x - e.x, u.z - e.z) <= e.radius + .5) this.arc(e.x, .4, e.z, u.x, HIT_Y[u.kind], u.z, fade);
    }
    for (const w of this.wreckPool.items) {
      const age = now - w.t0;
      if (!w.on || age >= WRECK_SMOKE_SECONDS) { w.on = false; continue; }
      if (now >= w.smoke) { w.smoke = now + .16; this.puff(now, w.x + rand(-.1, .1), w.y, w.z + rand(-.1, .1), rand(-.15, .15), rand(.6, .9), rand(-.15, .15), .22, 1.1, 1.7, .13, .65 * (1 - age / WRECK_SMOKE_SECONDS)); }
      if (age < WRECK_SPARK_SECONDS && now >= w.spark) {
        w.spark = now + rand(.15, .6);
        this.sparks(now, 3 + Math.floor(Math.random() * 3), w.x, w.y, w.z, 0, 0, 3.5, 1, EMP);
        this.flash(now, .06, w.x, w.y, w.z, .3, ARC);
      }
    }
    // Flashes
    const fl = this.flashes.data;
    for (const f of this.flashPool.items) {
      const k = (now - f.t0) / f.life;
      if (!f.on || k >= 1) { f.on = false; continue; }
      const i = k >= 0 ? this.flashes.add() : -1;
      if (i < 0) continue;
      const a = 1 - k * k;
      set3(fl.aCenter, i, f.x, f.y, f.z); set2(fl.aSizeRot, i, f.size * (1 + .3 * k), f.rot); set4(fl.aColor, i, f.color.r, f.color.g, f.color.b, a);
    }
    // Smoke
    const sm = this.smoke.data, drag = Math.exp(-1.6 * dt);
    for (const p of this.smokePool.items) {
      const k = (now - p.t0) / p.life;
      if (!p.on || k >= 1) { p.on = false; continue; }
      if (k < 0) continue;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vx *= drag; p.vz *= drag; p.vy *= Math.exp(-.6 * dt); p.rot += p.spin * dt;
      const i = this.smoke.add();
      if (i < 0) continue;
      const alpha = p.alpha * Math.min(1, k / .12) * (1 - k) ** 1.4;
      set3(sm.aCenter, i, p.x, p.y, p.z); set2(sm.aSizeRot, i, p.size * (1 + p.grow * ease(k)), p.rot); set4(sm.aColor, i, p.shade, p.shade, p.shade * 1.05, alpha);
    }
    // Sparks: thin shards stretched along their velocity, bouncing once off the street.
    let n = 0;
    for (const p of this.sparkPool.items) {
      const k = (now - p.t0) / p.life;
      if (!p.on || k >= 1) { p.on = false; continue; }
      p.vy -= GRAVITY * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < .03) { p.y = .03; p.vy *= -.35; p.vx *= .55; p.vz *= .55; }
      const speed = Math.hypot(p.vx, p.vy, p.vz);
      if (speed > 1e-3) dir.set(p.vx / speed, p.vy / speed, p.vz / speed); else dir.set(0, 1, 0);
      quaternion.setFromUnitVectors(Z_AXIS, dir);
      matrix.compose(at.set(p.x, p.y, p.z), quaternion, scale.set(.04, .04, Math.min(.32, Math.max(.06, speed * .04))));
      this.sparkMesh.setMatrixAt(n, matrix); this.sparkMesh.setColorAt(n, tint.copy(p.color).multiplyScalar((1 - k) * 1.6)); n++;
    }
    this.sparkMesh.count = n; this.sparkMesh.instanceMatrix.needsUpdate = true; this.sparkMesh.instanceColor!.needsUpdate = true;
    // Debris: chunks that tumble out, bounce, settle and shrink away.
    n = 0;
    for (const p of this.debrisPool.items) {
      const k = (now - p.t0) / p.life;
      if (!p.on || k >= 1) { p.on = false; continue; }
      const half = p.size / 2;
      p.vy -= GRAVITY * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < half) { p.y = half; p.vy = Math.abs(p.vy) > 1 ? -p.vy * .3 : 0; p.vx *= .45; p.vz *= .45; p.spin *= .4; }
      p.rx += p.spin * dt; p.rz += p.spin * .7 * dt;
      quaternion.setFromEuler(euler.set(p.rx, p.rot, p.rz));
      const s = p.size * Math.min(1, (1 - k) / .2);
      matrix.compose(at.set(p.x, p.y, p.z), quaternion, scale.set(s, s * .7, s * 1.2));
      this.debrisMesh.setMatrixAt(n++, matrix);
    }
    this.debrisMesh.count = n; this.debrisMesh.instanceMatrix.needsUpdate = true;
    // Blast rings on the street.
    const rg = this.rings.data;
    for (const r of this.ringPool.items) {
      const k = (now - r.t0) / r.life;
      if (!r.on || k >= 1) { r.on = false; continue; }
      const i = k >= 0 ? this.rings.add() : -1;
      if (i < 0) continue;
      const grow = ease(k), color = r.kind === 'grenade' ? BLAST_ORANGE : r.kind === 'heal' ? HEAL : EMP;
      // The grenade's shock ring runs out past the blast radius, thick and bright at first, with a short-lived glow inside.
      const [ring, width, fill, alpha] = r.kind === 'grenade' ? [.12 + .86 * grow, .16 - .12 * k, Math.max(0, .9 - k * 2.6), (1 - k) ** 1.2 * 1.3]
        : r.echo ? [.1 + .85 * grow, .05, 0, (1 - k) * .8] : [.3 + .68 * grow, .06, (1 - k) * .22, (1 - k) * .95];
      set3(rg.aCenter, i, r.x, .06, r.z); set2(rg.aSizeRot, i, r.radius * (r.kind === 'grenade' ? 1.15 : 1), 0); set4(rg.aColor, i, color.r, color.g, color.b, alpha); set3(rg.aRing, i, ring, width, fill);
    }
    // Decals stay for the mission.
    const dc = this.decals.data;
    for (const d of this.decalPool.items) {
      if (!d.on || now < d.t0) continue;
      const i = this.decals.add();
      if (i < 0) break;
      const k = d.grow > 0 ? Math.min(1, (now - d.t0) / d.grow) : 1;
      set3(dc.aCenter, i, d.x, .012, d.z); set2(dc.aSizeRot, i, d.size * (.6 + .4 * ease(k)), d.rot); set4(dc.aColor, i, d.color.r, d.color.g, d.color.b, d.alpha * k);
    }
    for (const q of [this.beams, this.flashes, this.smoke, this.rings, this.decals]) q.flush();
  }
}

export function CombatEffects({ sim }: { sim: Simulation }) {
  const fx = useMemo(() => new CombatFx(), []);
  useEffect(() => () => fx.dispose(), [fx]);
  useFrame(({ size }) => fx.frame(sim, size.width, size.height));
  return <primitive object={fx.root} />;
}
