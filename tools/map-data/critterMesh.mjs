/**
 * Critter bodies (offline): a smooth signed-distance body per species — round
 * cones and ellipsoids joined with a smooth minimum — meshed with surface nets
 * and simplified (meshoptimizer) to two levels. Per vertex: bone pair + weight
 * (vertex-shader animation), body zone (painted outfits), colour code (main /
 * light / marking fur, fixed colour, garment colours) with the fixed colour,
 * prop id, face coordinates (the face is drawn by the shader) and a fur flag.
 * See src/map/characters/critters.js for the species and the conventions.
 */
import { MeshoptSimplifier } from 'meshoptimizer'
import { roundCone, ellipsoid, smin, surfaceNets } from '../../src/map/characters/sdf.js'
import { SPECIES, BONE, ZONE, PROP, PIVOTS, TOP } from '../../src/map/characters/critters.js'
import { garmentPieces, GARMENT_BOX } from './garments.mjs'

const MAIN = 0
const LIGHT = 1
const MARK = 2
const FIXED = 3
const GARB = 4 // garment top colour
const GARC = 5 // garment bottom colour

const hex = (h) => {
  const n = parseInt(h.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s]
const len = (a) => Math.hypot(a[0], a[1], a[2])
const mirror = (p) => [-p[0], p[1], p[2]]

/** a field squashed along its local axes (scale s about centre c) — slightly conservative distance */
function squash(f, c, s) {
  const k = Math.min(...s)
  return (p) => f(add(c, [(p[0] - c[0]) / s[0], (p[1] - c[1]) / s[1], (p[2] - c[2]) / s[2]])) * k
}
/** rotate a field about centre c by Euler (x then y then z), p → local */
function rotated(f, c, [rx, ry, rz]) {
  const cx = Math.cos(-rx), sx = Math.sin(-rx), cy = Math.cos(-ry), sy = Math.sin(-ry), cz = Math.cos(-rz), sz = Math.sin(-rz)
  return (p) => {
    let [x, y, z] = sub(p, c)
    ;[x, y] = [x * cz - y * sz, x * sz + y * cz]
    ;[x, z] = [x * cy + z * sy, -x * sy + z * cy]
    ;[y, z] = [y * cx - z * sx, y * sx + z * cx]
    return f(add(c, [x, y, z]))
  }
}
const torus = (c, R, r) => (p) => {
  const q = sub(p, c)
  return Math.hypot(Math.hypot(q[0], q[2]) - R, q[1]) - r
}
const hash3 = (x, y, z) => {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453
  return s - Math.floor(s)
}
/** cellular spots: true inside a spot of radius r on a jittered grid of size g */
function spot(p, g, r) {
  const ci = p.map((v) => Math.floor(v / g))
  for (let a = -1; a <= 1; a++)
    for (let b = -1; b <= 1; b++)
      for (let c = -1; c <= 1; c++) {
        const cc = [ci[0] + a, ci[1] + b, ci[2] + c]
        const h = hash3(...cc)
        if (h < 0.35) continue
        const ctr = [(cc[0] + hash3(cc[1], cc[2], cc[0])) * g, (cc[1] + hash3(cc[2], cc[0], cc[1])) * g, (cc[2] + hash3(cc[0], cc[2], cc[1] + 3)) * g]
        if (len(sub(p, ctr)) < r * (0.7 + 0.5 * h)) return true
      }
  return false
}

// ---- species body -------------------------------------------------------------
export function speciesParts(S) {
  const parts = []
  const props = []
  const P = (f, o) => parts.push({ f, blend: 0.03, fur: 1, code: MAIN, zone: ZONE.other, bone: BONE.body, ...o })
  const Q = (prop, f, o) => props.push({ f, prop, blend: 0.01, fur: 0, code: FIXED, zone: ZONE.other, bone: BONE.head, ...o })
  const marks = new Set(S.marks || [])
  const extras = new Set(S.extras || [])
  const build = S.build || 'normal'
  const W = build === 'stocky' ? 1.1 : build === 'round' ? 1.12 : build === 'lanky' ? 0.92 : 1
  const HC = [0, 0.72, 0.01]
  const HR = [0.2 * S.head[0], 0.185 * S.head[1], 0.18 * S.head[2]]
  const front = HC[2] + HR[2]

  // marking colour functions (rest position p → code)
  const bodyCode = (p) => {
    if (marks.has('belly') && p[2] > 0.04 && Math.abs(p[0]) < 0.085 + (0.45 - p[1]) * 0.15 && p[1] > 0.26 && p[1] < 0.53) return LIGHT
    if (marks.has('stripes') && p[2] < 0.06 && Math.sin(p[1] * 75 + Math.abs(p[0]) * 12) > 0.55) return MARK
    if (marks.has('tabbyLight') && p[2] < 0.0 && Math.sin(p[1] * 70) > 0.6) return MARK
    if (marks.has('spots') && spot(p, 0.06, 0.016)) return MARK
    if (marks.has('fawnSpots') && p[2] < 0.02 && p[1] > 0.3 && spot(p, 0.05, 0.012)) return LIGHT
    if (marks.has('patches') && Math.sin(p[0] * 13 + 1) * Math.sin(p[1] * 11 + 2) * Math.sin(p[2] * 12 + 0.5) > 0.22) return MARK
    if (marks.has('dots') && spot(p, 0.05, 0.01)) return LIGHT
    if (marks.has('chestBars') && p[2] > 0.05 && p[1] > 0.28 && p[1] < 0.52 && Math.sin(p[1] * 90) > 0.5) return MARK
    if (marks.has('neckSheen') && p[1] > 0.48) return MARK
    return MAIN
  }
  const headCode = (p) => {
    const fx = p[0] / HR[0]
    const fy = (p[1] - HC[1]) / HR[1]
    const fz = (p[2] - HC[2]) / HR[2]
    if (marks.has('whiteHead')) return LIGHT
    if (marks.has('faceDisc') && fz > 0.25 && fx * fx * 0.9 + (fy + 0.05) ** 2 < 0.62) return LIGHT
    if (marks.has('greyFace') && fz > 0.1 && fy < 0.35) return LIGHT
    if (marks.has('darkFace')) return fz > -0.1 && fy < 0.45 ? LIGHT : MAIN
    if (marks.has('foxMask') && fz > 0.2 && fy < -0.15) return LIGHT
    if (marks.has('blaze') && fz > 0.3 && Math.abs(fx) < 0.16 && fy > -0.2) return LIGHT
    if (marks.has('eyeRings') && fz > 0.3 && (Math.abs(fx) - S.face.ex) ** 2 + (fy - S.face.ey) ** 2 < 0.05) return LIGHT
    if (marks.has('eyePatch') && fz > 0.2 && (fx - S.face.ex) ** 2 + (fy - S.face.ey) ** 2 < 0.07) return MARK
    if (marks.has('stripes') && fy > 0.55 && fz < 0.45 && Math.sin(fx * 16) > 0.55) return MARK
    if (marks.has('tabbyLight') && fy > 0.55 && fz < 0.45 && Math.sin(fx * 16) > 0.6) return MARK
    if (marks.has('spots') && fz < 0.4 && spot(p, 0.06, 0.014)) return MARK
    if (marks.has('patches') && fx > 0.2 && fy > 0.0) return MARK
    if (marks.has('neckSheen') && fy < -0.7) return MARK
    return MAIN
  }
  const limbCode = (p) => {
    if (marks.has('socks') && p[1] < 0.15) return MARK
    if (marks.has('darkFace')) return LIGHT
    return bodyCode(p)
  }
  const torsoZone = (p) => {
    if (p[2] > 0.06 && Math.abs(p[0]) < 0.05 && p[1] > 0.3 && p[1] < 0.53) return ZONE.chestFront
    if (p[1] > 0.5) return ZONE.neck
    if (p[1] > 0.4) return ZONE.chest
    if (p[1] > 0.29) return ZONE.belly
    return ZONE.hips
  }

  // ---- torso, neck, head
  const belly = build === 'round' ? 1.1 : 1
  P(ellipsoid([0, 0.335, 0.0], [0.16 * W * belly, 0.155, 0.14 * W * belly]), { bone: BONE.body, zone: torsoZone, code: bodyCode, blend: 0.05, tag: 'torso' })
  P(roundCone([0, 0.31, -0.005], [0, 0.5, -0.01], 0.15 * W, 0.105), { bone: BONE.body, zone: torsoZone, code: bodyCode, blend: 0.05, tag: 'torso' })
  P(roundCone([0, 0.5, -0.01], [0, 0.6, 0.0], 0.09, 0.085), { bone: BONE.head, zone: ZONE.neck, code: bodyCode, blend: 0.06, tag: 'neck' })
  const wool = extras.has('wool')
  const headF = ellipsoid(HC, HR)
  P(wool ? (p) => headF(p) - (p[1] > HC[1] + 0.06 || p[2] < HC[2] - 0.05 ? 0.012 * (0.5 + 0.5 * Math.sin(p[0] * 90) * Math.sin(p[1] * 90) * Math.sin(p[2] * 90)) : 0) : headF, { bone: BONE.head, zone: ZONE.head, code: headCode, blend: 0.06 })
  if (wool) {
    // fleece: a bumpy coat over the torso
    const coat = ellipsoid([0, 0.37, -0.005], [0.18 * W, 0.19, 0.16 * W])
    P((p) => coat(p) - 0.014 * (0.5 + 0.5 * Math.sin(p[0] * 80) * Math.sin(p[1] * 80) * Math.sin(p[2] * 80)), { bone: BONE.body, zone: torsoZone, code: MAIN, blend: 0.04, tag: 'torso' })
  }

  // ---- muzzle / beak (head bone)
  const mz = (dy, dz) => [0, HC[1] + dy, front + dz]
  const nose = (c, r, col = '#2a2224') => P(ellipsoid(c, r), { bone: BONE.head, zone: ZONE.head, code: FIXED, color: col, fur: 0, blend: 0.008 })
  const lightBall = (c, r, blend = 0.03) => P(ellipsoid(c, r), { bone: BONE.head, zone: ZONE.head, code: LIGHT, blend })
  switch (S.muzzle) {
    case 'cat':
      // one small round muzzle standing out a little (like the bear's), not whisker pads
      lightBall(mz(-0.072, -0.012), [0.05, 0.038, 0.042], 0.03)
      nose(mz(-0.05, 0.022), [0.016, 0.011, 0.01], '#e39aa0')
      break
    case 'bunny':
      lightBall(mz(-0.074, -0.014), [0.046, 0.036, 0.04], 0.03)
      nose(mz(-0.052, 0.018), [0.014, 0.01, 0.009], '#e38f9c')
      // round full cheeks in the fur colour (not white whisker pads)
      if (S.extras?.includes('cheeks')) for (const s of [-1, 1]) P(ellipsoid([s * 0.12, HC[1] - 0.06, front - 0.08], [0.06, 0.052, 0.05]), { bone: BONE.head, zone: ZONE.head, code: MAIN, blend: 0.05 })
      break
    case 'dog':
    case 'fox': {
      const fox = S.muzzle === 'fox'
      P(roundCone(mz(-0.065, -0.06), mz(-0.075, fox ? 0.02 : 0.015), 0.068, fox ? 0.042 : 0.05), { bone: BONE.head, zone: ZONE.head, code: LIGHT, blend: 0.04 })
      nose(mz(fox ? -0.05 : -0.048, fox ? 0.058 : 0.062), [0.024, 0.018, 0.016])
      break
    }
    case 'bear':
      lightBall(mz(-0.07, -0.02), [0.075, 0.058, 0.06], 0.035)
      nose(mz(-0.045, 0.035), [0.028, 0.02, 0.018])
      break
    case 'long':
    case 'deer':
    case 'cowMuzzle':
    case 'sheep':
    case 'horse': {
      const big = S.muzzle === 'deer' ? 0.85 : 1
      const col = S.muzzle === 'cowMuzzle' ? FIXED : LIGHT
      P(ellipsoid(mz(-0.085, -0.02 + (big - 1) * 0.1), [0.105 * big, 0.08 * big, 0.085 * big]), { bone: BONE.head, zone: ZONE.head, code: col, color: '#f0b9b3', blend: 0.05 })
      for (const s of [-1, 1]) nose(add(mz(-0.08, 0.055 + (big - 1) * 0.12), [s * 0.035, 0, 0]), [0.012, 0.016, 0.01], S.muzzle === 'cowMuzzle' ? '#8a5a5a' : '#2a2224')
      if (S.muzzle === 'deer') nose(mz(-0.055, 0.06), [0.024, 0.018, 0.016])
      break
    }
    case 'boar':
      P(roundCone(mz(-0.065, -0.05), mz(-0.075, 0.015), 0.07, 0.058), { bone: BONE.head, zone: ZONE.head, code: LIGHT, blend: 0.04 })
      P(ellipsoid(mz(-0.075, 0.068), [0.052, 0.043, 0.016]), { bone: BONE.head, zone: ZONE.head, code: FIXED, color: '#e0a29c', fur: 0, blend: 0.012 })
      for (const s of [-1, 1]) nose(mz(-0.075, 0.082).map((v, i) => v + [s * 0.018, 0, 0][i]), [0.008, 0.011, 0.006], '#7a4040')
      break
    case 'dragon':
      P(roundCone(mz(-0.07, -0.05), mz(-0.075, 0.015), 0.068, 0.055), { bone: BONE.head, zone: ZONE.head, code: LIGHT, blend: 0.05 })
      for (const s of [-1, 1]) nose(mz(-0.05, 0.064).map((v, i) => v + [s * 0.022, 0, 0][i]), [0.009, 0.007, 0.006])
      break
    case 'hedgehog':
      P(roundCone(mz(-0.065, -0.05), mz(-0.072, 0.025), 0.065, 0.04), { bone: BONE.head, zone: ZONE.head, code: LIGHT, blend: 0.04 })
      nose(mz(-0.064, 0.064), [0.021, 0.017, 0.015])
      break
    case 'owlBeak':
      P(roundCone(mz(-0.03, -0.01), mz(-0.085, 0.035), 0.026, 0.008), { bone: BONE.head, zone: ZONE.head, code: FIXED, color: '#e2b55a', fur: 0, blend: 0.01 })
      break
    case 'eagleBeak':
      P(roundCone(mz(-0.03, -0.03), mz(-0.045, 0.07), 0.05, 0.022), { bone: BONE.head, zone: ZONE.head, code: FIXED, color: '#f2c94c', fur: 0, blend: 0.015 })
      P(roundCone(mz(-0.045, 0.07), mz(-0.09, 0.075), 0.022, 0.008), { bone: BONE.head, zone: ZONE.head, code: FIXED, color: '#f2c94c', fur: 0, blend: 0.01 })
      break
    case 'parrotBeak':
      P(roundCone(mz(-0.04, -0.02), mz(-0.1, 0.045), 0.045, 0.01), { bone: BONE.head, zone: ZONE.head, code: FIXED, color: '#f3c7a0', fur: 0, blend: 0.012 })
      break
    case 'pigeonBeak':
      P(roundCone(mz(-0.04, -0.01), mz(-0.05, 0.07), 0.022, 0.01), { bone: BONE.head, zone: ZONE.head, code: FIXED, color: '#3a3536', fur: 0, blend: 0.01 })
      P(ellipsoid(mz(-0.025, 0.005), [0.02, 0.012, 0.012]), { bone: BONE.head, zone: ZONE.head, code: FIXED, color: '#f2f0ea', fur: 0, blend: 0.008 })
      break
    default:
  }

  // ---- ears (left side; mirrored for the right) → pivots
  const ears = []
  const ear = (base, f, o = {}) => ears.push({ base, f, o })
  const flat = (f, c, rot, s) => rotated(squash(f, c, s), c, rot)
  switch (S.ears) {
    case 'pointed':
    case 'tufted':
    case 'fox': {
      const big = S.ears === 'fox' ? 1.25 : 1
      const b = [0.105, HC[1] + 0.13, HC[2] - 0.01]
      const t = [0.145, HC[1] + 0.13 + 0.105 * big, HC[2] - 0.02]
      ear(b, flat(roundCone(b, t, 0.062 * big, 0.028), b, [0, 0, 0], [1, 1, 0.45]))
      ear(b, flat(roundCone(add(b, [0.005, 0.015, 0.02]), add(t, [-0.004, -0.025, 0.02]), 0.036 * big, 0.016), b, [0, 0, 0], [1, 1, 0.3]), { code: FIXED, color: '#efbcb6', fur: 0, blend: 0.008 })
      if (S.ears === 'tufted') ear(b, roundCone(add(t, [0, 0.012, 0]), add(t, [0.006, 0.05, -0.005]), 0.016, 0.011), { code: MARK, blend: 0.012 })
      if (S.ears === 'fox') ear(b, roundCone(add(t, [-0.006, -0.02, 0]), t, 0.03, 0.028), { code: MARK, blend: 0.012 })
      break
    }
    case 'bunny':
    case 'hare': {
      const L = S.ears === 'hare' ? 0.24 : 0.18
      const b = [0.065, HC[1] + 0.15, HC[2] - 0.02]
      const c = [0.085, b[1] + L * 0.55, b[2] - 0.01]
      ear(b, flat(ellipsoid(c, [0.048, L * 0.55, 0.048]), c, [-0.08, 0, -0.14], [1, 1, 0.5]), { code: (p) => (marks.has('earTips') && p[1] > b[1] + L * 0.85 ? MARK : MAIN) })
      ear(b, flat(ellipsoid(add(c, [0, -0.01, 0.018]), [0.026, L * 0.42, 0.02]), c, [-0.08, 0, -0.14], [1, 1, 0.4]), { code: FIXED, color: '#efb3bb', fur: 0, blend: 0.006 })
      break
    }
    case 'round':
    case 'small':
    case 'boar': {
      const r = S.ears === 'small' ? 0.038 : 0.055
      const b = [0.12, HC[1] + 0.13, HC[2] - 0.02]
      const c = add(b, [0.02, 0.03, 0])
      if (S.ears === 'boar') ear(b, flat(roundCone(b, add(b, [0.05, 0.065, -0.01]), 0.045, 0.024), b, [0, 0, 0], [1, 1, 0.45]))
      else {
        ear(b, flat(ellipsoid(c, [r, r, r]), c, [0, 0, 0], [1, 1, 0.5]))
        ear(b, flat(ellipsoid(add(c, [0, 0, 0.012]), [r * 0.6, r * 0.6, r * 0.6]), c, [0, 0, 0], [1, 1, 0.3]), { code: LIGHT, blend: 0.006 })
      }
      break
    }
    case 'floppy': {
      const b = [0.16, HC[1] + 0.1, HC[2] - 0.01]
      const c = [0.215, HC[1] - 0.0, HC[2] - 0.0]
      ear(b, flat(ellipsoid(c, [0.055, 0.115, 0.055]), c, [0, 0, 0.32], [1, 1, 0.42]), { code: MARK })
      break
    }
    case 'cow':
    case 'sheep':
    case 'goat':
    case 'deer': {
      const droop = S.ears === 'sheep' ? -0.35 : S.ears === 'deer' ? 0.45 : S.ears === 'goat' ? 0.0 : 0.15
      const b = [0.17, HC[1] + 0.05, HC[2] - 0.02]
      const c = add(b, [0.08, 0.035 * Math.sign(droop + 0.01) + droop * 0.06, 0])
      const len2 = S.ears === 'deer' ? 0.085 : 0.075
      ear(b, flat(ellipsoid(c, [len2, 0.035, 0.035]), c, [0, 0, droop], [1, 1, 0.5]), { code: S.ears === 'sheep' ? LIGHT : MAIN })
      ear(b, flat(ellipsoid(add(c, [0, 0, 0.012]), [len2 * 0.7, 0.02, 0.02]), c, [0, 0, droop], [1, 1, 0.35]), { code: FIXED, color: '#e9b4ae', fur: 0, blend: 0.006 })
      break
    }
    case 'horse':
    case 'donkey': {
      const L = S.ears === 'donkey' ? 0.2 : 0.12
      const b = [0.11, HC[1] + 0.14, HC[2] - 0.03]
      const t = add(b, [0.05, L, -0.01])
      ear(b, flat(roundCone(b, t, 0.042, 0.024), b, [0, 0, 0], [1, 1, 0.5]), { code: (p) => (S.ears === 'donkey' && p[1] > t[1] - 0.03 ? MARK : MAIN) })
      ear(b, flat(roundCone(add(b, [0.004, 0.02, 0.012]), add(t, [-0.005, -0.03, 0.012]), 0.022, 0.008), b, [0, 0, 0], [1, 1, 0.35]), { code: LIGHT, blend: 0.006 })
      break
    }
    case 'squirrel': {
      const b = [0.11, HC[1] + 0.14, HC[2] - 0.02]
      const t = add(b, [0.03, 0.09, 0])
      ear(b, flat(roundCone(b, t, 0.04, 0.012), b, [0, 0, 0], [1, 1, 0.5]))
      ear(b, roundCone(t, add(t, [0.004, 0.03, -0.005]), 0.016, 0.011), { code: MARK, blend: 0.01 })
      break
    }
    case 'owl': {
      const b = [0.13, HC[1] + 0.14, HC[2] - 0.01]
      ear(b, flat(roundCone(b, add(b, [0.04, 0.07, -0.01]), 0.035, 0.018), b, [0, 0, 0], [1, 1, 0.45]))
      break
    }
    case 'fin': {
      const b = [0.17, HC[1] + 0.06, HC[2] - 0.04]
      ear(b, flat(roundCone(b, add(b, [0.075, 0.035, -0.04]), 0.035, 0.018), b, [0, 0, 0], [1, 1, 0.4]), { code: MARK })
      break
    }
    default:
  }
  const earPivot = ears.length ? ears[0].base : [0.12, HC[1] + 0.12, HC[2]]
  for (const e of ears) {
    const o = { bone: BONE.earL, zone: ZONE.other, blend: 0.035, ...e.o }
    P(e.f, o)
    P((p) => e.f(mirror(p)), { ...o, bone: BONE.earR, code: typeof o.code === 'function' ? (p) => o.code(mirror(p)) : o.code })
  }

  // ---- horns / antlers (head)
  const horn = (a, b, r1, r2, col = '#efe3c4') => {
    P(roundCone(a, b, r1, r2), { bone: BONE.head, zone: ZONE.head, code: FIXED, color: col, fur: 0, blend: 0.015 })
    P(roundCone(mirror(a), mirror(b), r1, r2), { bone: BONE.head, zone: ZONE.head, code: FIXED, color: col, fur: 0, blend: 0.015 })
  }
  if (S.horns === 'bull') {
    horn([0.13, HC[1] + 0.11, HC[2] - 0.02], [0.24, HC[1] + 0.13, HC[2] - 0.01], 0.032, 0.022)
    horn([0.24, HC[1] + 0.13, HC[2] - 0.01], [0.27, HC[1] + 0.19, HC[2] + 0.0], 0.022, 0.016)
  }
  if (S.horns === 'cow') horn([0.1, HC[1] + 0.14, HC[2] - 0.02], [0.14, HC[1] + 0.19, HC[2] - 0.02], 0.02, 0.014)
  if (S.horns === 'goat') {
    horn([0.06, HC[1] + 0.16, HC[2] - 0.01], [0.09, HC[1] + 0.25, HC[2] - 0.07], 0.028, 0.02, '#8f8577')
    horn([0.09, HC[1] + 0.25, HC[2] - 0.07], [0.11, HC[1] + 0.24, HC[2] - 0.14], 0.02, 0.014, '#8f8577')
  }
  if (S.horns === 'antlers') {
    const c = '#8a6a4a'
    horn([0.07, HC[1] + 0.15, HC[2] - 0.02], [0.1, HC[1] + 0.27, HC[2] - 0.04], 0.016, 0.012, c)
    horn([0.1, HC[1] + 0.27, HC[2] - 0.04], [0.16, HC[1] + 0.34, HC[2] - 0.06], 0.012, 0.011, c)
    horn([0.095, HC[1] + 0.24, HC[2] - 0.035], [0.065, HC[1] + 0.31, HC[2] - 0.02], 0.01, 0.01, c)
  }
  if (S.horns === 'dragon') {
    horn([0.07, HC[1] + 0.14, HC[2] - 0.05], [0.095, HC[1] + 0.2, HC[2] - 0.11], 0.025, 0.017)
  }

  // ---- extras
  if (extras.has('ruff')) for (const s of [-1, 1]) P(ellipsoid([s * 0.165, HC[1] - 0.075, HC[2] - 0.01], [0.05, 0.05, 0.05]), { bone: BONE.head, zone: ZONE.head, code: MAIN, blend: 0.06 })
  if (extras.has('tusks')) for (const s of [-1, 1]) P(roundCone(mz(-0.085, 0.04).map((v, i) => v + [s * 0.055, 0, 0][i]), mz(-0.03, 0.06).map((v, i) => v + [s * 0.075, 0, 0][i]), 0.011, 0.004), { bone: BONE.head, zone: ZONE.head, code: FIXED, color: '#f3ead6', fur: 0, blend: 0.006 })
  if (extras.has('bristles')) P(roundCone([0, HC[1] + 0.17, HC[2] + 0.04], [0, 0.5, -0.12], 0.025, 0.02), { bone: BONE.head, zone: ZONE.head, code: MARK, blend: 0.03 })
  if (extras.has('beard')) P(roundCone(mz(-0.14, -0.05), mz(-0.24, -0.06), 0.028, 0.008), { bone: BONE.head, zone: ZONE.head, code: LIGHT, blend: 0.02 })
  if (extras.has('crest')) for (let k = 0; k < 3; k++) P(roundCone([0, HC[1] + HR[1] - 0.01, HC[2] + 0.04 - k * 0.04], [0, HC[1] + HR[1] + 0.07 - k * 0.012, HC[2] - 0.02 - k * 0.05], 0.022, 0.006), { bone: BONE.head, zone: ZONE.head, code: MAIN, blend: 0.015 })
  if (extras.has('mane')) {
    for (let k = 0; k < 5; k++) {
      const t = k / 4
      const c = [0, HC[1] + HR[1] - 0.005 - t * 0.27, HC[2] - 0.06 - t * 0.11]
      P(ellipsoid(c, [0.028, 0.05, 0.04]), { bone: t < 0.6 ? BONE.head : BONE.body, zone: ZONE.other, code: MARK, blend: 0.02 })
    }
    P(ellipsoid([0, HC[1] + HR[1] - 0.02, HC[2] + 0.09], [0.04, 0.03, 0.05]), { bone: BONE.head, zone: ZONE.head, code: MARK, blend: 0.02 }) // forelock
  }
  if (extras.has('spines')) {
    let k = 0
    for (let i = 0; i < 70; i++) {
      const u = (i * 0.618034) % 1
      const v = i / 70
      const az = Math.PI + (u - 0.5) * 3.0
      const el = -0.2 + v * 1.55
      const d = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)]
      if (d[2] > 0.15) continue
      const onHead = el > 0.35
      const c = onHead ? HC : [0, 0.38, -0.01]
      const r = onHead ? HR : [0.17, 0.2, 0.15]
      const base = add(c, [d[0] * r[0] * 0.92, d[1] * r[1] * 0.92, d[2] * r[2] * 0.92])
      P(roundCone(base, add(base, mul(d, 0.062 + 0.016 * u)), 0.026, 0.011), { bone: onHead ? BONE.head : BONE.body, zone: ZONE.other, code: MARK, blend: 0.012 })
      k++
    }
  }
  if (extras.has('spikes')) for (let k = 0; k < 5; k++) {
    const t = k / 4
    const base = [0, HC[1] + HR[1] - 0.02 - t * 0.42, HC[2] - 0.1 - t * 0.06]
    P(roundCone(base, add(base, [0, 0.025, -0.05]), 0.03, 0.015), { bone: t < 0.3 ? BONE.head : BONE.body, zone: ZONE.other, code: LIGHT, blend: 0.01 })
  }
  if (extras.has('wings'))
    for (const s of [-1, 1]) {
      const b = [s * 0.08, 0.47, -0.12]
      const c = [s * 0.17, 0.53, -0.17]
      P(rotated(squash(ellipsoid(c, [0.12, 0.08, 0.08]), c, [1, 1, 0.18]), c, [0, s * 0.5, s * 0.3]), { bone: BONE.body, zone: ZONE.other, code: MARK, blend: 0.02, fur: 0 })
      void b
    }

  // ---- arms (left; mirrored) — paws, or wings for birds
  const sh = [0.12 * W, 0.49, -0.005]
  const hand = [0.235 * W, 0.325, 0.035]
  const armParts = []
  if (extras.has('wingArms')) {
    const c = [0.2 * W, 0.4, -0.01]
    armParts.push([rotated(squash(roundCone(sh, [0.25 * W, 0.28, 0.0], 0.065, 0.03), c, [1, 1, 0.45]), c, [0, 0, 0]), ZONE.upperArm, (p) => (marks.has('wingBars') && Math.sin(p[1] * 80) > 0.6 ? MARK : MAIN)])
    armParts.push([roundCone([0.25 * W, 0.3, 0.0], [0.265 * W, 0.24, -0.01], 0.03, 0.012), ZONE.hand, MARK])
  } else {
    armParts.push([roundCone(sh, hand, 0.052, 0.044), ZONE.upperArm, limbCode])
    armParts.push([ellipsoid(add(hand, [0.008, -0.022, 0.004]), [0.046, 0.05, 0.044]), ZONE.hand, (p) => (marks.has('socks') ? MARK : limbCode(p))])
  }
  for (const [f, zone, code] of armParts) {
    const tag = zone === ZONE.hand ? 'hand' : 'arm'
    P(f, { bone: BONE.armL, zone, code, blend: 0.03, tag })
    P((p) => f(mirror(p)), { bone: BONE.armR, zone, code: typeof code === 'function' ? (p) => code(mirror(p)) : code, blend: 0.03, tag })
  }

  // ---- legs (left; mirrored): thigh, shin, foot (paw / hoof / bird foot)
  const lanky = build === 'lanky' ? 1.08 : 1
  const hip = [0.07 * W, 0.235, 0.0]
  const knee = [0.074 * W, 0.15, 0.008]
  const ankle = [0.078 * W, 0.06, 0.006]
  const legParts = []
  if (S.bird) {
    legParts.push([roundCone(hip, knee, 0.06, 0.04), ZONE.thigh, MAIN])
    legParts.push([roundCone(knee, ankle, 0.018, 0.016), ZONE.shin, FIXED, '#e0a24a'])
    for (const a of [-0.45, 0, 0.45]) legParts.push([roundCone([ankle[0], 0.02, 0.01], [ankle[0] + Math.sin(a) * 0.06, 0.015, 0.01 + Math.cos(a) * 0.065], 0.016, 0.01), ZONE.foot, FIXED, '#e0a24a'])
  } else {
    legParts.push([roundCone(hip, knee, 0.064 * W, 0.056), ZONE.thigh, limbCode])
    legParts.push([roundCone(knee, ankle, 0.056, 0.05 * lanky), ZONE.shin, limbCode])
    if (S.hooves) legParts.push([roundCone([ankle[0], 0.045, 0.012], [ankle[0], 0.025, 0.03], 0.05, 0.044), ZONE.foot, FIXED, '#3a2e28'])
    else legParts.push([ellipsoid([ankle[0] + 0.004, 0.034, 0.03], [0.058, 0.036, 0.078]), ZONE.foot, (p) => (marks.has('socks') ? MARK : limbCode(p))])
  }
  for (const [f, zone, code, color] of legParts) {
    const tag = zone === ZONE.foot ? 'foot' : 'leg'
    P(f, { bone: BONE.legL, zone, code, color, fur: code === FIXED ? 0 : 1, blend: zone === ZONE.thigh ? 0.035 : 0.025, tag })
    P((p) => f(mirror(p)), { bone: BONE.legR, zone, code: typeof code === 'function' ? (p) => code(mirror(p)) : code, color, fur: code === FIXED ? 0 : 1, blend: zone === ZONE.thigh ? 0.035 : 0.025, tag })
  }

  // ---- tail (bone tail, pivot at its root)
  const tailPivot = [0, 0.27, -0.12]
  const T = (f, o = {}) => P(f, { bone: BONE.tail, zone: ZONE.other, blend: 0.03, ...o })
  const chain = (pts, r0, r1, code = MAIN) => {
    for (let k = 0; k < pts.length - 1; k++) {
      const t0 = k / (pts.length - 1)
      const t1 = (k + 1) / (pts.length - 1)
      T(roundCone(pts[k], pts[k + 1], r0 + (r1 - r0) * t0, r0 + (r1 - r0) * t1), { code: typeof code === 'function' ? code : code, blend: 0.02 })
    }
  }
  const curve = (n, fn) => Array.from({ length: n }, (_, k) => fn(k / (n - 1)))
  switch (S.tail) {
    case 'long':
      chain(curve(6, (t) => [0.02 * t, 0.26 + Math.sin(t * 2.4) * 0.16, -0.12 - Math.sin(t * 1.5) * 0.17]), 0.03, 0.024, (p) => (marks.has('tabbyLight') && Math.sin(p[1] * 60) > 0.6 ? MARK : MAIN))
      break
    case 'ringed':
      chain(curve(6, (t) => [0.03 * t, 0.25 + Math.sin(t * 2.2) * 0.12, -0.12 - t * 0.2]), 0.045, 0.04, (p) => (Math.sin(len(sub(p, tailPivot)) * 55) > 0.3 || len(sub(p, tailPivot)) > 0.24 ? MARK : MAIN))
      break
    case 'bob':
      T(ellipsoid([0, 0.29, -0.16], [0.04, 0.05, 0.055]), { code: (p) => (p[1] > 0.32 ? MARK : MAIN) })
      break
    case 'pompom':
      T(ellipsoid([0, 0.27, -0.155], [0.058, 0.058, 0.058]), { code: FIXED, color: '#ffffff' })
      break
    case 'hareTail':
      T(ellipsoid([0, 0.28, -0.15], [0.045, 0.05, 0.045]), { code: (p) => (p[2] < -0.17 && p[1] > 0.29 ? MARK : LIGHT) })
      break
    case 'fox':
      chain(curve(5, (t) => [0.05 * t, 0.24 + t * 0.06, -0.13 - t * 0.24]), 0.055, 0.075, (p) => (len(sub(p, tailPivot)) > 0.26 ? LIGHT : MAIN))
      break
    case 'squirrel':
      chain(curve(7, (t) => [0, 0.24 + Math.sin(t * 2.6) * 0.45, -0.14 - Math.sin(t * 1.2) * 0.16 + t * 0.05]), 0.055, 0.08, MAIN)
      break
    case 'tuft':
      chain(curve(4, (t) => [0.02 * t, 0.28 - t * 0.17, -0.13 - t * 0.08]), 0.016, 0.013, MAIN)
      T(ellipsoid([0.02, 0.1, -0.215], [0.03, 0.05, 0.03]), { code: MARK })
      break
    case 'horse':
      chain(curve(4, (t) => [0, 0.29 - t * 0.17, -0.13 - t * 0.12]), 0.045, 0.03, MARK)
      break
    case 'curly':
      chain(curve(6, (t) => [0, 0.27 + Math.sin(t * 6.2) * 0.035, -0.12 - t * 0.04 - Math.cos(t * 6.2) * 0.03 + 0.03]), 0.013, 0.01, MAIN)
      break
    case 'short':
    case 'deer':
      T(ellipsoid([0, 0.29, -0.15], [0.035, 0.045, 0.04]), { code: S.tail === 'deer' ? FIXED : MAIN, color: '#ffffff' })
      break
    case 'curl':
      chain(curve(6, (t) => [0, 0.28 + Math.sin(t * 2.8) * 0.13, -0.12 - Math.sin(t * 1.6) * 0.1]), 0.035, 0.028, MAIN)
      break
    case 'feather':
      for (const s of [-1, 0, 1]) T(rotated(squash(ellipsoid([s * 0.04, 0.2, -0.2], [0.035, 0.012, 0.1]), [s * 0.04, 0.2, -0.2], [1, 1, 1]), [s * 0.04, 0.2, -0.2], [-0.5, s * 0.2, 0]), { code: marks.has('whiteHead') ? LIGHT : MARK, blend: 0.012 })
      break
    case 'dragon':
    case 'lizard': {
      const big = S.tail === 'dragon' ? 1 : 0.75
      chain(curve(6, (t) => [0.06 * Math.sin(t * 2), 0.26 - t * 0.22, -0.13 - t * 0.36 * big]), 0.08 * big, 0.016, (p) => (p[1] < 0.12 && p[2] < -0.3 ? MAIN : MAIN))
      if (S.tail === 'dragon') for (let k = 1; k < 5; k++) {
        const t = k / 5
        const b = [0.06 * Math.sin(t * 2), 0.26 - t * 0.22 + 0.06 * (1 - t), -0.13 - t * 0.36]
        T(roundCone(b, add(b, [0, 0.04, -0.03]), 0.022, 0.005), { code: LIGHT, blend: 0.008 })
      }
      break
    }
    default:
  }

  // ---- props (not blended into the body; prop ids, see critters.PROP)
  const hatY = HC[1] + HR[1] * 0.9
  const longEars = ['bunny', 'hare', 'donkey'].includes(S.ears)
  if (S.props.includes(PROP.barretina)) {
    const c = [0, hatY + 0.01, HC[2] - 0.03]
    Q(PROP.barretina, roundCone(c, add(c, [0.0, 0.05, -0.15]), 0.13 * S.head[0], 0.04), { color: '#c42b2b' })
    Q(PROP.barretina, torus(add(c, [0, -0.01, 0]), 0.125 * S.head[0], 0.016), { color: '#8f1f22' })
  }
  if (S.props.includes(PROP.straw)) {
    const c = [0, hatY + 0.01, HC[2]]
    Q(PROP.straw, (p) => Math.max(Math.hypot(p[0] - c[0], p[2] - c[2]) - (longEars ? 0.22 : 0.3), Math.abs(p[1] - c[1]) - 0.008), { color: '#e2c07a' })
    Q(PROP.straw, roundCone(c, add(c, [0, 0.08, 0]), 0.13, 0.11), { color: '#e2c07a' })
    Q(PROP.straw, torus(add(c, [0, 0.025, 0]), 0.128, 0.018), { color: '#c9463b' })
  }
  if (S.props.includes(PROP.beret)) {
    const c = [0.03, hatY + 0.02, HC[2] - 0.01]
    Q(PROP.beret, rotated(squash(ellipsoid(c, [0.17, 0.17, 0.17]), c, [1, 0.32, 1]), c, [0, 0, -0.2]), { code: GARC })
  }
  if (S.props.includes(PROP.crown))
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2
      const r = longEars ? 0.1 : 0.15 * S.head[0]
      const c = [Math.cos(a) * r, hatY - 0.01 - (longEars ? 0.02 : 0), HC[2] + Math.sin(a) * r * 0.95]
      Q(PROP.crown, ellipsoid(c, [0.03, 0.022, 0.03]), { color: ['#f29bb0', '#f6d36b', '#ffffff', '#b9a2e6', '#8fd0e8'][k % 5] })
      Q(PROP.crown, ellipsoid(add(c, [0, 0.008, 0]), [0.011, 0.011, 0.011]), { color: '#f2c94c' })
    }
  const neckY = 0.535
  if (S.props.includes(PROP.scarf)) {
    Q(PROP.scarf, torus([0, neckY, 0.0], 0.088, 0.03), { code: GARB, bone: BONE.body })
    Q(PROP.scarf, roundCone([0.05, neckY - 0.02, 0.09], [0.07, neckY - 0.13, 0.12], 0.026, 0.022), { code: GARB, bone: BONE.body })
  }
  if (S.props.includes(PROP.bowtie)) {
    for (const s of [-1, 1]) Q(PROP.bowtie, rotated(squash(ellipsoid([s * 0.035, neckY - 0.03, 0.1], [0.04, 0.03, 0.02]), [s * 0.035, neckY - 0.03, 0.1], [1, 1, 1]), [s * 0.035, neckY - 0.03, 0.1], [0, 0, s * 0.3]), { code: GARC, bone: BONE.body })
    Q(PROP.bowtie, ellipsoid([0, neckY - 0.03, 0.108], [0.015, 0.015, 0.013]), { code: GARC, bone: BONE.body })
  }
  if (S.props.includes(PROP.bandana)) {
    Q(PROP.bandana, torus([0, neckY + 0.005, 0.0], 0.085, 0.018), { color: '#c9463b', bone: BONE.body })
    Q(PROP.bandana, rotated(squash(roundCone([0, neckY - 0.01, 0.085], [0, neckY - 0.1, 0.12], 0.06, 0.012), [0, neckY - 0.05, 0.1], [1, 1, 0.3]), [0, neckY - 0.05, 0.1], [-0.35, 0, 0]), { color: '#c9463b', bone: BONE.body })
  }
  if (S.props.includes(PROP.rose)) {
    Q(PROP.rose, ellipsoid([0.08, 0.47, 0.135], [0.032, 0.03, 0.03]), { color: '#c8213a', bone: BONE.body })
    Q(PROP.rose, roundCone([0.08, 0.45, 0.13], [0.06, 0.38, 0.14], 0.006, 0.005), { color: '#3f7a46', bone: BONE.body })
  }

  return {
    parts,
    props,
    head: { c: HC, r: HR },
    pivots: { body: PIVOTS.body, head: PIVOTS.head, armL: [sh[0], sh[1], sh[2]], legL: hip, tail: tailPivot, earL: earPivot },
    axes: { sh, hand, hip, ankle, W, bird: !!S.bird },
  }
}

