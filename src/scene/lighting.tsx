import { useLayoutEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Vector3 } from 'three';
import type { DirectionalLight } from 'three';
import type { Bounds } from '../game/world.ts';
import { MAX_PRACTICALS } from './district.ts';
import type { Practical } from './district.ts';

// Night: a low cool fill, a shadowed moonlight key, and warm practicals at the lamps and signs. The light pools
// under them are decals (city.tsx); these point lights add the falloff on walls, units and wet ground.

function Moon({ bounds }: { bounds: Bounds }) {
  const ref = useRef<DirectionalLight>(null);
  useLayoutEffect(() => {
    const cx = (bounds.minX + bounds.maxX) / 2, cz = (bounds.minZ + bounds.maxZ) / 2, light = ref.current!, shadow = light.shadow.camera;
    const half = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) * .75;
    light.position.set(cx - 12, 22, cz + 9); light.target.position.set(cx, 0, cz); light.target.updateMatrixWorld();
    shadow.left = -half; shadow.right = half; shadow.top = half; shadow.bottom = -half; shadow.updateProjectionMatrix();
  }, [bounds]);
  return <directionalLight ref={ref} intensity={4.4} color="#c3cdf0" castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-.0008} shadow-normalBias={.02} />;
}

// A soft fill from the camera's side, so the faces the player looks at (and the squad on them) never go black.
// It follows the orbit and casts no shadow.
function CameraFill() {
  const ref = useRef<DirectionalLight>(null), look = useRef(new Vector3()).current;
  useFrame(({ camera }) => {
    const light = ref.current;
    if (!light) return;
    camera.getWorldDirection(look);
    light.position.copy(camera.position); light.target.position.copy(camera.position).add(look); light.target.updateMatrixWorld();
  });
  return <directionalLight ref={ref} intensity={1.5} color="#8c9ccc" />;
}

// A fixed pool of point lights: a district with fewer practicals parks the rest dark below the street, so the
// light count, and with it every lit shader, stays the same from one district to the next.
export function NightLighting({ bounds, practicals }: { bounds: Bounds; practicals: readonly Practical[] }) {
  return <>
    <color attach="background" args={['#04060b']} />
    <ambientLight intensity={.7} color="#7a84a8" />
    <hemisphereLight args={['#4d5a7e', '#1a1418', 1.4]} />
    <Moon bounds={bounds} />
    <CameraFill />
    {Array.from({ length: MAX_PRACTICALS }, (_, i) => {
      const p = practicals[i];
      return <pointLight key={i} position={p ? [p.x, p.y, p.z] : [0, -40, 0]} color={p?.color ?? '#000000'} intensity={p?.intensity ?? 0} distance={6.5} decay={2} />;
    })}
  </>;
}
