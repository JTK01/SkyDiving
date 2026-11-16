import * as THREE from 'three'
import { CharacterBuilder, onSurface, wave, ease } from './builder.js'

/**
 * Player avatar (original design after the reference image's proportions:
 * ≈ 4.2 heads tall, round head, simple dot-eye face, short black hair with
 * soft bangs, mitten hands) in skydiving gear: two-tone jumpsuit, soft helmet
 * with goggles on the forehead, gloves, wrist altimeter, harness and the
 * parachute container on the back.
 *
 * Model space: metres, feet at y = 0, facing +z, the character's left = +x.
 * Height 1.6 m. The root bone sits at the hips (body centre for the free fall).
 */
export const PLAYER_HEIGHT = 1.6
export const HIPS = 0.8

const SKIN = '#efc39c'
const HAIR = '#1f1b1d'
const SUIT = '#2c4774' // navy
const SUIT2 = '#e8742c' // orange panels
const WHITE = '#f1ede4'
const GEAR = '#2f3237'
const STRAP = '#3c3f45'
const GLOVE = '#26282c'
const SHOE = '#2b2622'

export function buildPlayer(lod = 0) {
  const b = new CharacterBuilder(lod)
  b.bone('root', null, [0, HIPS, 0])
    .bone('spine', 'root', [0, 0.92, 0])
    .bone('chest', 'spine', [0, 1.06, 0])
    .bone('head', 'chest', [0, 1.2, 0])
    .bone('armL', 'chest', [0.2, 1.15, 0])
    .bone('foreL', 'armL', [0.23, 0.92, 0])
    .bone('armR', 'chest', [-0.2, 1.15, 0])
    .bone('foreR', 'armR', [-0.23, 0.92, 0])
    .bone('legL', 'root', [0.085, 0.74, 0])
    .bone('shinL', 'legL', [0.09, 0.4, 0])
    .bone('legR', 'root', [-0.085, 0.74, 0])
    .bone('shinR', 'legR', [-0.09, 0.4, 0])

  // ---- head: round, slightly wide; face on the +z side --------------------
  const HC = [0, 1.39, 0.01]
  const HR = [0.205, 0.195, 0.19]
  b.ellipsoid(HR, { pos: HC, bone: 'head', color: SKIN }, 28, 20)
  for (const s of [-1, 1]) b.ellipsoid([0.035, 0.05, 0.03], { pos: [s * 0.2, 1.38, 0.0], bone: 'head', color: SKIN, detail: true }, 8, 6) // ears
  // hair: crown cap, back, soft bangs and side tufts (black)
  b.ellipsoid([0.215, 0.13, 0.205], { pos: [0, 1.48, -0.01], bone: 'head', color: HAIR }, 24, 12)
  b.ellipsoid([0.2, 0.17, 0.12], { pos: [0, 1.4, -0.09], bone: 'head', color: HAIR }, 18, 12)
  ;[[-0.11, 0.06], [-0.035, 0.08], [0.045, 0.075], [0.12, 0.05]].forEach(([x, dy], i) => {
    b.ellipsoid([0.075, 0.06, 0.035], { pos: onSurface(HC, [0.21, 0.2, 0.195], [x * 4.5, 1.0 + dy * 2, 1.1]), rot: [0.5, 0, (i - 1.5) * 0.25], bone: 'head', color: HAIR }, 10, 8)
  })
  for (const s of [-1, 1]) b.ellipsoid([0.04, 0.09, 0.05], { pos: [s * 0.185, 1.38, 0.05], bone: 'head', color: HAIR, detail: true }, 8, 6)
  // soft helmet (navy shell on the crown) and goggles pushed up on the forehead
  b.ellipsoid([0.222, 0.1, 0.212], { pos: [0, 1.53, -0.02], bone: 'head', color: SUIT }, 24, 10)
  b.torus(0.205, 0.012, { pos: [0, 1.5, -0.005], rot: [Math.PI / 2 + 0.18, 0, 0], bone: 'head', color: GEAR }, 24, 4)
  for (const s of [-1, 1]) {
    b.ellipsoid([0.055, 0.035, 0.03], { pos: onSurface([0, 1.5, 0], [0.215, 0.13, 0.21], [s * 0.42, 0.75, 1]), rot: [-0.6, s * 0.35, 0], bone: 'head', color: '#5d8fb8' }, 12, 8)
  }
  // face: dot eyes, brows, small smile, blush
  for (const s of [-1, 1]) {
    b.ellipsoid([0.019, 0.028, 0.012], { pos: onSurface(HC, HR, [s * 0.33, 0.03, 1]), rot: [0, s * 0.33, 0], bone: 'head', color: '#141214' }, 10, 8)
    b.ellipsoid([0.006, 0.008, 0.004], { pos: onSurface(HC, [HR[0] + 0.003, HR[1], HR[2] + 0.003], [s * 0.31, 0.07, 1]), bone: 'head', color: '#ffffff', detail: true }, 6, 4)
    b.box(0.045, 0.009, 0.01, { pos: onSurface(HC, [HR[0] + 0.002, HR[1], HR[2] + 0.002], [s * 0.34, 0.26, 1]), rot: [-0.25, s * 0.33, s * -0.12], bone: 'head', color: '#2a2224', detail: true })
    b.ellipsoid([0.032, 0.016, 0.006], { pos: onSurface(HC, [HR[0] + 0.001, HR[1], HR[2] + 0.001], [s * 0.52, -0.2, 1]), rot: [0, s * 0.5, 0], bone: 'head', color: '#f2a29a', detail: true }, 10, 6)
  }
  b.torus(0.022, 0.004, { pos: onSurface(HC, [HR[0] + 0.002, HR[1], HR[2] + 0.002], [0, -0.38, 1]), rot: [0.3, 0, Math.PI], bone: 'head', color: '#7a3a34', detail: true }, 10, 3, Math.PI)
  b.cyl(0.055, 0.06, 0.08, { pos: [0, 1.2, 0], bone: 'chest', color: SKIN }, 10)

  // ---- torso: jumpsuit with orange side panels, collar, harness ----------
  b.lathe([[0.001, 0.74], [0.17, 0.77], [0.185, 0.86], [0.18, 0.95], [0.19, 1.06], [0.19, 1.13], [0.13, 1.19], [0.001, 1.2]], { bone: 'spine', color: SUIT }, 20)
  for (const s of [-1, 1]) b.box(0.03, 0.34, 0.12, { pos: [s * 0.185, 0.98, 0], bone: 'spine', color: SUIT2 })
  b.torus(0.075, 0.018, { pos: [0, 1.185, 0.01], rot: [Math.PI / 2, 0, 0], bone: 'chest', color: WHITE }, 16, 5)
  // harness: shoulder straps, chest strap with buckle, leg loops
  for (const s of [-1, 1]) b.box(0.045, 0.36, 0.02, { pos: [s * 0.085, 1.0, 0.185], rot: [0.12, 0, s * 0.08], bone: 'spine', color: STRAP })
  b.box(0.24, 0.035, 0.02, { pos: [0, 1.05, 0.192], bone: 'spine', color: STRAP })
  b.box(0.05, 0.045, 0.025, { pos: [0, 1.05, 0.205], bone: 'spine', color: '#9aa0a6', detail: true })
  // container (parachute pack) on the back, with the pilot-chute handle
  b.box(0.32, 0.42, 0.13, { pos: [0, 0.98, -0.22], bone: 'spine', color: GEAR })
  b.capsule(0.065, 0.24, { pos: [0, 1.0, -0.285], rot: [0, 0, Math.PI / 2], bone: 'spine', color: GEAR, detail: true }, 8)
  b.box(0.28, 0.04, 0.02, { pos: [0, 1.17, -0.29], bone: 'spine', color: SUIT2 })
  b.ellipsoid([0.025, 0.025, 0.012], { pos: [0.1, 0.8, -0.29], bone: 'spine', color: SUIT2, detail: true }, 8, 6)

  // ---- arms: sleeves, gloves, altimeter on the left wrist ----------------
  for (const [s, arm, fore] of [[1, 'armL', 'foreL'], [-1, 'armR', 'foreR']]) {
    b.capsule(0.068, 0.17, { pos: [s * 0.225, 1.035, 0], rot: [0, 0, s * 0.1], bone: arm, color: SUIT })
    b.capsule(0.062, 0.16, { pos: [s * 0.24, 0.81, 0], bone: fore, color: SUIT })
    b.box(0.03, 0.12, 0.05, { pos: [s * 0.275, 0.84, 0], bone: fore, color: SUIT2, detail: true })
    b.ellipsoid([0.055, 0.065, 0.05], { pos: [s * 0.24, 0.66, 0.005], bone: fore, color: GLOVE }, 12, 10)
  }
  b.cyl(0.035, 0.035, 0.02, { pos: [0.262, 0.74, 0.03], rot: [0, 0, Math.PI / 2], bone: 'foreL', color: '#16181b' }, 12)
  b.cyl(0.026, 0.026, 0.004, { pos: [0.274, 0.74, 0.03], rot: [0, 0, Math.PI / 2], bone: 'foreL', color: '#cfd9a6', detail: true }, 12)
  // V sign fingers on the right hand (they show in the photo pose)
  for (const dz of [-0.015, 0.015]) b.capsule(0.012, 0.05, { pos: [-0.24, 0.6, 0.02 + dz], rot: [0, 0, dz * 8], bone: 'foreR', color: GLOVE, detail: true }, 6)

  // ---- legs: suit, leg straps, shoes --------------------------------------
  for (const [s, leg, shin] of [[1, 'legL', 'shinL'], [-1, 'legR', 'shinR']]) {
    b.capsule(0.088, 0.2, { pos: [s * 0.09, 0.57, 0], bone: leg, color: SUIT })
    b.torus(0.092, 0.016, { pos: [s * 0.09, 0.62, 0], rot: [Math.PI / 2, 0, 0], bone: leg, color: STRAP }, 14, 4)
    b.capsule(0.08, 0.22, { pos: [s * 0.09, 0.22, 0], bone: shin, color: SUIT })
    b.ellipsoid([0.07, 0.055, 0.11], { pos: [s * 0.09, 0.045, 0.03], bone: shin, color: SHOE }, 12, 8)
  }
  return b.build()
}