// ---- meshing --------------------------------------------------------------------
/** bounding sphere of a part from a coarse probe (used to skip far parts) */
function bounds(f, box) {
  // sample the box coarsely for points inside / near the surface
  const pts = []
  const h = 0.02
  for (let x = box[0][0]; x <= box[1][0]; x += h) for (let y = box[0][1]; y <= box[1][1]; y += h) for (let z = box[0][2]; z <= box[1][2]; z += h) if (f([x, y, z]) < h) pts.push([x, y, z])
  if (!pts.length) return { c: [0, 0, 0], r: 0 }
  const c = mul(pts.reduce((a, p) => add(a, p), [0, 0, 0]), 1 / pts.length)
  const r = Math.max(...pts.map((p) => len(sub(p, c)))) + h * 2
  return { c, r }
}

function unionField(parts) {
  return (p) => {
    let d = Infinity
    for (const q of parts) {
      const lb = len(sub(p, q.bc)) - q.br
      if (d !== Infinity && lb > d + q.blend) continue
      const v = q.f(p)
      d = d === Infinity ? v : smin(d, v, q.blend)
    }
    return d
  }
}

function mesh(parts, box, h) {
  const field = unionField(parts)
  const { positions, indices } = surfaceNets(field, box[0], box[1], h)
  return { field, positions, indices }
}

