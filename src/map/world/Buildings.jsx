import { useEffect, useMemo, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { buildingMaterial, ROOF_CELL_NEAR, ROOF_CELL_MID } from './materials'
import { loadKTX2 } from './loaders'

/**
 * Buildings in two LODs, both textured from the shared atlas:
 *  - near (≤ 600 m): real footprints extruded, merged per 300 m chunk
 *    (one draw per chunk → frustum culling still works)
 *  - mid (600 m – 2.7 km): oriented boxes, one InstancedMesh per data tile;
 *    tiles beyond the preset's `midDistance` are hidden (the orthophoto
 *    shows their roofs at that range)
 */
const CHUNK = 300
const hash = (a, b) => {
  const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453
  return s - Math.floor(s)
}

/** the atlas, loaded once per renderer */
export function useAtlas() {
  const gl = useThree((s) => s.gl)
  const [tex, setTex] = useState(null)
  useEffect(() => {
    let live = true
    let t
    loadKTX2(gl, `${import.meta.env.BASE_URL || '/'}textures/buildings.ktx2`).then((x) => {
      if (!live) return x.dispose()
      t = x
      x.wrapS = x.wrapT = THREE.ClampToEdgeWrapping
      x.anisotropy = Math.min(4, gl.capabilities.getMaxAnisotropy())
      x.needsUpdate = true
      setTex(x)
    })
    return () => {
      live = false
      t?.dispose()
    }
  }, [gl])
  return tex
}

function boxGeometry() {
  // unit box standing on y = 0, without its never-visible bottom face
  const box = new THREE.BoxGeometry(1, 1, 1)
  box.translate(0, 0.5, 0)
  const g = new THREE.BufferGeometry()
  for (const name of ['position', 'normal']) g.setAttribute(name, box.getAttribute(name))
  const idx = Array.from(box.index.array)
  idx.splice(box.groups[3].start, box.groups[3].count) // −y face
  g.setIndex(idx)
  box.dispose()
  return g
}

function MidTile({ data, tile, material, geometry, maxDistance }) {
  const [boxes, setBoxes] = useState(null)
  const camera = useThree((s) => s.camera)
  useEffect(() => {
    let live = true
    data.midTile(tile.file).then((b) => live && setBoxes(b))
    return () => {
      live = false
    }
  }, [data, tile.file])
  const mesh = useMemo(() => {
    if (!boxes) return null
    const n = boxes.length / 9
    const g = geometry.clone()
    const style = new Float32Array(n * 3)
    const m = new THREE.InstancedMesh(g, material, n)
    const o = new THREE.Object3D()
    for (let k = 0; k < n; k++) {
      const [cx, cz, w, d, a, h, base, roof, fac] = boxes.subarray(k * 9, k * 9 + 9)
      o.position.set(cx, base - 2, cz)
      o.rotation.set(0, -a, 0)
      o.scale.set(Math.max(w, 2), h + 2, Math.max(d, 2))
      o.updateMatrix()
      m.setMatrixAt(k, o.matrix)
      style.set([fac % 8, ROOF_CELL_MID[roof % 8], 0.9 + hash(cx, cz) * 0.2], k * 3)
    }
    g.setAttribute('aStyle', new THREE.InstancedBufferAttribute(style, 3))
    m.castShadow = true
    m.receiveShadow = true
    m.computeBoundingSphere()
    return m
  }, [boxes, geometry, material])
  useEffect(() => () => mesh?.geometry.dispose(), [mesh])
  const [bx, bz, bs] = tile.bounds
  const centre = useMemo(() => new THREE.Vector2(bx + bs / 2, bz + bs / 2), [bx, bz, bs])
  useFrame(() => {
    if (!mesh) return
    const d = Math.hypot(camera.position.x - centre.x, camera.position.z - centre.y) - bs * 0.71
    mesh.visible = d < maxDistance
  })
  return mesh ? <primitive object={mesh} /> : null
}

export function MidBuildings({ data, manifest, atlas, maxDistance = 2700 }) {
  const res = useMemo(() => (atlas ? { geometry: boxGeometry(), material: buildingMaterial({ instanced: true, atlas }) } : null), [atlas])
  useEffect(
    () => () => {
      res?.geometry.dispose()
      res?.material.dispose()
    },
    [res],
  )
  if (!res) return null
  return manifest.buildings.mid.tiles.map((t) => <MidTile key={t.file} data={data} tile={t} maxDistance={maxDistance} {...res} />)
}

/** near-zone footprints → extruded walls + flat roofs, merged per chunk */
export function NearBuildings({ data, atlas, onLoaded }) {
  const [list, setList] = useState(null)
  useEffect(() => {
    let live = true
    data.nearBuildings().then((b) => live && setList(b))
    return () => {
      live = false
    }
  }, [data])
  const meshes = useMemo(() => {
    if (!list || !atlas) return null
    const material = buildingMaterial({ instanced: false, atlas })
    const chunks = new Map()
    for (const b of list) {
      const r = b.ring
      const n = r.length / 2
      let cx = 0
      let cz = 0
      for (let k = 0; k < n; k++) {
        cx += r[k * 2] / n
        cz += r[k * 2 + 1] / n
      }
      const key = `${Math.floor(cx / CHUNK)},${Math.floor(cz / CHUNK)}`
      if (!chunks.has(key)) chunks.set(key, { pos: [], nrm: [], style: [], base: [], idx: [], v: 0 })
      const c = chunks.get(key)
      const y0 = b.baseY - 2
      const y1 = b.baseY + b.height
      const st = [b.facade % 8, ROOF_CELL_NEAR[b.roof % 8], 0.9 + hash(cx, cz) * 0.2]
      const push = (x, y, z, nx, ny, nz) => {
        c.pos.push(x, y, z)
        c.nrm.push(nx, ny, nz)
        c.style.push(...st)
        c.base.push(b.baseY)
      }
      for (let k = 0; k < n; k++) {
        const ax = r[k * 2]
        const az = r[k * 2 + 1]
        const bx = r[((k + 1) % n) * 2]
        const bz = r[((k + 1) % n) * 2 + 1]
        const len = Math.hypot(bx - ax, bz - az) || 1
        const nx = (bz - az) / len
        const nz = -(bx - ax) / len
        push(ax, y0, az, nx, 0, nz)
        push(bx, y0, bz, nx, 0, nz)
        push(bx, y1, bz, nx, 0, nz)
        push(ax, y1, az, nx, 0, nz)
        c.idx.push(c.v, c.v + 2, c.v + 1, c.v, c.v + 3, c.v + 2)
        c.v += 4
      }
      const contour = []
      for (let k = 0; k < n; k++) contour.push(new THREE.Vector2(r[k * 2], r[k * 2 + 1]))
      const tris = THREE.ShapeUtils.triangulateShape(contour, [])
      for (let k = 0; k < n; k++) push(r[k * 2], y1, r[k * 2 + 1], 0, 1, 0)
      for (const [a, b2, cc] of tris) c.idx.push(c.v + a, c.v + cc, c.v + b2)
      c.v += n
    }
    const out = []
    for (const c of chunks.values()) {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(c.pos, 3))
      g.setAttribute('normal', new THREE.Float32BufferAttribute(c.nrm, 3))
      g.setAttribute('aStyle', new THREE.Float32BufferAttribute(c.style, 3))
      g.setAttribute('aBase', new THREE.Float32BufferAttribute(c.base, 1))
      g.setIndex(c.idx)
      g.computeBoundingSphere()
      const m = new THREE.Mesh(g, material)
      m.castShadow = true
      m.receiveShadow = true
      out.push(m)
    }
    return { list: out, material }
  }, [list, atlas])
  useEffect(() => {
    if (meshes) onLoaded?.()
  }, [meshes]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(
    () => () => {
      meshes?.list.forEach((m) => m.geometry.dispose())
      meshes?.material.dispose()
    },
    [meshes],
  )
  if (!meshes) return null
  return meshes.list.map((m, i) => <primitive key={i} object={m} />)
}
