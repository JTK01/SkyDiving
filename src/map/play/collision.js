import { towerRadius } from '../world/towerProfile.js'

/**
 * Collision for the free fall: the jumper is a sphere of BODY_RADIUS around
 * the camera; the drop ends the moment it touches
 *  - the terrain (same triangles as the finest rendered terrain tiles),
 *  - a near-zone building (footprint prism, base − 2 m … roof, as drawn),
 *  - the basilica (388 simplified shapes from colliders.json: boxes, gable
 *    prisms, frustums/cones, lathe profiles, spheres and towers whose radius
 *    follows the drawn spire profile down to its 0.25 m tip).
 * Every frame the motion segment is swept in ≤ STEP sub-steps and the first
 * contact is refined by bisection, so nothing is tunnelled through at
 * terminal velocity (55 m/s ≈ 2.8 m per 50 ms frame).
 *
 * All shapes are put in a uniform grid (CELL m) by their bounds grown by the
 * body radius, so a query only looks at the shapes of one cell.
 */
export const BODY_RADIUS = 0.5
const STEP = 0.25
const CELL = 16

// ── 2D helpers ──────────────────────────────────────────────────────────────
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const l = dx * dx + dy * dy
  const t = l > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0
  return Math.hypot(px - ax - t * dx, py - ay - t * dy)
}
/** distance from (px, py) to a closed polygon (flat x,y array), 0 inside */
export function polyDist(pts, px, py) {
  const n = pts.length / 2
  let inside = false
  let d = Infinity
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i * 2]
    const yi = pts[i * 2 + 1]
    const xj = pts[j * 2]
    const yj = pts[j * 2 + 1]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
    d = Math.min(d, segDist(px, py, xi, yi, xj, yj))
  }
  return inside ? 0 : d
}

// ── basilica shapes (collider space: metres, y up from the basilica's ground) ─
const towerProfiles = new Map()
function towerProfile(c) {
  // (ρ, y) outline of the solid of revolution, denser toward the tip
  const k = `${c.r0},${c.H},${c.body},${c.taper},${c.k}`
  if (!towerProfiles.has(k)) {
    const pts = [0, 0]
    for (let i = 0; i <= 32; i++) {
      const t = 1 - (1 - i / 32) ** 2
      pts.push(towerRadius(c, t * c.H), t * c.H)
    }
    pts.push(0, c.H)
    towerProfiles.set(k, pts)
  }
  return towerProfiles.get(k)
}

/** exterior distance from a point (collider space) to one collider, 0 inside */
export function colliderDist(c, x, y, z) {
  switch (c.type) {
    case 'sphere':
      return Math.max(0, Math.hypot(x - c.x, y - c.y, z - c.z) - c.r)
    case 'cyl':
    case 'lathe':
    case 'tower': {
      // solids of revolution: 2D distance in the (ρ, y) half plane
      const rho = Math.hypot(x - c.x, z - c.z)
      const h = y - c.y0
      if (c.type === 'tower') return polyDist(towerProfile(c), rho, h)
      if (c.type === 'lathe') return polyDist(c.pts, rho, h)
      const d = polyDist([0, 0, c.rb, 0, c.rt, c.h, 0, c.h], rho, h)
      // half shell (apse): also outside the cut plane through the axis
      return c.cut ? Math.max(d, Math.max(0, -((x - c.x) * c.cut[0] + (z - c.z) * c.cut[1]))) : d
    }
    case 'box':
    case 'gable': {
      // into the shape's frame (rotation ry about y, as in three.js)
      const dx = x - c.x
      const dz = z - c.z
      const cs = Math.cos(c.ry)
      const sn = Math.sin(c.ry)
      const lx = cs * dx - sn * dz
      const lz = sn * dx + cs * dz
      if (c.type === 'box') {
        const qx = Math.max(0, Math.abs(lx) - c.hx)
        const qy = Math.max(0, Math.abs(y - c.y) - c.hy)
        const qz = Math.max(0, Math.abs(lz) - c.hz)
        return Math.hypot(qx, qy, qz)
      }
      const tri = polyDist([-c.w / 2, 0, c.w / 2, 0, 0, c.h], lx, y - c.y0)
      return Math.hypot(tri, Math.max(0, Math.abs(lz) - c.len / 2))
    }
    default:
      return Infinity
  }
}