function simplify(positions, indices, target, err) {
  const idx = new Uint32Array(indices)
  const pos = new Float32Array(positions)
  const [out] = MeshoptSimplifier.simplify(idx, pos, 3, Math.min(idx.length, target * 3), err, [])
  const remap = new Int32Array(positions.length / 3).fill(-1)
  const verts = []
  let n = 0
  const tri = new Uint32Array(out.length)
  for (let i = 0; i < out.length; i++) {
    const v = out[i]
    if (remap[v] < 0) {
      remap[v] = n++
      verts.push(v)
    }
    tri[i] = remap[v]
  }
  return { verts, tri }
}

/** per-vertex attributes from the nearest parts */
function attributes(parts, field, head, P, normalsOut) {
  const n = P.length / 3
  const A = { bone: new Uint8Array(n * 4), code: new Uint8Array(n * 4), color: new Uint8Array(n * 4), face: new Int8Array(n * 4) }
  const e = 0.002
  for (let v = 0; v < n; v++) {
    const p = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]
    const g = [0, 1, 2].map((k) => {
      const a = [...p]
      const b = [...p]
      a[k] += e
      b[k] -= e
      return field(a) - field(b)
    })
    const gl = len(g) || 1
    const nrm = mul(g, 1 / gl)
    normalsOut.set(nrm, v * 3)
    // distances to the parts near the vertex
    let dmin = Infinity
    let near = null
    const byBone = new Map()
    for (const q of parts) {
      if (len(sub(p, q.bc)) - q.br > 0.06 && parts.length > 1) continue
      const d = q.f(p)
      if (d < dmin) {
        dmin = d
        near = q
      }
      const prev = byBone.get(q.bone)
      if (prev === undefined || d < prev) byBone.set(q.bone, d)
    }
    if (!near) {
      // nothing near (should not happen): the closest part overall
      for (const q of parts) {
        const d = q.f(p)
        if (d < dmin) {
          dmin = d
          near = q
        }
        if (!byBone.has(q.bone) || d < byBone.get(q.bone)) byBone.set(q.bone, d)
      }
    }
    // the torso surface never follows the arms (the clothes over it do not either)
    if (near.tag === 'torso') {
      byBone.delete(BONE.armL)
      byBone.delete(BONE.armR)
    }
    const ranked = [...byBone.entries()].sort((a, b) => a[1] - b[1])
    const [b0, d0] = ranked[0]
    const [b1, d1] = ranked[1] || [b0, Infinity]
    const sigma = 0.012
    const w1 = Math.exp(-(d1 - d0) / sigma)
    const w0 = 1 / (1 + w1)
    A.bone.set([b0, b1, Math.round(w0 * 255), typeof near.zone === 'function' ? near.zone(p) : near.zone], v * 4)
    const code = typeof near.code === 'function' ? near.code(p) : near.code
    const col = near.color ? hex(near.color) : [255, 255, 255]
    A.color.set([...col, 255], v * 4)
    A.code.set([code, near.prop || 0, near.fur ? 255 : 0, 0], v * 4)
    // face coordinates (front of the head, not on fixed parts like noses / horns)
    const fx = p[0] / head.r[0]
    const fy = (p[1] - head.c[1]) / head.r[1]
    const isFace = near.bone === BONE.head && near.zone === ZONE.head && code !== FIXED && nrm[2] > 0.05 && p[2] > head.c[2]
    A.face.set([Math.round(Math.max(-1.27, Math.min(1.27, fx)) * 100), Math.round(Math.max(-1.27, Math.min(1.27, fy)) * 100), isFace ? 127 : 0, 0], v * 4)
  }
  return A
}

