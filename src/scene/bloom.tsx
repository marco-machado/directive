import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { RenderPipeline } from 'three/webgpu';
import type { WebGPURenderer } from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { backendOf, useRenderer } from './renderer.ts';

// Selective bloom by threshold: the scene renders into a half-float target, where emissive windows, neon trim
// and signs are authored past 1 (Part.glow, the facade's window gain) and lit surfaces stay below it. Only those
// pixels bloom. The pass takes the renderer's 4x MSAA and keeps a stencil buffer for the unit silhouettes
// (units.tsx). The pipeline applies the renderer's tone mapping and color space at the end. BLOOM.strength is on
// UnrealBloomPass's scale, which triples it; three's BloomNode does not, so it gets the tripled value.
export const BLOOM = { threshold: 1, strength: .62, radius: .45 };
const UNREAL_GAIN = 3;
// WebGPU always renders to half-float targets; WebGL 2 needs an extension for it.
export const bloomSupported = (gl: WebGPURenderer) => {
  if (backendOf(gl) === 'webgpu') return true;
  const { extensions } = gl.backend as unknown as { extensions: { has(name: string): boolean } };
  return extensions.has('EXT_color_buffer_float') || extensions.has('EXT_color_buffer_half_float');
};

export function Bloom() {
  const gl = useRenderer(), scene = useThree(s => s.scene), camera = useThree(s => s.camera);
  const { pipeline, nodes } = useMemo(() => {
    const scenePass = pass(scene, camera, { stencilBuffer: true }), color = scenePass.getTextureNode('output');
    const glow = bloom(color, BLOOM.strength * UNREAL_GAIN, BLOOM.radius, BLOOM.threshold);
    return { pipeline: new RenderPipeline(gl, color.add(glow)), nodes: [scenePass, glow] };
  }, [gl, scene, camera]);
  // The pipeline frees only its own quad; the passes hold the render targets.
  useEffect(() => () => { pipeline.dispose(); for (const node of nodes) node.dispose(); }, [pipeline, nodes]);
  // A positive priority takes over R3F's render: the pipeline draws the frame instead.
  useFrame(() => pipeline.render(), 1);
  return null;
}
