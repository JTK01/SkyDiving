import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { gltfLoader, loadKTX2 } from './loaders'
import { withAerial } from './aerial'

/**
 * Street and park trees (map data: features.trees, x z y size), 4 species
 * built offline by tools/map-data/build_trees.mjs:
 *   streets  London plane 72 % · hackberry 28 %
 *   squares / parks  stone pine 40 % · cypress 20 % · plane 20 % · hackberry 20 %
 *
 * Levels, re-assigned a few times a second from the camera position:
 *   near  the `near.n` closest trees within `near.r` m: branches + small cards
 *   mid   the next `mid.n` within `mid.r` m: trunk, limbs, large cards
 *   far   all others within `far` m: one hemi-octahedral impostor quad each
 *         (8 × 8 views over the upper hemisphere, so they read from above too)
 * One InstancedMesh per species and level + one for every impostor:
 * ≤ 9 draw calls. Trees do not cast into the cached shadow map.
 */
const BASE = import.meta.env.BASE_URL || '/'
const SPECIES = ['plane', 'celtis', 'pine', 'cypress']
const MIX = {
  street: [0.72, 0.28, 0, 0],
  park: [0.2, 0.2, 0.4, 0.2],
}
const hash = (a, b) => {
  const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453
  return s - Math.floor(s)
}

function inPoly(pts, x, z) {
  // pts: x, z, y triples
  let inside = false
  const n = pts.length / 3
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i * 3]
    const zi = pts[i * 3 + 1]
    const xj = pts[j * 3]
    const zj = pts[j * 3 + 1]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

/** species, scale and rotation of every tree */
function plant(f, stride) {
  const parks = f.areas
    .filter((a) => a.type !== 'water')
    .map((a) => {
      let [x0, z0, x1, z1] = [Infinity, Infinity, -Infinity, -Infinity]
      for (let k = 0; k < a.pts.length; k += 3) {
        x0 = Math.min(x0, a.pts[k])
        x1 = Math.max(x1, a.pts[k])
        z0 = Math.min(z0, a.pts[k + 1])
        z1 = Math.max(z1, a.pts[k + 1])
      }
      return { a, box: [x0, z0, x1, z1] }
    })
  const n = Math.floor(f.trees.length / 4 / stride)
  const out = { n, x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n), s: new Float32Array(n), yaw: new Float32Array(n), sp: new Uint8Array(n) }
  for (let k = 0; k < n; k++) {
    const q = k * stride * 4
    const [x, z, y, size] = f.trees.subarray(q, q + 4)
    const park = parks.some(({ a, box }) => x >= box[0] && x <= box[2] && z >= box[1] && z <= box[3] && inPoly(a.pts, x, z))
    const mix = MIX[park ? 'park' : 'street']
    let r = hash(x, z)
    let sp = 0
    while (sp < 3 && r > mix[sp]) r -= mix[sp++]
    out.x[k] = x
    out.y[k] = y - 0.1
    out.z[k] = z
    out.s[k] = park ? 0.75 + (size - 4.5) * 0.12 : 0.82 + (size - 4.2) * 0.2 // street ≈ 13–18 m planes
    out.yaw[k] = hash(z, x) * Math.PI * 2
    out.sp[k] = sp
  }
  return out
}

