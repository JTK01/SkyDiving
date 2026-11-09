import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { cine, SUN_DIRECTION } from '../state/cinematic'

/**
 * Sky dome: high-altitude blue gradient, warm forward-scatter around the sun,
 * a bright sun disk with bloom, and a hazy band at the horizon that the cloud
 * fog blends into.
 */
const vertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`
const fragment = /* glsl */ `
  precision highp float;
  uniform vec3 uSun;
  uniform float uBrightness;
  varying vec3 vDir;

  void main() {
    vec3 v = normalize(vDir);
    float h = v.y;
    float s = max(dot(v, uSun), 0.0);

    vec3 zenith  = vec3(0.10, 0.29, 0.62);
    vec3 upper   = vec3(0.30, 0.52, 0.80);
    vec3 horizon = vec3(0.74, 0.80, 0.87);
    vec3 below   = vec3(0.50, 0.57, 0.66);
    vec3 warm    = vec3(1.0, 0.83, 0.64);

    vec3 col = mix(horizon, upper, smoothstep(0.0, 0.25, h));
    col = mix(col, zenith, smoothstep(0.2, 0.9, h));
    col = mix(col, below, smoothstep(0.0, -0.25, h));

    // warm haze around the sun near the horizon
    col = mix(col, warm, pow(s, 5.0) * 0.4 * (1.0 - smoothstep(0.0, 0.6, h)));
    // atmospheric glow + disk
    col += vec3(1.0, 0.9, 0.75) * (pow(s, 24.0) * 0.35 + pow(s, 400.0) * 1.2);
    col += vec3(1.0) * smoothstep(0.99955, 0.9998, s) * 2.0;

    col *= uBrightness;
    gl_FragColor = vec4(col, 1.0);
  }
`

export default function Sky() {
  const ref = useRef()
  const camera = useThree((s) => s.camera)
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: { uSun: { value: SUN_DIRECTION }, uBrightness: { value: 0 } },
      }),
    [],
  )
  useFrame(() => {
    ref.current.position.copy(camera.position)
    material.uniforms.uBrightness.value = cine.brightness
  })
  return (
    <mesh ref={ref} material={material} renderOrder={-10} frustumCulled={false}>
      <sphereGeometry args={[4000, 48, 24]} />
    </mesh>
  )
}
