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

/** Tile recipes — tweak these to change the cloud character. */
const TILE_RECIPES = [
  // 0: wide cumulus billow with a flat base
  { lobes: 16, envX: 0.62, envY: 0.3, centreY: -0.08, r: [0.14, 0.3], base: -0.4, erosion: 0.5, freq: 5.0 },
  // 1: tall towering billow
  { lobes: 15, envX: 0.38, envY: 0.5, centreY: 0.0, r: [0.15, 0.3], base: -0.55, erosion: 0.48, freq: 5.4 },
  // 2: soft dense puff (used up close in transitions)
  { lobes: 12, envX: 0.42, envY: 0.32, centreY: 0.0, r: [0.2, 0.36], base: -0.75, erosion: 0.42, freq: 3.6 },
  // 3: thin wispy puff
  { lobes: 10, envX: 0.62, envY: 0.2, centreY: 0.0, r: [0.14, 0.28], base: -0.7, erosion: 0.7, freq: 3.0, wispy: true },
]

function generateTile(N, recipe, seed) {
  const rand = mulberry32(seed)
  const noise = makeValueNoise(seed * 7 + 3)
  const warpNoise = makeValueNoise(seed * 13 + 5)
  const lobes = []
  for (let i = 0; i < recipe.lobes; i++) {
    // sample inside an ellipse envelope; upper lobes are smaller (cauliflower)
    const a = rand() * Math.PI * 2
    const rr = Math.sqrt(rand())
    const x = Math.cos(a) * rr * recipe.envX
    const y = recipe.centreY + Math.sin(a) * rr * recipe.envY
    const r = (recipe.r[0] + rand() * (recipe.r[1] - recipe.r[0])) * (1 - Math.max(0, y) * 0.45) * (1 - rr * 0.35)
    lobes.push({ x, y, r })
  }

  const out = new Float32Array(N * N)
  const ox = rand() * 100
  const oy = rand() * 100
  for (let j = 0; j < N; j++) {
    const y0 = (j / (N - 1)) * 2 - 1
    for (let i = 0; i < N; i++) {
      const x0 = (i / (N - 1)) * 2 - 1
      // domain warp → irregular, billowing outlines
      const wx = fbm(warpNoise, x0 * 2.2 + 11, y0 * 2.2 + 3, 3) - 0.5
      const wy = fbm(warpNoise, x0 * 2.2 + 41, y0 * 2.2 + 17, 3) - 0.5
      const x = x0 + wx * 0.22
      const y = y0 + wy * 0.22
      // soft union of lobes
      let inv = 1
      for (let k = 0; k < lobes.length; k++) {
        const l = lobes[k]
        const dx = (x - l.x) / l.r
        const dy = (y - l.y) / (l.r * (recipe.wispy ? 0.6 : 0.95))
        const s = Math.max(0, 1 - (dx * dx + dy * dy))
        inv *= 1 - s * Math.sqrt(s)
      }
      let d = 1 - inv
      // flat base
      d *= smooth(recipe.base, recipe.base + 0.3, y)
      // fractal erosion — eats the thin edges much more than the core
      const n = fbm(noise, x * recipe.freq + ox, y * recipe.freq + oy, 6)
      const erode = recipe.erosion * (1.0 + Math.max(0, -y) * 0.3)
      d = d * 1.25 - (1 - n) * erode * (1.1 - d * 0.7)
      // keep borders empty
      const edge = Math.max(Math.abs(x0), Math.abs(y0))
      d *= smooth(1.0, 0.8, edge)
      d = Math.min(1, Math.max(0, d))
      out[j * N + i] = Math.pow(d, 1.15)
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

let cache = null
/** Shared, lazily generated cloud textures. */
export function getCloudTextures(atlasTile = 512) {
  if (!cache) cache = { atlas: buildAtlas(atlasTile), detail: buildDetail(128) }
  return cache
}

export const TILE_COUNT = TILE_RECIPES.length