// ---------------------------------------------------------------------------
// animations: pose(t, duration) → { bone: { r: [x, y, z], p: [dx, dy, dz] } }
// rotation x > 0 swings a hanging limb backward, z > 0 raises the left arm
// (+x) sideways (and lowers the right one).
// ---------------------------------------------------------------------------
export const PLAYER_CLIPS = {
  idle: {
    duration: 4,
    pose: (t) => ({
      spine: { r: [0.02 * wave(t, 4), 0, 0] },
      chest: { r: [0.025 * wave(t, 2), 0, 0] },
      head: { r: [0.04 * wave(t, 4, 0.3), 0.25 * wave(t, 8), 0] },
      armL: { r: [0.04 * wave(t, 2, 0.5), 0, 0.08] },
      armR: { r: [0.04 * wave(t, 2, 0.5), 0, -0.08] },
      foreL: { r: [-0.15, 0, 0] },
      foreR: { r: [-0.15, 0, 0] },
    }),
  },
  walk: {
    duration: 0.9,
    pose: (t, d) => {
      const s = wave(t, d)
      const c = wave(t, d, 0.5)
      return {
        root: { p: [0, 0.025 * Math.abs(c), 0], r: [0.04, 0.06 * s, 0] },
        chest: { r: [0, -0.1 * s, 0] },
        head: { r: [-0.03, 0.06 * s, 0] },
        legL: { r: [-0.5 * s, 0, 0] },
        legR: { r: [0.5 * s, 0, 0] },
        shinL: { r: [Math.max(0, 0.75 * c), 0, 0] },
        shinR: { r: [Math.max(0, -0.75 * c), 0, 0] },
        armL: { r: [0.45 * s, 0, 0.1] },
        armR: { r: [-0.45 * s, 0, -0.1] },
        foreL: { r: [-0.35 - 0.2 * Math.max(0, -s), 0, 0] },
        foreR: { r: [-0.35 - 0.2 * Math.max(0, s), 0, 0] },
      }
    },
  },
  // free fall: box position, belly to earth, arched back, knees bent
  freefall: {
    duration: 1.6,
    pose: (t) => {
      const f = 0.05 * wave(t, 0.4) // flutter
      return {
        root: { r: [Math.PI / 2 - 0.08, 0, 0] },
        spine: { r: [-0.18, 0, 0] },
        chest: { r: [-0.1, 0, 0] },
        head: { r: [-0.55, 0, 0] }, // looking ahead (toward the ground ahead)
        armL: { r: [-0.15, 0, 1.35 + f] },
        armR: { r: [-0.15, 0, -1.35 - f] },
        foreL: { r: [0, 0, 1.15] },
        foreR: { r: [0, 0, -1.15] },
        legL: { r: [0.15, 0, 0.28] },
        legR: { r: [0.15, 0, -0.28] },
        shinL: { r: [1.15 + f, 0, 0] },
        shinR: { r: [1.15 - f, 0, 0] },
      }
    },
  },
  // under canopy: hanging upright, hands up on the toggles, legs dangling
  canopy: {
    duration: 3,
    pose: (t) => ({
      root: { r: [0.06 * wave(t, 3), 0, 0.04 * wave(t, 3, 0.5)] },
      head: { r: [-0.15, 0, 0] },
      armL: { r: [-0.25, 0, 2.55] },
      armR: { r: [-0.25, 0, -2.55] },
      foreL: { r: [0, 0, 0.35] },
      foreR: { r: [0, 0, -0.35] },
      legL: { r: [-0.25 + 0.1 * wave(t, 3), 0, 0.06] },
      legR: { r: [-0.2 + 0.1 * wave(t, 3, 0.4), 0, -0.06] },
      shinL: { r: [0.35, 0, 0] },
      shinR: { r: [0.3, 0, 0] },
    }),
  },
  // touchdown: flare (hands down), knees absorb, stand up
  landing: {
    duration: 1.2,
    loop: false,
    pose: (t) => {
      const flare = ease(t / 0.25)
      const crouch = ease((t - 0.15) / 0.25) * (1 - ease((t - 0.6) / 0.5))
      return {
        root: { p: [0, -0.22 * crouch, 0], r: [0.25 * crouch, 0, 0] },
        head: { r: [-0.2 * crouch, 0, 0] },
        armL: { r: [-0.6 * crouch, 0, 2.55 * (1 - flare) + 0.25] },
        armR: { r: [-0.6 * crouch, 0, -2.55 * (1 - flare) - 0.25] },
        foreL: { r: [-0.4 * crouch, 0, 0] },
        foreR: { r: [-0.4 * crouch, 0, 0] },
        legL: { r: [-0.85 * crouch, 0, 0.05] },
        legR: { r: [-0.85 * crouch, 0, -0.05] },
        shinL: { r: [1.4 * crouch, 0, 0] },
        shinR: { r: [1.4 * crouch, 0, 0] },
      }
    },
  },
  // photo pose: V sign by the face, other hand on the hip, head tilt
  photo: {
    duration: 2.5,
    pose: (t) => {
      const k = ease(t / 0.35)
      return {
        root: { r: [0, 0.25 * k, 0.04 * k] },
        chest: { r: [0, -0.1 * k, 0] },
        head: { r: [0.05 * k, -0.12 * k, -0.16 * k + 0.02 * wave(t, 2.5)] },
        armR: { r: [-1.25 * k, 0, -0.35 * k] },
        foreR: { r: [-1.9 * k, 0, 0.3 * k] },
        armL: { r: [0.15 * k, 0, 0.55 * k] },
        foreL: { r: [-1.2 * k, 0, -0.9 * k] },
        legL: { r: [0, 0, 0.08 * k] },
        legR: { r: [0.1 * k, 0, -0.04 * k] },
      }
    },
  },
}

