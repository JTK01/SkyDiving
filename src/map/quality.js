import { create } from 'zustand'

/**
 * Map render quality presets (low / medium / high) + automatic resolution.
 *
 * Targets an integrated-GPU laptop at 1080p (Intel Iris Xe, Apple M1) on
 * 'medium': 60 fps average, 30 fps minimum. The resolution scale is adapted
 * every second from the measured frame time within the preset's range;
 * shadows / bloom / far detail are fixed per preset.
 *
 * Selection: ?q=low|medium|high, then the user's choice (localStorage), then
 * a guess from the device (touch → low, discrete GPU → high, else medium).
 */
export const PRESETS = {
  low: {
    label: '저',
    dpr: [0.6, 0.85], // scale range × min(devicePixelRatio, 1.5)
    shadows: 0, // shadow map size (0 = off)
    bloom: false,
    msaa: 0,
    terrainDetail: 1.2,
    maxTiles: 80,
    midDistance: 1600, // mid-zone boxes hidden beyond (m)
    treeDistance: 500,
    treeStride: 3,
    anisotropy: 2,
  },
  medium: {
    label: '중',
    dpr: [0.7, 1.0],
    shadows: 1024,
    bloom: true,
    msaa: 2,
    terrainDetail: 1.5,
    maxTiles: 120,
    midDistance: 2300,
    treeDistance: 800,
    treeStride: 1,
    anisotropy: 4,
  },
  high: {
    label: '고',
    dpr: [0.85, 1.0],
    shadows: 2048,
    bloom: true,
    msaa: 4,
    terrainDetail: 1.8,
    maxTiles: 160,
    midDistance: 2700,
    treeDistance: 1300,
    treeStride: 1,
    anisotropy: 8,
  },
}
const KEY = 'skydive.quality'

export function guessPreset(gl) {
  if (typeof window === 'undefined') return 'medium'
  if (window.matchMedia?.('(pointer: coarse)').matches) return 'low'
  try {
    const ctx = gl?.getContext?.()
    const ext = ctx?.getExtension('WEBGL_debug_renderer_info')
    const name = ext ? ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL) : ''
    if (/nvidia|geforce|rtx|radeon rx|radeon pro|arc a\d/i.test(name) && !/intel\(r\) (uhd|hd|iris)/i.test(name)) return 'high'
  } catch {
    /* no renderer info */
  }
  return 'medium'
}

function initial() {
  const q = new URLSearchParams(window.location.search).get('q')
  if (PRESETS[q]) return { name: q, source: 'url' }
  try {
    const v = localStorage.getItem(KEY)
    if (PRESETS[v]) return { name: v, source: 'user' }
  } catch {
    /* storage blocked */
  }
  return { name: null, source: 'auto' }
}

export const useQuality = create((set, get) => ({
  ...initial(),
  scale: 1, // current resolution scale (auto)
  fps: 0,
  frameMs: 0,
  worstMs: 0,
  /** first canvas decides the auto preset once */
  resolve: (gl) => {
    if (!get().name) set({ name: guessPreset(gl), source: 'auto' })
  },
  choose: (name) => {
    try {
      localStorage.setItem(KEY, name)
    } catch {
      /* ignore */
    }
    set({ name, source: 'user', scale: PRESETS[name].dpr[1] })
  },
  setStats: (s) => set(s),
}))

export const preset = (name) => PRESETS[name || 'medium']