/**
 * garment vertices: normal from the garment's own field, bones from the body point
 * under the cloth (so cloth and body bend together), colour from the piece; the
 * fur byte is 128 (= cloth) for the shader
 */
function garmentAttributes(bodyParts, field, piece, P, normalsOut) {
  const n = P.length / 3
  const A = { bone: new Uint8Array(n * 4), code: new Uint8Array(n * 4), color: new Uint8Array(n * 4), face: new Int8Array(n * 4) }
  const e = 0.002
  const col = piece.color ? hex(piece.color) : [255, 255, 255]
  for (let v = 0; v < n; v++) {
    const p = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]
    const g = [0, 1, 2].map((k) => {
      const a = [...p]
      const b = [...p]
      a[k] += e
      b[k] -= e
      return field(a) - field(b)
    })
    const nrm = mul(g, 1 / (len(g) || 1))
    normalsOut.set(nrm, v * 3)
    const q = sub(p, mul(nrm, 0.02))
    const tags = piece.follow(p)
    const byBone = new Map()
    for (const part of bodyParts) {
      if (!tags.includes(part.tag)) continue
      if (len(sub(q, part.bc)) - part.br > 0.08) continue
      const d = part.f(q)
      if (!byBone.has(part.bone) || d < byBone.get(part.bone)) byBone.set(part.bone, d)
    }
    const ranked = [...byBone.entries()].sort((a, b) => a[1] - b[1])
    const [b0, d0] = ranked[0] || [BONE.body, 0]
    const [b1, d1] = ranked[1] || [b0, Infinity]
    const w1 = Math.exp(-(d1 - d0) / 0.012)
    if (piece.rigid) A.bone.set([BONE.body, BONE.body, 255, 0], v * 4)
    else A.bone.set([b0, b1, Math.round((1 / (1 + w1)) * 255), 0], v * 4)
    A.color.set([...col, 255], v * 4)
    A.code.set([piece.code, 0, 128, 0], v * 4)
  }
  return A
}

