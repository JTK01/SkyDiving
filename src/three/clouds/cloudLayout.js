/**
 * Cloud layout configuration + puff generation.
 *
 * Three layers share one instanced, depth-sorted draw call:
 *  - sea        : the endless sea of clouds below the camera
 *  - cumulus    : towering cumulus clusters in the distance
 *  - transition : camera-relative clouds that frame the screen in the intro,
 *                 converge into the centre on START and scatter on login.
 *
 * Every value that shapes the look (position, size, density, direction) lives
 * in CLOUD_CONFIG so the art direction can be tuned without touching code.
 */

export const CLOUD_CONFIG = {
  sea: {
    count: 620,
    x: [-2000, 2000],
    z: [-2700, 320],
    y: [0, 26],
    size: [110, 260],
    flatten: 0.42, // height / width
    alpha: [0.6, 0.9],
    shade: 1, // underside darkening
    tiles: [0, 0, 3, 1, 2],
  },
  cumulus: {
    clusters: [
      { x: -560, y: 20, z: -820, w: 220, h: 300, puffs: 46 },
      { x: 620, y: 10, z: -1150, w: 280, h: 380, puffs: 52 },
      { x: -1250, y: 0, z: -1500, w: 320, h: 340, puffs: 44 },
      { x: 1400, y: 0, z: -700, w: 240, h: 260, puffs: 36 },
      { x: 120, y: 0, z: -1950, w: 380, h: 400, puffs: 46 },
      { x: -260, y: 270, z: -1300, w: 420, h: 70, puffs: 22 }, // high drifting deck
      { x: 760, y: 310, z: -1650, w: 460, h: 60, puffs: 20 },
    ],
    size: [130, 230],
    alpha: [0.6, 0.88],
    shade: 0.9,
    tiles: [1, 0, 1, 2],
    zRange: [-2700, 650], // wrap range when streaming with the wind
  },
  transition: {
    count: 74,
    // normalised screen space: 1 = screen edge
    rest: { ring: [0.9, 1.55], depth: [40, 150], size: [0.6, 1.1], alpha: [0.5, 0.8] },
    converge: { ring: [0.0, 0.55], depth: [10, 36], size: [0.95, 1.75], swirl: 0.55 },
    disperse: { ring: [2.3, 3.4], upBias: 0.45, depthPull: [4, 40], fade: 0.75 },
    shade: 0.55,
    tiles: [2, 0, 2, 1, 3],
  },
}

function makeRng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const lerpR = (rng, [a, b]) => a + (b - a) * rng()
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)]

export const LAYER = { SEA: 0, CUMULUS: 1, TRANSITION: 2 }

/**
 * Build the static description of every puff. Per-frame positions are derived
 * from these + the cinematic parameters in CloudSystem.
 */
export function buildPuffs(scale = 1, config = CLOUD_CONFIG) {
  const rng = makeRng(20261109)
  const puffs = []

  // --- sea --------------------------------------------------------------
  const sea = config.sea
  const seaCount = Math.round(sea.count * scale)
  for (let i = 0; i < seaCount; i++) {
    // denser near the camera, the far field gets compressed by perspective
    const zT = Math.pow(rng(), 0.8)
    const size = lerpR(rng, sea.size) * (scale < 1 ? 1.25 : 1)
    puffs.push({
      layer: LAYER.SEA,
      x: lerpR(rng, sea.x),
      y: lerpR(rng, sea.y),
      z: sea.z[1] - zT * (sea.z[1] - sea.z[0]),
      sx: size,
      sy: size * sea.flatten * lerpR(rng, [0.85, 1.25]),
      alpha: lerpR(rng, sea.alpha),
      seed: rng(),
      tile: pick(rng, sea.tiles),
      shade: sea.shade,
      light: 0.62 + rng() * 0.3,
    })
  }

  // --- cumulus clusters ---------------------------------------------------
  const cu = config.cumulus
  cu.clusters.forEach((c, ci) => {
    const n = Math.max(6, Math.round(c.puffs * (scale < 1 ? 0.6 : 1)))
    for (let i = 0; i < n; i++) {
      const t = rng()
      // narrower towards the top → towering cumulus
      const taper = 1 - t * 0.55
      const size = lerpR(rng, cu.size) * (0.7 + 0.5 * taper)
      const ox = (rng() * 2 - 1) * c.w * 0.5 * taper
      puffs.push({
        layer: LAYER.CUMULUS,
        cluster: ci,
        // higher & sun-facing (+x) puffs are lit, the base sits in shadow
        light: Math.min(1, 0.3 + t * 0.6 + (ox / c.w) * 0.25 + rng() * 0.12),
        x: c.x + ox,
        y: c.y + t * c.h,
        z: c.z + (rng() * 2 - 1) * c.w * 0.35,
        sx: size,
        sy: size * lerpR(rng, [0.75, 1.0]),
        alpha: lerpR(rng, cu.alpha),
        seed: rng(),
        tile: pick(rng, cu.tiles),
        shade: cu.shade,
      })
    }
  })

  // --- camera-relative transition clouds -------------------------------
  const tr = config.transition
  const trCount = Math.round(tr.count * (scale < 1 ? 0.6 : 1))
  for (let i = 0; i < trCount; i++) {
    const theta = (i / trCount) * Math.PI * 2 + rng() * 0.4
    const rRest = lerpR(rng, tr.rest.ring)
    const rConv = Math.sqrt(rng()) * tr.converge.ring[1]
    const convTheta = theta + (rng() - 0.5) * 1.2

    // scatter direction: outward, biased upward & sideways (never straight down)
    let dx = Math.cos(theta)
    let dy = Math.sin(theta)
    if (dy < 0) dy *= 0.25
    dy += tr.disperse.upBias
    const dl = Math.hypot(dx, dy) || 1
    const rDisp = lerpR(rng, tr.disperse.ring)

    const depthConv = lerpR(rng, tr.converge.depth)
    puffs.push({
      layer: LAYER.TRANSITION,
      rest: { x: Math.cos(theta) * rRest, y: Math.sin(theta) * rRest, d: lerpR(rng, tr.rest.depth), s: lerpR(rng, tr.rest.size) },
      conv: { x: Math.cos(convTheta) * rConv, y: Math.sin(convTheta) * rConv, d: depthConv, s: lerpR(rng, tr.converge.size) },
      disp: {
        x: (dx / dl) * rDisp,
        y: (dy / dl) * rDisp,
        d: depthConv - lerpR(rng, tr.disperse.depthPull),
        s: lerpR(rng, tr.converge.size) * 1.25,
      },
      // outer clouds start moving first; central ones open up first
      convDelay: (1 - (rRest - tr.rest.ring[0]) / (tr.rest.ring[1] - tr.rest.ring[0])) * 0.3 + rng() * 0.08,
      dispDelay: (rConv / tr.converge.ring[1]) * 0.3 + rng() * 0.1,
      swirl: (rng() - 0.5) * 2 * tr.converge.swirl,
      flatten: lerpR(rng, [0.62, 0.9]),
      light: Math.min(1, 0.55 + Math.sin(theta) * 0.2 + rng() * 0.25),
      alpha: lerpR(rng, tr.rest.alpha),
      seed: rng(),
      tile: pick(rng, tr.tiles),
      shade: tr.shade,
    })
  }

  return puffs
}
