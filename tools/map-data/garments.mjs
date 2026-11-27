/**
 * Clothes for the critters (offline): separate meshes over the body, not paint.
 * Each garment piece is a shell — the body's torso / arms / legs grown by the
 * cloth gap + thickness — cut to its region (a slab of the torso, an arm or a
 * leg up to a fraction of its length, a front panel…). Every cut edge gets a
 * rolled band (hem, cuff, collar, waistband), sleeves and trouser legs get
 * shallow horizontal folds, skirts pleats, jumpers ribbing. Pieces are skinned
 * from the body point under them, so they move with the body and do not
 * cross it when the limbs swing.
 *
 * Colour codes: 4 = the NPC's top colour, 5 = bottom colour, 3 = fixed colour
 * (shirts, buttons). Normalized model space as critterMesh.mjs.
 */
import { roundCone, ellipsoid, smin } from '../../src/map/characters/sdf.js'

const GARB = 4
const GARC = 5
const FIXED = 3
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const len = (a) => Math.hypot(a[0], a[1], a[2])

/** smooth union of the parts with a tag */
function tagged(parts, tags) {
  const ps = parts.filter((q) => tags.includes(q.tag))
  return (p) => {
    let d = Infinity
    for (const q of ps) {
      const lb = len(sub(p, q.bc)) - q.br
      if (d !== Infinity && lb > d + q.blend) continue
      const v = q.f(p)
      d = d === Infinity ? v : smin(d, v, q.blend)
    }
    return d
  }
}

/**
 * one garment piece from components [{ field, region, gap, fold }]:
 * shell = min over components of max(field − gap − fold, region), plus a rolled
 * band (1.3 cm wide, 0.5 cm proud) along every region edge
 */
function piece(components, { code, color = null, band = 0.006, bandW = 0.013, rigid = false }) {
  const f = (p) => {
    let d = Infinity
    for (const c of components) {
      const body = c.field(p)
      if (body > 0.08) continue
      const r = c.region(p)
      const g = c.gap + (c.fold ? c.fold(p) : 0)
      const shell = Math.max(body - g, r)
      const rim = Math.max(body - g - band, Math.max(r, -r - bandW))
      d = Math.min(d, shell, c.noBand ? Infinity : rim)
    }
    return d
  }
  return { f, code, color, rigid }
}

