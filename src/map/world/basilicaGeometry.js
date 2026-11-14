import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * Basílica de la Sagrada Família — procedural geometry (no rendering code),
 * in its COMPLETED state: no cranes, scaffolding or hoardings. Used offline by
 * tools/map-data/build_basilica.mjs (meshopt glb, two LODs + colliders).
 *
 * Sources (see docs/reference/sagrada-familia/ANALYSIS.md):
 *  [photo]    the 31 reference photos (docs/reference/sagrada-familia/):
 *             Nativity & Passion façades and towers, mosaic finials, aisle
 *             gables, apse pinnacles, sacristy dome, stone colours
 *  [official] completion design as published (Foundation statements, press):
 *             Jesus tower 172.5 m with a 17 × 13.5 m four-armed cross,
 *             Glory façade: 8 columns, 16 lanterns (7 + 9) up to ≈ 80 m,
 *             4 Glory towers (112 / 117 m), 18 towers in total, cloister,
 *             Assumption chapel dome, second sacristy
 *
 * Model axes (metres): nave along z (apse −z, Glory façade +z), transept
 * along x (Nativity +x, Passion −x), y up. Footprint ≈ 96 × 104 m.
 * Heights: Jesus Christ 172.5 · Virgin Mary 138 · Evangelists 135 ·
 * Glory 112–117 · Passion 107–112 · Nativity 98.5–107.
 *
 * lod 0 = near model (all ornament), lod 1 = far model (main masses only).
 * Stone parts carry `aTower` (u = angle, v = relative height, w = slit
 * strength) for the louvre / lattice pattern in the shader.
 */

// stone tints (vertex colours), sampled from the midday photos (5, 10):
// aged Nativity stone, Passion / nave sandstone, pale new central towers
const OLD = new THREE.Color('#9a8264')
const STONE = new THREE.Color('#c2ab8a')
const NEW = new THREE.Color('#d6c8b0')
const PALE = new THREE.Color('#e4dccd') // Passion pediment, Glory lanterns
const WHITE = new THREE.Color('#f3f0e8')
const RED = new THREE.Color('#c23a2b')
const ORANGE = new THREE.Color('#de7a2c')
const GOLD = new THREE.Color('#e3b440')
const GREEN = new THREE.Color('#3f7a46')
const BLUE = new THREE.Color('#3e6fb0')
const GLASS = new THREE.Color('#33404a')
const MANTLE = new THREE.Color('#5b84b8') // Assumption chapel dome

// deterministic jitter so repeated parts are not identical
let seed = 1
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
const jitter = (c, a = 0.05) => c.clone().multiplyScalar(1 - a + 2 * a * rnd())

