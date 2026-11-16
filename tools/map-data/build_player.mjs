/**
 * Player avatar → public/models/characters/player.glb (glTF SkinnedMesh)
 *   - one skin (19 joints, A-pose rest) shared by two meshes:
 *     player_lod0 (near) and player_lod1 (far)
 *   - continuous body with smooth weights (≤ 4 joints per vertex) + rigid
 *     head / gear parts, vertex colours (COLOR_0)
 *   - animations: idle, walk, freefall, canopy, landing, photo (sampled at 30 fps)
 *   - meshopt compression via gltfpack
 * usage: node build_player.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import { BONES, PLAYER_CLIPS, buildPlayerMesh } from '../../src/map/characters/playerRig.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.resolve(here, '../../public/models/characters')
fs.mkdirSync(out, { recursive: true })

const chunks = []
let offset = 0
const bufferViews = []
const accessors = []
function acc(array, type, comps, { target, minmax, componentType } = {}) {
  const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength)
  const pad = (4 - (bytes.length % 4)) % 4
  chunks.push(bytes, Buffer.alloc(pad))
  const bv = { buffer: 0, byteOffset: offset, byteLength: bytes.length }
  if (target) bv.target = target
  bufferViews.push(bv)
  offset += bytes.length + pad
  const ct = componentType ?? (array instanceof Uint32Array ? 5125 : array instanceof Uint16Array ? 5123 : 5126)
  const a = { bufferView: bufferViews.length - 1, componentType: ct, count: array.length / comps, type }
  if (minmax) Object.assign(a, minmax)
  accessors.push(a)
  return accessors.length - 1
}
const bounds = (arr, comps) => {
  const min = Array(comps).fill(Infinity)
  const max = Array(comps).fill(-Infinity)
  for (let i = 0; i < arr.length; i += comps)
    for (let k = 0; k < comps; k++) {
      min[k] = Math.min(min[k], arr[i + k])
      max[k] = Math.max(max[k], arr[i + k])
    }
  return { min, max }
}

// ---- nodes: 0 = root group, 1.. = joints, then the two meshes ------------
const nodes = [{ name: 'player', children: [] }]
const jointNode = {}
BONES.forEach(([name, parent, pos]) => {
  const pp = parent ? BONES.find((b) => b[0] === parent)[2] : [0, 0, 0]
  nodes.push({ name, translation: [pos[0] - pp[0], pos[1] - pp[1], pos[2] - pp[2]], children: [] })
  jointNode[name] = nodes.length - 1
})
BONES.forEach(([name, parent]) => {
  if (parent) nodes[jointNode[parent]].children.push(jointNode[name])
  else nodes[0].children.push(jointNode[name])
})
const ibm = new Float32Array(BONES.length * 16)
BONES.forEach(([, , pos], i) => new THREE.Matrix4().makeTranslation(-pos[0], -pos[1], -pos[2]).toArray(ibm, i * 16))
const skin = { joints: BONES.map(([n]) => jointNode[n]), skeleton: jointNode.hips, inverseBindMatrices: acc(ibm, 'MAT4', 16) }

const meshes = []
const stats = []
for (const lod of [0, 1]) {
  const m = buildPlayerMesh(lod)
  meshes.push({
    name: `player_lod${lod}`,
    primitives: [
      {
        attributes: {
          POSITION: acc(m.position, 'VEC3', 3, { target: 34962, minmax: bounds(m.position, 3) }),
          NORMAL: acc(m.normal, 'VEC3', 3, { target: 34962 }),
          COLOR_0: acc(m.color, 'VEC3', 3, { target: 34962 }),
          JOINTS_0: acc(m.joints, 'VEC4', 4, { target: 34962 }),
          WEIGHTS_0: acc(m.weights, 'VEC4', 4, { target: 34962 }),
        },
        indices: acc(m.index, 'SCALAR', 1, { target: 34963 }),
        material: 0,
      },
    ],
  })
  nodes.push({ name: `player_lod${lod}`, mesh: meshes.length - 1, skin: 0 })
  nodes[0].children.push(nodes.length - 1)
  stats.push(`lod${lod} ${m.index.length / 3} tris, ${m.position.length / 3} verts`)
}

// ---- animations ------------------------------------------------------------
const FPS = 30
const e = new THREE.Euler()
const q = new THREE.Quaternion()
const animations = []
for (const [name, c] of Object.entries(PLAYER_CLIPS)) {
  const loop = c.loop !== false
  const n = Math.max(2, Math.round(c.duration * FPS) + 1)
  const times = new Float32Array(n)
  const rot = BONES.map(() => new Float32Array(n * 4))
  const hipsT = new Float32Array(n * 3)
  for (let k = 0; k < n; k++) {
    const t = (k / (n - 1)) * c.duration
    times[k] = t
    const P = c.pose(loop ? t % c.duration : t, c.duration)
    BONES.forEach(([b], i) => {
      q.setFromEuler(e.set(...(P[b]?.r || [0, 0, 0]), 'YXZ')).toArray(rot[i], k * 4)
    })
    const hp = P.hips?.p || [0, 0, 0]
    hipsT.set([BONES[0][2][0] + hp[0], BONES[0][2][1] + hp[1], BONES[0][2][2] + hp[2]], k * 3)
  }
  const input = acc(times, 'SCALAR', 1, { minmax: { min: [0], max: [c.duration] } })
  const samplers = []
  const channels = []
  BONES.forEach(([b], i) => {
    samplers.push({ input, output: acc(rot[i], 'VEC4', 4), interpolation: 'LINEAR' })
    channels.push({ sampler: samplers.length - 1, target: { node: jointNode[b], path: 'rotation' } })
  })
  samplers.push({ input, output: acc(hipsT, 'VEC3', 3), interpolation: 'LINEAR' })
  channels.push({ sampler: samplers.length - 1, target: { node: jointNode.hips, path: 'translation' } })
  animations.push({ name, samplers, channels })
}

const json = {
  asset: { version: '2.0', generator: 'sky-dive build_player.mjs' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes,
  meshes,
  skins: [skin],
  animations,
  materials: [{ name: 'plush', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.95 } }],
  accessors,
  bufferViews,
}
const bin = Buffer.concat(chunks)
json.buffers = [{ byteLength: bin.length }]
let js = Buffer.from(JSON.stringify(json))
js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)])
const hdr = Buffer.alloc(12)
hdr.writeUInt32LE(0x46546c67, 0)
hdr.writeUInt32LE(2, 4)
hdr.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8)
const ch = (len, type) => {
  const b = Buffer.alloc(8)
  b.writeUInt32LE(len, 0)
  b.writeUInt32LE(type, 4)
  return b
}
const raw = path.join(out, 'player.raw.glb')
fs.writeFileSync(raw, Buffer.concat([hdr, ch(js.length, 0x4e4f534a), js, ch(bin.length, 0x004e4942), bin]))
const glb = path.join(out, 'player.glb')
execFileSync('node', [path.join(here, 'node_modules/gltfpack/cli.js'), '-i', raw, '-o', glb, '-cc', '-kn', '-km', '-kv', '-vp', '14'], { stdio: 'inherit' })
const rawSize = fs.statSync(raw).size
fs.unlinkSync(raw)
console.error(`player.glb ${(rawSize / 1024) | 0} kB raw → ${(fs.statSync(glb).size / 1024) | 0} kB meshopt · ${stats.join(' · ')} · ${BONES.length} joints · ${animations.length} clips`)