/** assemble simplified pieces → one indexed mesh with the per-vertex attributes */
function assemble(pieces) {
  const nv = pieces.reduce((s, p) => s + p.verts.length / 3, 0)
  const ni = pieces.reduce((s, p) => s + p.tri.length, 0)
  const positions = new Float32Array(nv * 3)
  const normals = new Float32Array(nv * 3)
  const out = { bone: new Uint8Array(nv * 4), code: new Uint8Array(nv * 4), color: new Uint8Array(nv * 4), face: new Int8Array(nv * 4) }
  const index = new Uint32Array(ni)
  let vo = 0
  let io = 0
  for (const pc of pieces) {
    const m = pc.verts.length / 3
    positions.set(pc.verts, vo * 3)
    normals.set(pc.N, vo * 3)
    for (const k of Object.keys(out)) out[k].set(pc.A[k], vo * 4)
    for (let i = 0; i < pc.tri.length; i += 3) {
      index[io + i] = pc.tri[i] + vo
      index[io + i + 1] = pc.tri[i + 2] + vo
      index[io + i + 2] = pc.tri[i + 1] + vo
    }
    vo += m
    io += pc.tri.length
  }
  return { positions, normals, ...out, index }
}

/**
 * one species → { lods: [{ positions, normals, bone, code, color, face, index }], pivots, head }
 * targets: triangles per level (body; props get a share on top)
 */
