import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'

/**
 * Near-zone ground detail from map data (≤ 1.3 km): roads as ribbons,
 * parks / plazas / playgrounds / ponds as polygons, and street & park trees.
 * Lifted slightly above the terrain (whose near zone is shaded as paving).
 */
const AREA_COLOR = {
  park: '#6f8c49',
  grass: '#7d9a52',
  playground: '#c7ad86',
  pitch: '#5f8d4c',
  plaza: '#cdbfa9',
  water: '#4d8aa6',
}
const ROAD_COLOR = { pedestrian: '#c4b7a3' }
const ASPHALT = '#59554f'
const LIFT_AREA = 0.45
const LIFT_ROAD = 0.6

function ribbon(pts, width, out, color) {
  const n = pts.length / 3
  if (n < 2) return
  const base = out.pos.length / 3
  const hw = width / 2
  for (let k = 0; k < n; k++) {
    const p = k * 3
    const a = k > 0 ? p - 3 : p
    const b = k < n - 1 ? p + 3 : p
    let dx = pts[b] - pts[a]
    let dz = pts[b + 1] - pts[a + 1]
    const l = Math.hypot(dx, dz) || 1
    dx /= l
    dz /= l
    const y = pts[p + 2] + LIFT_ROAD
    out.pos.push(pts[p] - dz * hw, y, pts[p + 1] + dx * hw, pts[p] + dz * hw, y, pts[p + 1] - dx * hw)
    out.col.push(color.r, color.g, color.b, color.r, color.g, color.b)
    if (k < n - 1) {
      const q = base + k * 2
      out.idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3) // upward-facing
    }
  }
}

function polygon(pts, color, out, lift) {
  const n = pts.length / 3
  const contour = []
  for (let k = 0; k < n; k++) contour.push(new THREE.Vector2(pts[k * 3], pts[k * 3 + 1]))
  const tris = THREE.ShapeUtils.triangulateShape(contour, [])
  const base = out.pos.length / 3
  for (let k = 0; k < n; k++) {
    out.pos.push(pts[k * 3], pts[k * 3 + 2] + lift, pts[k * 3 + 1])
    out.col.push(color.r, color.g, color.b)
  }
  for (const [a, b, c] of tris) out.idx.push(base + a, base + c, base + b)
}

function toMesh(out, material) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(out.col, 3))
  g.setIndex(out.idx)
  g.computeVertexNormals()
  g.computeBoundingSphere()
  const m = new THREE.Mesh(g, material)
  m.receiveShadow = true
  return m
}

export default function Features({ data, treeStride = 1 }) {
  const [f, setF] = useState(null)
  useEffect(() => {
    let live = true
    data.features().then((d) => live && setF(d))
    return () => {
      live = false
    }
  }, [data])

  const objects = useMemo(() => {
    if (!f) return null
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 })
    const water = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.15, metalness: 0.1 })
    const areas = { pos: [], col: [], idx: [] }
    const ponds = { pos: [], col: [], idx: [] }
    const order = ['plaza', 'park', 'grass', 'pitch', 'playground'] // later ones drawn on top (lift)
    for (const a of f.areas) {
      if (a.type === 'water') polygon(a.pts, new THREE.Color(AREA_COLOR.water), ponds, LIFT_AREA + 0.08)
      else polygon(a.pts, new THREE.Color(AREA_COLOR[a.type]), areas, LIFT_AREA + order.indexOf(a.type) * 0.02)
    }
    const roads = { pos: [], col: [], idx: [] }
    const asphalt = new THREE.Color(ASPHALT)
    for (const r of f.roads) ribbon(r.pts, r.width, roads, ROAD_COLOR[r.cls] ? new THREE.Color(ROAD_COLOR[r.cls]) : asphalt)

    // trees: low-poly crowns, instanced (seen from above, an octahedron reads as a crown)
    const n = Math.floor(f.trees.length / 4 / treeStride)
    const crown = new THREE.OctahedronGeometry(1, 0) // 8 triangles: ~21k trees stay cheap
    crown.scale(1, 0.9, 1)
    const tmat = new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true })
    const trees = new THREE.InstancedMesh(crown, tmat, n)
    const o = new THREE.Object3D()
    const c = new THREE.Color()
    for (let k = 0; k < n; k++) {
      const q = k * treeStride * 4
      const [x, z, y, s] = f.trees.subarray(q, q + 4)
      o.position.set(x, y + s * 1.25, z)
      o.rotation.set(0, x * 0.37, 0)
      o.scale.setScalar(s * 0.85)
      o.updateMatrix()
      trees.setMatrixAt(k, o.matrix)
      c.setHSL(0.24 + ((x * 13.1 + z * 7.7) % 1) * 0.05, 0.42, 0.24 + ((x * 3.3 - z) % 1 + 1) % 1 * 0.07)
      trees.setColorAt(k, c)
    }
    trees.castShadow = true
    trees.computeBoundingSphere()
    return { list: [toMesh(areas, mat), toMesh(ponds, water), toMesh(roads, mat), trees], materials: [mat, water, tmat] }
  }, [f, treeStride])

  useEffect(
    () => () => {
      objects?.list.forEach((m) => m.geometry.dispose())
      objects?.materials.forEach((m) => m.dispose())
    },
    [objects],
  )
  if (!objects) return null
  return objects.list.map((m, i) => <primitive key={i} object={m} />)
}
