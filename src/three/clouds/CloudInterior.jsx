import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { cine } from '../../state/cinematic'
import { getCloudTextures } from './cloudTextures'

/**
 * "Inside the cloud" full-screen layer — three parallax sheets of vapor
 * (Worley billows + fBm) lit with derivative normals, so the login backdrop
 * reads as real cloud depth rather than a flat noise texture.
 *
 * The bank is driven by two values:
 *  cover : overall strength (0 = absent, 1 = full)
 *  open  : radius of a billowy hole from the centre (1 = hole fills the frame)
 * Convergence runs open 1 → 0, so vapor closes in from the frame edges over
 * the converging puffs; login success runs open 0 → 1, tearing the bank open
 * from the centre. Changing cover while open = 1 is invisible, which lets the
 * director arm / disarm the layer without any visible fade.
 */
/**
 * Look controls (baked into the shader as constants).
 *  coverStart/coverWidth : sheet coverage ramp relative to each sheet's
 *    threshold — wider = softer, rounder vapor edges (was 0 / 0.2)
 *  holeSoftness : width of the torn edge while the bank opens / closes
 *  back sheet is always fully opaque, so whatever is drawn behind the
 *  interior (and switched off while it is closed) can never show through.
 */
export const INTERIOR_LOOK = {
  coverStart: -0.1,
  coverWidth: 0.42,
  holeInner: 0.1,
  holeOuter: 0.42,
  shadeRamp: [-0.1, 0.6],
  litRamp: [0.3, 1.05],
}
const f = (v) => Number(v).toFixed(4)

const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`
const fragment = /* glsl */ `
  precision highp float;
  uniform sampler2D uVapor;
  uniform float uCover;
  uniform float uOpen;
  uniform float uPush;
  uniform float uTime;
  uniform float uAspect;
  uniform float uBrightness;
  varying vec2 vUv;

  const vec3 LIT = vec3(0.99, 0.99, 1.0);
  const vec3 SHADE = vec3(0.7, 0.75, 0.84);
  const vec3 DEEP = vec3(0.47, 0.54, 0.66);
  const vec2 SUN = vec2(0.6, 0.8);

  // One sheet of cloud: Worley billows + fBm vapor, lit with derivative normals.
  // returns rgb = premultiplied colour, a = coverage
  vec4 sheet(vec2 p, float scale, vec2 drift, float seed, float thresh, float R, float openAmt) {
    vec2 q = p * scale + drift + seed;
    vec2 a = texture2D(uVapor, q * 0.16).rg;
    vec2 b = texture2D(uVapor, q * 0.37 + 0.31).rg;
    vec2 c = texture2D(uVapor, q * 0.85 + 0.73).rg;
    float billow = a.g * 0.55 + b.g * 0.3 + c.g * 0.15;
    float wisp = a.r * 0.5 + b.r * 0.32 + c.r * 0.18;
    float dens = mix(wisp, billow, 0.6);

    // shade with the big billows only → soft volumes, not a crunchy surface
    float hgt = a.g * 0.65 + b.g * 0.35;
    float pl = max(length(dFdx(p)), 1e-5);
    vec2 g = vec2(dFdx(hgt), dFdy(hgt)) / pl;
    vec3 n = normalize(vec3(-g * 0.03 / scale, 1.0));
    float lit = clamp(0.52 + dot(n.xy, SUN) * 0.55 + (dens - 0.5) * 0.6 + p.y * 0.15, 0.0, 1.0);
    vec3 col = mix(DEEP, SHADE, smoothstep(${f(INTERIOR_LOOK.shadeRamp[0])}, ${f(INTERIOR_LOOK.shadeRamp[1])}, lit));
    col = mix(col, LIT, smoothstep(${f(INTERIOR_LOOK.litRamp[0])}, ${f(INTERIOR_LOOK.litRamp[1])}, lit));

    float cov = smoothstep(thresh + ${f(INTERIOR_LOOK.coverStart)}, thresh + ${f(INTERIOR_LOOK.coverStart + INTERIOR_LOOK.coverWidth)}, dens);
    // tear open from the centre with a billowy edge (front sheets open first);
    // run in reverse (open 1 → 0) the same edge closes in from the frame edges
    float r = length(p * vec2(0.85, 1.15));
    float hole = smoothstep(R - ${f(INTERIOR_LOOK.holeInner)}, R + ${f(INTERIOR_LOOK.holeOuter)}, r + (dens - 0.5) * 0.9);
    cov *= mix(1.0, hole, openAmt);
    // thin torn edges catch the sun
    col += vec3(1.0, 0.93, 0.8) * (1.0 - smoothstep(0.0, 0.25, abs(r + (dens - 0.5) * 0.9 - R - 0.12))) * openAmt * 0.12;
    return vec4(col * cov, cov);
  }

  void main() {
    vec2 p = (vUv - 0.5) * vec2(max(uAspect, 1.0), max(1.0 / uAspect, 1.0));
    float t = uTime;
    float push = uPush + sin(t * 0.05) * 0.05;
    float openAmt = smoothstep(0.0, 0.04, uOpen);

    // back → front; front sheets zoom faster (camera drifting into the bank)
    // back sheet: threshold far below any density → always fully opaque
    vec4 back  = sheet(p, 1.1 / (1.0 + push * 0.25), vec2(t * 0.004, t * 0.002), 0.0, -2.0, uOpen * 2.4 - 0.3, openAmt);
    vec4 mid   = sheet(p, 1.6 / (1.0 + push * 0.5), vec2(-t * 0.008, t * 0.003), 3.7, 0.46, uOpen * 2.65 - 0.15, openAmt);
    vec4 front = sheet(p, 2.4 / (1.0 + push * 0.9), vec2(t * 0.013, -t * 0.005), 7.3, 0.56, uOpen * 3.0 - 0.05, openAmt);

    vec4 acc = back;
    acc = mid + acc * (1.0 - mid.a);
    acc = front + acc * (1.0 - front.a);

    acc.rgb *= (0.97 + vUv.y * 0.1) * uBrightness;
    gl_FragColor = acc * uCover;
  }
`

export default function CloudInterior() {
  const ref = useRef()
  const size = useThree((s) => s.size)
  const material = useMemo(() => {
    const { vapor } = getCloudTextures()
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
        uVapor: { value: vapor },
        uPush: { value: 0 },
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
    u.uPush.value = cine.push
    u.uAspect.value = size.width / size.height
    u.uBrightness.value = Math.max(cine.brightness, 0.0)
    // skip the full-screen pass while the layer is absent or its hole lies
    // entirely outside the frame (open ≳ 0.95 → nothing on screen)
    ref.current.visible = cine.cover > 0.001 && cine.open < 0.985
  })

  return (
    <mesh ref={ref} material={material} frustumCulled={false} renderOrder={20}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  )
}