class Builder {
  constructor(lod) {
    this.lod = lod
    this.near = lod === 0
    this.parts = { stone: [], mosaic: [], glass: [] }
    this.colliders = []
    this.m = new THREE.Matrix4()
    this.q = new THREE.Quaternion()
    this.e = new THREE.Euler()
  }
  /**
   * add a geometry with a uniform colour (and optional per-vertex tower data)
   * opts.collider: false → no collision shape, object → that shape (model space)
   */
  add(kind, geo, color, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1], opts = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone()
    g.deleteAttribute('uv')
    g.deleteAttribute('normal') // recomputed after the merge
    const n = g.attributes.position.count
    if (!g.attributes.color) {
      const c = new Float32Array(n * 3)
      for (let k = 0; k < n; k++) color.toArray(c, k * 3)
      g.setAttribute('color', new THREE.BufferAttribute(c, 3))
    }
    if (kind === 'stone' && !g.attributes.aTower) g.setAttribute('aTower', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
    if (kind !== 'stone') g.deleteAttribute('aTower')
    this.e.set(rot[0], rot[1], rot[2])
    this.m.compose(new THREE.Vector3(...pos), this.q.setFromEuler(this.e), new THREE.Vector3(...scale))
    g.applyMatrix4(this.m)
    this.parts[kind].push(g)
    if (opts.collider === false) return
    if (opts.collider) this.colliders.push(opts.collider)
    else this.collider(geo, pos, rot, scale)
  }
  /**
   * Simplified collision shape for each part (model space). Tilts about x/z
   * are ignored (only small leaning columns use them); ornaments under 0.5 m
   * are skipped.
   */
  collider(geo, [x, y, z], [, ry], [sx, sy, sz]) {
    const p = geo.parameters || {}
    const c = geo.userData.collider
    const push = (o) => this.colliders.push(o)
    if (c?.type === 'tower') push({ type: 'tower', x, z, y0: y, ...c.params })
    else if (c?.type === 'lathe') push({ type: 'lathe', x, z, y0: y, pts: c.pts.map((v) => Math.round(v * 100) / 100) })
    else if (c?.type === 'gable') push({ type: 'gable', x, y0: y, z, w: c.w, h: c.h, len: c.len, ry })
    else if (geo.type === 'BoxGeometry') push({ type: 'box', x, y, z, hx: (p.width * sx) / 2, hy: (p.height * sy) / 2, hz: (p.depth * sz) / 2, ry })
    else if (geo.type === 'ConeGeometry' || geo.type === 'CylinderGeometry') {
      // frustum of the faceted solid: radius between apothem and corner
      const facet = (1 + Math.cos(Math.PI / p.radialSegments)) / 2
      const cone = geo.type === 'ConeGeometry'
      const o = { type: 'cyl', x, z, y0: y - (p.height * sy) / 2, h: p.height * sy, rb: (cone ? p.radius : p.radiusBottom) * sx * facet, rt: (cone ? 0 : p.radiusTop) * sx * facet }
      if (p.thetaLength < Math.PI * 2 - 1e-6) {
        // half shell (apse): keep the side facing the middle angle
        const mid = p.thetaStart + p.thetaLength / 2 + ry
        o.cut = [Math.sin(mid), Math.cos(mid)]
      }
      if (o.h >= 0.5 && Math.max(o.rb, o.rt) >= 0.3) push(o)
    } else if (geo.type === 'TorusGeometry') {
      // ring laid flat (rotated about x): a thin disc
      push({ type: 'cyl', x, z, y0: y - p.tube * sy, h: 2 * p.tube * sy, rb: (p.radius + p.tube) * sx, rt: (p.radius + p.tube) * sx })
    } else if (p.radius && p.radius * Math.max(sx, sy, sz) >= 0.5) {
      // icosahedra: between in- and circumradius
      const k = p.detail ? 0.95 : 0.9
      push({ type: 'sphere', x, y, z, r: p.radius * Math.max(sx, sy, sz) * k })
    }
  }
  box(kind, color, size, pos, rot, opts) {
    this.add(kind, new THREE.BoxGeometry(...size), color, pos, rot, undefined, opts)
  }
  /** merged geometries (one per material) + colliders */
  result() {
    const out = { colliders: this.colliders }
    for (const [k, list] of Object.entries(this.parts)) {
      if (!list.length) continue
      const g = mergeGeometries(list, false)
      list.forEach((x) => x.dispose())
      g.computeVertexNormals()
      out[k] = g
    }
    return out
  }
}

const towerData = (g, H, slit) => {
  const p = g.attributes.position
  const tw = new Float32Array(p.count * 3)
  for (let v = 0; v < p.count; v++) {
    tw[v * 3] = (Math.atan2(p.getZ(v), p.getX(v)) / (Math.PI * 2) + 1) % 1
    tw[v * 3 + 1] = p.getY(v) / H
    tw[v * 3 + 2] = slit
  }
  g.setAttribute('aTower', new THREE.BufferAttribute(tw, 3))
}
const profileR = (r0, t, body, taper, k) => (t < body ? r0 * (1 - taper * (t / body)) : r0 * (1 - taper) * (1 - Math.pow((t - body) / (1 - body), k)))

/**
 * Apostle tower [photo 1, 3]: round shaft with rows of louvred openings,
 * mouldings between the stages, parabolic spire.
 */
function towerGeometry(r0, H, { segments = 14, body = 0.55, taper = 0.18, k = 1.8, slit = 1, steps = 40 } = {}) {
  const pts = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    let r = profileR(r0, t, body, taper, k)
    // horizontal mouldings between the louvre stages
    if (t < 0.85 && Math.abs(((t * 9) % 1) - 0.5) < 0.04) r *= 1.05
    pts.push(new THREE.Vector2(Math.max(r, 0.25), t * H))
  }
  const g = new THREE.LatheGeometry(pts, segments)
  towerData(g, H, slit)
  g.userData.collider = { type: 'tower', params: { r0, H, body, taper, k } }
  return g
}

/**
 * Central towers (Evangelists, Mary, Jesus) [photo 1, 3, 11; official]:
 * rounded-square section with vertical ribs and horizontal bands, tapering
 * into a parabolic top. The collider uses the round profile of the mean radius.
 */