/** foliage + bark atlas addressing (uv1 = column, row), wind, no normal flip on back faces */
function treeMaterial(atlas, a2c, wind) {
  const m = new THREE.MeshStandardMaterial({ map: atlas, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9, metalness: 0, envMapIntensity: 0.7 })
  m.alphaToCoverage = a2c
  m.userData.cacheKey = 'tree'
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = wind
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 uv1;\nuniform float uTime;\nvarying vec2 vCell;\nvarying vec2 vUvT;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvCell = uv1;\nvUvT = uv;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         // a light breeze on the foliage, more toward the top of the crown
         if (uv1.y < 0.5) {
           float ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.21;
           float k = 0.06 * smoothstep(2.0, 14.0, position.y);
           transformed.x += sin(uTime * 1.3 + ph + position.y * 0.4) * k;
           transformed.z += cos(uTime * 1.1 + ph + position.x * 0.5) * k * 0.7;
         }`,
      )
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vCell;\nvarying vec2 vUvT;')
      .replace(
        '#include <map_fragment>',
        `vec2 f = vCell.y > 0.5 ? fract(vUvT) : clamp(vUvT, 0.002, 0.998);
         vec2 auv = (vCell + f) * vec2(0.25, 0.5);
         vec4 texel = textureGrad(map, auv, dFdx(vUvT) * vec2(0.25, 0.5), dFdy(vUvT) * vec2(0.25, 0.5));
         diffuseColor *= texel;`,
      )
      .replace(
        '#include <normal_fragment_begin>',
        `float faceDirection = gl_FrontFacing ? 1.0 : -1.0;
         vec3 normal = normalize(vNormal); // crown-shaped normals: same on both card faces
         vec3 nonPerturbedNormal = normal;`,
      )
  }
  return withAerial(m)
}

/** hemi-octahedral impostor: camera-facing quad, the atlas cell nearest the view direction */
function impostorMaterial(atlas, meta) {
  const m = new THREE.MeshBasicMaterial({ map: atlas, alphaTest: 0.5, side: THREE.DoubleSide })
  m.userData.cacheKey = 'treeImpostor'
  const info = SPECIES.map((s) => {
    const d = meta.species[s]
    return new THREE.Vector4(d.center[1], d.radius, d.quadrant[0], d.quadrant[1])
  })
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uInfo = { value: info }
    sh.uniforms.uTint = { value: new THREE.Color(0.92, 0.92, 0.9) }
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float aSpecies;\nuniform vec4 uInfo[4];\nvarying vec2 vImp;\nvarying vec3 vAerialW;\nconst float N = ${meta.grid.toFixed(1)};`)
      .replace(
        '#include <project_vertex>',
        `vec3 base = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
         float sc = length(instanceMatrix[0].xyz);
         vec3 ax = instanceMatrix[0].xyz / sc;
         vec4 inf = uInfo[int(aSpecies + 0.5)];
         vec3 ctr = base + vec3(0.0, inf.x * sc, 0.0);
         float R = inf.y * sc;
         vec3 d = normalize(cameraPosition - ctr);
         // view direction in the tree's own frame (undo its yaw)
         vec3 dl = normalize(vec3(dot(d, ax), max(d.y, 0.0), dot(d, vec3(ax.z, 0.0, -ax.x) * -1.0)));
         vec3 o = dl / (abs(dl.x) + abs(dl.y) + abs(dl.z));
         vec2 cell = clamp(floor((vec2(o.x + o.z, o.x - o.z) * 0.5 + 0.5) * N), 0.0, N - 1.0);
         // billboard basis as in the bake (lookAt with up = +y)
         vec3 bx = normalize(cross(vec3(0.0, 1.0, 0.0), d) + vec3(1e-5, 0.0, 0.0));
         vec3 by = cross(d, bx);
         vec3 wp = ctr + (position.x * bx + position.y * by) * R;
         vec2 l = position.xy * 0.5 + 0.5;
         vImp = vec2(inf.z * N + cell.x + l.x, inf.w * N + (N - 1.0 - cell.y) + (1.0 - l.y)) / (2.0 * N);
         vAerialW = wp; // aerial perspective (withAerial skips its own vertex patch)
         vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
         gl_Position = projectionMatrix * mvPosition;`,
      )
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vImp;\nuniform vec3 uTint;')
      .replace('#include <map_fragment>', 'vec4 texel = texture2D(map, vImp);\ndiffuseColor *= texel;\ndiffuseColor.rgb *= uTint;')
  }
  return withAerial(m)
}