/** horizontal radius and vertical range of a collider (collider space) */
function colliderBounds(c) {
  switch (c.type) {
    case 'sphere':
      return { r: c.r, y0: c.y - c.r, y1: c.y + c.r }
    case 'cyl':
      return { r: Math.max(c.rb, c.rt), y0: c.y0, y1: c.y0 + c.h }
    case 'lathe': {
      let r = 0
      let h = 0
      for (let k = 0; k < c.pts.length; k += 2) {
        r = Math.max(r, c.pts[k])
        h = Math.max(h, c.pts[k + 1])
      }
      return { r, y0: c.y0, y1: c.y0 + h }
    }
    case 'tower':
      return { r: c.r0, y0: c.y0, y1: c.y0 + c.H }
    case 'box':
      return { r: Math.hypot(c.hx, c.hz), y0: c.y - c.hy, y1: c.y + c.hy }
    case 'gable':
      return { r: Math.hypot(c.w / 2, c.len / 2), y0: c.y0, y1: c.y0 + c.h }
    default:
      return null
  }
}

// ── world ───────────────────────────────────────────────────────────────────
export class CollisionWorld {
  /**
   * terrain: { half, n, levels: [{ L, size, tiles: Map('i_j' → Float32Array) }] } (finest first)
   * buildings: [{ ring: Float32Array (x,z…), baseY, height }]
   * basilica: { x, y, z, rotationY, colliders: [...] }
   */
  constructor({ terrain, buildings = [], basilica = null, radius = BODY_RADIUS }) {
    this.terrain = terrain
    this.R = radius
    this.grid = new Map()
    this.shapes = []
    for (const b of buildings) this.addBuilding(b)
    if (basilica) {
      // anything stacked on a tower's upper half (finials, crosses, stars) is part of that spire
      const towers = basilica.colliders.filter((c) => c.type === 'tower')
      const onSpire = (c) => {
        const y = c.y ?? c.y0
        return towers.some((t) => Math.hypot(c.x - t.x, c.z - t.z) < t.r0 && y > t.y0 + t.H * 0.5)
      }
      for (const c of basilica.colliders) this.addBasilicaPart(basilica, c, c.type === 'tower' || onSpire(c) ? 'tower' : c.type)
    }
  }

  insert(shape, minX, minZ, maxX, maxZ) {
    const R = this.R
    shape.y0 -= R
    shape.y1 += R
    this.shapes.push(shape)
    for (let i = Math.floor((minX - R) / CELL); i <= Math.floor((maxX + R) / CELL); i++)
      for (let j = Math.floor((minZ - R) / CELL); j <= Math.floor((maxZ + R) / CELL); j++) {
        const k = `${i},${j}`
        if (!this.grid.has(k)) this.grid.set(k, [])
        this.grid.get(k).push(shape)
      }
  }

  addBuilding(b) {
    const r = b.ring
    let [minX, minZ, maxX, maxZ] = [Infinity, Infinity, -Infinity, -Infinity]
    for (let k = 0; k < r.length; k += 2) {
      minX = Math.min(minX, r[k])
      maxX = Math.max(maxX, r[k])
      minZ = Math.min(minZ, r[k + 1])
      maxZ = Math.max(maxZ, r[k + 1])
    }
    const base = b.baseY - 2 // walls are drawn from 2 m below the ground point
    const top = b.baseY + b.height
    this.insert(
      {
        kind: 'building',
        part: 'roof',
        top,
        y0: base,
        y1: top,
        dist: (x, y, z) => Math.hypot(polyDist(r, x, z), Math.max(0, base - y, y - top)),
      },
      minX,
      minZ,
      maxX,
      maxZ,
    )
  }

  addBasilicaPart(B, c, part) {
    const bd = colliderBounds(c)
    if (!bd) return
    const cs = Math.cos(B.rotationY)
    const sn = Math.sin(B.rotationY)
    // collider centre → world (three.js rotation about y)
    const cx = B.x + cs * c.x + sn * c.z
    const cz = B.z - sn * c.x + cs * c.z
    this.insert(
      {
        kind: 'basilica',
        part,
        y0: B.y + bd.y0,
        y1: B.y + bd.y1,
        dist: (x, y, z) => {
          // world → basilica model space (inverse rotation)
          const dx = x - B.x
          const dz = z - B.z
          return colliderDist(c, cs * dx - sn * dz, y - B.y, sn * dx + cs * dz)
        },
      },
      cx - bd.r,
      cz - bd.r,
      cx + bd.r,
      cz + bd.r,
    )
  }

