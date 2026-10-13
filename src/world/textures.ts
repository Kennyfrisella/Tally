import * as THREE from 'three';

// Procedural textures. Nothing is downloaded: every surface is synthesized on a canvas at startup.

function hash(i: number, j: number, seed: number): number {
  let h = (i * 374761393 + j * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

/** Tileable value noise with period p (in lattice units). */
function vnoise(x: number, y: number, p: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const m = (a: number) => ((a % p) + p) % p;
  const a = hash(m(xi), m(yi), seed), b = hash(m(xi + 1), m(yi), seed);
  const c = hash(m(xi), m(yi + 1), seed), d = hash(m(xi + 1), m(yi + 1), seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x: number, y: number, period: number, octaves: number, seed: number): number {
  let s = 0, amp = 0.5, f = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    s += amp * vnoise(x * f, y * f, period * f, seed + o * 17);
    norm += amp; amp *= 0.5; f *= 2;
  }
  return s / norm;
}

/** Non-tiling smooth noise for world-space use (terrain). */
export function noise2(x: number, y: number, seed = 0): number {
  return vnoise(x, y, 1 << 24, seed);
}
export function fbm2(x: number, y: number, octaves: number, seed = 0): number {
  let s = 0, amp = 0.5, f = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    s += amp * noise2(x * f, y * f, seed + o * 31);
    norm += amp; amp *= 0.5; f *= 2.03;
  }
  return s / norm;
}

type RGB = [number, number, number];

function makeCanvas(size: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function fieldToTexture(size: number, fn: (u: number, v: number, i: number) => RGB, srgb = true): { tex: THREE.CanvasTexture; height: Float32Array } {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const [r, g, b] = fn(x / size, y / size, i);
      height[i] = (r + g + b) / 3;
      img.data[i * 4] = Math.max(0, Math.min(255, r * 255));
      img.data[i * 4 + 1] = Math.max(0, Math.min(255, g * 255));
      img.data[i * 4 + 2] = Math.max(0, Math.min(255, b * 255));
      img.data[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = 8;
  return { tex, height };
}

function normalFromHeight(h: Float32Array, size: number, strength: number): THREE.CanvasTexture {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const at = (x: number, y: number) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      img.data[i] = (-dx * inv * 0.5 + 0.5) * 255;
      img.data[i + 1] = (dy * inv * 0.5 + 0.5) * 255;
      img.data[i + 2] = (inv * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export interface TexSet { map: THREE.Texture; normalMap: THREE.Texture }

export class Textures {
  concrete!: TexSet;
  asphalt!: TexSet;
  rock!: TexSet;
  camo!: THREE.Texture;
  camoEnemy!: THREE.Texture;
  fabric!: THREE.Texture;
  grassDetail!: TexSet;

  constructor(readonly size = 512) {
    this.build();
  }

  private build() {
    const S = this.size;

    // Concrete: fine pores, formwork bands and run-off stains
    {
      const { tex, height } = fieldToTexture(S, (u, v) => {
        const n = fbm(u * 8, v * 8, 8, 5, 1);
        const pores = hash((u * S) | 0, (v * S) | 0, 2) > 0.985 ? -0.14 : (fbm(u * 64, v * 64, 64, 2, 2) - 0.5) * 0.07;
        const streak = Math.pow(fbm(u * 24, v * 2, 24, 3, 3), 3) * 0.22;
        const band = (Math.abs(((v * 4) % 1) - 0.5) < 0.006) ? -0.08 : 0;
        const g = 0.62 + (n - 0.5) * 0.22 + pores - streak + band;
        return [g, g * 0.985, g * 0.96];
      });
      this.concrete = { map: tex, normalMap: normalFromHeight(height, S, 2.2) };
    }

    // Asphalt: dark binder with bright aggregate
    {
      const { tex, height } = fieldToTexture(S, (u, v) => {
        const n = fbm(u * 16, v * 16, 16, 4, 5);
        const agg = hash((u * S) | 0, (v * S) | 0, 9);
        const speck = agg > 0.93 ? 0.16 : agg < 0.05 ? -0.05 : 0;
        const wear = fbm(u * 3, v * 3, 3, 3, 6) * 0.06;
        const g = 0.16 + (n - 0.5) * 0.08 + speck + wear;
        return [g, g, g * 1.02];
      });
      this.asphalt = { map: tex, normalMap: normalFromHeight(height, S, 3.5) };
    }

    // Rock: used as multiply detail for the terrain (near white) with strong normals
    {
      const { tex, height } = fieldToTexture(S, (u, v) => {
        const ridge = 1 - Math.abs(fbm(u * 6, v * 6, 6, 5, 11) * 2 - 1);
        const n = fbm(u * 20, v * 20, 20, 4, 12);
        const g = 0.72 + ridge * 0.2 + (n - 0.5) * 0.25;
        return [g, g * 0.98, g * 0.95];
      });
      this.rock = { map: tex, normalMap: normalFromHeight(height, S, 4) };
    }

    {
      const { tex, height } = fieldToTexture(S, (u, v) => {
        const n = fbm(u * 32, v * 32, 32, 4, 21);
        const blades = hash((u * S * 0.5) | 0, (v * S) | 0, 22) * 0.18;
        const g = 0.78 + (n - 0.5) * 0.3 + blades;
        return [g, g, g * 0.95];
      });
      this.grassDetail = { map: tex, normalMap: normalFromHeight(height, S, 2) };
    }

    // TAZ 90 four-colour camouflage
    const camo = (palette: RGB[], seed: number) => fieldToTexture(256, (u, v) => {
      const a = fbm(u * 4, v * 6, 4, 4, seed);
      const b = fbm(u * 5 + 3.1, v * 7, 5, 4, seed + 40);
      const c = fbm(u * 9, v * 9, 9, 3, seed + 80);
      let col = palette[0];
      if (a > 0.56) col = palette[1];
      if (b > 0.6) col = palette[2];
      if (c > 0.66 && a > 0.45) col = palette[3];
      const weave = (((u * 256) | 0) + ((v * 256) | 0)) % 2 === 0 ? 0.97 : 1.0;
      return [col[0] * weave, col[1] * weave, col[2] * weave];
    }).tex;
    this.camo = camo([[0.42, 0.45, 0.30], [0.24, 0.30, 0.17], [0.33, 0.25, 0.17], [0.11, 0.11, 0.09]], 31);
    this.camoEnemy = camo([[0.16, 0.16, 0.17], [0.22, 0.21, 0.20], [0.10, 0.10, 0.11], [0.28, 0.27, 0.24]], 51);
    this.fabric = fieldToTexture(128, (u, v) => {
      const g = 0.8 + fbm(u * 16, v * 16, 16, 2, 61) * 0.2;
      return [g, g, g];
    }).tex;
  }
}

/** Renders text onto a canvas texture (signs, lettering). */
export function textTexture(
  lines: string[],
  opts: { w?: number; h?: number; bg?: string; fg?: string; font?: string; border?: string; align?: CanvasTextAlign } = {},
): THREE.CanvasTexture {
  const w = opts.w ?? 512, h = opts.h ?? 256;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  if (opts.bg) { ctx.fillStyle = opts.bg; ctx.fillRect(0, 0, w, h); }
  if (opts.border) {
    ctx.strokeStyle = opts.border; ctx.lineWidth = Math.max(4, h * 0.04);
    ctx.strokeRect(ctx.lineWidth, ctx.lineWidth, w - ctx.lineWidth * 2, h - ctx.lineWidth * 2);
  }
  ctx.fillStyle = opts.fg ?? '#fff';
  const align = opts.align ?? 'center';
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  const lh = h / lines.length;
  lines.forEach((line, i) => {
    ctx.font = opts.font ?? `bold ${Math.floor(lh * 0.62)}px "Arial Narrow", Arial, sans-serif`;
    const x = align === 'center' ? w / 2 : align === 'left' ? w * 0.06 : w * 0.94;
    ctx.fillText(line, x, lh * (i + 0.5));
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function swissFlagTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#d52b1e';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#fff';
  ctx.fillRect(52, 26, 24, 76);
  ctx.fillRect(26, 52, 76, 24);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
