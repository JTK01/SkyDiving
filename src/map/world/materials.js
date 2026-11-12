import * as THREE from 'three'

// Barcelona palette: Eixample roofs are terracotta tile or pale terraces,
// façades warm stone / render
export const ROOF_NEAR = ['#c4673d', '#b95c36', '#cf7a4c', '#c06a44', '#d38b5e', '#cdbb9e', '#a99f93', '#c2703f']
export const ROOF_MID = ['#bf6c47', '#c98a64', '#b9ad9c', '#cbbca5', '#a69c90', '#c57a52', '#d2c4ae', '#9f958a']
export const FACADE = ['#e4d4ba', '#dccaa9', '#eadfcb', '#d6bf9c', '#cfb08c', '#e6cfae', '#c9c0b2', '#ddc7aa']

/**
 * Façade detail for building materials: storey/bay window grid drawn from
 * world position (fades out where it would alias), street-level shade, and
 * a separate roof colour on upward faces (instance or vertex attribute).
 */
export function buildingMaterial({ instanced }) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, vertexColors: !instanced })
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vWPos; varying vec3 vWNrm; varying vec3 vFacade;
         ${instanced ? 'attribute vec3 aFacade;' : 'attribute vec3 facade;'}`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
         vec4 wpp = vec4(transformed, 1.0);
         #ifdef USE_INSTANCING
           wpp = instanceMatrix * wpp;
           vWNrm = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
         #else
           vWNrm = normalize(mat3(modelMatrix) * objectNormal);
         #endif
         vWPos = (modelMatrix * wpp).xyz;
         vFacade = ${instanced ? 'aFacade' : 'facade'};`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNrm; varying vec3 vFacade;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         if (vWNrm.y < 0.5) {
           diffuseColor.rgb = vFacade;
           vec3 tang = normalize(cross(vec3(0.0, 1.0, 0.0), vWNrm) + 1e-4);
           float u = dot(vWPos, tang) / 3.6;
           float v = vWPos.y / 3.1;
           float fw = max(fwidth(u), fwidth(v));
           float win = step(0.32, fract(u)) * step(0.3, fract(v));
           float fade = 1.0 - smoothstep(0.3, 0.75, fw);
           diffuseColor.rgb *= 1.0 - win * 0.36 * fade - (1.0 - fade) * 0.12;
         }`,
      )
  }
  return m
}
