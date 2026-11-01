import { AdditiveBlending, MeshBasicMaterial, MeshStandardMaterial, Vector4 } from 'three';
import type { Material, Texture, WebGLProgramParametersWithUniforms } from 'three';
import { ATLAS_CELLS, BAY, FLOOR0, ROW } from './district.ts';

// Material roles for the district, built from stock three.js materials with small shader injections.
// Every injection has its own program cache key, so three never hands one material another's program.

type Shader = WebGLProgramParametersWithUniforms;
type Step = (shader: Shader) => void;
function program<M extends Material>(material: M, key: string, ...steps: Step[]): M {
  material.onBeforeCompile = shader => { for (const step of steps) step(shader); };
  material.customProgramCacheKey = () => key;
  return material;
}
const after = (shader: Shader, stage: 'vertexShader' | 'fragmentShader', chunk: string, code: string) => {
  shader[stage] = shader[stage].replace(`#include <${chunk}>`, `#include <${chunk}>\n${code}`);
};
const declare = (shader: Shader, stage: 'vertexShader' | 'fragmentShader', code: string) => after(shader, stage, 'common', code);

// Screen-door fade: each instance carries the share of its pixels to drop (0 keeps it solid), and the fragment
// shader discards that share in a 4x4 ordered-dither pattern. Discarded pixels write no depth, so whatever stands
// behind shows through, and the instanced mesh stays one draw call.
const fade: Step = shader => {
  declare(shader, 'vertexShader', 'attribute float instanceFade;\nvarying float vFade;');
  after(shader, 'vertexShader', 'begin_vertex', 'vFade = instanceFade;');
  declare(shader, 'fragmentShader', `varying float vFade;
float ditherBayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(.5, a.y * .75))); }
float ditherBayer4(vec2 a) { return ditherBayer2(.5 * a) * .25 + ditherBayer2(a); }`);
  after(shader, 'fragmentShader', 'clipping_planes_fragment', 'if (vFade > ditherBayer4(gl_FragCoord.xy) + .03125) discard;');
};

// Per-instance shader input (Part.data).
const data: Step = shader => {
  declare(shader, 'vertexShader', 'attribute vec4 instanceData;\nvarying vec4 vNdData;');
  after(shader, 'vertexShader', 'begin_vertex', 'vNdData = instanceData;');
  declare(shader, 'fragmentShader', 'varying vec4 vNdData;');
};

// The fragment's world position.
const world: Step = shader => {
  declare(shader, 'vertexShader', 'varying vec3 vNdWorld;');
  after(shader, 'vertexShader', 'begin_vertex', `#ifdef USE_INSTANCING
vNdWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.)).xyz;
#else
vNdWorld = (modelMatrix * vec4(transformed, 1.)).xyz;
#endif`);
  declare(shader, 'fragmentShader', 'varying vec3 vNdWorld;');
};

// Past the district's bounds the city sinks into the dark, so the ground and the ring never end at a hard edge.
const HORIZON = [7, 16];
const horizon = (bounds: { value: Vector4 }): Step => shader => {
  shader.uniforms.uNdBounds = bounds;
  declare(shader, 'fragmentShader', 'uniform vec4 uNdBounds;');
  after(shader, 'fragmentShader', 'opaque_fragment', `{
  vec2 out_ = max(max(uNdBounds.xy - vNdWorld.xz, vNdWorld.xz - uNdBounds.zw), 0.);
  gl_FragColor.rgb *= 1. - smoothstep(${HORIZON[0].toFixed(1)}, ${HORIZON[1].toFixed(1)}, length(out_));
}`);
};

// Roughness and metalness per instance, so one instanced mesh carries every solid material role.
const surface: Step = shader => {
  after(shader, 'fragmentShader', 'roughnessmap_fragment', 'roughnessFactor = vNdData.x;');
  after(shader, 'fragmentShader', 'metalnessmap_fragment', 'metalnessFactor = vNdData.y;');
};

const N = ATLAS_CELLS.toFixed(1);
const atlasLookup = `uniform sampler2D uNdAtlas;
// Cell (x, y) of the atlas counts from the canvas's top left; f runs 0-1 across the cell, y up.
vec3 ndAtlas(vec2 cell, vec2 f, vec2 dx, vec2 dy) { return textureGrad(uNdAtlas, vec2((cell.x + f.x) / ${N}, 1. - (cell.y + 1. - f.y) / ${N}), dx, dy).rgb; }`;

