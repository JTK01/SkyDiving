import * as THREE from 'three'
import { HAZE, SUN_DIR } from './atmosphereConfig'

/**
 * Aerial perspective shared by every map material: exponential haze whose
 * density falls off with altitude (integrated along the view ray), tinted
 * toward the sun. Replaces three's uniform fog so a camera 1 km up sees a
 * clear city and a hazy horizon, and terrain fades into the same colour as
 * the sky's horizon — no visible edge.
 */
export const AERIAL = {
  uHaze: { value: HAZE },
  uSunGlow: { value: new THREE.Color('#f3e6cf') },
  uSunDir: { value: SUN_DIR },
  uFogDensity: { value: 1.25e-4 }, // at sea level, per metre
  uFogHeight: { value: 1400 }, // scale height (m)
}

export const AERIAL_GLSL = /* glsl */ `
  uniform vec3 uHaze;
  uniform vec3 uSunGlow;
  uniform vec3 uSunDir;
  uniform float uFogDensity;
  uniform float uFogHeight;
  vec3 aerialPerspective(vec3 col, vec3 wpos) {
    vec3 d = wpos - cameraPosition;
    float dist = length(d);
    float h0 = max(cameraPosition.y, 0.0);
    float h1 = max(wpos.y, 0.0);
    float dh = h1 - h0;
    float H = uFogHeight;
    // mean of exp(-h/H) along the ray: H·(e^(−h0/H) − e^(−h1/H)) / (h1 − h0)
    float k = abs(dh) > 1.0 ? (exp(-h0 / H) - exp(-h1 / H)) * H / dh : exp(-h0 / H);
    float f = clamp(1.0 - exp(-uFogDensity * dist * k), 0.0, 1.0);
    float s = pow(max(dot(d / max(dist, 1e-3), uSunDir), 0.0), 6.0);
    return mix(col, mix(uHaze, uSunGlow, s * 0.6), f);
  }
`

/**
 * Patch a built-in material (Standard/Basic…) to use the aerial perspective
 * instead of three's fog. Chains with an existing onBeforeCompile.
 */
export function withAerial(material) {
  const prev = material.onBeforeCompile
  material.fog = false
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer)
    Object.assign(shader.uniforms, AERIAL)
    if (!shader.vertexShader.includes('vAerialW')) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vAerialW;')
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
           vec4 aerialW = vec4(transformed, 1.0);
           #ifdef USE_INSTANCING
             aerialW = instanceMatrix * aerialW;
           #endif
           vAerialW = (modelMatrix * aerialW).xyz;`,
        )
    }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vAerialW;\n${AERIAL_GLSL}`)
      .replace('#include <fog_fragment>', 'gl_FragColor.rgb = aerialPerspective(gl_FragColor.rgb, vAerialW);')
  }
  material.customProgramCacheKey = () => (material.userData.cacheKey || '') + 'aerial'
  return material
}