function ribbedTower(r0, H, { body = 0.62, taper = 0.12, k = 2.2, ribs = 16, rib = 0.05, square = 3.2, segments = 48, rings = 44, slit = 0.7 } = {}) {
  const pos = []
  const idx = []
  const radial = (th) => {
    // superellipse (rounded square) × rib modulation, normalised to mean ≈ 1
    const c = Math.abs(Math.cos(th))
    const s = Math.abs(Math.sin(th))
    const sq = 1 / Math.pow(Math.pow(c, square) + Math.pow(s, square), 1 / square)
    return (sq / 1.09) * (1 + rib * Math.pow(Math.cos(ribs * th), 2) - rib / 2)
  }
  for (let j = 0; j <= rings; j++) {
    const t = j / rings
    let r = Math.max(profileR(r0, t, body, taper, k), 0.3)
    if (t < 0.8 && Math.abs(((t * 11) % 1) - 0.5) < 0.05) r *= 1.04 // stone bands
    const round = Math.min(1, Math.max(0, (t - body) / (1 - body)) * 1.6) // the top rounds off
    for (let i = 0; i <= segments; i++) {
      const th = (i / segments) * Math.PI * 2
      const f = 1 + (radial(th) - 1) * (1 - round)
      pos.push(Math.cos(th) * r * f, t * H, Math.sin(th) * r * f)
    }
  }
  const w = segments + 1
  for (let j = 0; j < rings; j++)
    for (let i = 0; i < segments; i++) {
      const a = j * w + i
      idx.push(a, a + w, a + 1, a + 1, a + w, a + w + 1)
    }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  towerData(g, H, slit)
  g.userData.collider = { type: 'tower', params: { r0, H, body, taper, k } }
  return g
}

/** gable prism, ridge along z */
function gable(w, h, len) {
  const s = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, h)])
  const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false })
  g.translate(0, 0, -len / 2)
  g.userData.collider = { type: 'gable', w, h, len }
  return g
}

/** pointed (parabolic) gable outline, ridge along z — the aisle gables of photo 1 */
function pointedGable(w, h, len, steps = 6) {
  const pts = []
  for (let i = 0; i <= steps; i++) {
    const u = i / steps
    pts.push(new THREE.Vector2(-w / 2 + (w / 2) * u, h * (1 - Math.pow(1 - u, 1.8))))
  }
  for (let i = steps - 1; i >= 0; i--) pts.push(new THREE.Vector2(-pts[i].x, pts[i].y))
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: len, bevelEnabled: false })
  g.translate(0, 0, -len / 2)
  g.userData.collider = { type: 'gable', w, h, len }
  return g
}

/** lathe whose collider is its own profile */
function latheCollide(pts, segments) {
  const g = new THREE.LatheGeometry(pts, segments)
  g.userData.collider = { type: 'lathe', pts: [0, pts[0].y, ...pts.flatMap((v) => [v.x, v.y]), 0, pts[pts.length - 1].y] }
  return g
}

/**
 * Apostle tower finial [photo 3, 11]: tall hexagonal mosaic shaft banded
 * red / orange / white with white balls on its edges, crowned by a vertical
 * disc (red, white balls on the rim, gold cross) facing out of the façade.
 * `len` ≈ 22 % of the tower height.
 */