// Building tiers. The box's own size (from the instance matrix) lays out window bays that fit each face exactly and
// floors on world height, so rows line up across tiers. Each bay samples the atlas: window style and starting bay
// come from Part.data (x, y: bay offset, z: style, w: occupancy), and a hash of the bay switches some of the atlas's
// lit rooms off per building. Roofs take the grime tile, darker toward the parapet. textureGrad with the
// continuous bay coordinate keeps mip selection smooth across the jumps between cells.
const facade = (atlas: Texture, gain: { window: number; store: number }): Step => shader => {
  shader.uniforms.uNdAtlas = { value: atlas };
  shader.uniforms.uNdWindow = { value: gain.window };
  shader.uniforms.uNdStore = { value: gain.store };
  declare(shader, 'vertexShader', 'varying vec3 vNdLocal;\nvarying vec3 vNdSize;\nvarying vec3 vNdNormal;');
  after(shader, 'vertexShader', 'begin_vertex', `vNdSize = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
vNdLocal = position * vNdSize;
vNdNormal = normal;`);
  declare(shader, 'fragmentShader', `varying vec3 vNdLocal;
varying vec3 vNdSize;
varying vec3 vNdNormal;
uniform float uNdWindow;
uniform float uNdStore;
${atlasLookup}
float ndHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }`);
  after(shader, 'fragmentShader', 'map_fragment', `vec3 ndGlow = vec3(0.);
float ndGloss = 0.;
{
  bool xFace = abs(vNdNormal.x) > .5;
  float faceW = xFace ? vNdSize.z : vNdSize.x;
  float along = xFace ? -vNdLocal.z * sign(vNdNormal.x) : vNdLocal.x * sign(vNdNormal.z);
  float top = vNdWorld.y - vNdLocal.y + vNdSize.y * .5, bottom = top - vNdSize.y;
  float cols = max(1., floor(faceW / ${BAY.toFixed(2)} + .5));
  vec2 wall = vec2((along / faceW + .5) * cols, (vNdWorld.y - ${FLOOR0.toFixed(2)}) / ${ROW.toFixed(2)});
  vec2 roof = vNdWorld.xz / 6.;
  vec2 wdx = dFdx(wall) / ${N}, wdy = dFdy(wall) / ${N}, rdx = dFdx(roof) * .5, rdy = dFdy(roof) * .5;
  vec3 albedo = vec3(.45);
  if (vNdNormal.y > .5) {
    albedo = textureGrad(uNdAtlas, fract(roof) * .5, rdx, rdy).rgb;
    float edge = min(vNdSize.x * .5 - abs(vNdLocal.x), vNdSize.z * .5 - abs(vNdLocal.z));
    albedo *= mix(.55, 1., smoothstep(0., .5, edge)) * .8;
    diffuseColor.rgb = mix(vec3(dot(diffuseColor.rgb, vec3(.333))), diffuseColor.rgb, .4); // roofs keep little of the body's tint
  } else if (vNdNormal.y > -.5) {
    vec2 cell = floor(wall), f = fract(wall);
    float face = xFace ? (vNdNormal.x > 0. ? 0. : 1.) : (vNdNormal.z > 0. ? 2. : 3.);
    vec2 origin = vNdData.xy + face * vec2(3., 5.);
    float rowBottom = ${FLOOR0.toFixed(2)} + cell.y * ${ROW.toFixed(2)};
    if (vNdWorld.y < ${FLOOR0.toFixed(2)} && bottom < .5) {
      // Storefront band between the plinth and the first floor.
      vec2 c = vec2(16. + mod(origin.x + cell.x, 16.), 16. + mod(origin.y, 4.)), sf = vec2(f.x, (vNdWorld.y - bottom) / (${FLOOR0.toFixed(2)} - bottom));
      albedo = ndAtlas(c, sf, wdx, wdy);
      ndGlow = ndAtlas(c + vec2(0., 4.), sf, wdx, wdy) * uNdStore;
    } else if (cell.y >= 0. && rowBottom >= bottom - .01 && rowBottom + ${ROW.toFixed(2)} <= top + .01) {
      vec2 c = vec2(mod(vNdData.z, 2.), floor(vNdData.z / 2.)) * 8. + mod(origin + cell, 8.);
      albedo = ndAtlas(c, f, wdx, wdy);
      ndGlow = ndAtlas(c + vec2(16., 0.), f, wdx, wdy) * uNdWindow * step(ndHash(cell + origin * 7.31 + vNdData.xy), vNdData.w);
      ndGloss = 1. - smoothstep(.04, .16, dot(albedo, vec3(.333)));
    } else {
      albedo = ndAtlas(vec2(16. + mod(cell.x, 16.), 24. + mod(cell.y, 2.)), f, wdx, wdy);
    }
  }
  diffuseColor.rgb *= albedo * 2.2;
}`);
  after(shader, 'fragmentShader', 'roughnessmap_fragment', 'roughnessFactor = mix(roughnessFactor, .2, ndGloss);');
  after(shader, 'fragmentShader', 'emissivemap_fragment', 'totalEmissiveRadiance += ndGlow;');
};

