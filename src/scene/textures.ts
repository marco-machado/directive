import { BackSide, BoxGeometry, CanvasTexture, Color, Float32BufferAttribute, LinearMipmapLinearFilter, Mesh, MeshBasicMaterial, NoColorSpace, PlaneGeometry, PMREMGenerator, RepeatWrapping, Scene, SphereGeometry, SRGBColorSpace } from 'three';
import type { Texture, WebGLRenderer } from 'three';
import { between, mulberry32, pick } from '../game/rng.ts';
import type { Rng } from '../game/rng.ts';
import { ATLAS_CELLS, BLADE_CELLS, BOARD_CELLS, glyphStrokes } from './district.ts';
import type { District } from './district.ts';

// Canvas-generated textures. Nothing here loads an image: every texel is drawn from the contract seed.

const CELL = 64; // pixels per facade bay in the atlas
const canvas2d = (w: number, h: number) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return { c, g: c.getContext('2d')! };
};
const shade = (v: number) => { const n = Math.max(0, Math.min(255, Math.round(v))); return `rgb(${n},${n},${n})`; };
const WARM = ['#ffc887', '#ffd6a3', '#ffb978'], COOL = ['#d6ebff', '#bfe0ff'], NEON = ['#5ff0ff', '#ff6fd8', '#b48cff', '#7dffb2', '#ff8a5c'];

// Window geometry per facade style, in the bay's 64 px cell (y down): glass rectangles.
const WINDOWS: [number, number, number, number][][] = [
  [[12, 12, 40, 34]],                                   // 0: punched windows
  [[0, 14, 64, 30]],                                    // 1: ribbon glazing
  [[22, 5, 20, 52]],                                    // 2: tall slots
  [[9, 9, 20, 20], [35, 9, 20, 20], [9, 35, 20, 20], [35, 35, 20, 20]], // 3: industrial panes
];

function wall(g: CanvasRenderingContext2D, x: number, y: number, rng: Rng, seamLeft: boolean) {
  g.fillStyle = shade(182 + between(rng, -10, 10)); g.fillRect(x, y, CELL, CELL);
  for (let n = 0; n < 40; n++) { g.fillStyle = `rgba(0,0,0,${between(rng, .03, .1)})`; g.fillRect(x + rng() * CELL, y + rng() * CELL, 2, 2); }
  g.fillStyle = 'rgba(40,40,40,.55)'; g.fillRect(x, y + CELL - 2, CELL, 2);
  if (seamLeft) g.fillRect(x, y, 2, CELL);
}

function glass(g: CanvasRenderingContext2D, [x, y, w, h]: [number, number, number, number]) {
  const grad = g.createLinearGradient(x, y, x + w, y + h);
  grad.addColorStop(0, '#2c3a4a'); grad.addColorStop(.55, '#151c26'); grad.addColorStop(1, '#1d2734');
  g.fillStyle = 'rgba(232,232,232,.9)'; g.fillRect(x - 2, y - 2, w + 4, h + 4);
  g.fillStyle = grad; g.fillRect(x, y, w, h);
  g.fillStyle = 'rgba(70,70,70,.5)'; g.fillRect(x - 2, y + h + 2, w + 4, 3); // sill shadow
}

// A lit window: the room's light, a brighter ceiling strip, and sometimes blinds or furniture against it.
function room(g: CanvasRenderingContext2D, [x, y, w, h]: [number, number, number, number], tint: string, level: number, rng: Rng) {
  const grad = g.createLinearGradient(x, y, x, y + h), hex = parseInt(tint.slice(1), 16), [r, gr, bl] = [hex >> 16 & 255, hex >> 8 & 255, hex & 255];
  const top = `rgb(${Math.round(r * level)},${Math.round(gr * level)},${Math.round(bl * level)})`, low = `rgb(${Math.round(r * .78 * level)},${Math.round(gr * .7 * level)},${Math.round(bl * .66 * level)})`;
  grad.addColorStop(0, top); grad.addColorStop(1, low);
  g.fillStyle = grad; g.fillRect(x, y, w, h);
  if (rng() < .35) { g.fillStyle = 'rgba(0,0,0,.45)'; for (let k = y + 3; k < y + h; k += 5) g.fillRect(x, k, w, 2); }
  if (rng() < .35) { g.fillStyle = 'rgba(0,0,0,.7)'; g.fillRect(x + rng() * w * .6, y + h * .55, w * between(rng, .2, .45), h * .45); }
  if (rng() < .25) { g.fillStyle = 'rgba(0,0,0,.8)'; g.fillRect(rng() < .5 ? x : x + w * .55, y, w * .45, h); }
}

