/**
 * Billboard puff shader — "vapor" rendering.
 *
 * Each instance is a camera-facing quad. Its *silhouette* comes from a
 * low-frequency cumulus sprite (atlas); everything finer is generated per
 * pixel from tiling Worley + fBm noise, so the edge detail stays sharp no
 * matter how close the camera gets (no magnified, blurry texels):
 *
 *  - Worley billows erode the boundary into small rounded protrusions,
 *    fBm adds wispy vapor; erosion is strongest at the edges so the core
 *    stays solid and the outline crisp-but-soft.
 *  - Surface normals come from screen-space derivatives of a height field
 *    (base shape + billows) → every bump is lit from the sun side and
 *    shaded grey-blue on the other, which kills the flat "plastic" look.
 *  - Self-shadowing from the density toward the sun, underside darkening,
 *    silver lining on thin backlit vapor and aerial perspective.
 *
 * Output is premultiplied alpha; instances are depth-sorted on the CPU.
 */

export const cloudVertex = /* glsl */ `
  attribute vec3 iPos;
  attribute vec4 iData;   // sizeX, sizeY, alpha, seed
  attribute vec4 iExtra;  // tile index, underside shade, per-puff light, rotation

  varying vec2 vUv;
  varying vec2 vTile;
  varying float vAlpha;
  varying float vSeed;
  varying float vShade;
  varying float vLight;
  varying float vDist;
  varying vec3 vViewPos;
  varying float vRot;

  void main() {
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    // in-plane rotation (organic tumbling while clouds travel)
    float cr = cos(iExtra.w);
    float sr = sin(iExtra.w);
    vec2 p = vec2(position.x * iData.x, position.y * iData.y);
    p = vec2(p.x * cr - p.y * sr, p.x * sr + p.y * cr);
    vec3 world = iPos + right * p.x + up * p.y;
    vec4 mv = viewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mv;

    vUv = uv;
    float t = iExtra.x;
    vTile = vec2(mod(t, 2.0), floor(t / 2.0));
    vAlpha = iData.z;
    vSeed = iData.w;
    vShade = iExtra.y;
    vLight = iExtra.z;
    vDist = -mv.z;
    vViewPos = mv.xyz;
    vRot = iExtra.w;
  }
`

export const cloudFragment = /* glsl */ `
  precision highp float;
  uniform sampler2D uAtlas;
  uniform sampler2D uVapor;
  uniform vec3 uSunView;
  uniform vec3 uLit;
  uniform vec3 uShadow;
  uniform vec3 uDeep;
  uniform vec3 uSunColor;
  uniform vec3 uHaze;
  uniform float uFog;
  uniform float uBrightness;
  uniform float uTime;

  varying vec2 vUv;
  varying vec2 vTile;
  varying float vAlpha;
  varying float vSeed;
  varying float vShade;
  varying float vLight;
  varying float vDist;
  varying vec3 vViewPos;
  varying float vRot;

  float sampleD(vec2 uv) {
    uv = clamp(uv, 0.004, 0.996);
    return texture2D(uAtlas, (uv + vTile) * 0.5).r;
  }

  void main() {
    vec2 c = vUv * 2.0 - 1.0;
    float t = uTime;
    vec2 q = vUv + vSeed * 7.31;
    // the vapor churns slowly inside a stable silhouette (no shape popping)
    vec2 drift = vec2(t * 0.0045, -t * 0.003);

    // gentle domain warp of the silhouette
    vec2 w = texture2D(uVapor, q * 0.19 + drift).rg - 0.5;
    vec2 uv = vUv + w * 0.035;

    float base = sampleD(uv);

    vec2 v1 = texture2D(uVapor, q * 0.55 + drift).rg;
    vec2 v2 = texture2D(uVapor, q * 1.3 - drift * 1.6 + 0.37).rg;
    vec2 v3 = texture2D(uVapor, q * 3.1 + drift * 2.2 + 0.71).rg;
    float billow = v1.g * 0.5 + v2.g * 0.33 + v3.g * 0.17;
    float wisp = v1.r * 0.5 + v2.r * 0.3 + v3.r * 0.2;
    // the boundary is carved mostly by the small Worley cells → many little
    // rounded protrusions instead of a smooth, wobbly outline
    float edgeDetail = v1.g * 0.2 + v2.g * 0.35 + v3.g * 0.3 + v3.r * 0.15;

    // erode the boundary much more than the core → solid body, broken edge
    float dens = clamp(base * 1.55 - (1.0 - edgeDetail) * (0.95 - base * 0.55), 0.0, 1.0);

    // --- lighting --------------------------------------------------------
    // Normal from finite differences of the silhouette density. (Screen-space
    // derivatives of a magnified bilinear texture are stepped per texel and
    // show up as blocks on close clouds — explicit taps stay smooth.)
    const float E = 0.018;
    float gx = sampleD(uv + vec2(E, 0.0)) - base;
    float gy = sampleD(uv + vec2(0.0, E)) - base;
    vec2 g = vec2(gx, gy) / E;
    // sprite space → screen space (quads spin while clouds travel)
    float cr = cos(vRot);
    float sr = sin(vRot);
    g = vec2(g.x * cr - g.y * sr, g.x * sr + g.y * cr);
    vec2 cc = vec2(c.x * cr - c.y * sr, c.x * sr + c.y * cr);
    vec3 n = normalize(vec3(-g * 0.11 + cc * 0.25, 1.0));

    vec2 sun2 = uSunView.xy;
    float sl = length(sun2);
    sun2 = sl > 1e-3 ? sun2 / sl : vec2(0.0, 1.0);
    float side = dot(n.xy, sun2);
    float absorb = clamp((sampleD(uv + sun2 * 0.08) - base) * 1.8, 0.0, 1.0);

    // billow relief: brighter crowns, grey-blue creases between cells
    float relief = (v1.g - 0.5) * 0.2 + (v2.g - 0.5) * 0.3 + (v3.g - 0.5) * 0.22;
    float lit = vLight * 0.5 + 0.28 + side * 0.4 - absorb * 0.4 + cc.y * 0.1 - dens * 0.05 + relief;
    lit = clamp(lit, 0.0, 1.0);
    vec3 col = mix(uDeep, uShadow, smoothstep(0.0, 0.42, lit));
    col = mix(col, uLit, smoothstep(0.38, 0.92, lit));

    // flat, darker cumulus bases
    col *= mix(1.0 - 0.2 * vShade, 1.0, smoothstep(-0.75, 0.2, cc.y));

    // silver lining on thin, backlit vapor + rim catching the sun
    vec3 viewDir = normalize(vViewPos);
    float fs = pow(max(dot(viewDir, uSunView), 0.0), 5.0);
    float thin = 1.0 - smoothstep(0.03, 0.3, dens);
    col += uSunColor * (fs * (thin * 0.45 + 0.08) + thin * 0.07 * max(side, 0.0));

    col *= uBrightness;
    float f = 1.0 - exp(-vDist * uFog);
    col = mix(col, uHaze * uBrightness, f);

    // opaque body with a crisp-but-soft outline, plus a thin translucent
    // vapor fringe just outside it (water vapour, not a cut-out sticker)
    float body = smoothstep(0.06, 0.2, dens);
    float fringe = smoothstep(0.04, 0.45, base) * smoothstep(0.38, 0.78, wisp) * 0.32;
    float a = max(body, fringe) * vAlpha;
    a *= smoothstep(1.5, 9.0, vDist);       // soft fade when flying through
    if (a < 0.004) discard;

    gl_FragColor = vec4(col * a, a);
  }
`