// The street: the atlas's grime tile in world space, its darker patches read as damp and glossier.
const asphalt = (atlas: Texture): Step => shader => {
  shader.uniforms.uNdAtlas = { value: atlas };
  declare(shader, 'fragmentShader', atlasLookup);
  after(shader, 'fragmentShader', 'map_fragment', `float ndWet = 0.;
{
  vec2 g = vNdWorld.xz / 9.;
  vec3 grime = textureGrad(uNdAtlas, fract(g) * .5, dFdx(g) * .5, dFdy(g) * .5).rgb;
  float v = dot(grime, vec3(.333));
  diffuseColor.rgb *= mix(.75, 1.15, v * 2.);
  ndWet = smoothstep(.3, .2, v);
}`);
  after(shader, 'fragmentShader', 'roughnessmap_fragment', 'roughnessFactor = mix(roughnessFactor, .28, ndWet);');
};

// Puddles are stylized mirrors: they reflect the environment along a flattened view ray, so instead of the dark sky
// straight above they catch the neon haze near the horizon, the way a puddle shows the lit street around it.
const wetReflection: Step = shader => {
  after(shader, 'fragmentShader', 'lights_fragment_maps', `#if defined( RE_IndirectSpecular ) && defined( USE_ENVMAP )
{
  vec3 r = transformDirectionByInverseViewMatrix(reflect(-geometryViewDir, geometryNormal), viewMatrix);
  radiance = textureLod(envMap, envMapRotation * normalize(vec3(r.x, r.y * .22, r.z)), roughnessToMip(.12)).rgb * envMapIntensity;
}
#endif`);
};

// Sign faces read their own rectangle of the sign atlas (Part.data: u, v, width, height).
const signRect: Step = shader => {
  after(shader, 'vertexShader', 'uv_vertex', 'vMapUv = vMapUv * instanceData.zw + instanceData.xy;');
};

export type DistrictMaterials = ReturnType<typeof districtMaterials>;
export function districtMaterials(atlas: Texture, signs: Texture, pool: Texture, puddle: Texture, environment: Texture) {
  const bounds = { value: new Vector4() };
  const lit = (key: string, ...steps: Step[]) => program(new MeshStandardMaterial({ envMap: environment, envMapIntensity: .35 }), key, fade, data, world, surface, horizon(bounds), ...steps);
  const materials = {
    bounds,
    solid: lit('nd-solid'),
    facade: program(new MeshStandardMaterial({ roughness: .82, metalness: .05, envMap: environment, envMapIntensity: .3 }), 'nd-facade', fade, data, world, horizon(bounds), facade(atlas, { window: 1.7, store: 1.7 })),
    neon: program(new MeshBasicMaterial(), 'nd-neon', fade, world, horizon(bounds)),
    signs: program(new MeshBasicMaterial({ map: signs }), 'nd-signs', fade, data, world, horizon(bounds), signRect),
    pools: program(new MeshBasicMaterial({ map: pool, transparent: true, depthWrite: false, blending: AdditiveBlending }), 'nd-pools', world, horizon(bounds)),
    puddles: program(new MeshStandardMaterial({ alphaMap: puddle, transparent: true, depthWrite: false, roughness: .12, metalness: 1, envMap: environment, envMapIntensity: 2.4, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), 'nd-puddles', world, horizon(bounds), wetReflection),
    ground: program(new MeshStandardMaterial({ color: '#3b424c', roughness: .9, metalness: 0, envMap: environment, envMapIntensity: .3 }), 'nd-ground', world, horizon(bounds), asphalt(atlas)),
  };
  return materials;
}
export const disposeMaterials = (m: DistrictMaterials) => { for (const value of Object.values(m)) if (value instanceof MeshStandardMaterial || value instanceof MeshBasicMaterial) value.dispose(); };
