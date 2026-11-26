import * as THREE from 'three'
import { withAerial } from '../world/aerial'

/**
 * Textured avatar (Tripo colour + normal maps, set when the KTX2 files arrive):
 * standard shading plus a faint rim light like the NPCs' fuzz, so both read
 * as one style.
 */
export function avatarMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.72, metalness: 0, envMapIntensity: 0.8 })
  m.userData.cacheKey = 'avatar'
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
       float rim = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 3.0);
       totalEmissiveRadiance += diffuseColor.rgb * rim * 0.18;`,
    )
  }
  return withAerial(m)
}
