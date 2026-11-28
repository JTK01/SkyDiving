import { useEffect, useMemo, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { loadKTX2 } from './loaders'
import { withAerial } from './aerial'

/**
 * Street-level ground around the landmark (tools/map-data/build_streets.py,
 * build_ground_textures.py): the ground classes and distance fields of
 * streets/mask.png and the material atlases are handed to the terrain shader
 * (Terrain.jsx draws asphalt, panot paving, lawn, sauló, gravel and water
 * there, blending into the orthophoto with distance); this component adds the
 * raised parts as meshes on the terrain — painted road markings, granite
 * curbs along the carriageway and the stone rim of the pond.
 */
const BASE = import.meta.env.BASE_URL || '/'

/** the textures for the terrain shader: { mask, albedo, normal, half } (null until loaded) */
export function useStreetTextures(data, manifest, enabled) {
  const gl = useThree((s) => s.gl)
  const [tex, setTex] = useState(null)
  useEffect(() => {
    if (!enabled || !manifest.streets) return
    let live = true
    const S = manifest.streets
    const made = []
    Promise.all([
      data.fetch(S.mask).then((b) => createImageBitmap(new Blob([b], { type: 'image/png' }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none', imageOrientation: 'none' })),
      loadKTX2(gl, `${BASE}textures/ground_albedo.ktx2`),
      loadKTX2(gl, `${BASE}textures/ground_normal.ktx2`),
    ]).then(([bmp, albedo, normal]) => {
      const mask = new THREE.Texture(bmp)
      mask.flipY = false
      mask.colorSpace = THREE.NoColorSpace
      mask.generateMipmaps = false
      mask.minFilter = mask.magFilter = THREE.LinearFilter
      mask.wrapS = mask.wrapT = THREE.ClampToEdgeWrapping
      mask.needsUpdate = true
      albedo.colorSpace = THREE.SRGBColorSpace
      normal.colorSpace = THREE.NoColorSpace
      for (const t of [albedo, normal]) {
        t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
        t.anisotropy = Math.min(4, gl.capabilities.getMaxAnisotropy())
        t.needsUpdate = true
      }
      made.push(mask, albedo, normal)
      if (!live) return made.forEach((t) => t.dispose())
      setTex({ mask, albedo, normal, half: S.half, size: bmp.width })
    })
    return () => {
      live = false
      made.forEach((t) => t.dispose())
    }
  }, [data, manifest, gl, enabled])
  return tex
}

/** terrain height from the finest (L8) height tiles, same triangulation as Terrain */
async function heightField(data, manifest, half) {
  const T = manifest.terrain
  const L = 8
  const s = (2 * T.half) / 2 ** L
  const n = T.heightSize
  const i0 = Math.floor((-half - 4 + T.half) / s)
  const i1 = Math.floor((half + 4 + T.half) / s)
  const tiles = new Map()
  const jobs = []
  for (let i = i0; i <= i1; i++)
    for (let j = i0; j <= i1; j++) jobs.push(data.terrainTile(L, i, j).then((d) => tiles.set(`${i}_${j}`, d.heights), () => {}))
  await Promise.all(jobs)
  return (x, z) => {
    const i = Math.floor((x + T.half) / s)
    const j = Math.floor((z + T.half) / s)
    const h = tiles.get(`${i}_${j}`)
    if (!h) return manifest.frame.groundY
    const step = s / (n - 1)
    const gx = (x + T.half - i * s) / step
    const gz = (z + T.half - j * s) / step
    const ci = Math.min(n - 2, Math.floor(gx))
    const cj = Math.min(n - 2, Math.floor(gz))
    const fx = gx - ci
    const fz = gz - cj
    const a = cj * n + ci
    if (fx + fz <= 1) return h[a] + fx * (h[a + 1] - h[a]) + fz * (h[a + n] - h[a])
    return h[a + n + 1] + (1 - fx) * (h[a + n] - h[a + n + 1]) + (1 - fz) * (h[a + 1] - h[a + n + 1])
  }
}

function parse(buf, unit) {
  const v = new DataView(buf)
  const [nt, nc, nr] = [v.getUint32(4, true), v.getUint32(8, true), v.getUint32(12, true)]
  let o = 16
  const tri = new Float32Array(nt * 6)
  for (let k = 0; k < nt * 6; k++, o += 2) tri[k] = v.getInt16(o, true) * unit
  const strips = (count) =>
    Array.from({ length: count }, () => {
      const m = v.getUint32(o, true)
      o += 4
      const s = new Float32Array(m * 4)
      for (let k = 0; k < m * 4; k++, o += 2) s[k] = v.getInt16(o, true) * unit
      return s
    })
  return { tri, curbs: strips(nc), rims: strips(nr) }
}

/**
 * raised strip along an outline: a face on the outline (road / water side)
 * from `drop` below to `h` above the ground, the top, and the back face down
 * to the ground on the other side
 */
function stripGeometry(strips, H, h, drop, rgb) {
  const pos = []
  const nrm = []
  const col = []
  const idx = []
  let v = 0
  const c = new THREE.Color()
  for (const s of strips) {
    const m = s.length / 4
    if (m < 2) continue
    const base = v
    for (let k = 0; k < m; k++) {
      const [xi, zi, xo, zo] = [s[k * 4], s[k * 4 + 1], s[k * 4 + 2], s[k * 4 + 3]]
      let nx = xi - xo
      let nz = zi - zo
      const l = Math.hypot(nx, nz) || 1
      nx /= l
      nz /= l
      const yi = H(xi, zi)
      const yo = H(xo, zo)
      const top = Math.max(yi, yo) + h
      // 6 vertices: face bottom, face top, top inner, top outer, back top, back bottom
      pos.push(xi, yi - drop, zi, xi, top, zi, xi, top, zi, xo, top, zo, xo, top, zo, xo, yo - 0.02, zo)
      nrm.push(nx, 0, nz, nx, 0, nz, 0, 1, 0, 0, 1, 0, -nx, 0, -nz, -nx, 0, -nz)
      // slight wear variation per stone (1 m blocks)
      const w = 0.92 + 0.08 * Math.sin(Math.floor(k / 2) * 12.9898 + xi * 0.1)
      c.setRGB(rgb[0] * w, rgb[1] * w, rgb[2] * w)
      for (let q = 0; q < 6; q++) col.push(c.r * (q === 0 ? 0.7 : 1), c.g * (q === 0 ? 0.7 : 1), c.b * (q === 0 ? 0.7 : 1))
      v += 6
    }
    for (let k = 0; k < m - 1; k++) {
      const a = base + k * 6
      const b = a + 6
      for (const [p, q] of [
        [0, 1],
        [2, 3],
        [4, 5],
      ])
        idx.push(a + p, b + p, a + q, a + q, b + p, b + q)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setIndex(idx) // the outline's direction is not fixed: drawn double-sided
  g.computeBoundingSphere()
  return g
}

/** painted markings, curbs and pond rims (play mode, near the landmark) */
export function StreetDetail({ data, manifest, maxHeight = 320 }) {
  const [geo, setGeo] = useState(null)
  const camera = useThree((s) => s.camera)
  useEffect(() => {
    const S = manifest.streets
    if (!S) return
    let live = true
    Promise.all([data.fetch(S.geometry), heightField(data, manifest, S.half)]).then(([buf, H]) => {
      if (!live) return
      const { tri, curbs, rims } = parse(buf, S.unit)
      // markings: lifted 1.5 cm, drawn after the ground with a depth offset
      const n = tri.length / 2
      const pos = new Float32Array(n * 3)
      for (let k = 0; k < n; k++) {
        const x = tri[k * 2]
        const z = tri[k * 2 + 1]
        pos.set([x, H(x, z) + 0.015, z], k * 3)
      }
      const marks = new THREE.BufferGeometry()
      marks.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      // triangles come in either winding: make them all face up
      for (let k = 0; k < n; k += 3) {
        const ax = pos[k * 3]
        const az = pos[k * 3 + 2]
        const cross = (pos[k * 3 + 3] - ax) * (pos[k * 3 + 8] - az) - (pos[k * 3 + 5] - az) * (pos[k * 3 + 6] - ax)
        if (cross > 0) {
          for (let c = 0; c < 3; c++) {
            const t = pos[(k + 1) * 3 + c]
            pos[(k + 1) * 3 + c] = pos[(k + 2) * 3 + c]
            pos[(k + 2) * 3 + c] = t
          }
        }
      }
      marks.computeVertexNormals()
      marks.computeBoundingSphere()
      setGeo({
        marks,
        curbs: stripGeometry(curbs, H, 0.14, 0.04, [0.72, 0.7, 0.66]),
        rims: stripGeometry(rims, H, 0.38, 0.1, [0.8, 0.76, 0.68]),
      })
    })
    return () => {
      live = false
    }
  }, [data, manifest])
  const mats = useMemo(() => {
    const paint = withAerial(new THREE.MeshStandardMaterial({ color: '#e9e7de', roughness: 0.75, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }))
    paint.userData.cacheKey = 'paint'
    const stone = withAerial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, side: THREE.DoubleSide }))
    stone.userData.cacheKey = 'curb'
    return { paint, stone }
  }, [])
  useEffect(
    () => () => {
      mats.paint.dispose()
      mats.stone.dispose()
    },
    [mats],
  )
  useEffect(
    () => () => {
      if (geo) Object.values(geo).forEach((g) => g.dispose())
    },
    [geo],
  )
  const [show, setShow] = useState(true)
  useFrame(() => {
    // only near the ground: from higher up they are below a pixel
    const s = camera.position.y - manifest.frame.groundY < maxHeight
    if (s !== show) setShow(s)
  })
  if (!geo || !show) return null
  return (
    <>
      <mesh geometry={geo.marks} material={mats.paint} receiveShadow />
      <mesh geometry={geo.curbs} material={mats.stone} receiveShadow castShadow={false} />
      <mesh geometry={geo.rims} material={mats.stone} receiveShadow castShadow />
    </>
  )
}
