import * as THREE from 'three'
import { AERIAL, AERIAL_GLSL } from '../world/aerial'

/**
 * Critter NPC material: every NPC of a zone in one merged mesh, animated in
 * the vertex shader (no skeleton objects), drawn in a soft toon style.
 *
 * Per NPC (one row of the data texture uData, see TEXELS): position and
 * heading, walk phase / amount, wave, hop, blink, smile, head turn, fur and
 * garment colours, outfit code, prop mask, level of detail, face layout and
 * the species' joint pivots, held arm poses (photos). Per vertex: bone pair + weight, body zone,
 * colour code, fixed colour, prop id, face coordinates, fur flag, NPC index.
 *
 * Bones: 0 body · 1 head · 2/3 arms · 4/5 legs · 6 tail · 7/8 ears; ears ride
 * on the head, head / arms / tail on the body, legs on the root.
 * Look: banded sun light + sky / ground ambient, a warm rim; fur: bump-mapped
 * strands, soft tufts and lighter tips on the silhouette; clothes (separate
 * cloth meshes, fur byte 128): softer light, a knit bump, a fabric sheen; the
 * face drawn procedurally on the head (eyes with highlights and a warm iris,
 * blink, smile, brows, blush, mouth by style, opening while talking). An
 * inverted-hull pass (outline: true) draws the ink line.
 */
