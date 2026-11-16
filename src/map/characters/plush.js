import * as THREE from 'three'
import { withAerial } from '../world/aerial'

/**
 * Plush / felt material shared by the player and the animal NPCs: matte
 * standard shading + fine fabric grain (hashed from the rest-pose position,
 * so it sticks to the body) + a soft fuzz rim light.
 *
 * instanced = true (NPCs): rigid skinning from a bone-pose texture
 * (uPoses: RGBA32F, 3 texels per bone matrix, one row per frame), palette
 * colours per instance by vertex region (aRegion 0/1/2 → aColA/B/C,
 * 3 = vertex colour), optional props hidden by the per-instance mask.
 */
const GRAIN = /* glsl */ `
  float plushHash(vec3 p) { return fract(sin(dot(floor(p), vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
`

export function plushMaterial({ instanced = false, poses = null } = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, envMapIntensity: 0.6 })
  m.userData.cacheKey = instanced ? 'plushI' : 'plush'
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRest;')
    if (instanced) {
      sh.uniforms.uPoses = { value: poses }
      sh.uniforms.uTime = { value: 0 }
      m.userData.shader = sh
      sh.vertexShader = sh.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform highp sampler2D uPoses;
           uniform float uTime;
           attribute float aBone;
           attribute float aRegion;
           attribute float aProp;
           attribute vec4 aClip;   // first row, frames, start time, fps (< 0: play once)
           attribute vec3 aColA;
           attribute vec3 aColB;
           attribute vec3 aColC;
           attribute float aPropMask;
           mat4 poseAt(float row) {
             int b = int(aBone) * 3;
             int r = int(row);
             vec4 a = texelFetch(uPoses, ivec2(b, r), 0);
             vec4 c = texelFetch(uPoses, ivec2(b + 1, r), 0);
             vec4 d = texelFetch(uPoses, ivec2(b + 2, r), 0);
             return mat4(vec4(a.x, c.x, d.x, 0.0), vec4(a.y, c.y, d.y, 0.0), vec4(a.z, c.z, d.z, 0.0), vec4(a.w, c.w, d.w, 1.0));
           }`,
        )
        .replace(
          '#include <color_vertex>',
          `#include <color_vertex>
           vColor = aRegion < 0.5 ? aColA : aRegion < 1.5 ? aColB : aRegion < 2.5 ? aColC : color;`,
        )
        .replace(
          '#include <skinbase_vertex>',
          `float fps = abs(aClip.w);
           float fr = max(0.0, (uTime - aClip.z) * fps);
           fr = aClip.w > 0.0 ? mod(fr, aClip.y) : min(fr, aClip.y - 1.001);
           float f0 = floor(fr);
           float f1 = aClip.w > 0.0 ? mod(f0 + 1.0, aClip.y) : min(f0 + 1.0, aClip.y - 1.0);
           mat4 P0 = poseAt(aClip.x + f0);
           mat4 P1 = poseAt(aClip.x + f1);
           float fk = fr - f0;
           // blend positions of both frames (rigid parts, short frame steps)
           bool propOn = aProp < 0.5 || mod(floor(aPropMask / exp2(aProp - 1.0)), 2.0) > 0.5;`,
        )
        .replace(
          '#include <skinnormal_vertex>',
          'objectNormal = normalize(mat3(P0) * objectNormal);',
        )
        .replace(
          '#include <skinning_vertex>',
          `vRest = position;
           transformed = mix((P0 * vec4(transformed, 1.0)).xyz, (P1 * vec4(transformed, 1.0)).xyz, fk);
           if (!propOn) transformed = vec3(0.0);`,
        )
    } else {
      sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvRest = position;')
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
