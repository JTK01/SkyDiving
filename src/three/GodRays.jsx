import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { cine, SUN_DIRECTION } from '../state/cinematic'
import { getCloudTextures } from './clouds/cloudTextures'

/**
 * Screen-space crepuscular rays radiating from the sun's projected position.
 * Rendered additively *before* the cloud-interior layer, so while the clouds
 * part the light only shows through the opening.
 */
const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`
const fragment = /* glsl */ `
  precision highp float;
  uniform sampler2D uDetail;
  uniform vec2 uSun;
  uniform float uIntensity;
  uniform float uTime;
  uniform float uAspect;
  varying vec2 vUv;

  void main() {
    vec2 d = (vUv - uSun) * vec2(uAspect, 1.0);
    float len = length(d);
    vec2 dir = d / max(len, 1e-4);
    float t = uTime;

    float r1 = texture2D(uDetail, dir * 0.55 + vec2(t * 0.004, 0.0)).r;
    float r2 = texture2D(uDetail, dir * 1.7 + vec2(0.0, t * 0.006)).r;
    float rays = pow(r1, 3.0) * 1.7 + pow(r2, 4.0) * 1.1;

    float fall = exp(-len * 1.35);
    float glow = exp(-len * 7.0) * 0.4 + exp(-len * 24.0) * 0.5;
    vec3 sunC = vec3(1.0, 0.92, 0.78);
    vec3 col = sunC * (rays * fall * 0.42 + glow) * uIntensity;
    gl_FragColor = vec4(col, 1.0);
  }
`

export default function GodRays() {
  const ref = useRef()
  const { camera, size } = useThree()
  const tmp = useMemo(() => new THREE.Vector3(), [])
  const fwd = useMemo(() => new THREE.Vector3(), [])
  const material = useMemo(() => {
    const { detail } = getCloudTextures()
    return new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uDetail: { value: detail },
        uSun: { value: new THREE.Vector2(0.7, 0.8) },
        uIntensity: { value: 0 },
        uTime: { value: 0 },
        uAspect: { value: 1 },
      },
    })
  }, [])

  useFrame((_, dt) => {
    const u = material.uniforms
    u.uTime.value += Math.min(dt, 0.1)
    u.uAspect.value = size.width / size.height
    // project the sun direction far away from the camera
    tmp.copy(SUN_DIRECTION).multiplyScalar(1000).add(camera.position).project(camera)
    u.uSun.value.set(tmp.x * 0.5 + 0.5, tmp.y * 0.5 + 0.5)
    const facing = camera.getWorldDirection(fwd).dot(SUN_DIRECTION)
    const vis = THREE.MathUtils.smoothstep(facing, -0.1, 0.45)
    u.uIntensity.value = cine.rays * vis * cine.brightness
    const covered = cine.cover > 0.995 && cine.open < 0.001
    ref.current.visible = u.uIntensity.value > 0.002 && !covered
  })

  return (
    <mesh ref={ref} material={material} frustumCulled={false} renderOrder={10}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  )
}
