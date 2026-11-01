import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BoxGeometry, CanvasTexture, Color, CylinderGeometry, InstancedBufferAttribute, InstancedMesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, OctahedronGeometry, SRGBColorSpace } from 'three';
import type { Material, WebGLProgramParametersWithUniforms } from 'three';

// Decorative motion (spins, pulses, the title orbit) stops for players who ask for reduced motion.
export const STILL = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Shared geometry and materials keep the many small boxes cheap: each Box only scales a unit cube.
export const BOX = new BoxGeometry();
export const CYLINDER = new CylinderGeometry(1, 1, 1, 12);
export const DIAMOND = new OctahedronGeometry(.13);
const solids = new Map<string, MeshStandardMaterial>(), glows = new Map<string, MeshBasicMaterial>(), dimmed = new Map<string, string>();
export function solid(color: string, emissive?: string) {
  const key = `${color}|${emissive ?? ''}`;
  let m = solids.get(key);
  if (!m) { m = new MeshStandardMaterial({ color, roughness: .75, metalness: .18, emissive: emissive ?? '#000000', emissiveIntensity: .7 }); solids.set(key, m); }
  return m;
}
export function glow(color: string) {
  let m = glows.get(color);
  if (!m) { m = new MeshBasicMaterial({ color, toneMapped: false }); glows.set(color, m); }
  return m;
}
// The cover shield (the HUD's shield icon outline), drawn over everything: mint when covered, red when flanked.
export const SHIELD_COLOR = { covered: '#5ef2c0', flanked: '#ff5148' } as const;
const shields = new Map<string, MeshBasicMaterial>();
export function shield(color: string) {
  let m = shields.get(color);
  if (!m) {
    const canvas = document.createElement('canvas'), g = canvas.getContext('2d')!, path = new Path2D('M12 2.5l8 3v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10v-6z');
    canvas.width = canvas.height = 64; g.scale(64 / 24, 64 / 24);
    g.fillStyle = '#04090b'; g.strokeStyle = '#04090b'; g.lineWidth = 4; g.lineJoin = 'round'; g.stroke(path); g.fill(path);
    g.fillStyle = color; g.globalAlpha = .3; g.fill(path); g.globalAlpha = 1;
    g.strokeStyle = color; g.lineWidth = 2; g.stroke(path);
    const map = new CanvasTexture(canvas); map.colorSpace = SRGBColorSpace;
    m = new MeshBasicMaterial({ map, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
    shields.set(color, m);
  }
  return m;
}
export function dim(color: string) {
  let d = dimmed.get(color);
  if (!d) { d = `#${new Color(color).multiplyScalar(.42).getHexString()}`; dimmed.set(color, d); }
  return d;
}

// How a Box and the unit models get their material and render order. Units draw twice, lit and
// then as a flat silhouette where something hides them, by rendering the same model under two paints.
export type Paint = { material: (color: string, emissive?: string) => Material; shadows: boolean; order: number };
export const PaintContext = createContext<Paint>({ material: solid, shadows: true, order: 0 });
export const usePaint = () => useContext(PaintContext);

type Vec3 = [number, number, number];
export function Box({ position, size, color, emissive, castShadow }: { position: Vec3; size: Vec3; color: string; emissive?: string; castShadow?: boolean }) {
  const paint = usePaint();
  return <mesh position={position} scale={size} geometry={BOX} material={paint.material(color, emissive)} castShadow={castShadow && paint.shadows} renderOrder={paint.order} />;
}

// Screen-door fade: each instance carries the share of its pixels to drop (0 keeps it solid), and
// the fragment shader discards that share in a 4x4 ordered-dither pattern. Discarded pixels write no
// depth, so whatever stands behind shows through, and the instanced mesh stays one draw call.
const DITHER = /* glsl */ `
float ditherBayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(.5, a.y * .75))); }
float ditherBayer4(vec2 a) { return ditherBayer2(.5 * a) * .25 + ditherBayer2(a); }
`;
function dither(shader: WebGLProgramParametersWithUniforms) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float instanceFade;\nvarying float vFade;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFade = instanceFade;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\nvarying float vFade;\n${DITHER}`)
    .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vFade > ditherBayer4(gl_FragCoord.xy) + .03125) discard;');
}

// Per-building fade levels (the share of pixels dropped); `version` changes whenever any level does.
export type Fades = { level: Float32Array; version: number };

// `building` tags a part with the index of the building it belongs to, so it fades with it.
export type Part = { x: number; y: number; z: number; w: number; h: number; d: number; ry?: number; color: string; building?: number };
export function InstancedBoxes({ parts, lit, fades }: { parts: Part[]; lit?: boolean; fades: Fades }) {
  const ref = useRef<InstancedMesh>(null), seen = useRef(-1);
  // Its own geometry, to carry the per-instance fade attribute.
  const { geometry, material } = useMemo(() => {
    const geometry = new BoxGeometry();
    geometry.setAttribute('instanceFade', new InstancedBufferAttribute(new Float32Array(parts.length), 1));
    const material = lit ? new MeshStandardMaterial({ roughness: .75, metalness: .18 }) : new MeshBasicMaterial({ toneMapped: false });
    material.onBeforeCompile = dither;
    return { geometry, material };
  }, [parts, lit]);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  useLayoutEffect(() => {
    const mesh = ref.current!, dummy = new Object3D(), color = new Color();
    parts.forEach((p, i) => {
      dummy.position.set(p.x, p.y, p.z); dummy.rotation.set(0, p.ry ?? 0, 0); dummy.scale.set(p.w, p.h, p.d); dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix); mesh.setColorAt(i, color.set(p.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    seen.current = -1;
  }, [parts, geometry]);
  useFrame(() => {
    if (fades.version === seen.current) return;
    seen.current = fades.version;
    const attribute = geometry.getAttribute('instanceFade') as InstancedBufferAttribute, values = attribute.array as Float32Array;
    parts.forEach((p, i) => { values[i] = p.building === undefined ? 0 : fades.level[p.building]; });
    attribute.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[geometry, material, parts.length]} castShadow={lit} receiveShadow={lit} />;
}

// A ground ring of segments that fills clockwise as `value()` goes from 0 to 1.
export function ProgressRing({ radius, color, value, segments = 32 }: { radius: number; color: string; value: () => number; segments?: number }) {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current!, dummy = new Object3D(), length = 2 * Math.PI * radius / segments * .72;
    for (let k = 0; k < segments; k++) {
      const a = Math.PI - k / segments * 2 * Math.PI;
      dummy.position.set(Math.sin(a) * radius, 0, Math.cos(a) * radius); dummy.rotation.set(0, a, 0); dummy.scale.set(length, .02, .09); dummy.updateMatrix();
      mesh.setMatrixAt(k, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere();
  }, [radius, segments]);
  useFrame(() => { if (ref.current) ref.current.count = Math.round(Math.min(1, Math.max(0, value())) * segments); });
  return <group>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .04, 0]}><ringGeometry args={[radius - .045, radius + .045, 64]} /><meshBasicMaterial color={color} transparent opacity={.16} depthWrite={false} /></mesh>
    <instancedMesh ref={ref} args={[BOX, undefined, segments]} position={[0, .05, 0]}><meshBasicMaterial color={color} toneMapped={false} /></instancedMesh>
  </group>;
}
