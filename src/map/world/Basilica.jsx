import { useEffect, useState } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { gltfLoader } from './loaders'
import { withAerial } from './aerial'

/**
 * Basílica de la Sagrada Família, loaded from the prebuilt, meshopt-
 * compressed glb (tools/map-data/build_basilica.mjs ← basilicaGeometry.js).
 * Two meshes → two draw calls. Stone carries the tower louvre data in its
 * texcoords (uv = angle, rel. height; uv1.x = slit strength).
 */
const BASE = import.meta.env.BASE_URL || '/'
export const BASILICA_URL = `${BASE}models/sagrada-familia/basilica.glb`
export const BASILICA_COLLIDERS_URL = `${BASE}models/sagrada-familia/colliders.json`

function stoneMaterial(groundY) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0, envMapIntensity: 0.9 })
  m.userData.cacheKey = 'stone'
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uGround = { value: groundY }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 uv1;\nvarying vec3 vTower;\nvarying vec3 vObj;')
      // positions are quantised (KHR_mesh_quantization): use world space
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTower = vec3(uv, uv1.x);\nvObj = (modelMatrix * vec4(position, 1.0)).xyz;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uGround;\nvarying vec3 vTower;\nvarying vec3 vObj;\nfloat h1(float x){return fract(sin(x*91.7)*43758.5);}')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         // weathering: vertical streaks, darker and dirtier toward the base
         float streak = h1(floor(vObj.x * 1.7 + vObj.z * 1.3));
         diffuseColor.rgb *= 0.9 + 0.1 * streak;
         diffuseColor.rgb *= mix(0.78, 1.0, smoothstep(0.0, 40.0, vObj.y - uGround));
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

function mosaicMaterial() {
  // Venetian glass & ceramic: glossy, a touch self-lit so colours read from far away
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.1, flatShading: true, emissive: '#ffffff', emissiveIntensity: 0.1, envMapIntensity: 1.2 })
  m.userData.cacheKey = 'mosaic'
  return withAerial(m)
}

export default function Basilica({ onLoaded, ...props }) {
  const gl = useThree((s) => s.gl)
  const [scene, setScene] = useState(null)
  useEffect(() => {
    let live = true
    let mats = []
    gltfLoader(gl).load(BASILICA_URL, (g) => {
      if (!live) return
      mats = [stoneMaterial(props.position?.[1] ?? 0), mosaicMaterial()]
      g.scene.traverse((o) => {
        if (!o.isMesh) return
        o.material = o.name.includes('mosaic') || o.material.name === 'mosaic' ? mats[1] : mats[0]
        o.castShadow = true
        o.receiveShadow = true
      })
      setScene(g.scene)
      onLoaded?.()
    })
    return () => {
      live = false
      mats.forEach((m) => m.dispose())
    }
  }, [gl]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(
    () => () =>
      scene?.traverse((o) => {
        if (o.isMesh) o.geometry.dispose()
      }),
    [scene],
  )
  return <group {...props}>{scene && <primitive object={scene} />}</group>
}