export default function Trees({ data, stride = 1, near = { n: 30, r: 45 }, mid = { n: 1200, r: 260 }, far = 1300, msaa = 0, onLoaded }) {
  const { gl, camera } = useThree()
  const [assets, setAssets] = useState(null)
  const [f, setF] = useState(null)
  const wind = useRef({ value: 0 }).current
  useEffect(() => {
    let live = true
    data.features().then((d) => live && setF(d))
    Promise.all([
      new Promise((res, rej) => gltfLoader(gl).load(`${BASE}models/trees/trees.glb`, res, undefined, rej)),
      fetch(`${BASE}models/trees/impostors.json`).then((r) => r.json()),
      loadKTX2(gl, `${BASE}textures/trees.ktx2`),
      loadKTX2(gl, `${BASE}textures/tree_impostors.ktx2`),
    ]).then(([g, meta, atlas, imp]) => {
      if (!live) return
      const geos = {}
      g.scene.updateMatrixWorld(true)
      g.scene.traverse((o) => {
        if (!o.isMesh) return
        let n = o
        while (n && !/_lod\d/.test(n.name)) n = n.parent
        if (!n) return
        // bake the node transform (meshopt dequantisation) into the geometry
        const geo = o.geometry.clone()
        geo.applyMatrix4(o.matrixWorld)
        geos[n.name] = geo
      })
      for (const t of [atlas, imp]) {
        t.anisotropy = 4
        t.needsUpdate = true
      }
      setAssets({ geos, meta, atlas, imp })
    })
    return () => {
      live = false
    }
  }, [gl, data])

  const built = useMemo(() => {
    if (!assets || !f) return null
    const trees = plant(f, stride)
    const mat = treeMaterial(assets.atlas, msaa > 0, wind)
    const meshes = SPECIES.map((s) =>
      [0, 1].map((lod) => {
        const im = new THREE.InstancedMesh(assets.geos[`${s}_lod${lod}`], mat, lod ? mid.n : near.n)
        im.count = 0
        im.frustumCulled = false
        im.receiveShadow = true
        return im
      }),
    )
    const quad = new THREE.PlaneGeometry(2, 2)
    quad.setAttribute('aSpecies', new THREE.InstancedBufferAttribute(new Float32Array(trees.n), 1))
    const impostors = new THREE.InstancedMesh(quad, impostorMaterial(assets.imp, assets.meta), trees.n)
    impostors.count = 0
    impostors.frustumCulled = false
    return { trees, meshes, impostors, mat, lod: new Int8Array(trees.n).fill(-1), d: new Float32Array(trees.n), last: { x: 1e9, z: 1e9, y: 1e9, t: 0 } }
  }, [assets, f, stride, near.n, mid.n, msaa, wind])

  useEffect(() => {
    if (built) onLoaded?.()
    return () => {
      if (!built) return
      built.meshes.flat().forEach((m) => m.dispose())
      built.impostors.geometry.dispose()
      built.impostors.material.dispose()
      built.mat.dispose()
    }
  }, [built]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(
    () => () => {
      if (!assets) return
      Object.values(assets.geos).forEach((g) => g.dispose())
      assets.atlas.dispose()
      assets.imp.dispose()
    },
    [assets],
  )

  const o = useMemo(() => new THREE.Object3D(), [])
  useFrame((_, dt) => {
    if (!built) return
    wind.value += dt
    const L = built.last
    const c = camera.position
    L.t += dt
    // re-assign levels when the camera moved a few metres (or every 0.5 s)
    if (Math.hypot(c.x - L.x, c.y - L.y, c.z - L.z) < 3 && L.t < 0.5) return
    Object.assign(L, { x: c.x, y: c.y, z: c.z, t: 0 })
    const T = built.trees
    const order = []
    for (let k = 0; k < T.n; k++) {
      const dx = T.x[k] - c.x
      const dz = T.z[k] - c.z
      const dy = T.y[k] - c.y
      built.d[k] = Math.sqrt(dx * dx + dz * dz + dy * dy * 0.25)
      if (built.d[k] < mid.r) order.push(k)
    }
    order.sort((a, b) => built.d[a] - built.d[b])
    const counts = SPECIES.map(() => [0, 0])
    built.lod.fill(-1)
    let n0 = 0
    let n1 = 0
    for (const k of order) {
      let lod = -1
      if (n0 < near.n && built.d[k] < near.r) lod = 0
      else if (n1 < mid.n) lod = 1
      if (lod < 0) continue
      const sp = T.sp[k]
      const im = built.meshes[sp][lod]
      if (counts[sp][lod] >= im.instanceMatrix.count) continue
      if (lod) n1++
      else n0++
      built.lod[k] = lod
      o.position.set(T.x[k], T.y[k], T.z[k])
      o.rotation.set(0, T.yaw[k], 0)
      o.scale.setScalar(T.s[k])
      o.updateMatrix()
      im.setMatrixAt(counts[sp][lod]++, o.matrix)
    }
    built.meshes.forEach((pair, sp) =>
      pair.forEach((im, lod) => {
        im.count = counts[sp][lod]
        im.visible = im.count > 0
        im.instanceMatrix.needsUpdate = true
      }),
    )
    // everything else in range → impostors
    const imp = built.impostors
    const spA = imp.geometry.getAttribute('aSpecies')
    let ni = 0
    for (let k = 0; k < T.n; k++) {
      if (built.lod[k] >= 0 || built.d[k] > far) continue
      o.position.set(T.x[k], T.y[k], T.z[k])
      o.rotation.set(0, T.yaw[k], 0)
      o.scale.setScalar(T.s[k])
      o.updateMatrix()
      imp.setMatrixAt(ni, o.matrix)
      spA.array[ni++] = T.sp[k]
    }
    imp.count = ni
    imp.visible = ni > 0
    imp.instanceMatrix.needsUpdate = true
    spA.needsUpdate = true
  })

  if (!built) return null
  return (
    <>
      {built.meshes.flat().map((m, i) => (
        <primitive key={i} object={m} />
      ))}
      <primitive object={built.impostors} />
    </>
  )
}
