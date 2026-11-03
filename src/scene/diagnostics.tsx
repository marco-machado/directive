import { useEffect } from 'react';
import { addAfterEffect, addEffect } from '@react-three/fiber';
import { backendOf, useRenderer } from './renderer.ts';
import type { Backend } from './renderer.ts';

export type RendererCounts = { backend: Backend; calls: number; triangles: number; lines: number; geometries: number; textures: number };
declare global { interface Window { __THREE_GAME_DIAGNOSTICS__?: { renderer: RendererCounts } } }

// Dev builds publish the active backend and the last frame's renderer counts on window.__THREE_GAME_DIAGNOSTICS__ for measurement
// scripts. The counts cover every render call in the frame (shadow map, scene and post passes), not only the last.
export function Diagnostics() {
  const gl = useRenderer();
  useEffect(() => {
    gl.info.autoReset = false;
    const before = addEffect(() => gl.info.reset());
    const after = addAfterEffect(() => {
      const { render, memory } = gl.info;
      window.__THREE_GAME_DIAGNOSTICS__ = { renderer: { backend: backendOf(gl), calls: render.drawCalls, triangles: render.triangles, lines: render.lines, geometries: memory.geometries, textures: memory.textures } };
    });
    return () => { before(); after(); gl.info.autoReset = true; delete window.__THREE_GAME_DIAGNOSTICS__; };
  }, [gl]);
  return null;
}