  /** terrain height at (x, z), same triangulation as the rendered tiles */
  heightAt(x, z) {
    const T = this.terrain
    for (const lv of T.levels) {
      const s = lv.size
      const i = Math.floor((x + T.half) / s)
      const j = Math.floor((z + T.half) / s)
      const h = lv.tiles.get(`${i}_${j}`)
      if (!h) continue
      const n = T.n
      const step = s / (n - 1)
      const gx = (x + T.half - i * s) / step
      const gz = (z + T.half - j * s) / step
      const ci = Math.min(n - 2, Math.floor(gx))
      const cj = Math.min(n - 2, Math.floor(gz))
      const fx = gx - ci
      const fz = gz - cj
      const a = cj * n + ci
      // triangles (a, a+n, a+1) and (a+1, a+n, a+n+1): diagonal (i+1, j)–(i, j+1)
      if (fx + fz <= 1) return h[a] + fx * (h[a + 1] - h[a]) + fz * (h[a + n] - h[a])
      return h[a + n + 1] + (1 - fx) * (h[a + n] - h[a + n + 1]) + (1 - fz) * (h[a + 1] - h[a + n + 1])
    }
    return T.fallback ?? 0
  }

  /** what the body touches at (x, y, z), or null */
  contact(x, y, z) {
    const R = this.R
    const ground = this.heightAt(x, z)
    if (y - R <= ground) return { kind: 'ground', part: 'ground', ground }
    const cell = this.grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`)
    if (!cell) return null
    for (const s of cell) {
      if (y < s.y0 || y > s.y1) continue
      if (s.dist(x, y, z) <= R) {
        // a building touched from above counts as its roof, otherwise its wall
        const part = s.kind === 'building' ? (y >= s.top - R * 0.5 ? 'roof' : 'wall') : s.part
        return { kind: s.kind, part, ground }
      }
    }
    return null
  }

  /**
   * Sweep the body from a to b ({x, y, z}); returns null or the first contact
   * { x, y, z, kind, part } with the position refined to within ~1 cm.
   */
  sweep(a, b) {
    const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
    const n = Math.max(1, Math.ceil(len / STEP))
    const at = (t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t })
    let prev = 0
    for (let k = 1; k <= n; k++) {
      const t = k / n
      const p = at(t)
      let hit = this.contact(p.x, p.y, p.z)
      if (!hit) {
        prev = t
        continue
      }
      // bisection between the last free and the first touching sample
      let lo = prev
      let hi = t
      for (let q = 0; q < 6; q++) {
        const mid = (lo + hi) / 2
        const m = at(mid)
        const h = this.contact(m.x, m.y, m.z)
        if (h) {
          hi = mid
          hit = h
        } else lo = mid
      }
      return { ...at(hi), ...hit }
    }
    return null
  }
}

/**
 * Loads what the collision world needs for a drop zone of `radius` m around
 * the landmark: the terrain tiles of every level that covers it (decoded
 * tiles are shared with the renderer), the near-zone buildings and the
 * basilica colliders.
 */
export async function loadCollisionWorld(data, manifest, { landmark, radius, collidersUrl }) {
  const T = manifest.terrain
  const reach = radius + 120
  const levels = []
  const jobs = []
  for (const l of [...T.levels].sort((p, q) => q.level - p.level)) {
    const lv = { L: l.level, size: l.size ?? (2 * T.half) / 2 ** l.level, tiles: new Map() }
    for (const [i, j] of l.tiles) {
      const x0 = -T.half + i * lv.size
      const z0 = -T.half + j * lv.size
      if (x0 > landmark.x + reach || x0 + lv.size < landmark.x - reach || z0 > landmark.z + reach || z0 + lv.size < landmark.z - reach) continue
      jobs.push(data.terrainTile(l.level, i, j).then((d) => lv.tiles.set(`${i}_${j}`, d.heights)))
    }
    if (lv.tiles.size || jobs.length) levels.push(lv)
    if (l.level <= 4) break // coarser levels are never the finest one here
  }
  const [buildings, colliders] = await Promise.all([
    data.nearBuildings(),
    fetch(collidersUrl).then((r) => r.json()),
    Promise.all(jobs),
  ])
  const near = buildings.filter((b) => {
    const r = b.ring
    for (let k = 0; k < r.length; k += 2) if (Math.hypot(r[k] - landmark.x, r[k + 1] - landmark.z) < reach) return true
    return false
  })
  return new CollisionWorld({
    terrain: { half: T.half, n: T.heightSize, levels: levels.filter((l) => l.tiles.size), fallback: manifest.frame.groundY },
    buildings: near,
    basilica: { x: landmark.x, y: manifest.frame.groundY, z: landmark.z, rotationY: (landmark.rotationDeg * Math.PI) / 180, colliders: colliders.colliders },
  })
}