// Tileable value noise, `period` lattice cells across `size` pixels.
function noise(size: number, period: number, rng: Rng) {
  const lattice = Float32Array.from({ length: period * period }, () => rng()), cell = size / period;
  return (px: number, py: number) => {
    const fx = px / cell, fy = py / cell, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const at = (x: number, y: number) => lattice[((y % period) + period) % period * period + ((x % period) + period) % period];
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    return (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy;
  };
}

// The facade atlas, ATLAS_CELLS x ATLAS_CELLS bays of 64 px (cell coordinates count from the top left):
//   0-15 x 0-15   wall and glass albedo for four window styles, 8 x 8 bays each
//   16-31 x 0-15  the same bays' window light: which rooms are lit, and how
//   0-15 x 16-31  roof grime, one continuous tile (also the street's asphalt)
//   16-31 x 16-19 storefront albedo, 16-31 x 20-23 storefront light
//   16-31 x 24-25 plain wall panels for bands without windows
export function facadeAtlas(seed: number, anisotropy: number): CanvasTexture {
  const size = CELL * ATLAS_CELLS, { c, g } = canvas2d(size, size), rng = mulberry32(seed ^ 0xfacade);
  g.fillStyle = '#000'; g.fillRect(0, 0, size, size);
  for (let style = 0; style < 4; style++) {
    const bx = (style % 2) * 8, by = Math.floor(style / 2) * 8;
    for (let row = 0; row < 8; row++) {
      // A floor is mostly dark, partly lit or fully lit, in one kind of light.
      const r = rng(), floorLit = r < .3 ? .04 : r < .8 ? between(rng, .2, .6) : .92;
      const tint = rng() < .58 ? pick(rng, WARM) : rng() < .6 ? pick(rng, COOL) : pick(rng, NEON);
      for (let col = 0; col < 8; col++) {
        const x = (bx + col) * CELL, y = (by + row) * CELL;
        wall(g, x, y, rng, col % 2 === 0);
        for (const w of WINDOWS[style]) glass(g, w.map((v, k) => v + (k === 0 ? x : k === 1 ? y : 0)) as [number, number, number, number]);
        // Grime streaks down from the sills.
        const streak = g.createLinearGradient(0, y, 0, y + CELL);
        streak.addColorStop(0, 'rgba(0,0,0,0)'); streak.addColorStop(1, `rgba(0,0,0,${between(rng, .05, .18)})`);
        g.fillStyle = streak; g.fillRect(x + 8, y, CELL - 16, CELL);
        const lit = rng() < floorLit, ex = x + 16 * CELL;
        for (const w of WINDOWS[style]) {
          const rect = w.map((v, k) => v + (k === 0 ? ex : k === 1 ? y : 0)) as [number, number, number, number];
          if (lit && (style !== 3 || rng() < .8)) room(g, rect, rng() < .85 ? tint : pick(rng, WARM), between(rng, .55, 1), rng);
          else if (rng() < .12) { g.fillStyle = '#0b1526'; g.fillRect(...rect); }
        }
      }
    }
  }

  // Roof grime: layered noise, tar seams on a 128 px grid and cracks, all wrapping at the tile edge.
  const roof = g.createImageData(1024, 1024), coarse = noise(1024, 8, rng), mid = noise(1024, 32, rng), fine = noise(1024, 128, rng);
  for (let py = 0; py < 1024; py++) for (let px = 0; px < 1024; px++) {
    const stain = Math.max(0, .5 - coarse(px, py)) * 1.6, v = 168 + (mid(px, py) - .5) * 30 + (fine(px, py) - .5) * 26 - stain * 55, o = (py * 1024 + px) * 4;
    roof.data[o] = v * .98; roof.data[o + 1] = v; roof.data[o + 2] = v * 1.03; roof.data[o + 3] = 255;
  }
  g.putImageData(roof, 0, 1024);
  g.save(); g.beginPath(); g.rect(0, 1024, 1024, 1024); g.clip();
  g.fillStyle = 'rgba(30,30,30,.35)';
  for (let k = 0; k < 1024; k += 128) { g.fillRect(k, 1024, 3, 1024); g.fillRect(0, 1024 + k, 1024, 3); }
  g.strokeStyle = 'rgba(25,25,25,.45)'; g.lineWidth = 2;
  for (let n = 0; n < 26; n++) {
    let x = rng() * 1024, y = rng() * 1024;
    const path: [number, number][] = [[x, y]];
    for (let s = 0; s < 6; s++) { x += between(rng, -50, 50); y += between(rng, -50, 50); path.push([x, y]); }
    for (const dx of [-1024, 0, 1024]) for (const dy of [-1024, 0, 1024]) {
      g.beginPath(); path.forEach(([px, py], k) => (k ? g.lineTo : g.moveTo).call(g, px + dx, 1024 + py + dy)); g.stroke();
    }
  }
  g.restore();

  // Storefronts: shop windows under a lightbox fascia, doors, roller shutters and blank cladding.
  for (let row = 0; row < 4; row++) for (let col = 0; col < 16; col++) {
    const x = (16 + col) * CELL, y = (16 + row) * CELL, ly = y + 4 * CELL, kind = rng();
    g.fillStyle = shade(70 + rng() * 20); g.fillRect(x, y, CELL, CELL);
    g.fillStyle = '#16191e'; g.fillRect(x, y, CELL, 12);
    const sign = rng() < .65 ? pick(rng, [...NEON, ...WARM]) : null;
    if (sign) { g.fillStyle = sign; g.globalAlpha = .9; g.fillRect(x + 2, ly + 2, CELL - 4, 8); g.globalAlpha = 1; }
    if (kind < .55) {
      g.fillStyle = '#2a2f36'; g.fillRect(x + 4, y + 14, CELL - 8, CELL - 16);
      glass(g, [x + 7, y + 17, CELL - 14, CELL - 20]);
      if (rng() < .8) room(g, [x + 7, ly + 17, CELL - 14, CELL - 20], rng() < .5 ? pick(rng, WARM) : pick(rng, [...COOL, ...NEON]), between(rng, .6, 1), rng);
    } else if (kind < .7) {
      g.fillStyle = '#101317'; g.fillRect(x + 18, y + 18, 28, CELL - 18);
      g.fillStyle = '#c8c8c8'; g.fillRect(x + 16, y + 16, 32, 2);
      if (rng() < .6) { g.fillStyle = pick(rng, WARM); g.fillRect(x + 22, ly + 22, 20, 12); }
    } else if (kind < .9) {
      for (let k = y + 14; k < y + CELL; k += 4) { g.fillStyle = shade(120 + (k % 8 ? 20 : -20)); g.fillRect(x + 3, k, CELL - 6, 4); }
    }
  }
  // Plain wall panels.
  for (let row = 0; row < 2; row++) for (let col = 0; col < 16; col++) wall(g, (16 + col) * CELL, (24 + row) * CELL, rng, col % 2 === 0);

  const texture = new CanvasTexture(c);
  texture.colorSpace = SRGBColorSpace; texture.anisotropy = anisotropy; texture.minFilter = LinearMipmapLinearFilter;
  return texture;
}

// Sign faces: BLADE_CELLS vertical strips (64 x 512) across the top half, BOARD_CELLS boards (512 x 128) below.
// Light is drawn white on black; the instance color tints it and pushes it past the bloom threshold.
export function signAtlas(district: District): CanvasTexture {
  const { c, g } = canvas2d(1024, 1024), glyphs = glyphStrokes(district.seed);
  g.fillStyle = '#000'; g.fillRect(0, 0, 1024, 1024);
  const glyph = (index: number, x: number, y: number, size: number) => {
    const step = size / 3;
    for (const stroke of glyphs[index % glyphs.length]) {
      g.beginPath();
      stroke.forEach(([gx, gy], k) => (k ? g.lineTo : g.moveTo).call(g, x + gx * step + step / 2, y + gy * step * .8 + step / 2));
      g.stroke();
    }
  };
  g.lineCap = 'round'; g.lineJoin = 'round';
  district.blades.slice(0, BLADE_CELLS).forEach((text, i) => {
    const x = i * 64;
    g.fillStyle = '#0b0c10'; g.fillRect(x + 2, 2, 60, 508);
    g.shadowColor = '#fff'; g.shadowBlur = 6; g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 3;
    g.strokeRect(x + 7, 7, 50, 498);
    g.strokeStyle = '#fff'; g.lineWidth = 4.5;
    const size = Math.min(44, 470 / text.length);
    text.forEach((n, k) => glyph(n, x + 10, 22 + k * (470 / text.length) + (470 / text.length - size) / 2, size));
    g.shadowBlur = 0;
  });
  district.boards.slice(0, BOARD_CELLS).forEach((board, i) => {
    const x = (i % 2) * 512, y = 512 + Math.floor(i / 2) * 128;
    const bg = g.createLinearGradient(0, y, 0, y + 128);
    bg.addColorStop(0, '#2a2a2a'); bg.addColorStop(1, '#121212');
    g.fillStyle = bg; g.fillRect(x + 3, y + 3, 506, 122);
    g.fillStyle = 'rgba(255,255,255,.7)'; g.fillRect(x + 10, y + 10, 492, 3); g.fillRect(x + 10, y + 115, 492, 3);
    g.shadowColor = '#fff'; g.shadowBlur = 10; g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    let font = 72;
    do { g.font = `900 ${font}px "Arial Black", Arial, sans-serif`; font -= 4; } while (g.measureText(board.title).width > 400 && font > 24);
    g.fillText(board.title, x + 256, y + 60);
    g.strokeStyle = '#fff'; g.lineWidth = 3;
    glyph(board.glyphs[0], x + 18, y + 40, 40); glyph(board.glyphs[1], x + 454, y + 40, 40);
    g.shadowBlur = 0;
  });
  const texture = new CanvasTexture(c);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

// A soft round falloff for the additive light pools (linear data, not a color).
export function poolTexture(): CanvasTexture {
  const { c, g } = canvas2d(128, 128), image = g.createImageData(128, 128);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const r = Math.min(1, Math.hypot(x - 63.5, y - 63.5) / 63.5), v = Math.round(255 * (1 - r * r) ** 2.2), o = (y * 128 + x) * 4;
    image.data[o] = image.data[o + 1] = image.data[o + 2] = v; image.data[o + 3] = 255;
  }
  g.putImageData(image, 0, 0);
  const texture = new CanvasTexture(c); texture.colorSpace = NoColorSpace;
  return texture;
}

// Puddle outline: a few overlapping soft ellipses, used as an alpha mask.
export function puddleTexture(): CanvasTexture {
  const { c, g } = canvas2d(256, 256), rng = mulberry32(0x9dd1e);
  g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256);
  g.globalCompositeOperation = 'lighter';
  for (let n = 0; n < 6; n++) {
    const x = between(rng, 80, 176), y = between(rng, 90, 166), rx = between(rng, 40, 76), ry = between(rng, 26, 50);
    g.save(); g.translate(x, y); g.scale(1, ry / rx);
    const grad = g.createRadialGradient(0, 0, rx * .5, 0, 0, rx);
    grad.addColorStop(0, 'rgba(255,255,255,.95)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.beginPath(); g.arc(0, 0, rx, 0, Math.PI * 2); g.fill(); g.restore();
  }
  const texture = new CanvasTexture(c); texture.colorSpace = NoColorSpace; texture.wrapS = texture.wrapT = RepeatWrapping;
  return texture;
}

// Reflections for wet and glossy surfaces: a sky that glows with the city's haze toward the horizon and neon panels
// at every height the camera's reflections can reach, prefiltered once per renderer.
const environments = new WeakMap<WebGLRenderer, Texture>();
export function nightEnvironment(gl: WebGLRenderer): Texture {
  let texture = environments.get(gl);
  if (texture) return texture;
  const scene = new Scene(), box = new BoxGeometry(), plane = new PlaneGeometry(), sky = new SphereGeometry(30, 16, 8), rng = mulberry32(0xe17);
  scene.background = new Color('#05070d');
  const mats: MeshBasicMaterial[] = [];
  const add = (geometry: BoxGeometry | PlaneGeometry | SphereGeometry, color: string, scale: number) => {
    const m = new MeshBasicMaterial({ color: new Color(color).multiplyScalar(scale) }); mats.push(m);
    const mesh = new Mesh(geometry, m); scene.add(mesh); return mesh;
  };
  const haze = new Color('#5c3a72'), zenith = new Color('#0c1428'), shades: number[] = [], position = sky.getAttribute('position');
  for (let i = 0; i < position.count; i++) { const c = haze.clone().lerp(zenith, Math.min(1, Math.max(0, position.getY(i) / 30)) ** .6); shades.push(c.r, c.g, c.b); }
  sky.setAttribute('color', new Float32BufferAttribute(shades, 3));
  const dome = add(sky, '#ffffff', 1); dome.material.side = BackSide; dome.material.vertexColors = true;
  for (let n = 0; n < 26; n++) {
    const a = rng() * Math.PI * 2, e = between(rng, .05, 1.15), r = 12, panel = add(plane, pick(rng, [...NEON, ...WARM, '#3d6bff']), between(rng, 2, 5));
    panel.position.set(Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r);
    panel.scale.set(between(rng, 1, 3), between(rng, 2, 6), 1); panel.lookAt(0, 0, 0);
  }
  add(box, '#1a2a4a', .6).scale.set(60, .2, 60);
  const pmrem = new PMREMGenerator(gl);
  texture = pmrem.fromScene(scene, .04).texture;
  pmrem.dispose(); box.dispose(); plane.dispose(); sky.dispose(); mats.forEach(m => m.dispose());
  environments.set(gl, texture);
  return texture;
}
