import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * Basílica de la Sagrada Família — procedural model matched to the
 * reference photos in docs/reference/sagrada-familia/ (aerials 1–2, the
 * Passion façade 3, the night view 4) and to the footprint in the map data
 * (≈ 96 × 104 m). The finished state is shown: no cranes or scaffolding.
 *
 * Model axes (metres): nave along z (apse −z, Glory façade +z), transept
 * along x (Nativity façade +x, Passion façade −x), y up from the ground.
 * MapWorld rotates it onto the Eixample grid.
 *
 * Heights: Tower of Jesus Christ 172.5 · Tower of the Virgin Mary 138 ·
 * Evangelists 135 · Passion bell towers 107–112 · Nativity 98–107 ·
 * nave vaults 45 · aisles 30.
 *
 * Everything is merged into two meshes (stone, mosaic/glass) → 2 draw calls.
 * Stone parts carry `aTower` (u = angle, v = relative height, w = slit
 * strength) so the shader can cut the spiral louvres of the towers and add
 * weathering streaks without extra geometry.
 */

// stone tints (vertex colours): aged Nativity, Passion / nave, pale new towers
const OLD = new THREE.Color('#a48763')
const STONE = new THREE.Color('#cba77b')
const NEW = new THREE.Color('#dcc7a6')
const WHITE = new THREE.Color('#f3f0e8')
const RED = new THREE.Color('#c23a2b')
const ORANGE = new THREE.Color('#de7a2c')
const GOLD = new THREE.Color('#e3b440')
const GREEN = new THREE.Color('#3f7a46')
const BLUE = new THREE.Color('#3e6fb0')

class Builder {
  constructor() {
    this.parts = { stone: [], mosaic: [] }
    this.m = new THREE.Matrix4()
    this.q = new THREE.Quaternion()
    this.e = new THREE.Euler()
  }
  /** add a geometry with a uniform colour (and optional per-vertex tower data) */
  add(kind, geo, color, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone()
    g.deleteAttribute('uv')
    const n = g.attributes.position.count
    if (!g.attributes.color) {
      const c = new Float32Array(n * 3)
      for (let k = 0; k < n; k++) color.toArray(c, k * 3)
      g.setAttribute('color', new THREE.BufferAttribute(c, 3))
    }
    if (kind === 'stone' && !g.attributes.aTower) g.setAttribute('aTower', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
    if (kind === 'mosaic') g.deleteAttribute('aTower')
    this.e.set(rot[0], rot[1], rot[2])
    this.m.compose(new THREE.Vector3(...pos), this.q.setFromEuler(this.e), new THREE.Vector3(...scale))
    g.applyMatrix4(this.m)
    this.parts[kind].push(g)
  }
  box(kind, color, size, pos, rot) {
    this.add(kind, new THREE.BoxGeometry(...size), color, pos, rot)
  }
  meshes(materials) {
    return Object.entries(this.parts).map(([k, list]) => {
      const g = mergeGeometries(list, false)
      list.forEach((x) => x.dispose())
      g.computeVertexNormals()
      g.computeBoundingSphere()
      const mesh = new THREE.Mesh(g, materials[k])
      mesh.castShadow = true
      mesh.receiveShadow = true
      return mesh
    })
  }
}

/** tower: lathe profile r(t) with windowed lower body and parabolic spire */
function towerGeometry(r0, H, { segments = 14, body = 0.55, taper = 0.18, k = 1.8, slit = 1 } = {}) {
  const pts = []
  const steps = 40
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    let r
    if (t < body) r = r0 * (1 - taper * (t / body)) // gently tapering cylinder
    else {
      const u = (t - body) / (1 - body)
      r = r0 * (1 - taper) * (1 - Math.pow(u, k))
    }
    // horizontal mouldings between the louvre stages
    if (t < 0.85 && Math.abs(((t * 9) % 1) - 0.5) < 0.04) r *= 1.05
    pts.push(new THREE.Vector2(Math.max(r, 0.25), t * H))
  }
  const g = new THREE.LatheGeometry(pts, segments)
  const p = g.attributes.position
  const tw = new Float32Array(p.count * 3)
  for (let v = 0; v < p.count; v++) {
    tw[v * 3] = (Math.atan2(p.getZ(v), p.getX(v)) / (Math.PI * 2) + 1) % 1
    tw[v * 3 + 1] = p.getY(v) / H
    tw[v * 3 + 2] = slit
  }
  g.setAttribute('aTower', new THREE.BufferAttribute(tw, 3))
  return g
}

