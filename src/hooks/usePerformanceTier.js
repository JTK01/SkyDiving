/**
 * Picks a quality tier once at start-up. Everything that costs GPU/CPU
 * (cloud counts, texture size, pixel ratio) is derived from it.
 */
export function detectTier() {
  if (typeof window === 'undefined') return 'high'
  const forced = new URLSearchParams(window.location.search).get('tier')
  if (forced === 'high' || forced === 'low') return forced
  const coarse = window.matchMedia?.('(pointer: coarse)').matches
  const small = Math.min(window.innerWidth, window.innerHeight) < 700
  const cores = navigator.hardwareConcurrency || 4
  const mem = navigator.deviceMemory || 8
  if (coarse || small || cores <= 4 || mem <= 4) return 'low'
  return 'high'
}

export const TIER_SETTINGS = {
  high: { dpr: [1, 1.5], atlasTile: 512, cloudScale: 1, terrainSegments: [200, 110] },
  low: { dpr: [0.75, 1.1], atlasTile: 256, cloudScale: 0.5, terrainSegments: [110, 60] },
}

let cached
export function usePerformanceTier() {
  if (!cached) {
    const tier = detectTier()
    cached = { tier, ...TIER_SETTINGS[tier] }
  }
  return cached
}
