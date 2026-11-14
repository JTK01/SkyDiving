import { useEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { gltfLoader, loadKTX2 } from './loaders'
import { withAerial } from './aerial'

/**
 * Basílica de la Sagrada Família (completed state), loaded from the prebuilt,
 * meshopt-compressed glb (tools/map-data/build_basilica.mjs ←
 * basilicaGeometry.js) in two levels of detail:
 *   lod 0 (< LOD_DISTANCE): all ornament, ≈ 169 k triangles, 3 draws
 *   lod 1 (beyond):         main masses,   ≈ 16 k triangles, 2 draws
 * Stone carries the tower louvre data and the surface type in its texcoords
 * (uv = angle, rel. height; uv1 = slit strength, surface / 3). Ambient
 * occlusion is baked into the vertex colours. No normals are stored: every
 * material shades flat. `onLevel` fires when the level changes (shadow map).
 */
const BASE = import.meta.env.BASE_URL || '/'
export const BASILICA_URL = `${BASE}models/sagrada-familia/basilica.glb`
export const BASILICA_COLLIDERS_URL = `${BASE}models/sagrada-familia/colliders.json`
export const LOD_DISTANCE = 450 // m from the camera to the basilica centre

/**
 * Close-range surface detail (≤ ~150 m), shared by stone and mosaic:
 * triplanar samples of the tileable atlases (public/textures/stone_*.ktx2,
 * 4 cells: ashlar, carved, porous, mosaic; 1 cell = 4 m) from world position,
 * so the procedural model needs no UVs. Albedo detail, whiteout-blended
 * normal perturbation and cavity AO, faded out with distance.
 */
const TRI_GLSL = /* glsl */ `
uniform sampler2D uStoneA;
uniform sampler2D uStoneN;
varying vec3 vObj;
vec4 triCell(sampler2D t, vec2 uv, float cell) {
  vec2 a = vec2((cell + fract(uv.x)) * 0.25, fract(uv.y));
  return textureGrad(t, a, dFdx(uv) * vec2(0.25, 1.0), dFdy(uv) * vec2(0.25, 1.0));
}
// returns the near-fade factor; albedo multiplier, world normal and AO via out
float triDetail(float cell, out vec3 alb, out vec3 nP, out float ao) {
  vec3 nW = normalize(cross(dFdx(vObj), dFdy(vObj)));
  if (dot(nW, cameraPosition - vObj) < 0.0) nW = -nW;
  float nearK = 1.0 - smoothstep(40.0, 160.0, length(vObj - cameraPosition));
  alb = vec3(1.0); nP = nW; ao = 1.0;
  if (nearK <= 0.0) return 0.0;
  vec3 w = pow(abs(nW), vec3(4.0));
  w /= (w.x + w.y + w.z);
  vec2 uX = vObj.zy / 4.0, uY = vObj.xz / 4.0, uZ = vObj.xy / 4.0;
  vec4 aX = triCell(uStoneA, uX, cell), aY = triCell(uStoneA, uY, cell), aZ = triCell(uStoneA, uZ, cell);
  vec4 nX = triCell(uStoneN, uX, cell), nY = triCell(uStoneN, uY, cell), nZ = triCell(uStoneN, uZ, cell);
  alb = (aX.rgb * w.x + aY.rgb * w.y + aZ.rgb * w.z) / 0.8; // atlas mean ≈ 0.8
  ao = nX.b * w.x + nY.b * w.y + nZ.b * w.z;
  vec3 tX = vec3(nX.rg * 2.0 - 1.0, 0.0); tX.z = sqrt(max(0.0, 1.0 - dot(tX.xy, tX.xy)));
  vec3 tY = vec3(nY.rg * 2.0 - 1.0, 0.0); tY.z = sqrt(max(0.0, 1.0 - dot(tY.xy, tY.xy)));
  vec3 tZ = vec3(nZ.rg * 2.0 - 1.0, 0.0); tZ.z = sqrt(max(0.0, 1.0 - dot(tZ.xy, tZ.xy)));
  vec3 sg = sign(nW);
  tX.x *= sg.x; tY.x *= sg.y; tZ.x *= -sg.z;
  // whiteout blend
  vec3 bX = vec3(tX.xy + nW.zy, abs(tX.z) * nW.x);
  vec3 bY = vec3(tY.xy + nW.xz, abs(tY.z) * nW.y);
  vec3 bZ = vec3(tZ.xy + nW.xy, abs(tZ.z) * nW.z);
  nP = normalize(bX.zyx * w.x + bY.xzy * w.y + bZ.xyz * w.z);
  return nearK;
}
`

function detailUniforms(shader, tex) {
  shader.uniforms.uStoneA = { value: tex.albedo }
  shader.uniforms.uStoneN = { value: tex.normal }
}
// normal stage: blend the perturbed world normal (view space for lighting)
const NORMAL_DETAIL = `#include <normal_fragment_maps>
  if (triK > 0.0) normal = normalize(mix(normal, normalize(mat3(viewMatrix) * triN), triK));`

function stoneMaterial(groundY, tex) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0, envMapIntensity: 0.9, flatShading: true })
  m.userData.cacheKey = 'stone'
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uGround = { value: groundY }
    detailUniforms(shader, tex)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 uv1;\nvarying vec3 vTower;\nvarying vec3 vObj;\nvarying float vSurf;')
      // positions are quantised (KHR_mesh_quantization): use world space
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTower = vec3(uv, uv1.x);\nvSurf = floor(uv1.y * 3.0 + 0.5);\nvObj = (modelMatrix * vec4(position, 1.0)).xyz;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uGround;\nvarying vec3 vTower;\nvarying float vSurf;\nfloat h1(float x){return fract(sin(x*91.7)*43758.5);}\n${TRI_GLSL}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         // weathering: vertical streaks, darker and dirtier toward the base,
         // rain-washed tops a touch lighter
         float streak = h1(floor(vObj.x * 1.7 + vObj.z * 1.3));
         diffuseColor.rgb *= 0.9 + 0.1 * streak;
         diffuseColor.rgb *= mix(0.78, 1.0, smoothstep(0.0, 40.0, vObj.y - uGround));
         vec3 triA; vec3 triN; float triAO;
         float triK = triDetail(vSurf, triA, triN, triAO);
         diffuseColor.rgb *= mix(vec3(1.0), triA, triK);
         diffuseColor.rgb *= mix(1.0, triAO, triK * 0.85);
         // far model: tower louvres drawn as a pattern (the near model has real holes)
         if (vTower.z > 0.0) {
           float spiral = fract(vTower.x * 14.0 + vTower.y * 3.0);
           float stage = fract(vTower.y * 9.0);
           float slit = step(0.7, spiral) * step(0.14, stage) * step(stage, 0.9)
                      * step(0.1, vTower.y) * step(vTower.y, 0.86);
           diffuseColor.rgb *= 1.0 - slit * 0.78 * vTower.z;
           diffuseColor.rgb *= 1.0 + 0.12 * (1.0 - step(0.08, abs(stage - 0.5) - 0.38));
         }`,
      )
      .replace('#include <normal_fragment_maps>', NORMAL_DETAIL)
  }
  return withAerial(m)
}

function glassMaterial() {
  // window glass: dark, glossy, reflects the sky
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.12, metalness: 0.3, flatShading: true, envMapIntensity: 1.4 })
  m.userData.cacheKey = 'glass'
  return withAerial(m)
}

function mosaicMaterial(tex) {
  // Venetian glass & ceramic tesserae: glossy, a touch self-lit so colours
  // read from far away; up close the tesserae and grout of the atlas' cell 3
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.1, flatShading: true, emissive: '#ffffff', emissiveIntensity: 0.1, envMapIntensity: 1.2 })
  m.userData.cacheKey = 'mosaic'
  m.onBeforeCompile = (shader) => {
    detailUniforms(shader, tex)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = (modelMatrix * vec4(position, 1.0)).xyz;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${TRI_GLSL}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         vec3 triA; vec3 triN; float triAO;
         float triK = triDetail(3.0, triA, triN, triAO);
         diffuseColor.rgb *= mix(vec3(1.0), triA, triK);
         diffuseColor.rgb *= mix(1.0, triAO, triK);`,
      )
      .replace('#include <normal_fragment_maps>', NORMAL_DETAIL)
  }
  return withAerial(m)
}

