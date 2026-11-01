import { useEffect, useLayoutEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { HalfFloatType, Vector2, WebGLRenderTarget } from 'three';
import type { WebGLRenderer } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// Selective bloom by threshold: the scene renders into a half-float target, where emissive windows, neon trim
// and signs are authored past 1 (Part.glow, the facade's window gain) and lit surfaces stay below it. Only those
// pixels bloom. The target keeps a stencil buffer for the unit silhouettes (units.tsx) and 4x MSAA, since the
// canvas's own antialiasing does not reach an offscreen target. OutputPass applies the renderer's tone mapping.
export const BLOOM = { threshold: 1, strength: .62, radius: .45 };
export const bloomSupported = (gl: WebGLRenderer) => gl.extensions.has('EXT_color_buffer_float') || gl.extensions.has('EXT_color_buffer_half_float');

export function Bloom() {
  const gl = useThree(s => s.gl), scene = useThree(s => s.scene), camera = useThree(s => s.camera), size = useThree(s => s.size), dpr = useThree(s => s.viewport.dpr);
  const composer = useMemo(() => {
    const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4, stencilBuffer: true });
    const composer = new EffectComposer(gl, target);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new Vector2(1, 1), BLOOM.strength, BLOOM.radius, BLOOM.threshold));
    composer.addPass(new OutputPass());
    return composer;
  }, [gl, scene, camera]);
  useLayoutEffect(() => { composer.setPixelRatio(dpr); composer.setSize(size.width, size.height); }, [composer, dpr, size.width, size.height]);
  useEffect(() => () => { for (const pass of composer.passes) pass.dispose(); composer.dispose(); }, [composer]);
  // A positive priority takes over R3F's render: the composer draws the frame instead.
  useFrame(() => composer.render(), 1);
  return null;
}