/** gable prism, ridge along z */
function gable(w, h, len) {
  const s = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, h)])
  const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false })
  g.translate(0, 0, -len / 2)
  return g
}

/** mosaic finial of a bell tower: banded mitre + crosier ring + cross of balls */
function finial(b, x, y, z, r, palette) {
  const bands = [palette[0], WHITE, palette[1], WHITE, GOLD]
  const pts = []
  for (let i = 0; i <= 12; i++) {
    const t = i / 12
    pts.push(new THREE.Vector2(r * (0.55 + 0.6 * Math.sin(Math.PI * Math.min(t * 1.1, 1))) * (1 - t * 0.55), t * r * 5))
  }
  const g = new THREE.LatheGeometry(pts, 10).toNonIndexed()
  const n = g.attributes.position.count
  const c = new Float32Array(n * 3)
  for (let v = 0; v < n; v++) bands[Math.min(4, Math.floor((g.attributes.position.getY(v) / (r * 5)) * 5))].toArray(c, v * 3)
  g.setAttribute('color', new THREE.BufferAttribute(c, 3))
  b.add('mosaic', g, WHITE, [x, y, z])
  const top = y + r * 5
  b.add('mosaic', new THREE.TorusGeometry(r * 0.7, r * 0.16, 6, 14), GOLD, [x, top - r * 1.6, z], [Math.PI / 2, 0, 0])
  const ball = new THREE.IcosahedronGeometry(r * 0.32, 1)
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) b.add('mosaic', ball, WHITE, [x + dx * r * 0.75, top + r * 0.4, z + dz * r * 0.75])
  b.add('mosaic', ball, palette[0], [x, top + r * 1.1, z])
}

/** small pinnacle crowned with a coloured "fruit" ball */
function pinnacle(b, x, y, z, h, color, fruit) {
  b.add('stone', new THREE.ConeGeometry(h * 0.17, h, 6), color, [x, y + h / 2, z])
  if (fruit) b.add('mosaic', new THREE.IcosahedronGeometry(h * 0.16, 0), fruit, [x, y + h + h * 0.08, z])
}

