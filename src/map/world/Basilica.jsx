import { useEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { gltfLoader } from './loaders'
import { withAerial } from './aerial'

/**
 * Basílica de la Sagrada Família (completed state), loaded from the prebuilt,
 * meshopt-compressed glb (tools/map-data/build_basilica.mjs ←
 * basilicaGeometry.js) in two levels of detail:
 *   lod 0 (< LOD_DISTANCE): all ornament, ≈ 95 k triangles, 3 draws
 *   lod 1 (beyond):         main masses,   ≈ 17 k triangles, 2 draws
 * Stone carries the tower louvre / lattice data in its texcoords (uv = angle,
 * rel. height; uv1.x = slit strength). No normals are stored: every material
 * shades flat. `onLevel` fires when the level changes (shadow map refresh).
 */
const BASE = import.meta.env.BASE_URL || '/'
export const BASILICA_URL = `${BASE}models/sagrada-familia/basilica.glb`
export const BASILICA_COLLIDERS_URL = `${BASE}models/sagrada-familia/colliders.json`
export const LOD_DISTANCE = 450 // m from the camera to the basilica centre

function stoneMaterial(groundY) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0, envMapIntensity: 0.9, flatShading: true })
  m.userData.cacheKey = 'stone'
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uGround = { value: groundY }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 uv1;\nvarying vec3 vTower;\nvarying vec3 vObj;')
      // positions are quantised (KHR_mesh_quantization): use world space
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTower = vec3(uv, uv1.x);\nvObj = (modelMatrix * vec4(position, 1.0)).xyz;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uGround;\nvarying vec3 vTower;\nvarying vec3 vObj;\nfloat h1(float x){return fract(sin(x*91.7)*43758.5);}\nfloat h3(vec3 p){return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719)))*43758.5453);}')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         // weathering: vertical streaks, darker and dirtier toward the base
         float streak = h1(floor(vObj.x * 1.7 + vObj.z * 1.3));
         diffuseColor.rgb *= 0.9 + 0.1 * streak;
         diffuseColor.rgb *= mix(0.78, 1.0, smoothstep(0.0, 40.0, vObj.y - uGround));
         // close range only: block courses (0.65 m), staggered joints, grain
         float near = 1.0 - smoothstep(60.0, 220.0, length(vObj - cameraPosition));
         if (near > 0.0) {
           float row = vObj.y / 0.65;
           float cy = fract(row);
           float cx = fract((vObj.x + vObj.z) / 1.3 + floor(row) * 0.5);
           float joint = max(1.0 - smoothstep(0.0, 0.05, min(cy, 1.0 - cy)), 1.0 - smoothstep(0.0, 0.03, min(cx, 1.0 - cx)));
           float grain = h3(floor(vObj * 3.0)) - 0.5;
           float block = h1(floor(row) * 7.1 + floor((vObj.x + vObj.z) / 1.3 + floor(row) * 0.5));
           diffuseColor.rgb *= 1.0 - near * (0.09 * joint - 0.06 * grain - 0.05 * (block - 0.5));
         }
         // tower louvres: spiral slits on the body, light mouldings between stages
         if (vTower.z > 0.0) {
           float spiral = fract(vTower.x * 14.0 + vTower.y * 3.0);
           float stage = fract(vTower.y * 9.0);
           float slit = step(0.7, spiral) * step(0.14, stage) * step(stage, 0.9)
                      * step(0.1, vTower.y) * step(vTower.y, 0.86);
           diffuseColor.rgb *= 1.0 - slit * 0.78 * vTower.z;
           diffuseColor.rgb *= 1.0 + 0.12 * (1.0 - step(0.08, abs(stage - 0.5) - 0.38));
         }`,
      )
  }
  return withAerial(m)
}

function glassMaterial() {
  // window glass: dark, glossy, reflects the sky
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.12, metalness: 0.3, flatShading: true, envMapIntensity: 1.4 })
  m.userData.cacheKey = 'glass'
  return withAerial(m)
}

function mosaicMaterial() {
  // Venetian glass & ceramic: glossy, a touch self-lit so colours read from far away
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.1, flatShading: true, emissive: '#ffffff', emissiveIntensity: 0.1, envMapIntensity: 1.2 })
  m.userData.cacheKey = 'mosaic'
  return withAerial(m)
}

export default function Basilica({ onLoaded, onLevel, ...props }) {
  const gl = useThree((s) => s.gl)
  const [lod, setLod] = useState(null)
  const level = useRef(-1)
  useEffect(() => {
    let live = true
    let mats = []
    gltfLoader(gl).load(BASILICA_URL, (g) => {
      if (!live) return
      mats = { stone: stoneMaterial(props.position?.[1] ?? 0), mosaic: mosaicMaterial(), glass: glassMaterial() }
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