function apostleFinial(b, x, y0, z, len, r, facing, palette) {
  const shaftH = len * 0.8
  const shaft = new THREE.CylinderGeometry(r * 0.32, r, shaftH, 6, b.near ? 8 : 1).toNonIndexed()
  const p = shaft.attributes.position
  const col = new Float32Array(p.count * 3)
  const bands = [palette[0], palette[1], palette[0], WHITE] // mostly colour [photo 3]
  for (let v = 0; v < p.count; v++) {
    // colour per band (by triangle centre so bands stay crisp)
    const tri = Math.floor(v / 3) * 3
    const yc = (p.getY(tri) + p.getY(tri + 1) + p.getY(tri + 2)) / 3
    bands[Math.min(7, Math.max(0, Math.floor((yc / shaftH + 0.5) * 8))) % 4].toArray(col, v * 3)
  }
  shaft.setAttribute('color', new THREE.BufferAttribute(col, 3))
  b.add('mosaic', shaft, WHITE, [x, y0 + shaftH / 2, z], [0, facing, 0], undefined, {
    collider: { type: 'cyl', x, z, y0, h: shaftH, rb: r * 0.93, rt: r * 0.3 },
  })
  if (b.near) {
    // white balls along the six edges
    const ball = new THREE.IcosahedronGeometry(r * 0.16, 0)
    for (let e = 0; e < 6; e++) {
      const a = facing + (e / 6) * Math.PI * 2
      for (let s = 1; s < 10; s++) {
        const t = s / 10
        const rr = r * (1 - 0.68 * t) * 1.02
        b.add('mosaic', ball, WHITE, [x + Math.cos(a) * rr, y0 + t * shaftH, z - Math.sin(a) * rr], undefined, undefined, { collider: false })
      }
    }
  }
  // crown: vertical disc facing out (rotated about y to the façade normal)
  const yc = y0 + shaftH + r * 1.25
  const disc = new THREE.CylinderGeometry(r * 1.25, r * 1.25, r * 0.35, b.near ? 20 : 10)
  b.add('mosaic', disc, palette[0], [x, yc, z], [0, facing, Math.PI / 2], undefined, { collider: { type: 'sphere', x, y: yc, z, r: r * 1.15 } })
  b.add('mosaic', new THREE.IcosahedronGeometry(r * 0.5, 1), GOLD, [x, y0 + shaftH, z], undefined, undefined, { collider: false })
  if (b.near) {
    const fx = Math.cos(facing)
    const fz = -Math.sin(facing)
    const ball = new THREE.IcosahedronGeometry(r * 0.2, 0)
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2
      // rim in the disc plane (spanned by up and the horizontal perpendicular)
      const px = -fz * Math.cos(a) * r * 1.3
      const pz = fx * Math.cos(a) * r * 1.3
      b.add('mosaic', ball, WHITE, [x + px, yc + Math.sin(a) * r * 1.3, z + pz], undefined, undefined, { collider: false })
    }
    // gold cross on both faces of the disc
    for (const sgn of [-1, 1]) {
      const ox = fx * sgn * r * 0.2
      const oz = fz * sgn * r * 0.2
      b.box('mosaic', GOLD, [r * 0.3, r * 1.6, r * 0.3], [x + ox, yc, z + oz], [0, facing, 0], { collider: false })
      b.box('mosaic', GOLD, [r * 0.3, r * 0.3, r * 1.6], [x + ox, yc, z + oz], [0, facing, 0], { collider: false })
    }
  }
}

/** apostle tower with its finial; H = full height to the top of the disc */
function apostleTower(b, x, z, H, r0, color, facing, palette) {
  const body = H * 0.76
  const BELL = { segments: b.near ? 22 : 12, body: 0.62, taper: 0.1, k: 2.6, steps: b.near ? 40 : 18 }
  b.add('stone', towerGeometry(r0, body, BELL), jitter(color, 0.03), [x, 0, z])
  // shaft (0.8 len) + disc (2.5 r) end exactly at H
  const r = r0 * 0.52
  apostleFinial(b, x, body - 1.5, z, (H - body + 1.5 - 2.5 * r) / 0.8, r, facing, palette)
  if (b.near) {
    // seated apostle figure on the outer face, a third of the way up
    const fx = Math.cos(facing)
    const fz = -Math.sin(facing)
    b.add('stone', new THREE.IcosahedronGeometry(1.1, 0), jitter(color, 0.08), [x + fx * (r0 + 0.6), body * 0.45, z + fz * (r0 + 0.6)], [0, facing, 0], [1, 1.8, 1], { collider: false })
  }
}

/** small pinnacle crowned with a coloured "fruit" ball */
function pinnacle(b, x, y, z, h, color, fruit, segs = 6) {
  b.add('stone', new THREE.ConeGeometry(h * 0.17, h, segs), jitter(color, 0.04), [x, y + h / 2, z])
  if (fruit) b.add('mosaic', new THREE.IcosahedronGeometry(h * 0.16, 0), fruit, [x, y + h + h * 0.08, z])
}

/** stepped spire of the apse crown [photo 2, 4]: three stacked cones */
function apsePinnacle(b, x, y, z, h, color, fruit) {
  if (!b.near) return pinnacle(b, x, y, z, h, color, fruit)
  let yy = y
  for (const [f, r] of [[0.42, 0.2], [0.33, 0.15], [0.25, 0.1]]) {
    b.add('stone', new THREE.ConeGeometry(h * r, h * f * 1.25, 8), jitter(color, 0.04), [x, yy + (h * f * 1.25) / 2, z])
    yy += h * f * 0.8
  }
  b.add('mosaic', new THREE.IcosahedronGeometry(h * 0.08, 0), fruit, [x, y + h + 0.6, z])
}

/** tall pointed window: dark glass panel + pointed head, set on a wall facing ±x or ±z */
function windowPanel(b, x, y, z, w, h, facing) {
  const along = Math.abs(facing % Math.PI) < 0.01 ? 'x' : 'z' // wall plane
  const size = along === 'x' ? [w, h, 0.25] : [0.25, h, w]
  b.box('glass', GLASS, size, [x, y + h / 2, z], undefined, { collider: false })
  const head = gable(w, w * 0.9, 0.25)
  b.add('glass', head, GLASS, [x, y + h, z], [0, along === 'z' ? Math.PI / 2 : 0, 0], undefined, { collider: false })
}

