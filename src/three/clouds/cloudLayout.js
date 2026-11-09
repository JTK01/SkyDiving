/**
 * Cloud layout configuration + puff generation.
 *
 * Three layers share one instanced, depth-sorted draw call:
 *  - sea        : the endless sea of clouds below the camera
 *  - cumulus    : towering cumulus clusters in the distance
 *  - transition : large cumulus bodies on foreground / midground /
 *                 background layers framing the intro, plus one *hero* cloud
 *                 on the flight path that the camera flies into on START and
 *                 out of on login. Laid out in the intro camera's frame and
 *                 then fixed in the world, so the camera's own motion gives
 *                 the parallax and the fly-through.
 *
 * Every value that shapes the look (position, size, density, direction) lives
 * in CLOUD_CONFIG so the art direction can be tuned without touching code.
 */

export const CLOUD_CONFIG = {
  sea: {
    // fewer, much larger puffs → one continuous deck instead of dots
    count: 230,
    x: [-2100, 2100],
    z: [-2700, 660], // extends behind the (moved back) intro camera
    y: [0, 22],
    size: [300, 560],
    flatten: 0.34, // height / width
    alpha: [0.75, 0.95],
    shade: 1, // underside darkening
    tiles: [0, 0, 3, 1, 2],
  },
  cumulus: {
    clusters: [
      { x: -560, y: 20, z: -820, w: 220, h: 300, puffs: 18 },
      { x: 620, y: 10, z: -1150, w: 280, h: 380, puffs: 22 },
      { x: -1250, y: 0, z: -1500, w: 320, h: 340, puffs: 18 },
      { x: 1400, y: 0, z: -760, w: 240, h: 260, puffs: 14 },
      { x: 120, y: 0, z: -1950, w: 380, h: 400, puffs: 20 },
      { x: -260, y: 270, z: -1300, w: 420, h: 70, puffs: 9 }, // high drifting deck
      { x: 760, y: 310, z: -1650, w: 460, h: 60, puffs: 8 },
    ],
    size: [230, 340],
    spread: 0.32, // horizontal spread as a fraction of w (was 0.5 → loose)
    alpha: [0.75, 0.95],
    shade: 0.9,
    tiles: [1, 0, 1, 2],
    // wrap range when streaming with the wind — ends well in front of the
    // camera (intro z≈60, world z≈-140) so towers never engulf the view
    zRange: [-2900, -380],
  },
  /**
   * Transition cloud bodies. Positions are normalised screen coordinates of
   * the *intro* camera (1 = screen edge) at the body's depth; sizes are a
   * fraction of the intro screen height at that depth. The layout is then
   * fixed in the world (see cine.anchorMatrix), so flying the camera forward
   * makes nearer bodies sweep past faster than far ones.
   *
   * Each body is one connected cumulus: 8–14 heavily overlapping puffs in
   * rows — a wide flat base, smaller billows stacked above.
   *  pull / approach : converge (START) — kept subtle, the camera does the work
   *  disperse        : gentle outward drift on login, fades once off-screen
   */
  transition: {
    shade: 0.55,
    layers: {
      background: {
        clouds: 6, puffs: [8, 11], ring: [0.86, 1.35], depth: [200, 300], size: [0.3, 0.42],
        pull: [0.88, 0.96], approach: [0.97, 1.0], speed: [0.85, 1.0], delay: [0.0, 0.12],
        curl: 0.06, spin: 0.03, alpha: [0.9, 1], thickness: 0.18,
        disperse: { ring: [1.6, 2.2], approach: 1.0, speed: [0.72, 0.95], delay: [0.1, 0.36] },
      },
      midground: {
        clouds: 8, puffs: [10, 14], ring: [0.95, 1.4], depth: [90, 150], size: [0.42, 0.6],
        pull: [0.85, 0.95], approach: [0.95, 1.0], speed: [1.0, 1.2], delay: [0.0, 0.16],
        curl: 0.08, spin: 0.05, alpha: [0.96, 1], thickness: 0.2,
        disperse: { ring: [2.0, 2.8], approach: 1.0, speed: [0.85, 1.25], delay: [0.0, 0.3] },
      },
      foreground: {
        clouds: 3, puffs: [9, 12], ring: [1.1, 1.45], depth: [40, 60], size: [0.55, 0.7],
        pull: [0.9, 0.97], approach: [1.0, 1.0], speed: [1.0, 1.2], delay: [0.1, 0.2],
        curl: 0.08, spin: 0.05, alpha: [0.97, 1], thickness: 0.22,
        disperse: { ring: [2.4, 3.0], approach: 1.0, speed: [1.05, 1.35], delay: [0.0, 0.12] },
      },
    },
    /**
     * The cloud the camera flies into, straight ahead of the intro camera.
     * Its centre sits ~0.1 S above the flight altitude, so the camera passes
     * through the wide, flat lower rows (a cumulus narrows toward the top —
     * flying through the middle would leave sky in the upper corners). Built as complete cumulus faces ("slices") stacked
     * along the flight path, so from the approach until the camera leaves the
     * last slice there is always a full cloud face filling the view ahead.
     *  depth  : distance from the intro camera to the body centre (world units)
     *  size   : body size S as a fraction of the intro screen height there
     *  slices : slice offsets along the view axis, in units of S
     *  puffSize : puff size multiplier — the slices must be solid walls of
     *             vapor (no sky between puffs) when seen from inside
     */
    hero: {
      x: 0, y: -0.18, depth: 230, size: 0.65,
      slices: [-0.5, -0.25, 0, 0.25, 0.5],
      // exit side (−) thins out into translucent wisps, entry side (+) solid
      sliceAlpha: [0.4, 0.72, 1, 1, 1],
      // depth jitter per slice (units of S): the thin exit wisps are spread
      // out so the camera passes them one by one, not all in one frame
      sliceDepth: [0.22, 0.12, 0.04, 0.04, 0.04],
      puffsPerSlice: 18, puffSize: 1.35, alpha: [0.98, 1],
    },
    upBias: 0.22, // scatter direction: mostly sideways & up, never straight down
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
    const n = Math.max(6, Math.round(c.puffs * (scale < 1 ? 0.75 : 1)))
    for (let i = 0; i < n; i++) {
      const t = rng()
      // narrower towards the top → towering cumulus
      const taper = 1 - t * 0.55
      const size = lerpR(rng, cu.size) * (0.7 + 0.5 * taper)
      const ox = (rng() * 2 - 1) * c.w * cu.spread * taper
      puffs.push({
        layer: LAYER.CUMULUS,
        cluster: ci,
        // higher & sun-facing (+x) puffs are lit, the base sits in shadow
        light: Math.min(1, 0.3 + t * 0.6 + (ox / c.w) * 0.25 + rng() * 0.12),
        x: c.x + ox,
        y: c.y + t * c.h,
        z: c.z + (rng() * 2 - 1) * c.w * 0.2,
        sx: size,
        sy: size * lerpR(rng, [0.75, 1.0]),
        alpha: lerpR(rng, cu.alpha),
        seed: rng(),
        tile: pick(rng, cu.tiles),
        shade: cu.shade,
      })
      // same idea as the transition bodies: light = 0.3 + 0.6·(height / h)
      const q = puffs[puffs.length - 1]
      q.slope = (q.sy * 0.5 * 0.6) / c.h
      q.light = Math.min(1, 0.3 + t * 0.6 + (ox / c.w) * 0.2)
    }
  })

  // --- transition cloud bodies -------------------------------------------
  const tr = config.transition
  const layerScale = scale < 1 ? 0.6 : 1
  const puffScale = scale < 1 ? 0.75 : 1

  /**
   * One connected cumulus body. Puffs are laid out in rows (in units of the
   * body size S): a wide, flat, slightly darker base and progressively
   * narrower, smaller billows on top. Neighbouring puffs are ~0.15–0.2 S apart
   * but ~0.4–0.6 S wide, so they overlap heavily and read as one silhouette.
   */
  const BODY_LIGHT_PER_S = (0.9 - 0.42) / (0.25 + 0.2) // light rise per body size S
  const BODY_ROWS = [
    // share of puffs, row height (oy), half-width, puff size, flatten, light
    { share: 0.38, oy: -0.2, half: 0.4, size: [0.5, 0.6], flat: [0.62, 0.72], light: 0.42 },
    { share: 0.3, oy: -0.04, half: 0.3, size: [0.44, 0.54], flat: [0.75, 0.88], light: 0.62 },
    { share: 0.2, oy: 0.12, half: 0.2, size: [0.38, 0.47], flat: [0.8, 0.92], light: 0.78 },
    { share: 0.12, oy: 0.25, half: 0.1, size: [0.3, 0.38], flat: [0.82, 0.95], light: 0.9 },
  ]
  // the hero's slices are seen from inside, where a narrow cumulus top would
  // leave sky in the upper corners (worst on tall portrait screens): same
  // structure, but the upper rows stay wide
  const WALL_ROWS = BODY_ROWS.map((r, i) => ({ ...r, half: [0.44, 0.42, 0.38, 0.34][i], share: [0.3, 0.27, 0.23, 0.2][i] }))
  function pushBody(cloud, count, thickness, alphaRange, sizeMul = 1, rows = BODY_ROWS) {
    const n = Math.max(6, count)
    let made = 0
    rows.forEach((row, ri) => {
      const k = ri === rows.length - 1 ? n - made : Math.max(1, Math.round(n * row.share))
      for (let j = 0; j < k; j++) {
        // evenly spaced across the row with a little jitter → no gaps
        const u = k === 1 ? 0 : (j / (k - 1)) * 2 - 1
        const ox = u * row.half + (rng() - 0.5) * 0.06
        const oy = row.oy + (rng() - 0.5) * 0.05
        puffs.push({
          layer: LAYER.TRANSITION,
          cloud,
          ox,
          oy,
          oz: (rng() * 2 - 1) * thickness,
          size: lerpR(rng, row.size) * sizeMul,
          flatten: lerpR(rng, row.flat),
          light: Math.min(1, row.light + ox * 0.12 + (rng() - 0.5) * 0.02),
          alpha: lerpR(rng, alphaRange),
          rot: (rng() - 0.5) * 0.25,
          seed: rng(),
          tile: pick(rng, tr.tiles),
          shade: tr.shade,
        })
      }
      made += k
    })
    // light keeps rising with height *inside* each puff at the same rate as
    // across the rows (≈1.07 light per S), so overlapping puffs continue each
    // other's shading instead of meeting at a step → one continuous body
    for (let i = puffs.length - n; i < puffs.length; i++) {
      const q = puffs[i]
      q.slope = q.size * q.flatten * 0.5 * BODY_LIGHT_PER_S
    }
  }
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

      pushBody(cloud, Math.round(lerpR(rng, L.puffs) * puffScale), L.thickness, L.alpha)
    }
  })

  // --- the hero cloud on the flight path ---------------------------------
  const H = tr.hero
  const heroPos = { x: H.x, y: H.y, d: H.depth }
  const hero = {
    layer: 'hero',
    rest: heroPos,
    conv: heroPos,
    disp: heroPos,
    ctrlC: heroPos,
    ctrlD: heroPos,
    sizeNorm: H.size,
    delayC: 0,
    speedC: 1,
    // never moves; fades only at the very end of the dispersal, long after
    // the camera has flown out of it (pi = 1 at disperse = 1)
    delayD: 0.6,
    speedD: 2.5,
    rot0: 0,
    spinC: 0,
    spinD: 0,
    grow: 0,
    wobble: rng() * 100,
    frame: -1,
    state: { x: 0, y: 0, d: 0, ang: 0, scale: 1, ci: 0, pi: 0 },
  }
  H.slices.forEach((oz, si) => {
    const before = puffs.length
    const k = H.sliceAlpha[si]
    pushBody(hero, Math.round(H.puffsPerSlice * puffScale), H.sliceDepth[si], [H.alpha[0] * k, H.alpha[1] * k], H.puffSize, WALL_ROWS)
    for (let i = before; i < puffs.length; i++) puffs[i].oz = oz + puffs[i].oz
  })

  return puffs
}