function buildBasilica() {
  const b = new Builder()
  const fruits = [RED, ORANGE, GOLD, GREEN, WHITE]
  // bell towers: slender, nearly cylindrical shafts with a bullet-shaped top
  const BELL = { segments: 14, body: 0.64, taper: 0.1, k: 2.6 }

  // ---- body -------------------------------------------------------------
  b.box('stone', STONE, [45, 45, 70], [0, 22.5, 9])
  b.add('stone', gable(45, 16, 70), NEW, [0, 45, 9])
  for (const sx of [-1, 1]) {
    b.box('stone', STONE, [12, 30, 64], [sx * 28.5, 15, 10])
    // stepped window gables along the aisles
    for (let z = -16; z <= 38; z += 9) {
      b.add('stone', gable(7.5, 9, 3), STONE, [sx * 34.2, 30, z], [0, Math.PI / 2, 0])
      pinnacle(b, sx * 34.5, 30, z + 4.5, 8, STONE, fruits[(z + 40) % 5])
    }
  }
  b.box('stone', STONE, [76, 45, 30], [0, 22.5, 0]) // transept
  b.add('stone', gable(30, 15, 76), NEW, [0, 45, 0], [0, Math.PI / 2, 0])
  // apse + chapels
  b.add('stone', new THREE.CylinderGeometry(24, 25, 40, 20, 1, false, Math.PI / 2, Math.PI), STONE, [0, 20, -26])
  for (let a = 0; a < 7; a++) {
    const ang = Math.PI + (a / 6) * Math.PI
    const x = Math.cos(ang) * 25.5
    const z = -26 + Math.sin(ang) * 25.5
    b.add('stone', new THREE.CylinderGeometry(3.6, 4.2, 30, 6), STONE, [x, 15, z])
    pinnacle(b, x, 30, z, 11, STONE, fruits[a % 5])
  }
  // roof pinnacles along the nave and transept ridges
  for (let z = -18; z <= 40; z += 8) for (const sx of [-1, 1]) pinnacle(b, sx * 22.5, 45, z, 9, NEW, fruits[(z / 8 + 9) % 5 | 0])
  for (let x = -34; x <= 34; x += 8) if (Math.abs(x) > 20) for (const sz of [-1, 1]) pinnacle(b, x, 45, sz * 15, 9, NEW, fruits[(x / 8 + 9) % 5 | 0])

  // ---- Nativity façade (+x): aged stone, three portals, the cypress -------
  b.box('stone', OLD, [7, 42, 44], [41, 21, 0])
  for (const [z, h, w] of [[-12, 40, 10], [0, 52, 13], [12, 40, 10]]) {
    b.add('stone', gable(w, h * 0.45, 5), OLD, [44.5, h * 0.55, z], [0, Math.PI / 2, 0])
    b.box('stone', OLD, [5, h * 0.55, w], [44.5, (h * 0.55) / 2, z])
  }
  // sculpted relief: clustered lumps over the portal faces
  const lump = new THREE.IcosahedronGeometry(1, 0)
  for (let k = 0; k < 140; k++) {
    const z = ((k * 37) % 40) - 20
    const y = 6 + ((k * 53) % 44)
    b.add('stone', lump, OLD, [47 + ((k * 7) % 3) * 0.3, y, z], [k, k * 2, 0], [1 + (k % 3) * 0.5, 1.2 + (k % 4) * 0.4, 1 + (k % 2) * 0.6])
  }
  b.add('mosaic', new THREE.ConeGeometry(3.4, 16, 10), GREEN, [45, 61, 0]) // Tree of Life cypress
  for (let k = 0; k < 6; k++) b.add('mosaic', new THREE.IcosahedronGeometry(0.7, 0), WHITE, [45 + Math.cos(k) * 2.6, 56 + k * 2, Math.sin(k) * 2.6]) // doves
  ;[[-16.5, 98], [-5.5, 107], [5.5, 107], [16.5, 98]].forEach(([z, H], i) => {
    b.add('stone', towerGeometry(4.3, H * 0.84, BELL), OLD, [41, 0, z])
    finial(b, 41, H * 0.84 - 1, z, 2.6, i % 2 ? [GOLD, RED] : [RED, ORANGE])
  })

  // ---- Passion façade (−x): bone-like inclined columns, ribbed pediment ---
  b.box('stone', STONE, [7, 44, 44], [-41, 22, 0])
  b.box('stone', NEW, [10, 2.2, 42], [-48, 21, 0]) // portico canopy
  for (let k = 0; k < 6; k++) {
    const z = -17.5 + k * 7
    b.add('stone', new THREE.CylinderGeometry(0.9, 1.4, 21, 8), NEW, [-49, 10.5, z], [(k % 2 ? 1 : -1) * 0.16, 0, 0.08])
  }
  // crowning pediment: white triangle of 16 ribs (the "bones" of photo 3)
  for (let k = 0; k < 16; k++) {
    const z = -18 + k * 2.4
    const h = 34 * (1 - Math.abs(z) / 21)
    b.box('stone', WHITE, [1.2, h, 1.2], [-46, 23 + h / 2, z])
  }
  b.add('stone', gable(44, 36, 1.6), WHITE, [-46.6, 22.5, 0], [0, Math.PI / 2, 0])
  b.box('mosaic', GOLD, [0.8, 8, 0.8], [-46.8, 60, 0]) // cross
  b.box('mosaic', GOLD, [0.8, 0.8, 5], [-46.8, 62, 0])
  ;[[-16.5, 107], [-5.5, 112], [5.5, 112], [16.5, 107]].forEach(([z, H], i) => {
    b.add('stone', towerGeometry(4.4, H * 0.84, BELL), STONE, [-41, 0, z])
    finial(b, -41, H * 0.84 - 1, z, 2.7, i % 2 ? [RED, GOLD] : [ORANGE, RED])
  })

  // ---- Glory façade (+z): low narthex (towers not built) -----------------
  b.box('stone', NEW, [46, 24, 9], [0, 12, 48])
  for (let x = -18; x <= 18; x += 6) b.add('stone', gable(5, 8, 2), NEW, [x, 24, 52.5])

  // ---- central towers ---------------------------------------------------
  const central = { segments: 16, body: 0.62, taper: 0.12, k: 2.2, slit: 0.7 }
  b.add('stone', towerGeometry(9.5, 160, central), NEW, [0, 0, 1])
  // Tower of Jesus Christ: four-armed white glass cross (photo 4)
  b.box('mosaic', WHITE, [2.6, 15, 2.6], [0, 165, 1])
  b.box('mosaic', WHITE, [13.5, 2.6, 2.6], [0, 167, 1])
  b.box('mosaic', WHITE, [2.6, 2.6, 13.5], [0, 167, 1])
  // Tower of the Virgin Mary (above the apse) with its star
  b.add('stone', towerGeometry(7.8, 128, central), NEW, [0, 0, -27])
  for (let k = 0; k < 6; k++) b.box('mosaic', WHITE, [7.5, 0.9, 0.9], [0, 132, -27], [0, (k * Math.PI) / 6, (k % 2) * 0.6])
  b.add('mosaic', new THREE.IcosahedronGeometry(2.1, 1), WHITE, [0, 132, -27])
  // four Evangelists, crowned by their symbols (ox, lion, eagle, angel)
  ;[[-15, -13], [15, -13], [-15, 15], [15, 15]].forEach(([x, z], i) => {
    b.add('stone', towerGeometry(6.2, 126, central), NEW, [x, 0, z])
    b.add('mosaic', new THREE.IcosahedronGeometry(2.4, 0), [GOLD, ORANGE, BLUE, WHITE][i], [x, 129, z])
    b.box('mosaic', WHITE, [6, 0.6, 1.4], [x, 130, z], [0, 0.6 + i, 0.3]) // wings
  })
  // church grounds
  b.box('stone', new THREE.Color('#cdbfa8'), [104, 0.6, 112], [0, 0.3, 0])
  return b
}

function stoneMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, flatShading: false })
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aTower;\nvarying vec3 vTower;\nvarying vec3 vObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTower = aTower;\nvObj = position;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTower;\nvarying vec3 vObj;\nfloat h1(float x){return fract(sin(x*91.7)*43758.5);}')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         // weathering: vertical streaks, darker toward the base
         float streak = h1(floor(vObj.x * 1.7 + vObj.z * 1.3));
         diffuseColor.rgb *= 0.9 + 0.1 * streak;
         diffuseColor.rgb *= mix(0.82, 1.0, smoothstep(0.0, 40.0, vObj.y));
         // tower louvres: spiral slits on the body, vertical slots above
         if (vTower.z > 0.0) {
           float spiral = fract(vTower.x * 14.0 + vTower.y * 3.0);
           float stage = fract(vTower.y * 9.0);
           float slit = step(0.7, spiral) * step(0.14, stage) * step(stage, 0.9)
                      * step(0.1, vTower.y) * step(vTower.y, 0.86);
           diffuseColor.rgb *= 1.0 - slit * 0.78 * vTower.z;
           diffuseColor.rgb *= 1.0 + 0.12 * (1.0 - step(0.08, abs(stage - 0.5) - 0.38)); // light mouldings
         }`,
      )
  }
  return m
}

export default function Basilica(props) {
  const meshes = useMemo(() => {
    const mats = {
      stone: stoneMaterial(),
      // Venetian glass & ceramic: glossy and a touch self-lit so the colours
      // read from far away, as in the photos
      mosaic: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.1, flatShading: true, emissive: '#ffffff', emissiveIntensity: 0.12 }),
    }
    return buildBasilica().meshes(mats)
  }, [])
  useEffect(
    () => () =>
      meshes.forEach((m) => {
        m.geometry.dispose()
        m.material.dispose()
      }),
    [meshes],
  )
  return (
    <group {...props}>
      {meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </group>
  )
}