export async function buildSpecies(S, { targets = [4200, 1100], cell = 0.0075 } = {}) {
  await MeshoptSimplifier.ready
  const B = speciesParts(S)
  const box = [[-0.42, -0.02, -0.62], [0.42, 1.32, 0.42]]
  for (const q of [...B.parts, ...B.props]) Object.assign(q, (({ c, r }) => ({ bc: c, br: r }))(bounds(q.f, box)))
  const parts = B.parts.filter((q) => q.br > 0)
  const props = B.props.filter((q) => q.br > 0)
  const body = mesh(parts, box, cell)
  // props: each prop id meshed on its own (thin parts: finer cells)
  const propMeshes = []
  for (const id of [...new Set(props.map((q) => q.prop))]) {
    const ps = props.filter((q) => q.prop === id)
    const lo = [0, 1, 2].map((k) => Math.min(...ps.map((q) => q.bc[k] - q.br)) - 0.02)
    const hi = [0, 1, 2].map((k) => Math.max(...ps.map((q) => q.bc[k] + q.br)) + 0.02)
    propMeshes.push({ id, parts: ps, ...mesh(ps, [lo, hi], cell * 0.8) })
  }
  const lods = targets.map((target, li) => {
    const pieces = []
    const bs = simplify(body.positions, body.indices, target, li ? 0.03 : 0.012)
    pieces.push({ src: body, parts, sel: bs })
    for (const pm of propMeshes) {
      if (!pm.indices.length) continue
      // props: small, few triangles (they sit on top of the body)
      const t = li ? 70 : 260
      pieces.push({ src: pm, parts: pm.parts, sel: simplify(pm.positions, pm.indices, t, li ? 0.08 : 0.04) })
    }
    // merge
    const nv = pieces.reduce((s, p) => s + p.sel.verts.length, 0)
    const ni = pieces.reduce((s, p) => s + p.sel.tri.length, 0)
    const positions = new Float32Array(nv * 3)
    const normals = new Float32Array(nv * 3)
    const out = { bone: new Uint8Array(nv * 4), code: new Uint8Array(nv * 4), color: new Uint8Array(nv * 4), face: new Int8Array(nv * 4) }
    const index = new Uint32Array(ni)
    let vo = 0
    let io = 0
    for (const pc of pieces) {
      const P = new Float32Array(pc.sel.verts.length * 3)
      pc.sel.verts.forEach((v, k) => P.set(pc.src.positions.slice(v * 3, v * 3 + 3), k * 3))
      const N = new Float32Array(P.length)
      const A = attributes(pc.parts, pc.src.field, B.head, P, N)
      positions.set(P, vo * 3)
      normals.set(N, vo * 3)
      for (const k of Object.keys(out)) out[k].set(A[k], vo * 4)
      // surface nets winds the quads inward: flip to counter-clockwise outside
      for (let i = 0; i < pc.sel.tri.length; i += 3) {
        index[io + i] = pc.sel.tri[i] + vo
        index[io + i + 1] = pc.sel.tri[i + 2] + vo
        index[io + i + 2] = pc.sel.tri[i + 1] + vo
      }
      vo += pc.sel.verts.length
      io += pc.sel.tri.length
    }
    return { positions, normals, ...out, index }
  })
  // clothes: every outfit the species may wear, each piece meshed and simplified on its own
  const bodyParts = parts.filter((q) => ['torso', 'neck', 'arm', 'hand', 'leg', 'foot'].includes(q.tag))
  const garments = {}
  for (const [name, list] of Object.entries(garmentPieces(S, { ...B, parts }))) {
    const built = list.map((pc) => {
      const { positions, indices } = surfaceNets(pc.f, GARMENT_BOX[0], GARMENT_BOX[1], cell * 0.85)
      return { pc, positions, indices }
    })
    garments[name] = targets.map((_, li) =>
      assemble(
        built
          .filter((b) => b.indices.length)
          .map(({ pc, positions, indices }) => {
            const full = indices.length / 3
            const sel = simplify(positions, indices, li ? Math.min(full, 260) : Math.min(full, 950), li ? 0.03 : 0.008)
            const P = new Float32Array(sel.verts.length * 3)
            sel.verts.forEach((v, k) => P.set(positions.slice(v * 3, v * 3 + 3), k * 3))
            const N = new Float32Array(P.length)
            const A = garmentAttributes(bodyParts, pc.f, pc, P, N)
            return { verts: P, N, A, tri: sel.tri }
          }),
      ),
    )
  }
  return { lods, garments, pivots: B.pivots, head: B.head, top: TOP }
}
