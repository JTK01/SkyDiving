import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { cine, isBankClosed, SUN_DIRECTION } from '../../state/cinematic'
import { getCloudTextures } from './cloudTextures'
import { CLOUD_COLORS } from './CloudSystem'

/**
 * The continuous deck of the sea of clouds.
 *
 * A large ground-level plane shaded with multi-scale noise: billow tops are
 * lit from the sun side (density gradient toward the sun), gaps reveal the
 * dark blue haze far below. The billboard puffs sit on top of it and give the
 * deck its 3D relief.
 */
const vertex = /* glsl */ `
  varying vec3 vWorld;
  #include <common>
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`
const fragment = /* glsl */ `
  precision highp float;
  uniform sampler2D uDetail;
  uniform vec3 uSun;
  uniform vec3 uLit;
  uniform vec3 uShadow;
  uniform vec3 uHaze;
  uniform float uOffset;
  uniform float uFog;
  uniform float uBrightness;
  varying vec3 vWorld;

  float h(vec2 p) {
    return texture2D(uDetail, p * 0.0011).r * 0.5
         + texture2D(uDetail, p * 0.0027 + 0.31).r * 0.3
         + texture2D(uDetail, p * 0.0069 + 0.73).r * 0.14
         + texture2D(uDetail, p * 0.017 + 0.17).r * 0.06;
  }

  void main() {
    vec2 p = vWorld.xz - vec2(0.0, uOffset);
    float n = h(p);
    vec2 toSun = normalize(uSun.xz) * 28.0;
    float nS = h(p + toSun);
    float shadow = clamp((nS - n) * 5.0, 0.0, 1.0);

    // small billows on top of the large-scale shape
    float b1 = texture2D(uDetail, p * 0.031 + 0.5).r;
    float b2 = texture2D(uDetail, p * 0.075 + 0.2).r;
    float bumps = b1 * 0.65 + b2 * 0.35;

    float cov = smoothstep(0.26, 0.48, n + (bumps - 0.5) * 0.12);
    float lit = clamp(0.55 + (n - 0.5) * 1.3 - shadow * 0.65 + (bumps - 0.5) * 0.45, 0.0, 1.0);
    vec3 cloud = mix(uShadow * 0.9, uLit, lit);
    vec3 gap = vec3(0.4, 0.47, 0.58);
    vec3 col = mix(gap, cloud, cov);

    col *= uBrightness;
    float dist = distance(cameraPosition, vWorld);
    float f = 1.0 - exp(-dist * uFog * 1.15);
    col = mix(col, uHaze * uBrightness, f);
    gl_FragColor = vec4(col, 1.0);
  }
`

export default function CloudFloor() {
  const ref = useRef()
  const camera = useThree((s) => s.camera)
  const material = useMemo(() => {
    const { detail } = getCloudTextures()
    return new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        uDetail: { value: detail },
        uSun: { value: SUN_DIRECTION },
        uLit: { value: CLOUD_COLORS.lit },
        uShadow: { value: CLOUD_COLORS.shadow },
        uHaze: { value: CLOUD_COLORS.haze },
        uOffset: { value: 0 },
        uFog: { value: cine.cloudFog },
        uBrightness: { value: 1 },
      },
    })
  }, [])

  useFrame(() => {
    const u = material.uniforms
    u.uOffset.value = cine.windOffset
    u.uFog.value = cine.cloudFog
    u.uBrightness.value = cine.brightness
    ref.current.position.set(camera.position.x, -6, camera.position.z)
    ref.current.visible = !isBankClosed()
  })

  return (
    <mesh ref={ref} material={material} rotation={[-Math.PI / 2, 0, 0]} renderOrder={0}>
      <planeGeometry args={[12000, 12000, 1, 1]} />
    </mesh>
  )
}