export function garmentPieces(S, B) {
  const parts = B.parts
  const { sh, hand, hip, ankle, W } = B.axes
  const torso = tagged(parts, ['torso', 'neck'])
  const arms = tagged(parts, ['arm'])
  const legs = tagged(parts, ['leg'])
  const slab = (y0, y1) => (p) => Math.max(y0 - p[1], p[1] - y1)
  const armU = sub(hand, sh)
  const armL = len(armU)
  const legU = sub(ankle, hip)
  const legL = len(legU)
  const along = (o, u, L) => (p) => dot(sub([Math.abs(p[0]), p[1], p[2]], o), u) / (L * L)
  const armT = along(sh, armU, armL)
  const legT = along(hip, legU, legL)
  // region: the arm up to t1 of its length (and not inside the torso slab's job)
  const armTo = (t1) => (p) => (armT(p) - t1) * armL
  const legTo = (t1) => (p) => Math.max((legT(p) - t1) * legL, p[1] - 0.29)
  const sleeveFold = (p) => 0.003 * (0.5 + 0.5 * Math.sin(armT(p) * 46 + Math.abs(p[0]) * 30))
  const legFold = (p) => 0.003 * (0.5 + 0.5 * Math.sin(legT(p) * 40 + p[2] * 25))
  const hemDrape = (y0) => (p) => 0.004 * Math.max(0, 1 - (p[1] - y0) / 0.07) * (0.5 + 0.5 * Math.sin(Math.atan2(p[0], p[2]) * 11))
  const rib = (p) => 0.0025 * (0.5 + 0.5 * Math.sin(Math.atan2(p[0], p[2]) * 40))
  const top = (y0, y1, gap, extra = {}) => ({ field: torso, region: slab(y0, y1), gap, fold: hemDrape(y0), ...extra })
  const sleeve = (t1, gap, fold = sleeveFold) => ({ field: arms, region: armTo(t1), gap, fold })
  const trouser = (t1, gap) => ({ field: legs, region: legTo(t1), gap, fold: legFold })
  const pelvis = (y0, y1, gap) => ({ field: torso, region: slab(y0, y1), gap, noBand: true })
  const birdSleeve = B.axes.bird ? 0.5 : 1

  /** surface point of the torso straight out from (x, y) toward ±z (for straps) */
  const surfaceZ = (x, y, sgn) => {
    let lo = 0
    let hi = 0.3
    for (let k = 0; k < 30; k++) {
      const m = (lo + hi) / 2
      if (torso([x, y, sgn * m]) < 0) lo = m
      else hi = m
    }
    return sgn * lo
  }
  const strap = (x) => {
    const f0 = [x, 0.465, surfaceZ(x, 0.465, 1) + 0.016]
    const f1 = [x * 0.9, 0.53, surfaceZ(x * 0.9, 0.53, 1) + 0.012]
    const b1 = [x * 0.9, 0.53, surfaceZ(x * 0.9, 0.53, -1) - 0.012]
    const b0 = [x, 0.4, surfaceZ(x, 0.4, -1) - 0.016]
    const segs = [roundCone(f0, f1, 0.011, 0.011), roundCone(f1, b1, 0.011, 0.011), roundCone(b1, b0, 0.011, 0.011)]
    return (p) => Math.min(...segs.map((g) => g(p)))
  }
  const mirrorMin = (f) => (p) => Math.min(f(p), f([-p[0], p[1], p[2]]))
  const solid = (f, code, color) => ({ f, code, color })
  const buttons = (pts, color = '#e0b84a') => solid((p) => Math.min(...pts.map((c) => ellipsoid(c, [0.011, 0.011, 0.006])(p))), FIXED, color)
  const frontZ = (y) => surfaceZ(0, y, 1)

  const tee = piece([top(0.26, 0.535, 0.011), sleeve(0.42 * birdSleeve, 0.011)], { code: GARB })
  const trousers = (t1) => piece([pelvis(0.15, 0.3, 0.013), trouser(t1, 0.013)], { code: GARC })
  const shorts = piece([pelvis(0.15, 0.3, 0.013), trouser(0.4, 0.014)], { code: GARC })
  const out = {}
  out.tee = [tee, shorts]
  out.vest = [
    piece([top(0.26, 0.535, 0.009), sleeve(0.8 * birdSleeve, 0.009)], { code: FIXED, color: '#ece6d8' }),
    // open front: the slit |x| < 3 cm on the front is cut out of the vest
    piece([{ field: torso, region: (p) => Math.max(slab(0.27, 0.515)(p), -Math.max(Math.abs(p[0]) - 0.03, -p[2])), gap: 0.019, fold: hemDrape(0.27) }], { code: GARB }),
    buttons([0.3, 0.36, 0.42].map((y) => [0.045, y, frontZ(y) + 0.024]), '#3a2c24'),
    trousers(0.9),
  ]
  out.overalls = [
    tee,
    piece([pelvis(0.15, 0.31, 0.017), trouser(0.9, 0.017), { field: torso, region: (p) => Math.max(slab(0.15, 0.47)(p), Math.abs(p[0]) - 0.095 * W, -p[2] + 0.01), gap: 0.019 }], { code: GARC }),
    solid(mirrorMin(strap(0.07 * W)), GARC),
    buttons([[0.07 * W, 0.46, frontZ(0.46) + 0.028], [-0.07 * W, 0.46, frontZ(0.46) + 0.028]]),
  ]
  // dress: bodice + flared, pleated skirt (a solid cone around the legs)
  const skirtR0 = 0.16 * W + 0.02
  const skirtR1 = 0.23 * W
  const skirtCone = roundCone([0, 0.36, -0.005], [0, 0.12, -0.005], skirtR0, skirtR1)
  out.dress = [
    piece([top(0.33, 0.535, 0.012), sleeve(0.2 * birdSleeve, 0.02, (p) => 0.006 * Math.max(0, 1 - armT(p) / 0.2))], { code: GARB }),
    // the skirt hangs from the waist: body bone only (the legs swing inside it)
    piece([{ field: (p) => skirtCone(p) - 0.006 * (0.5 + 0.5 * Math.sin(Math.atan2(p[0], p[2]) * 16)), region: slab(0.13, 0.36), gap: 0 }], { code: GARB, band: 0.005, rigid: true }),
    solid((p) => Math.max(torso(p) - 0.022, slab(0.518, 0.54)(p)), FIXED, '#ffffff'),
  ]
  out.jumper = [piece([top(0.24, 0.545, 0.016, { fold: rib }), sleeve(0.84 * birdSleeve, 0.016, (p) => sleeveFold(p) + (armT(p) > 0.72 ? rib(p) : 0))], { code: GARB, band: 0.008, bandW: 0.02 }), trousers(0.9)]
  out.apron = [
    piece([{ field: torso, region: (p) => Math.max(slab(0.16, 0.5)(p), Math.abs(p[0]) - 0.12 * W, -p[2] + 0.015), gap: 0.014, fold: hemDrape(0.16) }], { code: GARB }),
    solid((p) => Math.max(torso(p) - 0.012, Math.max(slab(0.322, 0.338)(p), p[2] - 0.0)), GARB), // waist tie (back)
    solid((p) => Math.max(torso(p) - 0.012, slab(0.52, 0.535)(p)), GARB), // neck strap
  ]
  const allowed = S.outfits
  return Object.fromEntries(Object.entries(out).filter(([k]) => allowed.includes(k)))
}

/** a garment piece's bounding box (where the shell can be) */
export const GARMENT_BOX = [[-0.36, 0.06, -0.3], [0.36, 0.6, 0.32]]
