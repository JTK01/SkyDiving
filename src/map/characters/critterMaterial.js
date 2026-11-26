import * as THREE from 'three'
import { AERIAL, AERIAL_GLSL } from '../world/aerial'

/**
 * Critter NPC material: every NPC of a zone in one merged mesh, animated in
 * the vertex shader (no skeleton objects), drawn in a soft toon style.
 *
 * Per NPC (one row of the data texture uData, see TEXELS): position and
 * heading, walk phase / amount, wave, hop, blink, smile, head turn, fur and
 * garment colours, outfit code, prop mask, level of detail, face layout and
 * the species' joint pivots. Per vertex: bone pair + weight, body zone,
 * colour code, fixed colour, prop id, face coordinates, fur flag, NPC index.
 *
 * Bones: 0 body · 1 head · 2/3 arms · 4/5 legs · 6 tail · 7/8 ears; ears ride
 * on the head, head / arms / tail on the body, legs on the root.
 * Look: banded sun light + sky / ground ambient, a warm rim, fur grain with
 * soft tufts on the silhouette, clothes painted per body zone (2 bits per
 * zone in the outfit code) with a little thickness, the face drawn
 * procedurally on the head (eyes with highlights, blink, smile, brows, blush,
 * mouth by style). An inverted-hull pass (outline: true) draws the ink line.
 */
export const TEXELS = 16
export const T = { pos: 0, motion: 1, face: 2, colA: 3, colD: 4, colE: 5, colB: 6, colC: 7, layout: 8, layout2: 9, pHead: 10, pArm: 11, pLeg: 12, pTail: 13, pEar: 14, pBody: 15 }

