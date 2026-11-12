import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { SUN_DIR, HAZE, ZENITH, FOG_DENSITY, SUN_COLOR } from './atmosphereConfig'

function SkyDome() {
  const ref = useRef()
  const camera = useThree((s) => s.camera)
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        uniforms: { uSun: { value: SUN_DIR }, uHaze: { value: HAZE }, uZenith: { value: ZENITH } },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = position;
            vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_Position = p.xyww;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uSun; uniform vec3 uHaze; uniform vec3 uZenith;
          varying vec3 vDir;
          void main() {
            vec3 d = normalize(vDir);
            float h = max(d.y, 0.0);
            vec3 col = mix(uHaze, uZenith, pow(smoothstep(0.0, 0.85, h), 0.55));
            float s = max(dot(d, uSun), 0.0);
            col += vec3(1.0, 0.95, 0.85) * (pow(s, 12.0) * 0.18 + pow(s, 900.0) * 3.0);
            gl_FragColor = vec4(col, 1.0);
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

/** sky, sun, ambient and fog; `shadows` enables a sun shadow box around the basilica */
export default function Atmosphere({ shadows = false, shadowRadius = 450 }) {
  const fog = useMemo(() => new THREE.FogExp2(HAZE, FOG_DENSITY), [])
  const sun = SUN_DIR.clone().multiplyScalar(3000)
  return (
    <>
      <primitive attach="fog" object={fog} />
      <color attach="background" args={[HAZE]} />
      <SkyDome />
      <hemisphereLight args={['#cfe0f3', '#8c7f6c', 1.15]} />
      <directionalLight
        position={sun}
        color={SUN_COLOR}
        intensity={2.2}
        castShadow={shadows}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-shadowRadius}
        shadow-camera-right={shadowRadius}
        shadow-camera-top={shadowRadius}
        shadow-camera-bottom={-shadowRadius}
        shadow-camera-near={1500}
        shadow-camera-far={4500}
        shadow-bias={-0.0003}
        shadow-normalBias={0.6}
      />
    </>
  )
}
