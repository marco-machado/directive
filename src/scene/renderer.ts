import { useThree } from '@react-three/fiber';
import { WebGPURenderer } from 'three/webgpu';

// One renderer for every browser: three's WebGPURenderer, on WebGPU when the browser hands out an adapter and on
// its WebGL 2 backend otherwise. The adapter is probed here rather than left to three, whose own fallback logs a
// warning on every load without WebGPU. `?renderer=webgl` forces the WebGL 2 backend, for testing it on any machine.
export type Backend = 'webgpu' | 'webgl2';

async function chooseBackend(): Promise<Backend> {
  if (new URLSearchParams(location.search).get('renderer') === 'webgl') return 'webgl2';
  try {
    return navigator.gpu && await navigator.gpu.requestAdapter() ? 'webgpu' : 'webgl2';
  } catch { return 'webgl2'; }
}

// R3F's <Canvas gl> factory. The stencil buffer keeps unit silhouettes off the units' own visible pixels (units.tsx).
export async function createRenderer({ canvas }: { canvas: EventTarget }) {
  const renderer = new WebGPURenderer({ canvas: canvas as HTMLCanvasElement, powerPreference: 'high-performance', antialias: true, alpha: false, stencil: true, forceWebGL: await chooseBackend() === 'webgl2' });
  await renderer.init();
  return renderer;
}

export const backendOf = (gl: WebGPURenderer): Backend => (gl.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';

// R3F types its renderer as WebGLRenderer; the canvas always runs the one createRenderer built.
export const useRenderer = () => useThree(s => s.gl) as unknown as WebGPURenderer;
