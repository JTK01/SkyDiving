/**
 * Cloud layout configuration + puff generation.
 *
 * Three layers share one instanced, depth-sorted draw call:
 *  - sea        : the endless sea of clouds below the camera
 *  - cumulus    : towering cumulus clusters in the distance
 *  - transition : camera-relative cloud bodies on foreground / midground /
 *                 background layers that frame the intro, drift toward the
 *                 centre on START and scatter on login (parallax by depth).
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
    size: [120, 240],
    flatten: 0.42, // height / width
    alpha: [0.75, 0.95],
    shade: 1, // underside darkening
    tiles: [0, 0, 3, 1, 2],
  },
  cumulus: {
    clusters: [
      { x: -560, y: 20, z: -820, w: 220, h: 300, puffs: 46 },
      { x: 620, y: 10, z: -1150, w: 280, h: 380, puffs: 52 },
      { x: -1250, y: 0, z: -1500, w: 320, h: 340, puffs: 44 },
      { x: 1400, y: 0, z: -760, w: 240, h: 260, puffs: 36 },
      { x: 120, y: 0, z: -1950, w: 380, h: 400, puffs: 46 },
      { x: -260, y: 270, z: -1300, w: 420, h: 70, puffs: 22 }, // high drifting deck
      { x: 760, y: 310, z: -1650, w: 460, h: 60, puffs: 20 },
    ],
    size: [160, 260],
    alpha: [0.75, 0.95],
    shade: 0.9,
    tiles: [1, 0, 1, 2],
    // wrap range when streaming with the wind — ends well in front of the
    // camera (intro z≈60, world z≈-140) so towers never engulf the view
    zRange: [-2900, -380],
  },
  /**
   * Camera-relative transition clouds, built as individual cloud *bodies*
   * (several puffs each) on three depth layers. Positions are normalised
   * screen coordinates (1 = screen edge) at the cloud's depth; sizes are a
   * fraction of the screen height at the *rest* depth and then stay fixed in
   * world units, so approaching the camera grows them by real perspective.
   *
   *  pull     : how far toward the centre a cloud travels (0 = to the centre)
   *  approach : depth multiplier when converged (camera "enters" the bank)
   *  speed    : >1 finishes earlier; delay: start offset (0..1 of the timeline)
   */
  transition: {
    shade: 0.55,
    layers: {
      background: {
        clouds: 16, puffs: [3, 5], ring: [0.86, 1.4], depth: [190, 290], size: [0.2, 0.34],
        pull: [0.5, 0.78], approach: [0.72, 0.85], speed: [0.85, 1.0], delay: [0.0, 0.12],
        curl: 0.12, spin: 0.06, alpha: [0.82, 0.95],
        disperse: { ring: [2.0, 2.8], approach: 0.95, speed: [0.75, 0.9], delay: [0.12, 0.25] },
      },
      midground: {
        clouds: 22, puffs: [4, 6], ring: [0.86, 1.35], depth: [80, 135], size: [0.3, 0.48],
        pull: [0.15, 0.6], approach: [0.45, 0.6], speed: [1.0, 1.2], delay: [0.0, 0.16],
        curl: 0.22, spin: 0.12, alpha: [0.95, 1],
        disperse: { ring: [2.7, 3.6], approach: 0.75, speed: [0.95, 1.15], delay: [0.04, 0.16] },
      },
      foreground: {
        clouds: 7, puffs: [3, 4], ring: [1.0, 1.4], depth: [30, 46], size: [0.38, 0.55],
        pull: [0.4, 0.7], approach: [0.55, 0.68], speed: [1.25, 1.45], delay: [0.3, 0.42],
        curl: 0.3, spin: 0.16, alpha: [0.97, 1],
        disperse: { ring: [3.2, 4.2], approach: 0.6, speed: [1.1, 1.3], delay: [0.0, 0.06] },
      },
    },
    upBias: 0.5, // scatter direction: up & sideways, never straight down
    tiles: [0, 1, 2, 0, 1],
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
  const layerScale = scale < 1 ? 0.6 : 1
  Object.entries(tr.layers).forEach(([name, L]) => {
    const n = Math.max(3, Math.round(L.clouds * layerScale))
    for (let i = 0; i < n; i++) {
      // spread around the frame; slight upward bias keeps the title area clear
      const theta = (i / n) * Math.PI * 2 + (rng() - 0.5) * 0.9
      const rRest = lerpR(rng, L.ring)
      const rest = { x: Math.cos(theta) * rRest, y: Math.sin(theta) * rRest * 0.95, d: lerpR(rng, L.depth) }

      const pull = lerpR(rng, L.pull)
      const conv = {
        x: rest.x * pull + (rng() - 0.5) * 0.18,
        y: rest.y * pull + (rng() - 0.5) * 0.16,
        d: rest.d * lerpR(rng, L.approach),
      }

      // scatter outward from where it ended up, biased up & sideways
      let dx = conv.x + (rng() - 0.5) * 0.5
      let dy = conv.y
      if (dy < 0) dy *= 0.3
      dy += tr.upBias
      const dl = Math.hypot(dx, dy) || 1
      const rDisp = lerpR(rng, L.disperse.ring)
      const disp = { x: (dx / dl) * rDisp, y: (dy / dl) * rDisp, d: conv.d * L.disperse.approach }

      // curved paths: control points pushed sideways from the straight line
      const curve = (a, b, k) => {
        const mx = (a.x + b.x) / 2
        const my = (a.y + b.y) / 2
        const px = -(b.y - a.y)
        const py = b.x - a.x
        const s = (rng() - 0.5) * 2 * k
        return { x: mx + px * s, y: my + py * s }
      }

      const cloud = {
        layer: name,
        rest,
        conv,
        disp,
        ctrlC: curve(rest, conv, L.curl),
        ctrlD: curve(conv, disp, L.curl * 0.8),
        // world size fixed from the rest framing → perspective growth on approach
        sizeNorm: lerpR(rng, L.size),
        delayC: lerpR(rng, L.delay),
        speedC: lerpR(rng, L.speed),
        delayD: lerpR(rng, L.disperse.delay),
        speedD: lerpR(rng, L.disperse.speed),
        rot0: (rng() - 0.5) * 0.12,
        spinC: (rng() - 0.5) * 2 * L.spin,
        spinD: (rng() - 0.5) * 2 * L.spin * 1.4,
        grow: lerpR(rng, [0.0, 0.12]),
        wobble: rng() * 100,
        frame: -1,
        state: { x: 0, y: 0, d: 0, ang: 0, scale: 1, ci: 0, pi: 0 },
      }

      // cumulus body: wide flat base, smaller billows stacked on top
      const np = Math.round(lerpR(rng, L.puffs))
      for (let k = 0; k < np; k++) {
        const top = rng()
        const oy = -0.22 + top * 0.55
        const ox = (rng() * 2 - 1) * (0.62 - top * 0.3)
        puffs.push({
          layer: LAYER.TRANSITION,
          cloud,
          ox,
          oy,
          oz: (rng() * 2 - 1) * 0.22,
          size: lerpR(rng, [0.55, 0.85]) * (1 - top * 0.3),
          flatten: lerpR(rng, [0.7, 0.92]),
          light: Math.min(1, 0.38 + top * 0.5 + ox * 0.18 + rng() * 0.12),
          alpha: lerpR(rng, L.alpha),
          rot: (rng() - 0.5) * 0.5,
          seed: rng(),
          tile: pick(rng, tr.tiles),
          shade: tr.shade,
        })
      }
    }
  })

  return puffs
}
