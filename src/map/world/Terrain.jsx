import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { tileKey } from '../data/MapData'
import { parseKTX2, loadKTX2 } from './loaders'
import { SUN_DIR, HAZE, SUN_COLOR } from './atmosphereConfig'
import { AERIAL, AERIAL_GLSL } from './aerial'

/**
 * Streamed terrain: quadtree of height + imagery tiles (L0 65 km … L8 256 m).
 * Shading: slope/altitude material blend, detail normal map near the camera,
 * sun shadow mask, sea, and the shared aerial perspective.
 *
 * Selection (every few frames): a tile is split when the camera is closer
 * than `size × detail` and all four children exist in the tile set. A tile
 * is drawn only when its data is loaded; until *all* the wanted tiles under
 * a loaded ancestor are ready, the ancestor is drawn instead — never both,
 * so there are no overlaps or holes while streaming.
 *
 * GPU resources are kept per tile with an LRU and disposed when unused.
 */
const vertex = /* glsl */ `
  #include <common>
  #include <shadowmap_pars_vertex>
  #include <logdepthbuf_pars_vertex>
  attribute float aSea;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  varying float vSea;
  void main() {
    #include <beginnormal_vertex>
    #include <defaultnormal_vertex>
    #include <begin_vertex>
    #include <project_vertex>
    #include <logdepthbuf_vertex>
    #include <worldpos_vertex>
    #include <shadowmap_vertex>
    vUv = uv;
    vSea = aSea;
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
  }
`
const fragment = /* glsl */ `
  #include <common>
  #include <packing>
  #include <lights_pars_begin>
  #include <shadowmap_pars_fragment>
  #include <shadowmask_pars_fragment>
  #include <logdepthbuf_pars_fragment>
  ${AERIAL_GLSL}
  uniform sampler2D uMap;
  uniform sampler2D uDetail;
  uniform float uDetailOn;
  uniform vec3 uSun;
  uniform vec3 uSunColor;
  uniform vec3 uSky;
  uniform float uTime;
  // street-level ground (Streets.jsx): mask (R road distance, G class, B water distance) + atlases
  uniform sampler2D uStreetMask;
  uniform sampler2D uGroundAlb;
  uniform sampler2D uGroundNrm;
  uniform float uStreetOn;
  uniform float uStreetHalf;
  uniform float uStreetSize;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  varying float vSea;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }

  // a cell of the 3×2 ground atlases; derivatives passed in (taken in uniform control flow)
  // (each cell: the texture in the middle 15/16, a wrapped border of 1/32 around it)
  vec2 cellUv(float cell, vec2 p) {
    vec2 c = vec2(mod(cell, 3.0), floor(cell / 3.0));
    return (c + 0.03125 + fract(p) * 0.9375) / vec2(3.0, 2.0);
  }
  // A tiled texture seen at a grazing angle (pixel footprint long along the view)
  // turns into moiré rings wherever the filtering is too sharp; there the cell
  // fades to its average colour (its 1-texel mip) and the normal to flat.
  float farFade(vec2 dx, vec2 dy) { return smoothstep(0.025, 0.1, max(length(dx), length(dy))); }
  vec3 cellAlb(float cell, vec2 p, vec2 dx, vec2 dy) {
    // average linear colour of each cell (build_ground_textures.py atlas)
    vec3 mean = cell < 0.5 ? vec3(0.195) : cell < 1.5 ? vec3(0.4815) : cell < 2.5 ? vec3(0.1268, 0.1612, 0.0343)
      : cell < 3.5 ? vec3(0.3328, 0.2586, 0.156) : cell < 4.5 ? vec3(0.707, 0.6808, 0.6274) : vec3(0.608, 0.6151, 0.4863);
    float f = farFade(dx, dy);
    if (f > 0.999) return mean;
    return mix(textureGrad(uGroundAlb, cellUv(cell, p), dx * vec2(0.3125, 0.46875), dy * vec2(0.3125, 0.46875)).rgb, mean, f);
  }
  // tangent normal (OpenGL convention, image v down = −z) → world offset (x, z)
  vec2 cellNrm(float cell, vec2 p, vec2 dx, vec2 dy) {
    float f = farFade(dx, dy);
    if (f > 0.999) return vec2(0.0);
    vec2 t = textureGrad(uGroundNrm, cellUv(cell, p), dx * vec2(0.3125, 0.46875), dy * vec2(0.3125, 0.46875)).xy * 2.0 - 1.0;
    return vec2(t.x, -t.y) * (1.0 - f);
  }
  float sdRound(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
  // Barcelona panot (20 cm, four raised tablets): relief height 0..1 in tile units
  float panotH(vec2 q) {
    vec2 f = fract(q);
    float e = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
    float joint = smoothstep(0.0, 0.035, e);
    vec2 g = fract(f * 2.0) - 0.5; // quadrant
    float tab = 1.0 - smoothstep(-0.03, 0.03, sdRound(g, vec2(0.33), 0.12));
    return joint * (0.45 + 0.55 * tab);
  }

  void main() {
    #include <logdepthbuf_fragment>
    vec3 albedo = texture2D(uMap, vUv).rgb;
    // derivatives for the street layer (here: uniform control flow)
    vec2 sdx = dFdx(vWorld.xz);
    vec2 sdy = dFdy(vWorld.xz);
    vec3 n = normalize(vNormalW);
    vec3 toCam = cameraPosition - vWorld;
    float dist = length(toCam);
    vec3 v = toCam / dist;

    // slope / altitude material blend: steep ground reads as bare rock,
    // high ground (Collserola, ≥ 250 m) slightly cooler and darker forest
    float slope = 1.0 - n.y;
    float lum = dot(albedo, vec3(0.299, 0.587, 0.114));
    vec3 rock = mix(vec3(lum), albedo, 0.35) * vec3(0.95, 0.92, 0.88);
    albedo = mix(albedo, rock, smoothstep(0.28, 0.55, slope) * (1.0 - vSea));
    albedo *= mix(1.0, 0.86, smoothstep(250.0, 450.0, vWorld.y) * (1.0 - vSea));

    // ---- street level near the landmark: real ground materials instead of the photo
    float water = vSea;
    float street = 0.0;
    if (uStreetOn > 0.5) {
      vec2 sp = vWorld.xz;
      float inside = uStreetHalf - max(abs(sp.x), abs(sp.y));
      street = clamp(inside / 30.0, 0.0, 1.0) * (1.0 - smoothstep(90.0, 220.0, dist));
    }
    if (street > 0.001) {
      vec2 sp = vWorld.xz;
      vec2 muv = (sp + uStreetHalf) / (2.0 * uStreetHalf);
      vec4 m = texture2D(uStreetMask, muv);
      float roadD = (m.r * 255.0 - 128.0) / 16.0; // + inside the carriageway (m)
      float waterD = (m.b * 255.0 - 128.0) / 16.0;
      ivec2 tc = ivec2(clamp(muv, 0.0, 0.9999) * uStreetSize);
      float cls = floor(texelFetch(uStreetMask, tc, 0).g * 255.0 + 0.5);
      float big = noise(sp * 0.06) * 0.6 + noise(sp * 0.23) * 0.4; // large-scale variation
      float pix = length(sdx) + length(sdy); // metres per pixel
      vec3 sa = vec3(0.0);
      vec2 dn = vec2(0.0);
      float pond = 0.0;
      if (roadD > 0.0) {
        // asphalt (2.6 m texture), slightly varied
        vec2 p = sp / 2.6;
        sa = cellAlb(0.0, p, sdx / 2.6, sdy / 2.6) * vec3(0.62, 0.62, 0.64) * (0.9 + 0.2 * big);
        dn = cellNrm(0.0, p, sdx / 2.6, sdy / 2.6) * 0.5;
      } else if (waterD > 0.0) {
        sa = vec3(0.05, 0.11, 0.11); // pond (shaded below like the sea)
        pond = 1.0;
      } else if (cls > 2.5 && cls < 3.5) {
        // gravel (street tree pits)
        vec2 p = sp / 1.5;
        sa = cellAlb(4.0, p, sdx / 1.5, sdy / 1.5) * vec3(0.78, 0.74, 0.68);
        dn = cellNrm(4.0, p, sdx / 1.5, sdy / 1.5) * 0.8;
      } else {
        // paving / sauló / lawn from the soft blend field: smooth edges, organic where lawn meets sand
        float a = m.a;
        float wob = noise(sp * 0.8) + 0.5 * noise(sp * 2.3) - 0.75;
        float wl = smoothstep(0.6, 0.86, a + wob * 0.28);
        float ws = (1.0 - wl) * smoothstep(0.16, 0.34, a + wob * 0.05);
        float wp = 1.0 - wl - ws;
        if (wp > 0.004) {
          // panot: cement grain + the 20 cm four-tablet relief, tiles slightly different in tone
          vec2 p = sp / 1.1;
          vec3 c = cellAlb(1.0, p, sdx / 1.1, sdy / 1.1) * vec3(0.84, 0.82, 0.8);
          vec2 q = sp / 0.2;
          float fade = 1.0 - smoothstep(0.006, 0.025, pix); // the relief needs ≥ 8 px per tile
          float e = 0.004;
          float h0 = panotH(q);
          vec2 grad = vec2(panotH(q + vec2(e, 0.0)) - h0, panotH(q + vec2(0.0, e)) - h0) / e;
          float tv = fract(sin(dot(floor(q), vec2(12.9898, 78.233))) * 43758.5453);
          c *= mix(1.0, (0.95 + 0.08 * tv) * (0.86 + 0.14 * h0), fade) * (0.94 + 0.12 * big);
          sa += c * wp;
          dn += (-grad * 0.07 * fade + cellNrm(1.0, p, sdx / 1.1, sdy / 1.1) * 0.25) * wp;
        }
        if (ws > 0.004) {
          vec2 p = sp / 3.5;
          sa += cellAlb(3.0, p, sdx / 3.5, sdy / 3.5) * vec3(1.02, 0.98, 0.92) * (0.88 + 0.2 * big) * ws;
          dn += cellNrm(3.0, p, sdx / 3.5, sdy / 3.5) * 0.6 * ws;
        }
        if (wl > 0.004) {
          vec2 p = sp / 1.4;
          vec3 tint = cls > 4.5 && cls < 5.5 ? vec3(0.62, 0.9, 0.56) : vec3(0.74, 0.97, 0.62);
          sa += cellAlb(2.0, p, sdx / 1.4, sdy / 1.4) * tint * (0.8 + 0.32 * big) * wl;
          dn += cellNrm(2.0, p, sdx / 1.4, sdy / 1.4) * 0.7 * wl;
        }
      }
      // the photo keeps its large shadows / colour drift faintly (trees, kerbside)
      float lumP = dot(albedo, vec3(0.299, 0.587, 0.114));
      sa *= mix(1.0, clamp(lumP / 0.32, 0.75, 1.1), 0.25);
      albedo = mix(albedo, sa, street);
      n = normalize(n + vec3(dn.x, 0.0, dn.y) * street);
      water = max(water, pond * street);
    }

    // detail normal map at two scales, faded out with distance
    float near = uDetailOn * (1.0 - smoothstep(250.0, 2500.0, dist)) * (1.0 - vSea) * (1.0 - street);
    if (near > 0.001) {
      vec2 d1 = texture2D(uDetail, vWorld.xz / 22.0).xy * 2.0 - 1.0;
      vec2 d2 = texture2D(uDetail, vWorld.xz / 3.5).xy * 2.0 - 1.0;
      vec2 dn = d1 * 0.55 + d2 * 0.35 * (1.0 - smoothstep(60.0, 400.0, dist));
      n = normalize(n + vec3(dn.x, 0.0, dn.y) * near);
      albedo *= 1.0 + (d1.x + d2.y) * 0.05 * near;
    }

    float ndl = max(dot(n, uSun), 0.0) * getShadowMask();
    vec3 col = albedo * (uSky * 0.42 * (0.6 + 0.4 * n.y) + uSunColor * ndl * 1.05);

    // sea (and the pond): sky reflection with Fresnel, gentle waves and sun glint
    if (water > 0.01) {
      vec2 w = vWorld.xz * 0.02 + vec2(uTime * 0.03, uTime * 0.02);
      vec3 wn = normalize(vec3((noise(w * 3.1) - 0.5) * 0.18, 1.0, (noise(w * 2.3 + 7.0) - 0.5) * 0.18));
      float fres = 0.04 + 0.96 * pow(1.0 - max(dot(wn, v), 0.0), 5.0);
      vec3 deep = albedo * 0.85 + vec3(0.02, 0.06, 0.1);
      vec3 wcol = mix(deep, uSky * 0.95, fres * 0.85);
      vec3 h = normalize(uSun + v);
      wcol += uSunColor * pow(max(dot(wn, h), 0.0), 280.0) * 3.0;
      col = mix(col, wcol, water);
    }

    gl_FragColor = vec4(aerialPerspective(col, vWorld), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

/** coarser vertex grid for far (large) tiles: L0–1 every 4th, L2 every 2nd sample */
function decimate(heights, n, L) {
  const stride = L <= 1 ? 4 : L === 2 ? 2 : 1
  if (stride === 1) return { h: heights, n }
  const m = (n - 1) / stride + 1
  const h = new Float32Array(m * m)
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) h[j * m + i] = heights[j * stride * n + i * stride]
  return { h, n: m }
}

function buildGeometry(heights, n, size) {
  // (n×n grid) + a skirt hanging below every edge to hide LOD cracks
  const skirt = Math.max(6, size / 300)
  const ring = 4 * (n - 1)
  const count = n * n + ring
  const pos = new Float32Array(count * 3)
  const uv = new Float32Array(count * 2)
  const sea = new Float32Array(count)
  const step = size / (n - 1)
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i
      const h = heights[k]
      pos.set([i * step, h, j * step], k * 3)
      uv.set([i / (n - 1), j / (n - 1)], k * 2)
      sea[k] = h <= 0.6 ? 1 : 0
    }
  }
  // edge loop (clockwise index walk) for the skirt
  const edge = []
  for (let i = 0; i < n - 1; i++) edge.push(i) // top
  for (let j = 0; j < n - 1; j++) edge.push(j * n + n - 1) // right
  for (let i = n - 1; i > 0; i--) edge.push((n - 1) * n + i) // bottom
  for (let j = n - 1; j > 0; j--) edge.push(j * n) // left
  edge.forEach((src, q) => {
    const k = n * n + q
    pos.set([pos[src * 3], pos[src * 3 + 1] - skirt, pos[src * 3 + 2]], k * 3)
    uv.set([uv[src * 2], uv[src * 2 + 1]], k * 2)
    sea[k] = sea[src]
  })
  const idx = []
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i
      idx.push(a, a + n, a + 1, a + 1, a + n, a + n + 1)
    }
  }
  for (let q = 0; q < ring; q++) {
    const a = edge[q]
    const b = edge[(q + 1) % ring]
    const sa = n * n + q
    const sb = n * n + ((q + 1) % ring)
    idx.push(a, b, sa, b, sb, sa)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  g.setAttribute('aSea', new THREE.BufferAttribute(sea, 1))
  g.setIndex(idx)
  g.computeVertexNormals()
  g.computeBoundingSphere()
  return g
}

export default function Terrain({ data, manifest, detail = 1.6, maxTiles = 140, maxLevel = 8, buildPerFrame = 3, anisotropy = 4, streets = null, onStats }) {
  const { camera, gl } = useThree()
  const group = useRef()
  const [, setTick] = useState(0)
  const st = useRef({ gpu: new Map(), wanted: new Set(), drawn: [], frame: 0, loaded: new Set(), pending: new Set(), queue: [] }).current
  const T = manifest.terrain

  const uniforms = useMemo(
    () => ({
      uSun: { value: SUN_DIR },
      uSunColor: { value: SUN_COLOR },
      uSky: { value: HAZE.clone().lerp(new THREE.Color('#8fb4dc'), 0.5) },
      uTime: { value: 0 },
      uDetail: { value: null },
      uDetailOn: { value: 0 },
      uStreetMask: { value: null },
      uGroundAlb: { value: null },
      uGroundNrm: { value: null },
      uStreetOn: { value: 0 },
      uStreetHalf: { value: 450 },
      uStreetSize: { value: 1800 },
      ...AERIAL,
      ...THREE.UniformsLib.lights,
    }),
    [],
  )

  useEffect(() => {
    let live = true
    let tex
    loadKTX2(gl, `${import.meta.env.BASE_URL || '/'}textures/detail_normal.ktx2`).then((t) => {
      if (!live) return t.dispose()
      tex = t
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.colorSpace = THREE.NoColorSpace
      t.anisotropy = Math.min(anisotropy, gl.capabilities.getMaxAnisotropy())
      t.needsUpdate = true
      uniforms.uDetail.value = t
      uniforms.uDetailOn.value = 1
    })
    return () => {
      live = false
      tex?.dispose()
    }
  }, [gl, uniforms, anisotropy])

  // street-level ground textures (Streets.jsx) → the shared uniforms
  useEffect(() => {
    const u = uniforms
    u.uStreetOn.value = streets ? 1 : 0
    // the sampler must hold a texture even while off
    u.uStreetMask.value = streets?.mask ?? null
    u.uGroundAlb.value = streets?.albedo ?? null
    u.uGroundNrm.value = streets?.normal ?? null
    if (streets) {
      u.uStreetHalf.value = streets.half
      u.uStreetSize.value = streets.size
    }
  }, [streets, uniforms])

  const tileInfo = (L, i, j) => {
    const s = (2 * T.half) / 2 ** L
    return { L, i, j, s, x0: -T.half + i * s, z0: -T.half + j * s, key: tileKey(L, i, j) }
  }

  const request = (t) => {
    if (st.loaded.has(t.key) || st.pending.has(t.key)) return
    st.pending.add(t.key)
    data
      .terrainTile(t.L, t.i, t.j)
      .then(async (d) => {
        // KTX2 is transcoded in a worker; the GPU upload happens in useFrame,
        // a few tiles per frame
        const tex = d.ktx2 ? await parseKTX2(gl, d.ktx2) : null
        st.queue.push({ t, d, tex })
      })
      .catch(() => st.pending.delete(t.key))
  }

  // selection: returns tiles to draw (or null if nothing under `t` is ready)
  const select = (t, cam, out) => {
    const cx = t.x0 + t.s / 2
    const cz = t.z0 + t.s / 2
    const dx = Math.max(Math.abs(cam.x - cx) - t.s / 2, 0)
    const dz = Math.max(Math.abs(cam.z - cz) - t.s / 2, 0)
    const d = Math.hypot(dx, dz, Math.max(cam.y - 60, 0))
    const kids = [0, 1, 2, 3].map((q) => tileInfo(t.L + 1, t.i * 2 + (q % 2), t.j * 2 + (q >> 1)))
    const split = t.L < maxLevel && d < t.s * detail && kids.every((k) => T.has.has(k.key))
    st.wanted.add(t.key)
    request(t) // ancestors are always fetched: they are the fallback
    if (!split) {
      if (!st.loaded.has(t.key)) return null
      out.push(t)
      return [t]
    }
    const parts = []
    let ready = true
    for (const k of kids) {
      const r = select(k, cam, parts)
      if (!r) ready = false
    }
    if (ready) {
      out.push(...parts)
      return parts
    }
    if (st.loaded.has(t.key)) {
      out.push(t)
      return [t]
    }
    return null
  }

  const build = ({ t, d, tex: ktex }) => {
    st.pending.delete(t.key)
    if (!group.current) {
      ktex?.dispose()
      return
    }
    const dec = decimate(d.heights, T.heightSize, t.L)
    const geometry = buildGeometry(dec.h, dec.n, t.s)
    const tex = ktex || new THREE.Texture(d.image)
    tex.flipY = false
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
    if (!ktex) tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = Math.min(anisotropy, gl.capabilities.getMaxAnisotropy())
    tex.needsUpdate = true
    const material = new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, lights: true, uniforms: { ...uniforms, uMap: { value: tex } } })
    material.extensions = {}
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(t.x0, 0, t.z0)
    mesh.matrixAutoUpdate = false
    mesh.updateMatrix()
    mesh.receiveShadow = true
    mesh.visible = false
    group.current.add(mesh)
    st.gpu.set(t.key, { mesh, tex, used: performance.now() })
    st.loaded.add(t.key)
    st.dirty = true
  }

  useFrame((state, dt) => {
    uniforms.uTime.value += dt
    // upload a few decoded tiles per frame, coarsest first (keeps frames short)
    if (st.queue.length) {
      st.queue.sort((a, b) => a.t.L - b.t.L)
      for (const item of st.queue.splice(0, buildPerFrame)) build(item)
    }
    if (++st.frame % 6 !== 0 && !st.dirty) return
    st.dirty = false
    st.wanted.clear()
    const draw = []
    select(tileInfo(0, 0, 0), camera.position, draw)
    const now = performance.now()
    const keys = new Set(draw.map((t) => t.key))
    for (const [k, g] of st.gpu) {
      const vis = keys.has(k)
      g.mesh.visible = vis
      if (vis || st.wanted.has(k)) g.used = now
    }
    // LRU: dispose tiles not wanted for 15 s once over budget
    if (st.gpu.size > maxTiles) {
      const old = [...st.gpu.entries()].filter(([, g]) => now - g.used > 15000).sort((a, b) => a[1].used - b[1].used)
      for (const [k, g] of old.slice(0, st.gpu.size - maxTiles)) {
        group.current.remove(g.mesh)
        g.mesh.geometry.dispose()
        g.mesh.material.dispose()
        g.tex.dispose()
        st.gpu.delete(k)
        st.loaded.delete(k)
      }
    }
    onStats?.({ drawn: draw.length, loaded: st.gpu.size, pending: st.pending.size })
    if (draw.length && !st.firstDraw) {
      st.firstDraw = true
      setTick((x) => x + 1)
    }
  })

  useEffect(
    () => () => {
      for (const g of st.gpu.values()) {
        g.mesh.geometry.dispose()
        g.mesh.material.dispose()
        g.tex.dispose()
      }
      st.gpu.clear()
    },
    [st],
  )

  return <group ref={group} />
}
