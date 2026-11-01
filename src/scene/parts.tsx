import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BoxGeometry, Color, CylinderGeometry, InstancedBufferAttribute, InstancedMesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, OctahedronGeometry, PlaneGeometry } from 'three';
import type { BufferGeometry, Material } from 'three';
import type { Part } from './district.ts';

// Decorative motion (spins, pulses, the title orbit) stops for players who ask for reduced motion.
export const STILL = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Shared geometry and materials keep the many small boxes cheap: each Box only scales a unit cube.
export const BOX = new BoxGeometry();
export const CYLINDER = new CylinderGeometry(1, 1, 1, 12);
export const DIAMOND = new OctahedronGeometry(.13);
// Unit-sized shapes for instanced parts: a cylinder one meter across and a plane facing +z.
export const ROUND = new CylinderGeometry(.5, .5, 1, 14), PLANE = new PlaneGeometry();
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

// Per-building fade levels (the share of pixels dropped); `version` changes whenever any level does.
export type Fades = { level: Float32Array; version: number };

// One draw call for many parts: each instance scales the shared geometry to its part, takes its color (pushed
// past 1 by `glow`), its fade level from its building (see materials.ts) and its Part.data as `instanceData`.
const NO_FADES: Fades = { level: new Float32Array(0), version: 0 };
export function InstancedParts({ parts, geometry: base, material, fades = NO_FADES, castShadow, receiveShadow, renderOrder }: { parts: readonly Part[]; geometry: BufferGeometry; material: Material; fades?: Fades; castShadow?: boolean; receiveShadow?: boolean; renderOrder?: number }) {
  const ref = useRef<InstancedMesh>(null), seen = useRef(-1);
  // Its own geometry, to carry the per-instance attributes.
  const geometry = useMemo(() => {
    const geometry = base.clone(), values = new Float32Array(parts.length * 4);
    parts.forEach((p, i) => { if (p.data) values.set(p.data, i * 4); });
    geometry.setAttribute('instanceFade', new InstancedBufferAttribute(new Float32Array(parts.length), 1));
    geometry.setAttribute('instanceData', new InstancedBufferAttribute(values, 4));
    return geometry;
  }, [parts, base]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useLayoutEffect(() => {
    const mesh = ref.current!, dummy = new Object3D(), color = new Color();
    dummy.rotation.order = 'YXZ';
    parts.forEach((p, i) => {
      dummy.position.set(p.x, p.y, p.z); dummy.rotation.set(p.rx ?? 0, p.ry ?? 0, p.rz ?? 0); dummy.scale.set(p.w, p.h, p.d); dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix); mesh.setColorAt(i, color.set(p.color).multiplyScalar(p.glow ?? 1));
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
  return <instancedMesh ref={ref} args={[geometry, material, parts.length]} castShadow={castShadow} receiveShadow={receiveShadow} renderOrder={renderOrder} />;
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
