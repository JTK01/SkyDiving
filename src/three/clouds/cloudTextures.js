import * as THREE from 'three'

/**
 * Procedural cloud textures, generated once on the CPU at start-up.
 *
 *  - Puff atlas (2×2 tiles): density sprites for the billboards. Each tile is a
 *    cumulus "billow" built from soft overlapping lobes, flattened at the base
 *    and eroded by fractal noise so the edges look like real cauliflower cloud.
 *  - Detail noise: a small, seamlessly tiling fBm texture used for edge
 *    erosion, the full-screen cloud interior and the god rays.
 */

// ---------------------------------------------------------------------------
// noise helpers
function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeValueNoise(seed, period = 0) {
  const rand = mulberry32(seed)
  const SIZE = 256
  const perm = new Uint16Array(SIZE * 2)
  const vals = new Float32Array(SIZE)
  for (let i = 0; i < SIZE; i++) {
    perm[i] = i
    vals[i] = rand()
  }
  for (let i = SIZE - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const t = perm[i]
    perm[i] = perm[j]
    perm[j] = t
  }
  for (let i = 0; i < SIZE; i++) perm[i + SIZE] = perm[i]

  const lattice = (ix, iy) => {
    if (period) {
      ix = ((ix % period) + period) % period
      iy = ((iy % period) + period) % period
    }
    return vals[perm[(perm[ix & 255] + iy) & 511] & 255]
  }

  return (x, y, p = period) => {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const xf = x - xi
    const yf = y - yi
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10)
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10)
    const prev = period
    period = p
    const a = lattice(xi, yi)
    const b = lattice(xi + 1, yi)
    const c = lattice(xi, yi + 1)
    const d = lattice(xi + 1, yi + 1)
    period = prev
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
  }
}

function fbm(noise, x, y, octaves, period = 0) {
  let sum = 0
  let amp = 0.5
  let norm = 0
  let p = period
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x, y, p)
    norm += amp
    x *= 2
    y *= 2
    p *= 2
    amp *= 0.5
  }
  return sum / norm
}

const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

// ---------------------------------------------------------------------------
// puff tiles

/**
 * Tile recipes — the *low-frequency* body of a cloud. The sprite stores a
 * smooth dome of density that fills the tile; all fine detail (protrusions,
 * wisps, billows) is carved per pixel in the shader, where it stays sharp at
 * any distance. A hard-edged, saturated sprite here would leave the shader
 * nothing to erode and the clouds would read as smooth plastic blobs.
 */
const TILE_RECIPES = [
  // 0: wide cumulus with a flat base
  { lobes: 12, envX: 0.6, envY: 0.28, centreY: -0.06, r: [0.32, 0.5], base: -0.5 },
  // 1: tall, towering cumulus
  { lobes: 12, envX: 0.4, envY: 0.46, centreY: 0.0, r: [0.32, 0.48], base: -0.62 },
  // 2: rounded heap (close-up transition clouds)
  { lobes: 10, envX: 0.46, envY: 0.34, centreY: -0.02, r: [0.36, 0.54], base: -0.66 },
  // 3: low, ragged stratocumulus
  { lobes: 12, envX: 0.64, envY: 0.2, centreY: -0.04, r: [0.28, 0.42], base: -0.42, ragged: true },
]

function generateTile(N, recipe, seed) {
  const rand = mulberry32(seed)
  const noise = makeValueNoise(seed * 7 + 3)
  const warpNoise = makeValueNoise(seed * 13 + 5)
  const lobes = []
  for (let i = 0; i < recipe.lobes; i++) {
    const a = rand() * Math.PI * 2
    const rr = Math.sqrt(rand())
    const x = Math.cos(a) * rr * recipe.envX
    const y = recipe.centreY + Math.sin(a) * rr * recipe.envY
    // upper lobes smaller → cauliflower silhouette
    const r = (recipe.r[0] + rand() * (recipe.r[1] - recipe.r[0])) * (1 - Math.max(0, y) * 0.4)
    lobes.push({ x, y, r, w: 0.7 + rand() * 0.5 })
  }

  const out = new Float32Array(N * N)
  const ox = rand() * 100
  const oy = rand() * 100
  for (let j = 0; j < N; j++) {
    const y0 = (j / (N - 1)) * 2 - 1
    for (let i = 0; i < N; i++) {
      const x0 = (i / (N - 1)) * 2 - 1
      // low-frequency domain warp → irregular outline, every tile different
      const wx = fbm(warpNoise, x0 * 1.8 + 11, y0 * 1.8 + 3, 3) - 0.5
      const wy = fbm(warpNoise, x0 * 1.8 + 41, y0 * 1.8 + 17, 3) - 0.5
      const x = x0 + wx * 0.2
      const y = y0 + wy * 0.2

      let f = 0
      for (let k = 0; k < lobes.length; k++) {
        const l = lobes[k]
        const dx = (x - l.x) / l.r
        const dy = (y - l.y) / (l.r * (recipe.ragged ? 0.7 : 0.92))
        const q = 1 - (dx * dx + dy * dy)
        if (q > 0) f += q * Math.sqrt(q) * l.w
      }
      // soft saturation keeps a smooth gradient from edge to core
      let d = 1 - Math.exp(-f * 0.7)
      // flat base
      d *= smooth(recipe.base, recipe.base + 0.35, y)
      // broad internal variation (thicker / thinner parts)
      const n = fbm(noise, x * 2.4 + ox, y * 2.4 + oy, 4)
      d *= 0.72 + 0.56 * n
      // keep borders empty
      const edge = Math.max(Math.abs(x0), Math.abs(y0))
      d *= smooth(1.0, 0.86, edge)
      out[j * N + i] = Math.min(1, Math.max(0, d))
    }
  }
  return out
}

