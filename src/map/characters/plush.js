import * as THREE from 'three'
import { withAerial } from '../world/aerial'

/**
 * Plush / felt material shared by the player and the NPCs (skinned glTF):
 * matte standard shading + fine fabric grain (hashed from the rest-pose
 * position, so it sticks to the body) + a soft fuzz rim light.
 *
 * palette (NPCs): vertex colours are replaced by region — the glTF packs the
 * palette region and prop id in TEXCOORD_0, renamed to aPal on load
 * (u = region / 3, v = prop / 8):
 *   region 0 / 1 / 2 → uColA / uColB / uColC (fur, garment, trousers),
 *   region 3 → the vertex colour; a prop k > 0 is hidden unless bit k−1 of
 *   uPropMask is set. Set the colours / mask on material.userData.palette.
 */
const GRAIN = /* glsl */ `
  float plushHash(vec3 p) { return fract(sin(dot(floor(p), vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
`

export function plushMaterial({ palette = null } = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, envMapIntensity: 0.6 })
  m.userData.cacheKey = palette ? 'plushP' : 'plush'
  if (palette) m.userData.palette = palette
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRest;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRest = position;')
    if (palette) {
      sh.uniforms.uColA = { value: palette.a }
      sh.uniforms.uColB = { value: palette.b }
      sh.uniforms.uColC = { value: palette.c }
      sh.uniforms.uPropMask = { value: palette.mask }
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aPal;\nuniform vec3 uColA;\nuniform vec3 uColB;\nuniform vec3 uColC;\nuniform float uPropMask;')
        .replace(
          '#include <color_vertex>',
          `#include <color_vertex>
           float region = floor(aPal.x * 3.0 + 0.5);
           vColor.rgb = region < 0.5 ? uColA : region < 1.5 ? uColB : region < 2.5 ? uColC : color.rgb; // color may be vec3 or vec4`,
        )
        .replace(
          '#include <skinning_vertex>',
          `#include <skinning_vertex>
           float prop = floor(aPal.y * 8.0 + 0.5);
           if (prop > 0.5 && mod(floor(uPropMask / exp2(prop - 1.0)), 2.0) < 0.5) transformed = vec3(0.0);`,
        )
    }
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vRest;\n${GRAIN}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         // felt grain (≈ 8 mm) and slightly larger pile variation
         diffuseColor.rgb *= 0.93 + 0.1 * plushHash(vRest * 120.0) + 0.04 * plushHash(vRest * 35.0);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         // fuzz: fibres catch light at grazing angles
         float rim = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 2.5);
         totalEmissiveRadiance += diffuseColor.rgb * rim * 0.28;`,
      )
  }
  return withAerial(m)
}
