export type QualityLevel = 'low' | 'medium' | 'high';

export interface Quality {
  level: QualityLevel;
  pixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  bloom: boolean;
  antialias: boolean;
  tunnelLights: number;
  trees: number;
  textureSize: number;
  drawDistance: number;
}

export const PRESETS: Record<QualityLevel, Quality> = {
  low: { level: 'low', pixelRatio: 0.75, shadows: false, shadowMapSize: 1024, bloom: false, antialias: false, tunnelLights: 4, trees: 500, textureSize: 256, drawDistance: 1400 },
  medium: { level: 'medium', pixelRatio: 1, shadows: true, shadowMapSize: 2048, bloom: true, antialias: true, tunnelLights: 6, trees: 1400, textureSize: 512, drawDistance: 2200 },
  high: { level: 'high', pixelRatio: Math.min(window.devicePixelRatio, 2), shadows: true, shadowMapSize: 4096, bloom: true, antialias: true, tunnelLights: 8, trees: 2600, textureSize: 1024, drawDistance: 3000 },
};

const KEY = 'gotthard.quality';

/** Picks a default preset from a cheap GPU probe; the menu can override it. */
export function detectQuality(): QualityLevel {
  try {
    const saved = localStorage.getItem(KEY) as QualityLevel | null;
    if (saved && saved in PRESETS) return saved;
  } catch { /* storage unavailable */ }
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return 'low';
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).toLowerCase();
    if (/rtx|radeon rx|apple m[2-9]|apple m1 (pro|max)|arc a/.test(name)) return 'high';
    if (/swiftshader|llvmpipe|software|mali-4|adreno 3/.test(name)) return 'low';
    return 'medium';
  } catch {
    return 'medium';
  }
}

export function saveQuality(level: QualityLevel) {
  try { localStorage.setItem(KEY, level); } catch { /* ignore */ }
}