/** round rose window on a vertical plane (normal along x when alongX) */
function rose(b, x, y, z, r, alongX) {
  b.add('glass', new THREE.CylinderGeometry(r, r, 0.3, 14), GLASS, [x, y, z], alongX ? [0, 0, Math.PI / 2] : [Math.PI / 2, 0, 0], undefined, { collider: false })
}

/** sculpted relief: clustered lumps + stalactites over a façade face (normal +x before rotation) */
function relief(b, cx, cz, normal, w, y0, y1, count, color) {
  const lump = new THREE.IcosahedronGeometry(1, 0)
  const drip = new THREE.ConeGeometry(0.6, 3, 5)
  const nx = Math.cos(normal)
  const nz = -Math.sin(normal)
  for (let k = 0; k < count; k++) {
    const u = (rnd() - 0.5) * w
    const y = y0 + Math.pow(rnd(), 0.8) * (y1 - y0)
    const out = 0.3 + rnd() * 1.2
    const px = cx + nx * out - nz * u
    const pz = cz + nz * out + nx * u
    if (k % 6 === 5) b.add('stone', drip, jitter(color, 0.1), [px, y, pz], [Math.PI, 0, 0], [1, 0.8 + rnd(), 1], { collider: false })
    else b.add('stone', lump, jitter(color, 0.12), [px, y, pz], [rnd() * 6, rnd() * 6, 0], [0.8 + rnd() * 0.9, 1 + rnd() * 1.2, 0.8 + rnd() * 0.9])
  }
}

/**
 * Hyperboloid lantern of the Glory façade [official]: hourglass shaft with a
 * mosaic tip.
 */
function lantern(b, x, y, z, h, r, color) {
  const pts = []
  const n = b.near ? 12 : 5
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const rr = r * Math.sqrt(0.32 + Math.pow((t - 0.62) / 0.5, 2)) * (1 - 0.35 * t)
    pts.push(new THREE.Vector2(Math.max(rr, 0.3), t * h))
  }
  pts.push(new THREE.Vector2(0.01, h * 1.06))
  const g = latheCollide(pts, b.near ? 16 : 8)
  towerData(g, h, 0.5)
  b.add('stone', g, jitter(color, 0.03), [x, y, z])
  b.add('mosaic', new THREE.IcosahedronGeometry(r * 0.35, 0), GOLD, [x, y + h * 1.08, z])
}

/**
 * Sacristy [photo 1, 11, 13]: square base, drum, latticed paraboloid dome
 * crowned with a finial. The lattice is the louvre pattern of the shader.
 */
function sacristy(b, x, z, color) {
  const near = b.near
  b.box('stone', jitter(color, 0.03), [17, 10, 17], [x, 5, z])
  b.add('stone', new THREE.CylinderGeometry(8, 8.6, 8, near ? 24 : 12), jitter(color, 0.03), [x, 14, z])
  const pts = []
  for (let i = 0; i <= (near ? 14 : 6); i++) {
    const t = i / (near ? 14 : 6)
    pts.push(new THREE.Vector2(Math.max(8 * (1 - Math.pow(t, 1.6)), 0.4), 18 + t * 22))
  }
  const dome = latheCollide(pts, near ? 24 : 12)
  const p = dome.attributes.position
  const tw = new Float32Array(p.count * 3)
  for (let v = 0; v < p.count; v++) {
    tw[v * 3] = (Math.atan2(p.getZ(v), p.getX(v)) / (Math.PI * 2) + 1) % 1
    tw[v * 3 + 1] = (p.getY(v) - 18) / 22
    tw[v * 3 + 2] = 1
  }
  dome.setAttribute('aTower', new THREE.BufferAttribute(tw, 3))
  b.add('stone', dome, jitter(color, 0.03), [x, 0, z])
  if (near) for (const y of [24, 30, 35]) b.add('stone', new THREE.TorusGeometry(8 * (1 - Math.pow((y - 18) / 22, 1.6)), 0.25, 4, 24), color, [x, y, z], [Math.PI / 2, 0, 0], undefined, { collider: false })
  pinnacle(b, x, 40, z, 6, PALE, GOLD)
  // corner pinnacles of the base
  if (near) for (const [dx, dz] of [[-8, -8], [8, -8], [-8, 8], [8, 8]]) pinnacle(b, x + dx, 10, z + dz, 6, color, null)
}

/**
 * Evangelist symbol / Mary's star / Jesus' cross on the central towers
 * [photo 4, 11; official].
 */
