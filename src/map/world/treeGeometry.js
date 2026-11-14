import * as THREE from 'three'

/**
 * Procedural trees (no rendering code): trunk + branch tubes and alpha leaf
 * cards, for 4 species seen in the reference photos and the city tree census:
 *   plane    London plane (Platanus × hispanica): Eixample street trees
 *   celtis   hackberry (Celtis australis): mixed into the street rows
 *   pine     stone pine (Pinus pinea): umbrella crowns in the squares
 *   cypress  Mediterranean cypress: columns in front of the Passion façade
 * Used offline by tools/map-data/build_trees.mjs → public/models/trees/trees.glb.
 *
 * Geometry attributes: position, normal, uv (card 0..1 or bark tiling) and
 * uv1 = (atlas column, row): row 0 foliage (alpha), row 1 bark (tiled in the
 * shader). Leaf normals are bent outward from the crown centre so the crown
 * shades as one volume. Heights are in metres, base at y = 0.
 */
export const SPECIES = {
  plane: { col: 0, H: 16, clear: 4.2, r0: 0.3, crownR: 5.6, crownY: 10.5, crownH: 9.5, form: 'round', branches: 8, card: 2.4, cards: [210, 46] },
  celtis: { col: 1, H: 11, clear: 2.8, r0: 0.22, crownR: 4.2, crownY: 7, crownH: 7.2, form: 'round', branches: 7, card: 2.0, cards: [190, 42] },
  pine: { col: 2, H: 13, clear: 7.5, r0: 0.28, crownR: 6.2, crownY: 11.2, crownH: 3.6, form: 'umbrella', branches: 7, card: 2.6, cards: [170, 40] },
  cypress: { col: 3, H: 15, clear: 0.8, r0: 0.22, crownR: 1.5, crownY: 7.8, crownH: 14, form: 'column', branches: 0, card: 1.7, cards: [230, 48] },
}
export const SPECIES_NAMES = Object.keys(SPECIES)

const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)
const UP = v3(0, 1, 0)

class Mesh {
  constructor() {
    this.p = []
    this.n = []
    this.uv = []
    this.uv1 = []
    this.idx = []
  }
  vert(p, n, u, v, c, r) {
    this.p.push(p.x, p.y, p.z)
    this.n.push(n.x, n.y, n.z)
    this.uv.push(u, v)
    this.uv1.push(c, r)
    return this.p.length / 3 - 1
  }
  geometry() {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2))
    g.setAttribute('uv1', new THREE.Float32BufferAttribute(this.uv1, 2))
    g.setIndex(this.idx)
    return g
  }
}

/** tapered tube along a polyline of points with radii; bark uv tiles every ~2πr */
function tube(m, pts, radii, seg, col) {
  const rings = []
  let along = 0
  for (let i = 0; i < pts.length; i++) {
    const t = (i < pts.length - 1 ? pts[i + 1].clone().sub(pts[i]) : pts[i].clone().sub(pts[i - 1])).normalize()
    const a = Math.abs(t.y) < 0.95 ? UP : v3(1, 0, 0)
    const b1 = v3().crossVectors(t, a).normalize()
    const b2 = v3().crossVectors(t, b1).normalize()
    if (i) along += pts[i].distanceTo(pts[i - 1])
    const ring = []
    for (let k = 0; k <= seg; k++) {
      const th = (k / seg) * Math.PI * 2
      const n = b1.clone().multiplyScalar(Math.cos(th)).addScaledVector(b2, Math.sin(th))
      ring.push(m.vert(pts[i].clone().addScaledVector(n, radii[i]), n, k / seg * Math.max(1, Math.round(radii[0] * 6)), along / 1.6, col, 1))
    }
    rings.push(ring)
  }
  for (let i = 0; i < rings.length - 1; i++)
    for (let k = 0; k < seg; k++) m.idx.push(rings[i][k], rings[i][k + 1], rings[i + 1][k], rings[i][k + 1], rings[i + 1][k + 1], rings[i + 1][k])
}

/** one leaf card: a quad of `size` at p facing roughly `dir`, normals bent from the crown centre */
function card(m, p, dir, size, col, centre, rnd) {
  const n = dir.clone().normalize()
  const a = Math.abs(n.y) < 0.9 ? UP : v3(1, 0, 0)
  const t1 = v3().crossVectors(n, a).normalize()
  const t2 = v3().crossVectors(n, t1).normalize()
  const rot = rnd() * Math.PI * 2
  const ux = t1.clone().multiplyScalar(Math.cos(rot)).addScaledVector(t2, Math.sin(rot))
  const uy = v3().crossVectors(n, ux).normalize()
  // keep the card's "up" (twig base at the bottom of the texture) pointing down-ish
  if (uy.y > 0) uy.negate()
  const h = size / 2
  const bent = (q) => q.clone().sub(centre).normalize().lerp(n, 0.35).normalize()
  const c = [[-1, -1, 0, 1], [1, -1, 1, 1], [1, 1, 1, 0], [-1, 1, 0, 0]].map(([sx, sy, u, v]) => {
    const q = p.clone().addScaledVector(ux, sx * h).addScaledVector(uy, -sy * h)
    return m.vert(q, bent(q), u, v, col, 0)
  })
  m.idx.push(c[0], c[1], c[2], c[0], c[2], c[3])
}

