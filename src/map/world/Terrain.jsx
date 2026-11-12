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

  void main() {
    #include <logdepthbuf_fragment>
    vec3 albedo = texture2D(uMap, vUv).rgb;
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

    // detail normal map at two scales, faded out with distance
    float near = uDetailOn * (1.0 - smoothstep(250.0, 2500.0, dist)) * (1.0 - vSea);
    if (near > 0.001) {
      vec2 d1 = texture2D(uDetail, vWorld.xz / 22.0).xy * 2.0 - 1.0;
      vec2 d2 = texture2D(uDetail, vWorld.xz / 3.5).xy * 2.0 - 1.0;
      vec2 dn = d1 * 0.55 + d2 * 0.35 * (1.0 - smoothstep(60.0, 400.0, dist));
      n = normalize(n + vec3(dn.x, 0.0, dn.y) * near);
      albedo *= 1.0 + (d1.x + d2.y) * 0.05 * near;
    }

    float ndl = max(dot(n, uSun), 0.0) * getShadowMask();
    vec3 col = albedo * (uSky * 0.42 * (0.6 + 0.4 * n.y) + uSunColor * ndl * 1.05);

    // sea: sky reflection with Fresnel, gentle waves and sun glint
    if (vSea > 0.01) {
      vec2 w = vWorld.xz * 0.02 + vec2(uTime * 0.03, uTime * 0.02);
      vec3 wn = normalize(vec3((noise(w * 3.1) - 0.5) * 0.18, 1.0, (noise(w * 2.3 + 7.0) - 0.5) * 0.18));
      float fres = 0.04 + 0.96 * pow(1.0 - max(dot(wn, v), 0.0), 5.0);
      vec3 deep = albedo * 0.85 + vec3(0.02, 0.06, 0.1);
      vec3 water = mix(deep, uSky * 0.95, fres * 0.85);
      vec3 h = normalize(uSun + v);
      water += uSunColor * pow(max(dot(wn, h), 0.0), 280.0) * 3.0;
      col = mix(col, water, vSea);
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

export default function Terrain({ data, manifest, detail = 1.6, maxTiles = 140, maxLevel = 8, buildPerFrame = 3, anisotropy = 4, onStats }) {
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
