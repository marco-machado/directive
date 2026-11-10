import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Color, InstancedBufferAttribute, Object3D } from 'three';
import type { BufferGeometry, InstancedMesh, Material } from 'three';
import type { Placement } from './district.ts';

// One draw call for every copy of a modeled prop: each instance stands the shared model at its placement and
// carries the placement's color as `instancePaint`, which the `prop` material gives to the model's painted parts.
export function InstancedProps({ placements, geometry: base, material, castShadow }: { placements: readonly Placement[]; geometry: BufferGeometry; material: Material; castShadow?: boolean }) {
  const ref = useRef<InstancedMesh>(null);
  // Its own geometry, to carry the per-instance attribute.
  const geometry = useMemo(() => {
    const geometry = base.clone(), paint = new Float32Array(placements.length * 3), color = new Color();
    placements.forEach((p, i) => color.set(p.color).toArray(paint, i * 3));
    geometry.setAttribute('instancePaint', new InstancedBufferAttribute(paint, 3));
    return geometry;
  }, [placements, base]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useLayoutEffect(() => {
    const mesh = ref.current!, dummy = new Object3D();
    placements.forEach((p, i) => {
      dummy.position.set(p.x, 0, p.z); dummy.rotation.set(0, p.ry, 0); dummy.scale.set(...p.scale); dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [placements, geometry]);
  return <instancedMesh ref={ref} args={[geometry, material, placements.length]} castShadow={castShadow} receiveShadow />;
}