function evangelistSymbol(b, x, y, z, i) {
  const col = [GOLD, ORANGE, BLUE, WHITE][i]
  b.add('mosaic', new THREE.IcosahedronGeometry(2.6, b.near ? 1 : 0), WHITE, [x, y, z])
  b.add('mosaic', new THREE.IcosahedronGeometry(1.2, 0), col, [x, y + 2.8, z])
  for (const s of [-1, 1]) b.box('mosaic', WHITE, [7, 0.7, 2], [x + s * 3, y + 1, z], [0, i * 0.8, s * 0.45], { collider: false }) // wings
}

export function buildBasilica({ lod = 0 } = {}) {
  seed = 1
  const b = new Builder(lod)
  const near = lod === 0
  const fruits = [RED, ORANGE, GOLD, GREEN, WHITE]

  // ---- body: nave (5 aisles), transept, apse ----------------------------
  b.box('stone', STONE, [45, 45, 70], [0, 22.5, 9])
  b.add('stone', gable(45, 16, 70), NEW, [0, 45, 9])
  b.box('stone', STONE, [76, 45, 30], [0, 22.5, 0]) // transept
  b.add('stone', gable(30, 15, 76), NEW, [0, 45, 0], [0, Math.PI / 2, 0])
  for (const sx of [-1, 1]) {
    // outer aisles
    b.box('stone', STONE, [12, 30, 64], [sx * 28.5, 15, 10])
    // aisle gables [photo 1, 3]: pointed, a rose window, gold-tipped pinnacles between
    for (let z = -16; z <= 38; z += 9) {
      if (Math.abs(z) < 16) continue // the transept
      b.add('stone', pointedGable(8, 12, 3), jitter(STONE, 0.03), [sx * 34.2, 30, z], [0, Math.PI / 2, 0])
      pinnacle(b, sx * 34.5, 30, z + 4.5, 9, PALE, GOLD)
      if (near) {
        rose(b, sx * 35.8, 34, z, 1.6, true)
        // two tiers of tall windows in the aisle wall, buttresses between
        windowPanel(b, sx * 34.65, 6, z, 3.2, 9, Math.PI / 2)
        windowPanel(b, sx * 34.65, 18, z, 3.2, 8, Math.PI / 2)
        b.box('stone', jitter(STONE, 0.04), [1.6, 30, 1.6], [sx * 35, 15, z + 4.5])
      }
    }
    // clerestory windows above the aisle roofs
    if (near) for (let z = -18; z <= 42; z += 6) if (Math.abs(z) > 16) windowPanel(b, sx * 22.65, 31, z, 2.6, 11, Math.PI / 2)
  }
  // nave-roof lanterns along the ridge
  if (near) for (let z = 18; z <= 40; z += 7) b.add('stone', new THREE.ConeGeometry(1.6, 7, 8), NEW, [0, 63, z])
  // apse + chapels, crowned by stepped pinnacles [photo 2, 4]
  b.add('stone', new THREE.CylinderGeometry(24, 25, 40, near ? 28 : 14, 1, false, Math.PI / 2, Math.PI), STONE, [0, 20, -26])
  for (let a = 0; a < 7; a++) {
    const ang = Math.PI + (a / 6) * Math.PI
    const x = Math.cos(ang) * 25.5
    const z = -26 + Math.sin(ang) * 25.5
    b.add('stone', new THREE.CylinderGeometry(3.6, 4.2, 30, near ? 10 : 6), jitter(STONE, 0.03), [x, 15, z])
    apsePinnacle(b, x, 30, z, 18, STONE, fruits[a % 5])
  }
  // inner ring of slender spires around the apse top
  if (near)
    for (let a = 0; a < 12; a++) {
      const ang = Math.PI + ((a + 0.5) / 12) * Math.PI
      pinnacle(b, Math.cos(ang) * 19, 40, -26 + Math.sin(ang) * 19, 13, NEW, fruits[(a + 2) % 5], 8)
    }
  // roof pinnacles along the nave and transept ridges
  for (let z = -18; z <= 40; z += 8) for (const sx of [-1, 1]) pinnacle(b, sx * 22.5, 45, z, 9, NEW, fruits[(z / 8 + 9) % 5 | 0])
  for (let x = -34; x <= 34; x += 8) if (Math.abs(x) > 20) for (const sz of [-1, 1]) pinnacle(b, x, 45, sz * 15, 9, NEW, fruits[(x / 8 + 9) % 5 | 0])

  // ---- Nativity façade (+x) [photo 13, 6]: aged stone, three portals -----
  b.box('stone', OLD, [7, 42, 44], [41, 21, 0])
  for (const [z, h, w] of [[-12, 40, 10], [0, 52, 13], [12, 40, 10]]) {
    // receding archivolts (nested pointed frames), dark doorway
    const layers = near ? 4 : 1
    for (let l = 0; l < layers; l++) {
      const s = 1 - l * 0.16
      b.add('stone', gable(w * s, h * 0.45 * s, 5 - l), jitter(OLD, 0.06), [44.5 - l * 0.6, h * 0.55, z], [0, Math.PI / 2, 0])
      b.box('stone', jitter(OLD, 0.06), [5 - l, h * 0.55, w * s], [44.5 - l * 0.6, (h * 0.55) / 2, z])
    }
    if (near) b.box('glass', new THREE.Color('#2a2622'), [0.3, h * 0.3, w * 0.35], [47.1, h * 0.15, z], undefined, { collider: false })
  }
  // sculpted relief over the portal faces, densest on the central portal
  relief(b, 47, 0, 0, 40, 5, 52, near ? 420 : 60, OLD)
  // the Tree of Life cypress with its white doves
  b.add('mosaic', new THREE.ConeGeometry(3.4, 16, near ? 12 : 8), GREEN, [45, 61, 0])
  if (near) b.add('mosaic', new THREE.ConeGeometry(2.6, 8, 12), GREEN.clone().multiplyScalar(1.15), [45, 57, 0], undefined, undefined, { collider: false })
  for (let k = 0; k < (near ? 10 : 3); k++) b.add('mosaic', new THREE.IcosahedronGeometry(0.7, 0), WHITE, [45 + Math.cos(k) * 2.8, 54 + k * 1.3, Math.sin(k) * 2.8])
  ;[[-16.5, 98.5], [-5.5, 107], [5.5, 107], [16.5, 98.5]].forEach(([z, H], i) => apostleTower(b, 41, z, H, 4.3, OLD, 0, i % 2 ? [GOLD, RED] : [RED, ORANGE]))

  // ---- Passion façade (−x) [photo 1, 3, 9, 19]: bone columns, ribbed pediment
  b.box('stone', STONE, [7, 44, 44], [-41, 22, 0])
  b.box('stone', PALE, [10, 2.2, 42], [-48, 21, 0]) // portico canopy
  for (let k = 0; k < 6; k++) {
    const z = -17.5 + k * 7
    // bone-like: thin at both ends, swollen in the middle
    const pts = []
    for (let i = 0; i <= (near ? 10 : 4); i++) {
      const t = i / (near ? 10 : 4)
      pts.push(new THREE.Vector2(0.8 + 1.0 * Math.sin(Math.PI * t) + (t > 0.85 ? (t - 0.85) * 6 : 0), t * 21))
    }
    const bone = latheCollide(pts, near ? 12 : 6)
    b.add('stone', bone, jitter(PALE, 0.03), [-49, 0, z], [(k % 2 ? 1 : -1) * 0.16, 0, 0.08])
  }
  // crowning pediment: 18 inclined ribs, white, tent-like [photo 1]
  for (let k = 0; k < 18; k++) {
    const z = -20.4 + k * 2.4
    const h = 36 * (1 - Math.abs(z) / 22)
    if (h < 2) continue
    if (near) b.add('stone', new THREE.CylinderGeometry(0.45, 0.75, h, 6), jitter(PALE, 0.02), [-46.2, 23 + h / 2, z], [0, 0, -0.12])
    else b.box('stone', PALE, [1.2, h, 1.2], [-46, 23 + h / 2, z])
  }
  b.add('stone', gable(44, 36, 1.6), PALE, [-45.4, 22.5, 0], [0, Math.PI / 2, 0])
  // frieze [photo 1, 3]: a row of standing figures on the portico canopy
  if (near)
    for (let k = 0; k < 14; k++) {
      const z = -19.5 + k * 3
      b.add('stone', new THREE.IcosahedronGeometry(0.7, 0), jitter(STONE, 0.1), [-49 - (k % 2) * 0.6, 24.2, z], [0, k, 0], [1, 2.4, 1], { collider: false })
    }
  b.box('mosaic', GOLD, [0.8, 8, 0.8], [-46.8, 60, 0]) // cross
  b.box('mosaic', GOLD, [0.8, 0.8, 5], [-46.8, 62, 0])
  ;[[-16.5, 107], [-5.5, 112], [5.5, 112], [16.5, 107]].forEach(([z, H], i) => apostleTower(b, -41, z, H, 4.4, STONE, Math.PI, i % 2 ? [RED, ORANGE] : [ORANGE, RED]))

  // ---- Glory façade (+z) [official design] -------------------------------
  b.box('stone', NEW, [46, 45, 6], [0, 22.5, 46]) // façade wall closing the nave (z 43–49)
  ;[[-16.5, 112], [-5.5, 117], [5.5, 117], [16.5, 112]].forEach(([x, H], i) => apostleTower(b, x, 46.5, H, 4.6, NEW, -Math.PI / 2, i % 2 ? [GOLD, WHITE] : [RED, GOLD]))
  // porch: 8 columns (the Beatitudes), roof slab at 30 m
  for (let k = 0; k < 8; k++) b.add('stone', new THREE.CylinderGeometry(1.2, 1.7, 30, near ? 12 : 6), jitter(NEW, 0.03), [-21 + k * 6, 15, 59.5])
  b.box('stone', NEW, [50, 3, 11], [0, 31.5, 55])
  // 16 hyperboloid lanterns rising toward the centre: 7 in front, 9 behind
  for (let k = 0; k < 7; k++) {
    const x = -18 + k * 6
    lantern(b, x, 33, 57, 18 + (1 - Math.abs(x) / 18) * 28, 2.4, PALE)
  }
  for (let k = 0; k < 9; k++) {
    const x = -20 + k * 5
    lantern(b, x, 33, 52.5, 26 + (1 - Math.abs(x) / 20) * 21, 2.1, PALE)
  }
  if (near) for (let k = 0; k < 5; k++) windowPanel(b, -12 + k * 6, 6, 49.2, 3, 14, 0)

  // ---- sacristies at the apse corners [photo 1, 11, 13] ------------------
  sacristy(b, -37, -42, STONE)
  sacristy(b, 37, -42, OLD)
  // ---- cloister around the apse, Assumption chapel [official] -----------
  b.box('stone', STONE, [56, 11, 3], [0, 5.5, -54])
  for (const sx of [-1, 1]) {
    b.box('stone', STONE, [4, 11, 22], [sx * 46, 5.5, -26])
    b.box('stone', STONE, [4, 11, 26], [sx * 46, 5.5, 32])
  }
  b.add('stone', new THREE.CylinderGeometry(5.5, 5.5, 12, near ? 20 : 10), STONE, [0, 6, -56])
  b.add('mosaic', new THREE.SphereGeometry(5.5, near ? 20 : 10, near ? 10 : 5, 0, Math.PI * 2, 0, Math.PI / 2), MANTLE, [0, 12, -56], undefined, undefined, {
    collider: { type: 'sphere', x: 0, y: 12, z: -56, r: 5.3 },
  })
  if (near) {
    for (let x = -24; x <= 24; x += 6) if (Math.abs(x) > 8) windowPanel(b, x, 2, -55.6, 2.4, 7, 0)
    for (const sx of [-1, 1]) for (const z of [-34, -26, -18, 24, 32, 40]) windowPanel(b, sx * 48.1, 2, z, 2.4, 7, Math.PI / 2)
  }

  // ---- central towers [photo 1, 3, 11; official] -------------------------
  const central = { segments: near ? 48 : 16, rings: near ? 44 : 14, body: 0.62, taper: 0.12, k: 2.2, slit: 0.7 }
  // Tower of Jesus Christ: 155.5 m + the 17 m four-armed white cross = 172.5 m
  b.add('stone', ribbedTower(9.5, 155.5, central), NEW, [0, 0, 1])
  b.box('mosaic', WHITE, [2.8, 17, 2.8], [0, 164, 1])
  b.box('mosaic', WHITE, [13.5, 2.8, 2.8], [0, 166.5, 1])
  b.box('mosaic', WHITE, [2.8, 2.8, 13.5], [0, 166.5, 1])
  // Tower of the Virgin Mary (above the apse) with its 12-pointed star: 138 m
  b.add('stone', ribbedTower(7.8, 128, central), NEW, [0, 0, -27])
  for (let k = 0; k < 6; k++) b.box('mosaic', WHITE, [9, 1, 1], [0, 133, -27], [0, (k * Math.PI) / 6, (k % 2) * 0.6])
  b.add('mosaic', new THREE.IcosahedronGeometry(2.4, 1), WHITE, [0, 133, -27])
  // four Evangelists (135 m), crowned by their symbols
  ;[[-15, -13], [15, -13], [-15, 15], [15, 15]].forEach(([x, z], i) => {
    b.add('stone', ribbedTower(6.2, 128, central), NEW, [x, 0, z])
    evangelistSymbol(b, x, 130.5, z, i)
  })
  // church grounds
  b.box('stone', new THREE.Color('#cdbfa8'), [104, 0.6, 112], [0, 0.3, 0])
  return b.result()
}

/** radius of a tower collider at height `y` above its base (same profile as the mesh) */
export { towerRadius } from './towerProfile.js'
