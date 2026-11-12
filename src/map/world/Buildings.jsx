import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { buildingMaterial, ROOF_NEAR, ROOF_MID, FACADE } from './materials'

const col = (hex) => new THREE.Color(hex)
const ROOF_N = ROOF_NEAR.map(col)
const ROOF_M = ROOF_MID.map(col)
const FAC = FACADE.map(col)

/** one mid-zone tile of oriented boxes → a single InstancedMesh */
function MidTile({ data, file, material, geometry }) {
  const [boxes, setBoxes] = useState(null)
  useEffect(() => {
    let live = true
    data.midTile(file).then((b) => live && setBoxes(b))
    return () => {
      live = false
    }
  }, [data, file])
  const mesh = useMemo(() => {
    if (!boxes) return null
    const n = boxes.length / 9
    const m = new THREE.InstancedMesh(geometry, material, n)
    const o = new THREE.Object3D()
    const facade = new Float32Array(n * 3)
    for (let k = 0; k < n; k++) {
      const [cx, cz, w, d, a, h, base, roof, fac] = boxes.subarray(k * 9, k * 9 + 9)
      o.position.set(cx, base - 2, cz)
      o.rotation.set(0, -a, 0)
      o.scale.set(Math.max(w, 2), h + 2, Math.max(d, 2))
      o.updateMatrix()
      m.setMatrixAt(k, o.matrix)
      m.setColorAt(k, ROOF_M[roof % 8])
      FAC[fac % 8].toArray(facade, k * 3)
    }
    const g = geometry.clone()
    g.setAttribute('aFacade', new THREE.InstancedBufferAttribute(facade, 3))
    m.geometry = g
    m.castShadow = true
    m.receiveShadow = true
    m.computeBoundingSphere()
    return m
  }, [boxes, geometry, material])
  useEffect(() => () => mesh?.geometry.dispose(), [mesh])
  return mesh ? <primitive object={mesh} /> : null
}

export function MidBuildings({ data, manifest }) {
  const res = useMemo(() => {
    // unit box standing on y = 0, without its (never visible) bottom face
    const box = new THREE.BoxGeometry(1, 1, 1)
    box.translate(0, 0.5, 0)
    const geometry = new THREE.BufferGeometry()
    for (const name of ['position', 'normal']) geometry.setAttribute(name, box.getAttribute(name))
    const bottom = box.groups[3] // BoxGeometry face order: +x, −x, +y, −y, +z, −z
    const idx = Array.from(box.index.array)
    idx.splice(bottom.start, bottom.count)
    geometry.setIndex(idx)
    box.dispose()
    return { geometry, material: buildingMaterial({ instanced: true }) }
  }, [])
  useEffect(() => () => {
    res.geometry.dispose()
    res.material.dispose()
  }, [res])
  return manifest.buildings.mid.tiles.map((t) => <MidTile key={t.file} data={data} file={t.file} {...res} />)
}

/** near-zone footprints → extruded walls + flat roofs, merged into one mesh */
export function NearBuildings({ data }) {
  const [list, setList] = useState(null)
  useEffect(() => {
    let live = true
    data.nearBuildings().then((b) => live && setList(b))
    return () => {
      live = false
    }
  }, [data])
  const mesh = useMemo(() => {
    if (!list) return null
    const pos = []
    const nrm = []
    const color = []
    const facade = []
    const idx = []
    let base = 0
    for (const b of list) {
      const r = b.ring
      const n = r.length / 2
      const y0 = b.baseY - 2
      const y1 = b.baseY + b.height
      const roof = ROOF_N[b.roof % 8]
      const fac = FAC[b.facade % 8]
      // walls (ring is CCW in x/z with z = south → outward normal = (dz, 0, -dx))
      for (let k = 0; k < n; k++) {
        const ax = r[k * 2]
        const az = r[k * 2 + 1]
        const bx = r[((k + 1) % n) * 2]
        const bz = r[((k + 1) % n) * 2 + 1]
        const len = Math.hypot(bx - ax, bz - az) || 1
        const nx = (bz - az) / len
        const nz = -(bx - ax) / len
        pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az)
        for (let q = 0; q < 4; q++) {
          nrm.push(nx, 0, nz)
          color.push(roof.r, roof.g, roof.b)
          facade.push(fac.r, fac.g, fac.b)
        }
        idx.push(base, base + 2, base + 1, base, base + 3, base + 2) // faces outward
        base += 4
      }
      // roof
      const contour = []
      for (let k = 0; k < n; k++) contour.push(new THREE.Vector2(r[k * 2], r[k * 2 + 1]))
      const tris = THREE.ShapeUtils.triangulateShape(contour, [])
      for (let k = 0; k < n; k++) {
        pos.push(r[k * 2], y1, r[k * 2 + 1])
        nrm.push(0, 1, 0)
        color.push(roof.r, roof.g, roof.b)
        facade.push(fac.r, fac.g, fac.b)
      }
      for (const [a, b2, c] of tris) idx.push(base + a, base + c, base + b2)
      base += n
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(color, 3))
    g.setAttribute('facade', new THREE.Float32BufferAttribute(facade, 3))
    g.setIndex(idx)
    g.computeBoundingSphere()
    const m = new THREE.Mesh(g, buildingMaterial({ instanced: false }))
    m.castShadow = true
    m.receiveShadow = true
    return m
  }, [list])
  useEffect(() => () => {
    mesh?.geometry.dispose()
    mesh?.material.dispose()
  }, [mesh])
  return mesh ? <primitive object={mesh} /> : null
}
