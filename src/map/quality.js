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
const SWAY_KEY = 'skydive.sway'
function readFlag(k) {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(k) === '1'
  } catch {
    return false
  }
}

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
  dpr: null, // canvas pixel ratio set by AutoResolution (devicePixelRatio × scale)
  sway: readFlag(SWAY_KEY), // wind sway of the camera while falling (off by default)
  setSway: (on) => {
    try {
      localStorage.setItem(SWAY_KEY, on ? '1' : '0')
    } catch {
      /* ignore */
    }
    set({ sway: on })
  },
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

const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams()
/** ?scale=0.85 locks the resolution scale (no automatic adjustment) */
export const FIXED_SCALE = params.has('scale') ? Math.min(2, Math.max(0.25, +params.get('scale') || 1)) : null

/**
 * Frame-time benchmark of one drop (?bench): every frame from the moment the
 * fall starts until contact is recorded (the first second, with shader
 * compilation and tile uploads, is reported separately).
 */
export const BENCH = params.has('bench')
export const frameLog = { recording: false, ms: [], info: null }

export function summarizeFrames(all, warmupMs = 1000) {
  let t = 0
  let k = 0
  while (k < all.length && t < warmupMs) t += all[k++]
  const ms = all.slice(k)
  if (!ms.length) return null
  const sorted = [...ms].sort((a, b) => a - b)
  const sum = ms.reduce((a, b) => a + b, 0)
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
  const fps = (x) => Math.round((1000 / x) * 10) / 10
  return {
    frames: ms.length,
    seconds: Math.round(sum / 100) / 10,
    avgFps: fps(sum / ms.length),
    low1Fps: fps(pct(0.99)), // 1 % low: the 99th-percentile frame time
    minFps: fps(sorted[sorted.length - 1]),
    over33ms: Math.round((ms.filter((x) => x > 1000 / 30).length / ms.length) * 1000) / 10, // % of frames under 30 fps
    warmupFrames: k,
    warmupWorstMs: Math.round(Math.max(0, ...all.slice(0, k))),
  }
}

/** GPU name for reports (WEBGL_debug_renderer_info; may be masked by the browser) */
export function gpuName(gl) {
  try {
    const ctx = gl.getContext()
    const ext = ctx.getExtension('WEBGL_debug_renderer_info')
    return ext ? ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL) : ctx.getParameter(ctx.RENDERER)
  } catch {
    return 'unknown'
  }
}
