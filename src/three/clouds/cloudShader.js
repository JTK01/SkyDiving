/**
 * Billboard puff shader.
 *
 * Each instance is a camera-facing quad sampling a density sprite from the
 * atlas. Lighting fakes volumetric scattering:
 *  - sphere normal  → broad lambert-like shading
 *  - density sampled toward the sun → self-shadowing of billows
 *  - forward scattering → silver lining when looking toward the sun
 *  - underside darkening + aerial perspective (fog toward the horizon haze)
 * Output is premultiplied alpha; instances are depth-sorted on the CPU.
 */

export const cloudVertex = /* glsl */ `
  attribute vec3 iPos;
  attribute vec4 iData;   // sizeX, sizeY, alpha, seed
  attribute vec3 iExtra;  // tile index, underside shade, per-puff light (0..1)

  varying vec2 vUv;
  varying vec2 vTile;
  varying float vAlpha;
  varying float vSeed;
  varying float vShade;
  varying float vLight;
  varying float vDist;
  varying vec3 vViewPos;

  void main() {
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec3 world = iPos + right * position.x * iData.x + up * position.y * iData.y;
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
  }
`

export const cloudFragment = /* glsl */ `
  precision highp float;
  uniform sampler2D uAtlas;
  uniform sampler2D uDetail;
  uniform vec3 uSunView;
  uniform vec3 uLit;
  uniform vec3 uShadow;
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

  float sampleD(vec2 uv) {
    uv = clamp(uv, 0.004, 0.996);
    return texture2D(uAtlas, (uv + vTile) * 0.5).r;
  }

  void main() {
    vec2 c = vUv * 2.0 - 1.0;
    float t = uTime * 0.035 + vSeed * 31.0;

    // slow internal turbulence
    vec2 warp = vec2(sin(c.y * 2.7 + t), cos(c.x * 2.3 - t * 0.8)) * 0.012;
    vec2 uv = vUv + warp;

    float d = sampleD(uv);
    if (d < 0.004) discard;

    // edge erosion with tiling detail noise (keeps close-ups crisp)
    float det = texture2D(uDetail, uv * 1.7 + vSeed * 9.0 + vec2(uTime * 0.004, 0.0)).r;
    d = clamp(d - (det - 0.42) * 0.45 * (1.0 - d * 0.6), 0.0, 1.0);

    // --- lighting --------------------------------------------------------
    // density gradient toward the sun ≈ light absorbed on the way in
    vec2 sunOff = uSunView.xy * 0.09;
    float dSun = sampleD(uv + sunOff);
    float dSun2 = sampleD(uv + sunOff * 2.2);
    float absorb = max(dSun - d, 0.0) * 1.6 + max(dSun2 - d, 0.0) * 0.8;

    // gentle volume rounding (kept weak — strong sphere shading looks cartoony)
    vec3 n = normalize(vec3(c * 0.6, sqrt(max(0.05, 1.0 - dot(c, c) * 0.36))));
    float lambert = dot(n, uSunView) * 0.5 + 0.5;

    // vLight = where this puff sits inside its cloud (top / sun side = bright)
    float lit = vLight * 0.75 + 0.12 + lambert * 0.14 + c.y * 0.16 - absorb * 0.6 - d * 0.1;
    lit = clamp(lit, 0.0, 1.0);
    vec3 col = mix(uShadow, uLit, lit);

    // underside darkening (flat cumulus bases)
    col *= mix(1.0 - 0.28 * vShade, 1.0, smoothstep(-0.7, 0.3, c.y));

    // forward scattering: thin parts glow when backlit
    vec3 viewDir = normalize(vViewPos);
    float fs = pow(max(dot(viewDir, uSunView), 0.0), 6.0);
    float thin = 1.0 - smoothstep(0.05, 0.6, d);
    col += uSunColor * fs * (thin * 0.45 + 0.12);

    col *= uBrightness;

    // aerial perspective
    float f = 1.0 - exp(-vDist * uFog);
    col = mix(col, uHaze * uBrightness, f);

    float a = smoothstep(0.0, 0.95, d) * vAlpha;
    // soft fade when a puff reaches the camera instead of clipping
    a *= smoothstep(1.5, 9.0, vDist);
    if (a < 0.003) discard;

    gl_FragColor = vec4(col * a, a);
  }
`