export const TEXELS = 18
export const T = { pos: 0, motion: 1, face: 2, colA: 3, colD: 4, colE: 5, colB: 6, colC: 7, layout: 8, layout2: 9, pHead: 10, pArm: 11, pLeg: 12, pTail: 13, pEar: 14, pBody: 15, pose: 16, extra: 17 }

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

  vec4 D(int k, int i) { return texelFetch(uData, ivec2(k, i), 0); }

  mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
  mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
  mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }

  // per-NPC animation inputs (set in main)
  float gT, gPhase, gWalk, gWave, gHop, gYaw, gPitch, gSeed;
  vec4 gPose; // held arm poses: left up, right up, left out, right out (photos)
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
      float up = b == 2 ? gPose.x : gPose.y;
      float spread = b == 2 ? gPose.z : gPose.w;
      if (up > 0.0) R = rotZ(s * 2.5 * up) * rotX(-0.2 * up) * R;
      if (spread > 0.0) R = rotZ(s * 1.3 * spread) * rotY(-s * 0.5 * spread) * R;
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
    gPose = D(${T.pose}, i);
    pHead = D(${T.pHead}, i).xyz; pArm = D(${T.pArm}, i).xyz; pLeg = D(${T.pLeg}, i).xyz;
    pTail = D(${T.pTail}, i).xyz; pEar = D(${T.pEar}, i).xyz; pBody = D(${T.pBody}, i).xyz;

    // colour: fur codes 0–2, fixed 3, the NPC's garment colours 4 / 5 (cloth meshes)
    float code = aCode.x;
    vec3 col = code < 0.5 ? C3.rgb : code < 1.5 ? C4.rgb : code < 2.5 ? C5.rgb : code < 3.5 ? srgb(aCol) : code < 4.5 ? C6.rgb : C7.rgb;
    vColor = col;
    vMark = C5.rgb;
    // fur byte: 255 fur, 128 cloth, 0 other
    vFur = aCode.z > 200.0 ? 1.0 : 0.0;
    vGarment = aCode.z > 100.0 && aCode.z < 200.0 ? 1.0 : 0.0;
    vFace = vec3(aFace.xy * 1.27, aFace.z);
    vLayout = D(${T.layout}, i);
    vLayout2 = D(${T.layout2}, i);
    vExpr = vec4(E.x, E.y, D(${T.extra}, i).x, 0.0);

    vec3 p0 = position;
    vec3 n0 = normalize(normal);
    vRest = p0;
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
  ${AERIAL_GLSL}


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
    float blink = vExpr.x, smile = vExpr.y, talk = vExpr.z;
    vec3 ink = vLayout2.z > 0.5 ? vec3(0.06, 0.05, 0.05) : vec3(0.075, 0.055, 0.05);
    // blush
    float bl = 1.0 - smoothstep(0.0, 0.11, length((f - vec2(ex + 0.06, ey - 0.27)) / vec2(1.0, 0.62)));
    col = mix(col, vec3(0.93, 0.45, 0.45), bl * 0.5 * vLayout2.x);
    // eyes: tall ovals with a highlight; closed (blink / big smile) → an arc
    float closed = max(blink, smoothstep(0.55, 0.95, smile));
    vec2 er = vec2(0.112, 0.138) * es; // big, nearly round: all pupil (no white showing)
    if (closed < 0.5) {
      float h = mix(1.0, 0.12, closed * 2.0);
      float e = aa(ellipseD(f, vec2(ex, ey), vec2(er.x, er.y * h)));
      col = mix(col, ink, e);
      float hl = aa(ellipseD(f, vec2(ex - 0.034 * es, ey + 0.05 * es), vec2(0.038, 0.044) * es)) * step(0.5, h);
      col = mix(col, vec3(1.0), hl * 0.95);
      float hl2 = aa(ellipseD(f, vec2(ex + 0.035 * es, ey - 0.06 * es), vec2(0.019, 0.019) * es)) * step(0.5, h);
      col = mix(col, vec3(1.0), hl2 * 0.8);
      // a warm iris glow at the bottom of the eye
      float iris = aa(ellipseD(f, vec2(ex, ey - er.y * 0.45 * h), vec2(er.x * 0.62, er.y * 0.35 * h))) * e;
      col = mix(col, vec3(0.32, 0.17, 0.08), iris * 0.55);
    } else {
      float d = arcD(f, vec2(ex, ey - 0.03), er.x * 0.95, 0.35, 2.8);
      col = mix(col, ink, aa(d - 0.016));
    }
    // brows: short soft arcs (strong for brow-y species), lifted a little by a smile
    float bw = vLayout2.y > 0.5 ? 0.017 : 0.011;
    float by = ey + er.y + 0.06 + 0.02 * smile;
    col = mix(col, mix(col, ink, vLayout2.y > 0.5 ? 1.0 : 0.55), aa(arcD(f, vec2(ex, by - 0.08), 0.09, 1.05, 2.1) - bw));
    // mouth (opens while talking)
    float my = vLayout2.w;
    if (talk > 0.05 && style < 2.5) {
      float o = aa(ellipseD(f, vec2(0.0, my - 0.03), vec2(0.04, 0.035 * talk)));
      col = mix(col, vec3(0.55, 0.16, 0.18), o);
    }
    if (style < 0.5) {
      // a small soft ω (no line down from the nose, no open jaw)
      float d = min(arcD(f, vec2(0.04, my + 0.01), 0.04, 3.4, 6.0), 9.0);
      col = mix(col, ink, aa(d - 0.013));
      float o = aa(ellipseD(f, vec2(0.0, my - 0.03), vec2(0.03, 0.028 * smile)));
      col = mix(col, vec3(0.78, 0.36, 0.38), o * step(0.3, smile));
    } else if (style < 1.5) {
      float r = 0.075 + 0.025 * smile;
      float d = arcD(f, vec2(0.0, my + r * 0.75), r, 3.7 - smile * 0.25, 5.72 + smile * 0.25);
      col = mix(col, ink, aa(d - 0.015));
      if (smile > 0.5) {
        float o = aa(max(ellipseD(f, vec2(0.0, my + r * 0.75), vec2(r * 0.92)), f.y - (my + r * 0.75 - r * 0.55)));
        col = mix(col, vec3(0.62, 0.2, 0.22), o);
      }
    } else if (style < 2.5) {
      // bunny: little y
      col = mix(col, ink, aa(segD(f, vec2(0.0, my + 0.04), vec2(0.0, my)) - 0.013));
      col = mix(col, ink, aa(min(arcD(f, vec2(0.035, my), 0.035, 3.3 - smile * 0.4, 6.0), 9.0) - 0.013));
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
    bool cloth = vGarment > 0.5;
    float near = 1.0 - smoothstep(6.0, 18.0, length(cameraPosition - vW));
    float h = 0.0; // bump height (fur strands / cloth weave), metres
    if (vFur > 0.5) {
      // fur: strands along the body (stretched noise), tufts on the silhouette, lighter tips
      float s = vnoise(vRest * vec3(300.0, 80.0, 300.0));
      float s2 = vnoise(vRest * vec3(95.0, 28.0, 95.0) + 7.0);
      base *= 0.88 + 0.14 * s + 0.07 * s2;
      h = (s * 0.7 + s2 * 0.3) * 0.0016 * near;
      float edge = smoothstep(0.32, 0.04, abs(ndv));
      if (near > 0.0 && s * 0.8 + s2 * 0.4 < edge * 0.8 * near) discard;
      base = mix(base, base * 1.18 + 0.03, edge * 0.5); // backlit tips
    } else if (cloth) {
      // cloth: a fine knit (two crossed ridges) + darker creases from the folds
      float k = 0.5 + 0.5 * sin(vRest.y * 1100.0 + sin(vRest.x * 260.0) * 2.0);
      float k2 = 0.5 + 0.5 * sin((vRest.x + vRest.z) * 700.0);
      base *= 0.92 + 0.06 * k * near + 0.03 * k2 * near;
      h = (k * 0.6 + k2 * 0.4) * 0.0006 * near;
    }
    if (h > 0.0) {
      // bump: perturb the normal by the height's screen-space gradient
      vec3 dpx = dFdx(vW), dpy = dFdy(vW);
      float dhx = dFdx(h), dhy = dFdy(h);
      vec3 r1 = cross(dpy, N), r2 = cross(N, dpx);
      float det = dot(dpx, r1);
      vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
      N = normalize(abs(det) * N - grad);
    }
    if (vFace.z > 0.5) base = drawFace(base);
    // light: banded sun + sky / ground ambient + warm rim
    float ndl = dot(N, uSunDir);
    float band = smoothstep(-0.12, 0.08, ndl) * 0.62 + smoothstep(0.25, 0.55, ndl) * 0.38;
    vec3 amb = mix(uGround, uSky, N.y * 0.5 + 0.5);
    vec3 light = amb + uSunCol * band;
    float rim = pow(1.0 - max(ndv, 0.0), 3.0);
    if (cloth) light = amb * 1.05 + uSunCol * (smoothstep(-0.25, 0.2, ndl) * 0.55 + smoothstep(0.2, 0.6, ndl) * 0.35);
    vec3 c = base * light + base * rim * (cloth ? 0.18 : 0.4) * vec3(1.0, 0.92, 0.8);
    if (cloth) c += vec3(0.05, 0.048, 0.045) * pow(1.0 - max(ndv, 0.0), 2.0) * band; // fabric sheen
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
