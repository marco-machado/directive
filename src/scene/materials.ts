import { AdditiveBlending, Vector4 } from 'three';
import type { Texture } from 'three';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial, PhysicalLightingModel } from 'three/webgpu';
import type { Node, NodeBuilder, NodeMaterial } from 'three/webgpu';
import { abs, attribute, bool, dFdx, dFdy, dot, float, floor, Fn, fract, If, length, materialColor, materialEmissive, materialRoughness, max, min, mix, mod, normalGeometry, output, pmremTexture, positionGeometry, positionWorld, property, reflectVector, screenCoordinate, select, sign, sin, smoothstep, step, texture, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import { ATLAS_CELLS, BAY, FLOOR0, ROW } from './district.ts';

// Material roles for the district, built from three's node materials with small TSL additions.

type Step<M extends NodeMaterial = NodeMaterial> = (material: M) => void;
function build<M extends NodeMaterial>(material: M, ...steps: Step<M>[]): M {
  for (const step of steps) step(material);
  return material;
}

// Per-instance shader input written by InstancedParts (parts.tsx): the fade level, Part.data and the part's size.
const instanceFade = attribute('instanceFade', 'float'), instanceData = attribute('instanceData', 'vec4'), instanceSize = attribute('instanceSize', 'vec3');

// Screen-door fade: each instance carries the share of its pixels to drop (0 keeps it solid), and the fragment
// stage discards that share in a 4x4 ordered-dither pattern. Discarded pixels write no depth, so whatever stands
// behind shows through, and the instanced mesh stays one draw call. Shadows ignore the fade, as they always have.
const ditherBayer2 = (a: Node<'vec2'>) => { const f = floor(a); return fract(dot(f, vec2(.5, f.y.mul(.75)))); };
const ditherBayer4 = (a: Node<'vec2'>) => ditherBayer2(a.mul(.5)).mul(.25).add(ditherBayer2(a));
const fade: Step = m => {
  m.maskNode = instanceFade.lessThanEqual(ditherBayer4(vec2(screenCoordinate.xy)).add(.03125));
  m.maskShadowNode = bool(true);
};

// The playable zone ends at the district's bounds. Past them the city is graded down, dimmer and nearly gray, so the
// street the camera sees out there reads as backdrop, not ground the squad can take. The grade sets in over
// OUT_OF_ZONE.edge meters at the bounds, where city.tsx outlines the zone. Further out the city sinks into the dark
// (HORIZON, meters past the bounds), so the ground and the ring never end at a hard edge.
const OUT_OF_ZONE = { dim: .45, saturation: .3, edge: .1 };
const HORIZON = [7, 16];
const zone = (bounds: Node<'vec4'>): Step => m => {
  const past = length(max(max(bounds.xy.sub(positionWorld.xz), positionWorld.xz.sub(bounds.zw)), 0));
  const rgb = output.rgb, gray = vec3(dot(rgb, vec3(.2126, .7152, .0722)));
  const graded = mix(rgb, mix(gray, rgb, OUT_OF_ZONE.saturation).mul(OUT_OF_ZONE.dim), smoothstep(0, OUT_OF_ZONE.edge, past));
  m.outputNode = vec4(graded.mul(smoothstep(HORIZON[0], HORIZON[1], past).oneMinus()), output.a);
};

// Direct highlights stop at GLINT, keeping their hue, so a lit surface never reaches the bloom threshold
// (BLOOM.threshold, bloom.tsx). Without it, a camera orbited onto the moon's mirror direction catches the moon
// in every wet patch of asphalt and every puddle, and the bloom pass smears the glints over the whole frame.
// The cap runs once every light has added its share and before three sums the direct and indirect terms.
const GLINT = .45;
class GlintCapLighting extends PhysicalLightingModel {
  start(builder: NodeBuilder) {
    super.start(builder);
    const s = (builder.context as unknown as { reflectedLight: { directSpecular: Node<'vec3'> } }).reflectedLight.directSpecular;
    s.assign(s.mul(min(1, float(GLINT).div(max(max(s.r, s.g), s.b).max(1e-4)))));
  }
}
class LitMaterial extends MeshStandardNodeMaterial {
  setupLightingModel() { return new GlintCapLighting(); }
}

// Roughness and metalness per instance, so one instanced mesh carries every solid material role.
const surface: Step<MeshStandardNodeMaterial> = m => {
  m.roughnessNode = instanceData.x;
  m.metalnessNode = instanceData.y;
};

// Modeled props (propGeometry.ts) carry their look per vertex: a color and a surface of roughness, metalness, glow
// and tint. Where tint is 1 the instance's paint (InstancedProps, props.tsx) replaces the vertex's white; glow turns
// the vertex color into light. The bloom pass thresholds on luminance, so a lamp's lens blooms and a car's red
// tail lights only glow, as the boxes they replace did.
const vertexColor = attribute('color', 'vec3'), vertexSurface = attribute('surface', 'vec4'), instancePaint = attribute('instancePaint', 'vec3');
const prop: Step<MeshStandardNodeMaterial> = m => {
  m.colorNode = mix(vertexColor, vertexColor.mul(instancePaint), vertexSurface.w);
  m.roughnessNode = vertexSurface.x;
  m.metalnessNode = vertexSurface.y;
  m.emissiveNode = vertexColor.mul(vertexSurface.z);
};

const N = ATLAS_CELLS;
// Cell (x, y) of the atlas counts from the canvas's top left; f runs 0-1 across the cell, y up.
const atlasCell = (atlas: Texture, cell: Node<'vec2'>, f: Node<'vec2'>, dx: Node<'vec2'>, dy: Node<'vec2'>) =>
  texture(atlas, vec2(cell.x.add(f.x).div(N), float(1).sub(cell.y.add(1).sub(f.y).div(N)))).grad(dx, dy).rgb;
const hash = (p: Node<'vec2'>) => fract(sin(dot(p, vec2(12.9898, 78.233))).mul(43758.5453));

// Building tiers. The box's own size (instanceSize) lays out window bays that fit each face exactly and floors on
// world height, so rows line up across tiers. Each bay samples the atlas: window style and starting bay come from
// Part.data (x, y: bay offset, z: style, w: occupancy), and a hash of the bay switches some of the atlas's lit rooms
// off per building. Roofs take the grime tile, darker toward the parapet. Sampling with explicit gradients of the
// continuous bay coordinate keeps mip selection smooth across the jumps between cells, and lets the samples sit
// inside branches. The color pass leaves the glow and the glass gloss for the emissive and roughness inputs.
const facade = (atlas: Texture, gain: { window: number; store: number }): Step<MeshStandardNodeMaterial> => m => {
  const glow = property('vec3', 'ndGlow'), gloss = property('float', 'ndGloss');
  m.colorNode = Fn(() => {
    glow.assign(vec3(0)); gloss.assign(0);
    const size = instanceSize, local = positionGeometry.mul(size), normal = normalGeometry, world = positionWorld;
    const xFace = abs(normal.x).greaterThan(.5);
    const faceW = select(xFace, size.z, size.x);
    const along = select(xFace, local.z.negate().mul(sign(normal.x)), local.x.mul(sign(normal.z)));
    const top = world.y.sub(local.y).add(size.y.mul(.5)).toVar(), bottom = top.sub(size.y).toVar();
    const cols = max(1, floor(faceW.div(BAY).add(.5)));
    const wall = vec2(along.div(faceW).add(.5).mul(cols), world.y.sub(FLOOR0).div(ROW)).toVar(), roof = world.xz.div(6).toVar();
    const wdx = dFdx(wall).div(N).toVar(), wdy = dFdy(wall).div(N).toVar(), rdx = dFdx(roof).mul(.5).toVar(), rdy = dFdy(roof).mul(.5).toVar();
    const albedo = vec3(.45).toVar(), base = vec3(materialColor).toVar();
    If(normal.y.greaterThan(.5), () => {
      albedo.assign(texture(atlas, fract(roof).mul(.5)).grad(rdx, rdy).rgb);
      const edge = min(size.x.mul(.5).sub(abs(local.x)), size.z.mul(.5).sub(abs(local.z)));
      albedo.mulAssign(mix(.55, 1, smoothstep(0, .5, edge)).mul(.8));
      base.assign(mix(vec3(dot(base, vec3(.333))), base, .4)); // roofs keep little of the body's tint
    }).ElseIf(normal.y.greaterThan(-.5), () => {
      const cell = floor(wall).toVar(), f = fract(wall).toVar();
      const face = select(xFace, select(normal.x.greaterThan(0), 0, 1), select(normal.z.greaterThan(0), 2, 3));
      const origin = instanceData.xy.add(vec2(3, 5).mul(face)).toVar();
      const rowBottom = cell.y.mul(ROW).add(FLOOR0);
      If(world.y.lessThan(FLOOR0).and(bottom.lessThan(.5)), () => {
        // Storefront band between the plinth and the first floor.
        const c = vec2(mod(origin.x.add(cell.x), 16).add(16), mod(origin.y, 4).add(16)), sf = vec2(f.x, world.y.sub(bottom).div(float(FLOOR0).sub(bottom)));
        albedo.assign(atlasCell(atlas, c, sf, wdx, wdy));
        glow.assign(atlasCell(atlas, c.add(vec2(0, 4)), sf, wdx, wdy).mul(gain.store));
      }).ElseIf(cell.y.greaterThanEqual(0).and(rowBottom.greaterThanEqual(bottom.sub(.01))).and(rowBottom.add(ROW).lessThanEqual(top.add(.01))), () => {
        const style = instanceData.z, c = vec2(mod(style, 2), floor(style.div(2))).mul(8).add(mod(origin.add(cell), 8));
        albedo.assign(atlasCell(atlas, c, f, wdx, wdy));
        glow.assign(atlasCell(atlas, c.add(vec2(16, 0)), f, wdx, wdy).mul(gain.window).mul(step(hash(cell.add(origin.mul(7.31)).add(instanceData.xy)), instanceData.w)));
        gloss.assign(smoothstep(.04, .16, dot(albedo, vec3(.333))).oneMinus());
      }).Else(() => {
        albedo.assign(atlasCell(atlas, vec2(mod(cell.x, 16).add(16), mod(cell.y, 2).add(24)), f, wdx, wdy));
      });
    });
    return base.mul(albedo).mul(2.2);
  })();
  m.roughnessNode = mix(materialRoughness, .2, gloss);
  m.emissiveNode = materialEmissive.add(glow);
};

// The street: the atlas's grime tile in world space, its darker patches read as damp and glossier.
const asphalt = (atlas: Texture): Step<MeshStandardNodeMaterial> => m => {
  const g = positionWorld.xz.div(9);
  const grime = texture(atlas, fract(g).mul(.5)).grad(dFdx(g).mul(.5), dFdy(g).mul(.5)).rgb;
  const v = dot(grime, vec3(.333));
  m.colorNode = vec3(materialColor).mul(mix(.75, 1.15, v.mul(2)));
  m.roughnessNode = mix(materialRoughness, .28, smoothstep(.2, .3, v).oneMinus());
};

// Puddles are stylized mirrors: they reflect the environment along a flattened view ray, so instead of the dark sky
// straight above they catch the neon haze near the horizon, the way a puddle shows the lit street around it. The
// lookup's own direction and blur replace the material's; puddles are fully metallic, so it adds no diffuse light.
const wetReflection = (environment: Texture): Step<MeshStandardNodeMaterial> => m => {
  const r = reflectVector;
  m.envNode = pmremTexture(environment, vec3(r.x, r.y.mul(.22), r.z).normalize(), float(.12));
};

// Sign faces read their own rectangle of the sign atlas (Part.data: u, v, width, height).
const signRect = (signs: Texture): Step => m => {
  m.colorNode = texture(signs, uv().mul(instanceData.zw).add(instanceData.xy));
};

type DistrictMaterials = ReturnType<typeof districtMaterials>;
export function districtMaterials(atlas: Texture, signs: Texture, pool: Texture, puddle: Texture, environment: Texture) {
  const bounds = uniform(new Vector4());
  const materials = {
    bounds,
    solid: build(new LitMaterial({ envMap: environment, envMapIntensity: .35 }), fade, surface, zone(bounds)),
    prop: build(new LitMaterial({ envMap: environment, envMapIntensity: .35 }), prop, zone(bounds)),
    facade: build(new LitMaterial({ roughness: .82, metalness: .05, envMap: environment, envMapIntensity: .3 }), fade, zone(bounds), facade(atlas, { window: 1.7, store: 1.7 })),
    neon: build(new MeshBasicNodeMaterial(), fade, zone(bounds)),
    signs: build(new MeshBasicNodeMaterial(), fade, zone(bounds), signRect(signs)),
    pools: build(new MeshBasicNodeMaterial({ map: pool, transparent: true, depthWrite: false, blending: AdditiveBlending }), zone(bounds)),
    puddles: build(new LitMaterial({ alphaMap: puddle, transparent: true, depthWrite: false, roughness: .12, metalness: 1, envMapIntensity: 2.4, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), zone(bounds), wetReflection(environment)),
    ground: build(new LitMaterial({ color: '#3b424c', roughness: .9, metalness: 0, envMap: environment, envMapIntensity: .3 }), zone(bounds), asphalt(atlas)),
  };
  return materials;
}
export const disposeMaterials = (m: DistrictMaterials) => { for (const value of Object.values(m)) if (value instanceof MeshStandardNodeMaterial || value instanceof MeshBasicNodeMaterial) value.dispose(); };
