import { useLayoutEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BoxGeometry, Color, CylinderGeometry, InstancedMesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, OctahedronGeometry } from 'three';

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
export function dim(color: string) {
  let d = dimmed.get(color);
  if (!d) { d = `#${new Color(color).multiplyScalar(.42).getHexString()}`; dimmed.set(color, d); }
  return d;
}

type Vec3 = [number, number, number];
export function Box({ position, size, color, emissive, castShadow }: { position: Vec3; size: Vec3; color: string; emissive?: string; castShadow?: boolean }) {
  return <mesh position={position} scale={size} geometry={BOX} material={solid(color, emissive)} castShadow={castShadow} />;
}

export type Part = { x: number; y: number; z: number; w: number; h: number; d: number; ry?: number; color: string };
export function InstancedBoxes({ parts, lit }: { parts: Part[]; lit?: boolean }) {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current!, dummy = new Object3D(), color = new Color();
    parts.forEach((p, i) => {
      dummy.position.set(p.x, p.y, p.z); dummy.rotation.set(0, p.ry ?? 0, 0); dummy.scale.set(p.w, p.h, p.d); dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix); mesh.setColorAt(i, color.set(p.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [parts]);
  return <instancedMesh ref={ref} args={[BOX, undefined, parts.length]} castShadow={lit} receiveShadow={lit}>
    {lit ? <meshStandardMaterial roughness={.75} metalness={.18} /> : <meshBasicMaterial toneMapped={false} />}
  </instancedMesh>;
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