/** bent polyline from a to b */
function path(a, b, steps, bend, rnd) {
  const pts = []
  const side = v3(rnd() - 0.5, 0, rnd() - 0.5).normalize().multiplyScalar(bend * a.distanceTo(b))
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    pts.push(a.clone().lerp(b, t).addScaledVector(side, Math.sin(Math.PI * t)))
  }
  return pts
}

/**
 * build one tree: lod 0 = near (full branching, small cards), lod 1 = mid
 * (trunk + main limbs, few large cards). Returns a BufferGeometry.
 */
export function buildTree(name, lod = 0, seed = 1) {
  const S = SPECIES[name]
  let s = seed * 9301 + 49297
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  const m = new Mesh()
  const near = lod === 0
  const seg = near ? 9 : 5
  const centre = v3(0, S.crownY, 0)
  // trunk (the pine leans and curves)
  const lean = S.form === 'umbrella' ? v3(0.8 + rnd(), 0, 0.4 * (rnd() - 0.5)) : v3(0.15 * (rnd() - 0.5), 0, 0.15 * (rnd() - 0.5))
  const top = S.form === 'column' ? S.H * 0.9 : S.form === 'umbrella' ? S.crownY : S.crownY + S.crownH * 0.15
  const trunk = path(v3(0, 0, 0), v3(lean.x, top, lean.z), near ? 9 : 4, S.form === 'umbrella' ? 0.06 : 0.025, rnd)
  const tr = trunk.map((_, i) => S.r0 * (1 - 0.65 * (i / (trunk.length - 1))) * (i === 0 ? 1.25 : 1))
  tube(m, trunk, tr, seg, S.col)
  const tips = []
  if (S.form !== 'column') {
    // main limbs toward the crown surface
    const nb = near ? S.branches : Math.ceil(S.branches * 0.6)
    for (let k = 0; k < nb; k++) {
      const az = (k / nb) * Math.PI * 2 + rnd() * 0.6
      const t = S.form === 'umbrella' ? 0.75 + 0.25 * rnd() : 0.35 + 0.6 * (k / nb)
      const i = Math.min(trunk.length - 2, Math.floor(t * (trunk.length - 1)))
      const from = trunk[i].clone()
      const elev = S.form === 'umbrella' ? 0.15 + 0.25 * rnd() : 0.45 + 0.4 * rnd()
      const reach = S.crownR * (0.7 + 0.25 * rnd())
      const to = v3(Math.cos(az) * reach, 0, Math.sin(az) * reach).add(v3(lean.x, 0, lean.z))
      to.y = Math.min(S.crownY + S.crownH * 0.4, from.y + reach * elev + (S.form === 'umbrella' ? 1.2 : 0.8))
      const limb = path(from, to, near ? 5 : 2, 0.12, rnd)
      const r0 = tr[i] * 0.55
      tube(m, limb, limb.map((_, j) => r0 * (1 - 0.75 * (j / (limb.length - 1)))), near ? 6 : 4, S.col)
      tips.push(to)
      if (near) {
        // second-order twigs from the outer half of each limb
        for (let q = 0; q < 3; q++) {
          const a = limb[2 + Math.floor(rnd() * (limb.length - 2))]
          const d = to.clone().sub(from).normalize().add(v3(rnd() - 0.5, rnd() * 0.6, rnd() - 0.5)).normalize()
          const b = a.clone().addScaledVector(d, S.crownR * (0.35 + 0.3 * rnd()))
          tube(m, path(a, b, 2, 0.1, rnd), [r0 * 0.4, r0 * 0.25, r0 * 0.1], 4, S.col)
          tips.push(b)
        }
      }
    }
  }
  // leaf cards
  const n = S.cards[lod]
  const size = S.card * (near ? 1 : 1.9)
  for (let k = 0; k < n; k++) {
    let p
    let dir
    if (S.form === 'column') {
      // flame-shaped column around the axis, widest a third of the way up
      const y = S.clear + (S.H - S.clear) * Math.pow(rnd(), 0.85)
      const u = (y - S.clear) / (S.H - S.clear)
      const r = S.crownR * Math.sin(Math.PI * Math.pow(u, 0.62)) * (0.55 + 0.45 * rnd())
      const az = rnd() * Math.PI * 2
      p = v3(Math.cos(az) * r, y, Math.sin(az) * r)
      dir = v3(Math.cos(az), 0.25 * (rnd() - 0.3), Math.sin(az))
    } else {
      // around the limb tips, filling an ellipsoid shell (flat and wide for the pine)
      const tip = tips[Math.floor(rnd() * tips.length)]
      const off = v3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(S.form === 'umbrella' ? 3.2 : 2.6)
      if (S.form === 'umbrella') off.y *= 0.35
      p = tip.clone().add(off)
      const e = p.clone().sub(centre)
      const ry = S.crownH / 2
      const k2 = (e.x * e.x + e.z * e.z) / (S.crownR * S.crownR) + (e.y * e.y) / (ry * ry)
      if (k2 > 1) p = centre.clone().addScaledVector(e, 1 / Math.sqrt(k2))
      dir = p.clone().sub(centre).normalize().add(v3(rnd() - 0.5, rnd() * 0.8, rnd() - 0.5).multiplyScalar(0.8))
    }
    card(m, p, dir, size * (0.8 + 0.4 * rnd()), S.col, centre, rnd)
  }
  const g = m.geometry()
  g.computeBoundingSphere()
  g.userData = { species: name, lod, H: S.H, R: S.crownR }
  return g
}