const VERT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  uniform highp sampler2D uData;
  uniform float uTime;
  uniform float uLod;
  uniform float uOutline;
  attribute vec4 aBone;   // bone a, bone b, weight a (0–255), zone
  attribute vec4 aCode;   // colour code, prop id, fur flag (0/255), npc index
  attribute vec3 aCol;    // fixed colour (sRGB, normalized)
  attribute vec3 aFace;   // face x, y (×1.27), flag
  varying vec3 vColor;
  varying vec3 vN;
  varying vec3 vW;
  varying vec3 vRest;
  varying vec3 vFace;
  varying float vFur;
  varying float vGarment;
  varying vec4 vLayout;
  varying vec4 vLayout2;
  varying vec4 vExpr;
  varying vec3 vMark;
  varying vec3 vZi;
  flat varying vec3 vGB;
  flat varying vec3 vGC;
  flat varying float vOutfit;
  flat varying vec3 vPA;
  flat varying vec3 vPL;
  flat varying float vNY;

  vec4 D(int k, int i) { return texelFetch(uData, ivec2(k, i), 0); }
  // body zone from the rest position (left side, |x|) and the bone weights
  // zi: arm weight, leg weight, unclothed weight (head / ears / tail); pa / pl: shoulder / hip pivots, ny: neck
  float zoneOf(vec3 p, vec3 zi, vec3 pa, vec3 pl, float ny) {
    vec3 q = vec3(abs(p.x), p.y, p.z);
    if (zi.z > 0.5) return 0.0;
    float span = ny - pl.y;
    if (zi.x > 0.5) {
      float t = length(q - pa) / (span * 0.82);
      return t < 0.5 ? 5.0 : t < 0.8 ? 10.0 : 6.0;
    }
    if (zi.y > 0.5) return p.y > pl.y * 0.62 ? 7.0 : p.y > pl.y * 0.27 ? 8.0 : 9.0;
    if (p.y > ny - span * 0.12) return 1.0;
    if (q.x < span * 0.16 && p.z > 0.0 && p.y > pl.y + span * 0.22) return 11.0;
    if (p.y > pl.y + span * 0.55) return 2.0;
    if (p.y > pl.y + span * 0.18) return 3.0;
    return 4.0;
  }
  float outfitCode(float outfit, float zone) { return mod(floor(outfit / exp2(2.0 * zone)), 4.0); }

  mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
  mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
  mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }

  // per-NPC animation inputs (set in main)
  float gT, gPhase, gWalk, gWave, gHop, gYaw, gPitch, gSeed;
  vec3 pHead, pArm, pLeg, pTail, pEar, pBody;

  void rot(inout vec3 p, inout vec3 n, vec3 piv, mat3 R) { p = R * (p - piv) + piv; n = R * n; }

  void bodyX(inout vec3 p, inout vec3 n) {
    // lean into the walk, waddle, breathe
    mat3 R = rotZ(0.06 * gWalk * sin(gPhase)) * rotX(0.09 * gWalk + 0.015 * sin(gT * 1.7));
    rot(p, n, pBody, R);
  }
  void headX(inout vec3 p, inout vec3 n) {
    float idle = 1.0 - gWalk;
    mat3 R = rotY(gYaw + idle * 0.12 * sin(gT * 0.45 + gSeed)) * rotX(gPitch + 0.04 * sin(gT * 0.9 + gSeed) + gWalk * 0.05 * sin(gPhase * 2.0)) * rotZ(idle * 0.07 * sin(gT * 0.6 + gSeed * 2.0));
    rot(p, n, pHead, R);
  }
  void bone(int b, inout vec3 p, inout vec3 n) {
    if (b == 7 || b == 8) {
      float s = b == 7 ? 1.0 : -1.0;
      vec3 piv = vec3(pEar.x * s, pEar.yz);
      float tw = pow(max(0.0, sin(gT * 0.8 + gSeed * 3.0 + s)), 24.0);
      rot(p, n, piv, rotZ(s * (0.25 * tw + 0.05 * sin(gT * 1.3 + s))) * rotX(-0.1 * gWalk * sin(gPhase * 2.0)));
      headX(p, n);
      bodyX(p, n);
    } else if (b == 1) {
      headX(p, n);
      bodyX(p, n);
    } else if (b == 2 || b == 3) {
      float s = b == 2 ? 1.0 : -1.0;
      vec3 piv = vec3(pArm.x * s, pArm.yz);
      float swing = -sin(gPhase + (b == 2 ? 0.0 : 3.14159)) * 0.6 * gWalk;
      float wave = b == 3 ? gWave : 0.0;
      mat3 R = rotZ(s * (0.06 + 0.04 * sin(gT * 1.2)) * (1.0 - wave)) * rotX(swing);
      if (wave > 0.0) R = rotZ(-2.45 * wave + 0.38 * wave * sin(gT * 10.0)) * rotX(-0.25 * wave) * R;
      rot(p, n, piv, R);
      bodyX(p, n);
    } else if (b == 4 || b == 5) {
      float s = b == 4 ? 1.0 : -1.0;
      vec3 piv = vec3(pLeg.x * s, pLeg.yz);
      rot(p, n, piv, rotX(sin(gPhase + (b == 4 ? 3.14159 : 0.0)) * 0.55 * gWalk));
    } else if (b == 6) {
      rot(p, n, pTail, rotY(0.35 * sin(gT * (2.0 + 3.0 * gWalk) + gSeed)) * rotX(0.08 * sin(gT * 1.3)));
      bodyX(p, n);
    } else {
      bodyX(p, n);
    }
  }

  vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }

  void main() {
    int i = int(aCode.w + 0.5);
    vec4 P = D(${T.pos}, i);
    vec4 C6 = D(${T.colB}, i);
    vec4 C5 = D(${T.colE}, i);
    // level of detail / hidden NPC / prop not worn → collapsed
    float prop = aCode.y;
    float mask = C5.w;
    bool off = abs(C6.w - uLod) > 0.5;
    if (prop > 0.5 && mod(floor(mask / exp2(prop - 1.0)), 2.0) < 0.5) off = true;
    if (off) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    vec4 M = D(${T.motion}, i);
    vec4 E = D(${T.face}, i);
    vec4 C3 = D(${T.colA}, i);
    vec4 C4 = D(${T.colD}, i);
    vec4 C7 = D(${T.colC}, i);
    gT = uTime + C7.w;
    gSeed = C7.w;
    gPhase = M.x; gWalk = M.y; gWave = M.z; gHop = M.w;
    gYaw = E.z; gPitch = E.w;
    pHead = D(${T.pHead}, i).xyz; pArm = D(${T.pArm}, i).xyz; pLeg = D(${T.pLeg}, i).xyz;
    pTail = D(${T.pTail}, i).xyz; pEar = D(${T.pEar}, i).xyz; pBody = D(${T.pBody}, i).xyz;

    // colour: fur codes 0–2 (clothed or not: decided per fragment), fixed 3, garments 4 / 5
    float code = aCode.x;
    vec3 col = code < 0.5 ? C3.rgb : code < 1.5 ? C4.rgb : code < 2.5 ? C5.rgb : code < 3.5 ? srgb(aCol) : code < 4.5 ? C6.rgb : C7.rgb;
    int ba0 = int(aBone.x + 0.5), bb0 = int(aBone.y + 0.5);
    float wa = aBone.z / 255.0;
    float armW = (ba0 == 2 || ba0 == 3 ? wa : 0.0) + (bb0 == 2 || bb0 == 3 ? 1.0 - wa : 0.0);
    float legW = (ba0 == 4 || ba0 == 5 ? wa : 0.0) + (bb0 == 4 || bb0 == 5 ? 1.0 - wa : 0.0);
    float bareW = (ba0 == 1 || ba0 >= 6 ? wa : 0.0) + (bb0 == 1 || bb0 >= 6 ? 1.0 - wa : 0.0);
    vZi = vec3(armW, legW, code > 2.5 ? 1.0 : bareW);
    vGB = C6.rgb;
    vGC = C7.rgb;
    vOutfit = C4.w;
    vPA = pArm;
    vPL = pLeg;
    vNY = pHead.y;
    float oc = outfitCode(C4.w, zoneOf(position, vZi, pArm, pLeg, pHead.y));
    vGarment = oc > 0.5 ? 1.0 : 0.0;
    vColor = col;
    vMark = C5.rgb;
    vFur = aCode.z / 255.0;
    vFace = vec3(aFace.xy * 1.27, aFace.z);
    vLayout = D(${T.layout}, i);
    vLayout2 = D(${T.layout2}, i);
    vExpr = vec4(E.x, E.y, 0.0, 0.0);

    vec3 p0 = position;
    vec3 n0 = normalize(normal);
    vRest = p0;
    // clothes sit a little proud of the fur
    if (vGarment > 0.5) p0 += n0 * 0.006;
    vec3 pa = p0, na = n0, pb = p0, nb = n0;
    int ba = int(aBone.x + 0.5), bb = int(aBone.y + 0.5);
    bone(ba, pa, na);
    float w = aBone.z / 255.0;
    vec3 p = pa, n = na;
    if (w < 0.995 && bb != ba) {
      bone(bb, pb, nb);
      p = mix(pb, pa, w);
      n = normalize(mix(nb, na, w));
    }
    // root: bob + hop, size jitter, heading, world position
    p.y += gHop + abs(sin(gPhase)) * 0.03 * gWalk;
    p *= C3.w;
    mat3 H = rotY(P.w);
    p = H * p;
    n = H * n;
    vec3 wp = P.xyz + p;
    if (uOutline > 0.5) {
      float dist = length(cameraPosition - wp);
      wp += n * clamp(dist * 0.0022, 0.0045, 0.03);
    }
    vW = wp;
    vN = n;
    vec4 mv = viewMatrix * vec4(wp, 1.0);
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }
`

const FRAG = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uSunCol; // uSunDir: from AERIAL_GLSL
  uniform vec3 uSky;
  uniform vec3 uGround;
  uniform float uOutline;
  varying vec3 vColor;
  varying vec3 vN;
  varying vec3 vW;
  varying vec3 vRest;
  varying vec3 vFace;
  varying float vFur;
  varying float vGarment;
  varying vec4 vLayout;   // eye x, eye y, eye size, mouth style (0 ω, 1 smile, 2 bunny, 3 beak)
  varying vec4 vLayout2;  // blush, brows, light face, mouth y
  varying vec4 vExpr;     // blink, smile
  varying vec3 vMark;
  varying vec3 vZi;
  flat varying vec3 vGB;
  flat varying vec3 vGC;
  flat varying float vOutfit;
  flat varying vec3 vPA;
  flat varying vec3 vPL;
  flat varying float vNY;
  ${AERIAL_GLSL}
  // body zone from the rest position (left side, |x|) and the bone weights
  // zi: arm weight, leg weight, unclothed weight (head / ears / tail); pa / pl: shoulder / hip pivots, ny: neck
  float zoneOf(vec3 p, vec3 zi, vec3 pa, vec3 pl, float ny) {
    vec3 q = vec3(abs(p.x), p.y, p.z);
    if (zi.z > 0.5) return 0.0;
    float span = ny - pl.y;
    if (zi.x > 0.5) {
      float t = length(q - pa) / (span * 0.82);
      return t < 0.5 ? 5.0 : t < 0.8 ? 10.0 : 6.0;
    }
    if (zi.y > 0.5) return p.y > pl.y * 0.62 ? 7.0 : p.y > pl.y * 0.27 ? 8.0 : 9.0;
    if (p.y > ny - span * 0.12) return 1.0;
    if (q.x < span * 0.16 && p.z > 0.0 && p.y > pl.y + span * 0.22) return 11.0;
    if (p.y > pl.y + span * 0.55) return 2.0;
    if (p.y > pl.y + span * 0.18) return 3.0;
    return 4.0;
  }
  float outfitCode(float outfit, float zone) { return mod(floor(outfit / exp2(2.0 * zone)), 4.0); }


  float hash(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
  float vnoise(vec3 q) {
    vec3 i = floor(q), f = fract(q); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), f.z),
               mix(mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.z), f.y);
  }
  float aa(float d) { float w = max(fwidth(d), 1e-4); return 1.0 - smoothstep(-w, w, d); }
  float ellipseD(vec2 p, vec2 c, vec2 r) { return (length((p - c) / r) - 1.0) * min(r.x, r.y); }
  float segD(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
  // arc of a circle (centre c, radius r) between angles a0..a1
  float arcD(vec2 p, vec2 c, float r, float a0, float a1) {
    vec2 q = p - c; float a = atan(q.y, q.x);
    if (a < a0 || a > a1) { vec2 e0 = c + r * vec2(cos(a0), sin(a0)), e1 = c + r * vec2(cos(a1), sin(a1)); return min(length(p - e0), length(p - e1)); }
    return abs(length(q) - r);
  }

  vec3 drawFace(vec3 col) {
    vec2 f = vFace.xy;
    f.x = abs(f.x); // symmetric features
    float ex = vLayout.x, ey = vLayout.y, es = vLayout.z, style = vLayout.w;
    float blink = vExpr.x, smile = vExpr.y;
    vec3 ink = vLayout2.z > 0.5 ? vec3(0.06, 0.05, 0.05) : vec3(0.075, 0.055, 0.05);
    // blush
    float bl = 1.0 - smoothstep(0.0, 0.11, length((f - vec2(ex + 0.06, ey - 0.27)) / vec2(1.0, 0.62)));
    col = mix(col, vec3(0.93, 0.45, 0.45), bl * 0.5 * vLayout2.x);
    // eyes: tall ovals with a highlight; closed (blink / big smile) → an arc
    float closed = max(blink, smoothstep(0.55, 0.95, smile));
    vec2 er = vec2(0.1, 0.13) * es;
    if (closed < 0.5) {
      float h = mix(1.0, 0.12, closed * 2.0);
      float e = aa(ellipseD(f, vec2(ex, ey), vec2(er.x, er.y * h)));
      col = mix(col, ink, e);
      float hl = aa(ellipseD(f, vec2(ex - 0.03 * es, ey + 0.045 * es), vec2(0.034, 0.04) * es)) * step(0.5, h);
      col = mix(col, vec3(1.0), hl * 0.95);
      float hl2 = aa(ellipseD(f, vec2(ex + 0.03 * es, ey - 0.055 * es), vec2(0.016, 0.016) * es)) * step(0.5, h);
      col = mix(col, vec3(1.0), hl2 * 0.8);
    } else {
      float d = arcD(f, vec2(ex, ey - 0.03), er.x * 0.95, 0.35, 2.8);
      col = mix(col, ink, aa(d - 0.016));
    }
    // brows
    if (vLayout2.y > 0.5) col = mix(col, ink, aa(segD(f, vec2(ex - 0.07, ey + 0.17), vec2(ex + 0.06, ey + 0.13)) - 0.016));
    // mouth
    float my = vLayout2.w;
    if (style < 0.5) {
      // ω
      float d = min(arcD(f, vec2(0.06, my), 0.06, 3.3, 6.1), 9.0);
      col = mix(col, ink, aa(d - 0.02));
      col = mix(col, ink, aa(segD(f, vec2(0.0, my + 0.0), vec2(0.0, my + 0.07)) - 0.018));
      float o = aa(ellipseD(f, vec2(0.0, my - 0.05), vec2(0.05, 0.05 * smile)));
      col = mix(col, vec3(0.6, 0.18, 0.2), o * step(0.15, smile) * (1.0 - step(0.0, -f.y + my - 0.12)));
    } else if (style < 1.5) {
      float r = 0.11 + 0.04 * smile;
      float d = arcD(f, vec2(0.0, my + r * 0.75), r, 3.6 - smile * 0.25, 5.82 + smile * 0.25);
      col = mix(col, ink, aa(d - 0.02));
      if (smile > 0.5) {
        float o = aa(max(ellipseD(f, vec2(0.0, my + r * 0.75), vec2(r * 0.92)), f.y - (my + r * 0.75 - r * 0.55)));
        col = mix(col, vec3(0.62, 0.2, 0.22), o);
      }
    } else if (style < 2.5) {
      // bunny: little y
      col = mix(col, ink, aa(segD(f, vec2(0.0, my + 0.07), vec2(0.0, my)) - 0.018));
      col = mix(col, ink, aa(min(arcD(f, vec2(0.05, my), 0.05, 3.3 - smile * 0.4, 6.0), 9.0) - 0.018));
    }
    return col;
  }

  void main() {
    #include <logdepthbuf_fragment>
    vec3 V = normalize(cameraPosition - vW);
    vec3 N = normalize(vN);
    if (!gl_FrontFacing) N = -N;
    float ndv = dot(N, V);
    if (uOutline > 0.5) {
      gl_FragColor = vec4(aerialPerspective(vColor * 0.28 + vec3(0.02, 0.015, 0.012), vW), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      return;
    }
    vec3 base = vColor;
    // clothes: per fragment from the rest position → clean hems
    float oc = outfitCode(vOutfit, zoneOf(vRest, vZi, vPA, vPL, vNY));
    bool cloth = oc > 0.5;
    if (cloth) base = oc < 1.5 ? vGB : oc < 2.5 ? vGC : vec3(0.84, 0.8, 0.72);
    // fur: fine strands + soft tufts on the silhouette; clothes: a knit
    float near = 1.0 - smoothstep(6.0, 18.0, length(cameraPosition - vW));
    if (vFur > 0.5 && !cloth) {
      float s = vnoise(vRest * vec3(260.0, 70.0, 260.0));
      float s2 = vnoise(vRest * vec3(90.0, 25.0, 90.0) + 7.0);
      base *= 0.9 + 0.12 * s + 0.06 * s2;
      float edge = smoothstep(0.32, 0.04, abs(ndv));
      if (near > 0.0 && s * 0.8 + s2 * 0.4 < edge * 0.75 * near) discard;
    } else if (cloth) {
      float k = 0.5 + 0.5 * sin(vRest.y * 900.0) * sin(vRest.x * 420.0 + vRest.z * 420.0);
      base *= 0.95 + 0.07 * k * near;
    }
    if (vFace.z > 0.5 && !cloth) base = drawFace(base);
    // light: banded sun + sky / ground ambient + warm rim
    float ndl = dot(N, uSunDir);
    float band = smoothstep(-0.12, 0.08, ndl) * 0.62 + smoothstep(0.25, 0.55, ndl) * 0.38;
    vec3 amb = mix(uGround, uSky, N.y * 0.5 + 0.5);
    vec3 light = amb + uSunCol * band;
    float rim = pow(1.0 - max(ndv, 0.0), 3.0);
    vec3 c = base * light + base * rim * 0.35 * vec3(1.0, 0.92, 0.8);
    // a soft darker edge (like the ink line, inside the silhouette)
    c *= 1.0 - 0.18 * smoothstep(0.3, 0.0, ndv);
    gl_FragColor = vec4(aerialPerspective(c, vW), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

/** the data texture of a zone mesh: TEXELS × rows RGBA float */
export function critterData(rows) {
  const tex = new THREE.DataTexture(new Float32Array(TEXELS * rows * 4), TEXELS, rows, THREE.RGBAFormat, THREE.FloatType)
  tex.minFilter = tex.magFilter = THREE.NearestFilter
  tex.needsUpdate = true
  return tex
}

export function critterMaterial(data, { lod = 0, outline = false } = {}) {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uData: { value: data },
      uTime: { value: 0 },
      uLod: { value: lod },
      uOutline: { value: outline ? 1 : 0 },
      uSunCol: { value: new THREE.Color('#fff1de').multiplyScalar(1.05) },
      uSky: { value: new THREE.Color('#b9cde3').multiplyScalar(0.62) },
      uGround: { value: new THREE.Color('#9c8c74').multiplyScalar(0.48) },
      ...AERIAL,
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: outline ? THREE.BackSide : THREE.FrontSide,
  })
  m.extensions = { derivatives: true }
  return m
}
