import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { SUN_DIR, HAZE, ZENITH, SUN_COLOR } from './atmosphereConfig'
import { AERIAL } from './aerial'

/**
 * Fixed clear-day lighting shared by preview and play:
 *  - sky dome (horizon colour = aerial-perspective haze, sun disc + glow)
 *  - sun (directional) + image-based ambient from a PMREM-filtered
 *    RoomEnvironment (soft sky/ground bounce on PBR materials)
 *  - optional sun shadow limited to a box around the landmark, rendered on
 *    demand (static scene, fixed sun): `shadowVersion` bumps re-render it
 */
function SkyDome() {
  const ref = useRef()
  const camera = useThree((s) => s.camera)
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        uniforms: { uSun: { value: SUN_DIR }, uHaze: { value: HAZE }, uZenith: { value: ZENITH }, uGlow: AERIAL.uSunGlow },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = position;
            vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_Position = p.xyww;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uSun; uniform vec3 uHaze; uniform vec3 uZenith; uniform vec3 uGlow;
          varying vec3 vDir;
          void main() {
            vec3 d = normalize(vDir);
            float h = max(d.y, 0.0);
            vec3 col = mix(uHaze, uZenith, pow(smoothstep(0.0, 0.85, h), 0.55));
            float s = max(dot(d, uSun), 0.0);
            col = mix(col, uGlow, pow(s, 6.0) * 0.6 * (1.0 - h)); // same tint as the aerial haze
            col += vec3(1.0, 0.95, 0.85) * (pow(s, 14.0) * 0.16 + pow(s, 900.0) * 6.0); // halo + disc (feeds bloom)
            gl_FragColor = vec4(col, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    [],
  )
  useFrame(() => ref.current.position.copy(camera.position))
  return (
    <mesh ref={ref} material={mat} renderOrder={-100} frustumCulled={false}>
      <sphereGeometry args={[1000, 32, 16]} />
    </mesh>
  )
}

function Environment() {
  const { gl, scene } = useThree()
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl)
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = env
    scene.environmentIntensity = 0.32
    pmrem.dispose()
    return () => {
      scene.environment = null
      env.dispose()
    }
  }, [gl, scene])
  return null
}

/** shadow map rendered only when `version` changes (and on preset change) */
function ShadowCache({ size, radius, center, version }) {
  const gl = useThree((s) => s.gl)
  const frames = useRef(0)
  useEffect(() => {
    gl.shadowMap.autoUpdate = false
    gl.shadowMap.needsUpdate = true
    frames.current = 3 // a few frames: geometry uploaded in between
  }, [gl, size, version])
  useFrame(() => {
    if (frames.current > 0) {
      frames.current--
      gl.shadowMap.needsUpdate = true
    }
  })
  return null
}

export default function Atmosphere({ shadowSize = 0, shadowRadius = 320, center = [0, 0, 0], shadowVersion = 0 }) {
  const sun = useMemo(() => new THREE.DirectionalLight(SUN_COLOR, 1.55), [])
  useEffect(() => {
    sun.position.copy(SUN_DIR).multiplyScalar(2500).add(new THREE.Vector3(...center))
    sun.target.position.set(...center)
    sun.target.updateMatrixWorld()
    sun.castShadow = shadowSize > 0
    const cam = sun.shadow.camera
    Object.assign(cam, { left: -shadowRadius, right: shadowRadius, top: shadowRadius, bottom: -shadowRadius, near: 1500, far: 3600 })
    cam.updateProjectionMatrix()
    sun.shadow.bias = -0.0004
    sun.shadow.normalBias = 0.5
    if (shadowSize && sun.shadow.mapSize.x !== shadowSize) {
      sun.shadow.mapSize.set(shadowSize, shadowSize)
      sun.shadow.map?.dispose()
      sun.shadow.map = null
    }
  }, [sun, shadowSize, shadowRadius, center])
  return (
    <>
      <color attach="background" args={[HAZE]} />
      <SkyDome />
      <Environment />
      <hemisphereLight args={['#cfe0f3', '#8c7f6c', 0.35]} />
      <primitive object={sun} />
      <primitive object={sun.target} />
      {shadowSize > 0 && <ShadowCache size={shadowSize} radius={shadowRadius} center={center} version={shadowVersion} />}
    </>
  )
}
