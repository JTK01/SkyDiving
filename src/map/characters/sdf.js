/**
 * Signed-distance modelling for continuous character bodies (offline):
 * primitives (round cones, ellipsoids) joined with a smooth minimum, meshed
 * with surface nets, smooth normals from the field gradient, skin weights
 * blended from the primitives' bones (≤ 4 per vertex, so joints bend).
 */

// ---- primitives (p, a, b: [x, y, z]) ----------------------------------------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const len = (a) => Math.sqrt(dot(a, a))

/** round cone from a (radius r1) to b (radius r2) — Inigo Quilez */
export function roundCone(a, b, r1, r2) {
  const ba = sub(b, a)
  const l2 = dot(ba, ba)
  const rr = r1 - r2
  const a2 = l2 - rr * rr
  const il2 = 1 / l2
  return (p) => {
    const pa = sub(p, a)
    const y = dot(pa, ba)
    const z = y - l2
    const xv = [pa[0] * l2 - ba[0] * y, pa[1] * l2 - ba[1] * y, pa[2] * l2 - ba[2] * y]
    const x2 = dot(xv, xv)
    const y2 = y * y * l2
    const z2 = z * z * l2
    const k = Math.sign(rr) * rr * rr * x2
    if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2
    if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1
    return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1
  }
}

/** ellipsoid centred at c with radii r (approximate distance, good near the surface) */
export function ellipsoid(c, r) {
  return (p) => {
    const q = sub(p, c)
    const k0 = len([q[0] / r[0], q[1] / r[1], q[2] / r[2]])
    const k1 = len([q[0] / (r[0] * r[0]), q[1] / (r[1] * r[1]), q[2] / (r[2] * r[2])])
    return k1 > 0 ? (k0 * (k0 - 1)) / k1 : -Math.min(...r)
  }
}

/** polynomial smooth minimum */
export function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - h * h * k * 0.25
}

/**
 * A body: [{ f: sdf, bone: index, color: [r, g, b] | (p) => [r, g, b], blend: k }]
 * field(p) = smooth union of every part (each part's own blend radius).
 */
export function bodyField(parts) {
  return (p) => {
    let d = Infinity
    for (const q of parts) d = d === Infinity ? q.f(p) : smin(d, q.f(p), q.blend ?? 0.03)
    return d
  }
}

/**
 * Surface nets over the box [min, max] with cell size h: one vertex per cell
 * crossing the surface (average of the edge crossings), one quad per crossed
 * grid edge. Returns { positions: number[], indices: number[] }.
 */
export function surfaceNets(field, min, max, h) {
  const n = [0, 1, 2].map((k) => Math.ceil((max[k] - min[k]) / h) + 1)
  const [nx, ny, nz] = n
  const val = new Float32Array(nx * ny * nz)
  const id = (i, j, k) => i + nx * (j + ny * k)
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) val[id(i, j, k)] = field([min[0] + i * h, min[1] + j * h, min[2] + k * h])
  const vert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1)
  const cid = (i, j, k) => i + (nx - 1) * (j + (ny - 1) * k)
  const positions = []
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]]
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]
  for (let k = 0; k < nz - 1; k++)
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        const v = corners.map(([a, b, c]) => val[id(i + a, j + b, k + c)])
        let inside = 0
        for (const x of v) if (x < 0) inside++
        if (inside === 0 || inside === 8) continue
        let sx = 0
        let sy = 0
        let sz = 0
        let cnt = 0
        for (const [e0, e1] of edges) {
          const a = v[e0]
          const b = v[e1]
          if (a < 0 === b < 0) continue
          const t = a / (a - b)
          const c0 = corners[e0]
          const c1 = corners[e1]
          sx += c0[0] + (c1[0] - c0[0]) * t
          sy += c0[1] + (c1[1] - c0[1]) * t
          sz += c0[2] + (c1[2] - c0[2]) * t
          cnt++
        }
        vert[cid(i, j, k)] = positions.length / 3
        positions.push(min[0] + (i + sx / cnt) * h, min[1] + (j + sy / cnt) * h, min[2] + (k + sz / cnt) * h)
      }
  const indices = []
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return
    if (flip) indices.push(a, c, b, a, d, c)
    else indices.push(a, b, c, a, c, d)
  }
  for (let k = 1; k < nz - 1; k++)
    for (let j = 1; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const s = val[id(i, j, k)] < 0
        // x edge (i,j,k)-(i+1,j,k): cells around it in the y/z plane
        if (i < nx - 1 && s !== val[id(i + 1, j, k)] < 0) quad(vert[cid(i, j - 1, k - 1)], vert[cid(i, j, k - 1)], vert[cid(i, j, k)], vert[cid(i, j - 1, k)], s)
        if (j < ny - 1 && s !== val[id(i, j + 1, k)] < 0) quad(vert[cid(i - 1, j, k - 1)], vert[cid(i - 1, j, k)], vert[cid(i, j, k)], vert[cid(i, j, k - 1)], s)
        if (k < nz - 1 && s !== val[id(i, j, k + 1)] < 0) quad(vert[cid(i - 1, j - 1, k)], vert[cid(i, j - 1, k)], vert[cid(i, j, k)], vert[cid(i - 1, j, k)], s)
      }
  return { positions, indices }
}

/** smooth normals from the field gradient */
export function fieldNormals(field, positions, e = 0.004) {
  const out = new Float32Array(positions.length)
  for (let v = 0; v < positions.length; v += 3) {
    const p = [positions[v], positions[v + 1], positions[v + 2]]
    const g = [0, 1, 2].map((k) => {
      const a = [...p]
      const b = [...p]
      a[k] += e
      b[k] -= e
      return field(a) - field(b)
    })
    const l = len(g) || 1
    out[v] = g[0] / l
    out[v + 1] = g[1] / l
    out[v + 2] = g[2] / l
  }
  return out
}

/**
 * skin weights from the parts: the part nearest the vertex dominates, parts
 * within ~sigma of it blend in (joints); summed per bone, top 4, normalised.
 */
export function partWeights(parts, positions, sigma = 0.025) {
  const n = positions.length / 3
  const joints = new Uint16Array(n * 4)
  const weights = new Float32Array(n * 4)
  const colors = new Float32Array(n * 3)
  for (let v = 0; v < n; v++) {
    const p = [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]]
    const d = parts.map((q) => q.f(p))
    const dmin = Math.min(...d)
    const byBone = new Map()
    d.forEach((dd, i) => {
      const w = Math.exp(-(dd - dmin) / sigma)
      if (w < 1e-3) return
      byBone.set(parts[i].bone, (byBone.get(parts[i].bone) || 0) + w)
    })
    const top = [...byBone.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
    const sum = top.reduce((s, [, w]) => s + w, 0)
    top.forEach(([b, w], k) => {
      joints[v * 4 + k] = b
      weights[v * 4 + k] = w / sum
    })
    // colour from the nearest part
    const near = parts[d.indexOf(dmin)]
    const c = typeof near.color === 'function' ? near.color(p) : near.color
    colors.set(c, v * 3)
  }
  return { joints, weights, colors }
}