/**
 * Ram-air canopy, 9 cells, above the player (root frame, metres): span 7 m,
 * chord 2.6 m, anhedral arc; plus suspension lines to the risers. Returns
 * { canopy: Mesh, lines: LineSegments } built with the given materials.
 */
export function buildCanopy(lod = 0) {
  const cells = 9
  const span = 7
  const chord = 2.6
  const parts = []
  const cols = ['#f1ede4', '#e8742c', '#2c4774']
  const color = new THREE.Color()
  const top = 5.4 // above the hips
  for (let k = 0; k < cells; k++) {
    const u = (k + 0.5) / cells - 0.5
    const x = u * span
    const y = top - 1.3 * (2 * u) ** 2
    const roll = -u * 0.9
    // airfoil-ish cell: thick at the front, thin at the trailing edge
    const g = new THREE.BoxGeometry(span / cells - 0.03, 0.34, chord, 1, 1, lod === 0 ? 4 : 1)
    const p = g.attributes.position
    for (let v = 0; v < p.count; v++) {
      const z = p.getZ(v) / chord + 0.5 // 0 trailing … 1 leading
      p.setY(v, p.getY(v) * (0.25 + 0.75 * Math.sin(Math.PI * Math.min(1, z * 0.9 + 0.1))) + 0.06 * Math.sin(Math.PI * z))
    }
    g.computeVertexNormals()
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, 0.2), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.08, 0, roll)), new THREE.Vector3(1, 1, 1)))
    const c = new Float32Array(p.count * 3)
    color.set(cols[k === 4 ? 1 : k % 3 === 2 ? 2 : 0]).toArray(c, 0)
    for (let v = 0; v < p.count; v++) color.toArray(c, v * 3)
    g.setAttribute('color', new THREE.BufferAttribute(c, 3))
    g.deleteAttribute('uv')
    parts.push(g)
  }
  // suspension lines: 4 rows (A–D) per rib to the two risers at the shoulders
  const line = []
  for (let k = 0; k <= cells; k++) {
    const u = k / cells - 0.5
    const x = u * span
    const y = top - 1.3 * (2 * u) ** 2 - 0.18
    for (const z of [1.2, 0.5, -0.2, -0.9]) {
      const rx = (u < 0 ? -1 : 1) * 0.2
      line.push(x, y, z, rx, 0.55, 0)
    }
  }
  return { parts, line: new Float32Array(line) }
}
