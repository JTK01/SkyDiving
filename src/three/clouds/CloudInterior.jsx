import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { cine } from '../../state/cinematic'
import { getCloudTextures } from './cloudTextures'

/**
 * "Inside the cloud" full-screen layer.
 *
 * Fills the frame once the converging puffs have closed the gaps (cover → 1)
 * and stays as the living, slowly billowing backdrop behind the login UI.
 * On login success the layer tears open from the centre (open → 1) with a
 * noisy, cloud-shaped edge while the puffs behind it scatter outward.
 */
const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`
const fragment = /* glsl */ `
  precision highp float;
  uniform sampler2D uDetail;
  uniform float uCover;
  uniform float uOpen;
  uniform float uTime;
  uniform float uAspect;
  uniform float uBrightness;
  varying vec2 vUv;

  float tex(vec2 p) {
    return texture2D(uDetail, p).r * 0.55
         + texture2D(uDetail, p * 2.07 + 0.31).r * 0.3
         + texture2D(uDetail, p * 4.31 + 0.77).r * 0.15;
  }

  void main() {
    vec2 p = (vUv - 0.5) * vec2(max(uAspect, 1.0), max(1.0 / uAspect, 1.0));
    float t = uTime;

    // three parallax layers drifting at different speeds
    float n1 = tex(p * 0.32 + vec2(t * 0.006, t * 0.003));
    float n2 = tex(p * 0.62 + vec2(-t * 0.011, t * 0.002) + n1 * 0.35);
    float n3 = tex(p * 1.25 + vec2(t * 0.017, -t * 0.006) + n2 * 0.25);
    float n = n1 * 0.45 + n2 * 0.35 + n3 * 0.2;

    vec3 lightC = vec3(0.95, 0.965, 0.985);
    vec3 midC   = vec3(0.79, 0.83, 0.89);
    vec3 shadeC = vec3(0.6, 0.66, 0.75);
    float g = smoothstep(0.3, 0.72, n);
    vec3 col = mix(shadeC, midC, smoothstep(0.2, 0.5, n));
    col = mix(col, lightC, g);
    col *= 0.9 + vUv.y * 0.16;           // light from above
    col += vec3(1.0, 0.92, 0.8) * pow(g, 3.0) * 0.06;

    // --- parting from the centre -------------------------------------------
    vec2 q = p * vec2(0.85, 1.15);         // opens a little more up & sideways
    float r = length(q);
    float R = uOpen * 2.1 - 0.1;
    float edgeNoise = (n2 - 0.5) * 0.9 + (n3 - 0.5) * 0.35;
    float hole = smoothstep(R - 0.02, R + 0.38, r + edgeNoise);
    float openAmt = smoothstep(0.0, 0.04, uOpen);
    float a = uCover * mix(1.0, hole, openAmt);

    // the torn edges catch the sunlight
    float rim = smoothstep(0.35, 0.0, abs(r + edgeNoise - R - 0.18)) * openAmt;
    col += vec3(1.0, 0.93, 0.82) * rim * 0.18;

    col *= uBrightness;
    gl_FragColor = vec4(col * a, a);
  }
`

export default function CloudInterior() {
  const ref = useRef()
  const size = useThree((s) => s.size)
  const material = useMemo(() => {
    const { detail } = getCloudTextures()
    return new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      uniforms: {
        uDetail: { value: detail },
        uCover: { value: 0 },
        uOpen: { value: 0 },
        uTime: { value: 0 },
        uAspect: { value: 1 },
        uBrightness: { value: 1 },
      },
    })
  }, [])

  useFrame((_, dt) => {
    const u = material.uniforms
    u.uTime.value += Math.min(dt, 0.1)
    u.uCover.value = cine.cover
    u.uOpen.value = cine.open
    u.uAspect.value = size.width / size.height
    u.uBrightness.value = Math.max(cine.brightness, 0.0)
    ref.current.visible = cine.cover > 0.001
  })

  return (
    <mesh ref={ref} material={material} frustumCulled={false} renderOrder={20}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  )
}