export default function Basilica({ onLoaded, onLevel, ...props }) {
  const gl = useThree((s) => s.gl)
  const [lod, setLod] = useState(null)
  const level = useRef(-1)
  useEffect(() => {
    let live = true
    let mats = []
    let textures = []
    Promise.all([
      new Promise((res, rej) => gltfLoader(gl).load(BASILICA_URL, res, undefined, rej)),
      loadKTX2(gl, `${BASE}textures/stone_albedo.ktx2`),
      loadKTX2(gl, `${BASE}textures/stone_normal.ktx2`),
    ]).then(([g, albedo, normal]) => {
      if (!live) return
      for (const t of [albedo, normal]) {
        t.anisotropy = Math.min(4, gl.capabilities.getMaxAnisotropy())
        t.needsUpdate = true
      }
      textures = [albedo, normal]
      const tex = { albedo, normal }
      mats = { stone: stoneMaterial(props.position?.[1] ?? 0, tex), mosaic: mosaicMaterial(tex), glass: glassMaterial() }
      const groups = [new THREE.Group(), new THREE.Group()]
      const meshes = []
      g.scene.updateMatrixWorld(true)
      g.scene.traverse((o) => o.isMesh && meshes.push(o))
      for (const o of meshes) {
        // the kind / level is in the name of the node above the mesh (gltfpack)
        let n = o
        while (n && !/_lod\d/.test(n.name)) n = n.parent
        const name = n?.name || ''
        const kind = ['mosaic', 'glass'].find((k) => name.includes(k)) || 'stone'
        o.material = mats[kind]
        o.castShadow = kind !== 'glass'
        o.receiveShadow = true
        // attach keeps the world transform (gltfpack dequantises via node transforms)
        groups[name.includes('lod1') ? 1 : 0].attach(o)
      }
      const l = new THREE.LOD()
      l.addLevel(groups[0], 0)
      l.addLevel(groups[1], LOD_DISTANCE)
      setLod(l)
      onLoaded?.()
    })
    return () => {
      live = false
      Object.values(mats).forEach((m) => m.dispose())
      textures.forEach((t) => t.dispose())
    }
  }, [gl]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(
    () => () =>
      lod?.traverse((o) => {
        if (o.isMesh) o.geometry.dispose()
      }),
    [lod],
  )
  useFrame(() => {
    if (!lod) return
    const k = lod.getCurrentLevel()
    if (k !== level.current) {
      level.current = k
      onLevel?.(k)
    }
  })
  return <group {...props}>{lod && <primitive object={lod} />}</group>
}