function buildAtlas(tile) {
  const size = tile * 2
  const data = new Uint8Array(size * size)
  TILE_RECIPES.forEach((recipe, idx) => {
    const tx = idx % 2
    const ty = Math.floor(idx / 2)
    const t = generateTile(tile, recipe, 1337 + idx * 101)
    for (let j = 0; j < tile; j++) {
      const row = (ty * tile + j) * size + tx * tile
      for (let i = 0; i < tile; i++) data[row + i] = Math.round(t[j * tile + i] * 255)
    }
  })
  const tex = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.UnsignedByteType)
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = true
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
  tex.unpackAlignment = 1
  tex.needsUpdate = true
  return tex
}

function buildDetail(size = 128) {
  const noise = makeValueNoise(4242)
  const period = 8
  const data = new Uint8Array(size * size)
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const n = fbm(noise, (i / size) * period, (j / size) * period, 5, period)
      data[j * size + i] = Math.round(Math.min(1, Math.max(0, (n - 0.5) * 1.6 + 0.5)) * 255)
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.UnsignedByteType)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = true
  tex.unpackAlignment = 1
  tex.needsUpdate = true
  return tex
}

/**
 * Seamless Worley (cellular) noise. Returns 1 - F1 distance, i.e. round
 * "bumps" — summed over octaves this is the cauliflower billowing of cumulus.
 */
function makeWorley(cells, seed) {
  const rand = mulberry32(seed)
  const pts = new Float32Array(cells * cells * 2)
  for (let i = 0; i < pts.length; i++) pts[i] = rand()
  return (u, v) => {
    const x = u * cells
    const y = v * cells
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    let best = 9
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const cx = xi + ox
        const cy = yi + oy
        const wx = ((cx % cells) + cells) % cells
        const wy = ((cy % cells) + cells) % cells
        const k = (wy * cells + wx) * 2
        const dx = cx + pts[k] - x
        const dy = cy + pts[k + 1] - y
        const d = dx * dx + dy * dy
        if (d < best) best = d
      }
    }
    return 1 - Math.min(1, Math.sqrt(best))
  }
}

/**
 * "Vapor" texture for resolution-independent cloud detail (RG, tiling):
 *  R: Perlin-style fBm (period 16)  — wispy erosion
 *  G: 3-octave Worley billows       — rounded protrusions on the edges
 */
function buildVapor(size = 256) {
  const noise = makeValueNoise(9091)
  const w1 = makeWorley(6, 11)
  const w2 = makeWorley(13, 23)
  const w3 = makeWorley(27, 37)
  const data = new Uint8Array(size * size * 2)
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = i / size
      const v = j / size
      const n = fbm(noise, u * 16, v * 16, 5, 16)
      const w = w1(u, v) * 0.55 + w2(u, v) * 0.3 + w3(u, v) * 0.15
      const k = (j * size + i) * 2
      data[k] = Math.round(Math.min(1, Math.max(0, (n - 0.5) * 1.7 + 0.5)) * 255)
      data[k + 1] = Math.round(Math.min(1, Math.max(0, (w - 0.25) * 1.6)) * 255)
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGFormat, THREE.UnsignedByteType)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = true
  tex.unpackAlignment = 1
  tex.needsUpdate = true
  return tex
}

let cache = null
/** Shared, lazily generated cloud textures. */
export function getCloudTextures(atlasTile = 512) {
  if (!cache) cache = { atlas: buildAtlas(atlasTile), detail: buildDetail(128), vapor: buildVapor(256) }
  return cache
}

export const TILE_COUNT = TILE_RECIPES.length
