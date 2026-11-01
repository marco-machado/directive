import { useEffect } from 'react';
import { addAfterEffect, addEffect, useThree } from '@react-three/fiber';

export type RendererCounts = { calls: number; triangles: number; lines: number; geometries: number; textures: number; programs: number };
declare global { interface Window { __THREE_GAME_DIAGNOSTICS__?: { renderer: RendererCounts } } }

// Dev builds publish the last frame's renderer counts on window.__THREE_GAME_DIAGNOSTICS__ for measurement
// scripts. The counts cover every render call in the frame (shadow map, scene and post passes), not only the last.
export function Diagnostics() {
  const gl = useThree(s => s.gl);
  useEffect(() => {
    gl.info.autoReset = false;
    const before = addEffect(() => gl.info.reset());
    const after = addAfterEffect(() => {
      const { render, memory, programs } = gl.info;
      window.__THREE_GAME_DIAGNOSTICS__ = { renderer: { calls: render.calls, triangles: render.triangles, lines: render.lines, geometries: memory.geometries, textures: memory.textures, programs: programs?.length ?? 0 } };
    });
    return () => { before(); after(); gl.info.autoReset = true; delete window.__THREE_GAME_DIAGNOSTICS__; };
  }, [gl]);
  return null;
}
