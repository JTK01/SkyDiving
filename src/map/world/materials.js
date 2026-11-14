import * as THREE from 'three'
import { withAerial } from './aerial'

/**
 * Building material: façade / roof / ground-floor atlas (public/textures/
 * buildings.ktx2, 4×4 cells, see tools/map-data/build_textures.py).
 *
 * No UVs are stored: walls are mapped from world position along the wall
 * (bays of 3.6 m, storeys of 3.1 m; one cell = 4 × 4), roofs from world x/z
 * (one cell = 16 m), the ground floor (< 4.5 m) from the ground-floor row.
 * Per building `aStyle` = (façade cell 0–7, roof cell 0–3, brightness),
 * `aBase` = ground height (instanced boxes read both from the instance).
 * textureGrad with continuous coordinates avoids mip seams at cell wraps.
 */
// roof palette index → atlas roof cell (0 tiles, 1 terrace, 2 concrete, 3 mixed).
// Mix from the reference photos (22–25): mostly light terraces and grey
// roofs, terracotta on about a third of them (tiles or mixed).
export const ROOF_CELL_NEAR = [1, 0, 1, 3, 0, 1, 3, 2]
export const ROOF_CELL_MID = [1, 3, 0, 1, 0, 3, 2, 1]

export function buildingMaterial({ instanced, atlas }) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0, envMapIntensity: 0.8 })
  m.userData.cacheKey = instanced ? 'bldI' : 'bldN'
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uAtlas = { value: atlas }
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         attribute vec3 aStyle;
         ${instanced ? '' : 'attribute float aBase;'}
         varying vec3 vBW; varying vec3 vBN; varying vec3 vStyle; varying float vBase;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
         vec4 bw = vec4(transformed, 1.0);
         #ifdef USE_INSTANCING
           bw = instanceMatrix * bw;
           vBN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
           vBase = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).y + 2.0;
         #else
           vBN = normalize(mat3(modelMatrix) * objectNormal);
           vBase = aBase;
         #endif
         vBW = (modelMatrix * bw).xyz;
         vStyle = aStyle;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform sampler2D uAtlas;
         varying vec3 vBW; varying vec3 vBN; varying vec3 vStyle; varying float vBase;
         vec3 atlasCell(vec2 cell, vec2 p) {
           vec2 f = clamp(fract(p), 0.004, 0.996);
           return textureGrad(uAtlas, (cell + f) * 0.25, dFdx(p) * 0.25, dFdy(p) * 0.25).rgb;
         }`,
      )
      .replace(
        '#include <map_fragment>',
        `{
           vec3 c;
           float h = vBW.y - vBase;
           if (vBN.y > 0.5) {
             c = atlasCell(vec2(vStyle.y, 2.0), vBW.xz / 16.0);
           } else {
             vec3 tang = normalize(cross(vec3(0.0, 1.0, 0.0), vBN) + 1e-4);
             float u = dot(vBW, tang) / 14.4;
             if (h < 4.5) c = atlasCell(vec2(mod(vStyle.x, 4.0), 3.0), vec2(u, h / 4.5));
             else c = atlasCell(vec2(mod(vStyle.x, 4.0), floor(vStyle.x / 4.0)), vec2(u, (h - 4.5) / 12.4));
             // contact shadow / street canyon occlusion toward the ground
             c *= mix(0.62, 1.0, smoothstep(0.0, 14.0, h));
           }
           diffuseColor.rgb = c * vStyle.z;
         }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
         // glass reads glossy: dark, bluish texels get low roughness
         float glassy = smoothstep(0.25, 0.0, dot(diffuseColor.rgb, vec3(0.33))) * step(vBN.y, 0.5);
         roughnessFactor = mix(roughnessFactor, 0.25, glassy);`,
      )
  }
  return withAerial(m)
}
