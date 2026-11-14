/**
 * Basilica model → public/models/sagrada-familia/
 *   basilica.glb     meshopt-compressed (EXT_meshopt_compression) via gltfpack
 *   colliders.json   simplified collision shapes (model space, metres)
 * usage: node build_basilica.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildBasilica } from '../../src/map/world/basilicaGeometry.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.resolve(here, '../../public/models/sagrada-familia')
fs.mkdirSync(out, { recursive: true })

// two levels of detail: lod 0 near (all ornament), lod 1 far (main masses)
const LODS = [buildBasilica({ lod: 0 }), buildBasilica({ lod: 1 })]
const { colliders } = LODS[0]

// --- minimal glTF 2.0 binary writer -------------------------------------
const chunks = []
let offset = 0
const bufferViews = []
const accessors = []
function addAccessor(array, type, comps, { min, max, target = 34962 } = {}) {
  const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength)
  const pad = (4 - (bytes.length % 4)) % 4
  chunks.push(bytes, Buffer.alloc(pad))
  bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target })
  offset += bytes.length + pad
  const acc = { bufferView: bufferViews.length - 1, componentType: array instanceof Uint32Array ? 5125 : 5126, count: array.length / comps, type }
  if (min) Object.assign(acc, { min, max })
  accessors.push(acc)
  return accessors.length - 1
}
function primitive(g, tower) {
  const pos = g.attributes.position.array
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k], pos[i + k])
    max[k] = Math.max(max[k], pos[i + k])
  }
  const attributes = {
    POSITION: addAccessor(pos, 'VEC3', 3, { min, max }),
    // no NORMAL: every material shades flat (normals from screen-space
    // derivatives), so triangles share vertices and the file stays small
    COLOR_0: addAccessor(g.attributes.color.array, 'VEC3', 3),
  }
  if (tower) {
    // tower louvre data in texcoords: uv = (angle, rel. height), uv1 = (slit, 0)
    const t = g.attributes.aTower.array
    const n = t.length / 3
    const uv0 = new Float32Array(n * 2)
    const uv1 = new Float32Array(n * 2)
    for (let i = 0; i < n; i++) {
      uv0[i * 2] = t[i * 3]
      uv0[i * 2 + 1] = t[i * 3 + 1]
      uv1[i * 2] = t[i * 3 + 2]
    }
    attributes.TEXCOORD_0 = addAccessor(uv0, 'VEC2', 2)
    attributes.TEXCOORD_1 = addAccessor(uv1, 'VEC2', 2)
  }
  return { attributes, material: tower ? 0 : 1 }
}
const KINDS = ['stone', 'mosaic', 'glass']
const MATS = {
  stone: { name: 'stone', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.88 } },
  mosaic: { name: 'mosaic', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0.1, roughnessFactor: 0.3 } },
  glass: { name: 'glass', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0.2, roughnessFactor: 0.15 } },
}
const meshes = []
const nodes = []
LODS.forEach((L, lod) => {
  for (const kind of KINDS) {
    if (!L[kind]) continue
    const prim = primitive(L[kind], kind === 'stone')
    prim.material = KINDS.indexOf(kind)
    meshes.push({ name: `${kind}_lod${lod}`, primitives: [prim] })
    nodes.push({ name: `${kind}_lod${lod}`, mesh: meshes.length - 1 })
  }
})
const json = {
  asset: { version: '2.0', generator: 'sky-dive build_basilica.mjs' },
  scene: 0,
  scenes: [{ nodes: nodes.map((_, k) => k) }],
  nodes,
  materials: KINDS.map((k) => MATS[k]),
  meshes,
}
json.accessors = accessors
json.bufferViews = bufferViews
const bin = Buffer.concat(chunks)
json.buffers = [{ byteLength: bin.length }]
let js = Buffer.from(JSON.stringify(json))
js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)])
const header = Buffer.alloc(12)
header.writeUInt32LE(0x46546c67, 0)
header.writeUInt32LE(2, 4)
header.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8)
const ch = (len, type) => {
  const b = Buffer.alloc(8)
  b.writeUInt32LE(len, 0)
  b.writeUInt32LE(type, 4)
  return b
}
const raw = path.join(out, 'basilica.raw.glb')
fs.writeFileSync(raw, Buffer.concat([header, ch(js.length, 0x4e4f534a), js, ch(bin.length, 0x004e4942), bin]))

// --- meshopt compression (vertex dedup, reorder, quantise, EXT_meshopt) --
const glb = path.join(out, 'basilica.glb')
// 16-bit texcoords: values stay in 0..1 (no KHR_texture_transform needed — there is no texture)
execFileSync('node', [path.join(here, 'node_modules/gltfpack/cli.js'), '-i', raw, '-o', glb, '-cc', '-kv', '-km', '-kn', '-vp', '14', '-vt', '16'], { stdio: 'inherit' })
const rawSize = fs.statSync(raw).size
fs.unlinkSync(raw)

// --- colliders (rounded) -------------------------------------------------
const r = (v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v)
const cols = colliders.map((c) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, r(v)])))
fs.writeFileSync(path.join(out, 'colliders.json'), JSON.stringify({ version: 1, space: 'model (metres, y up from the ground)', colliders: cols }))
console.error(`basilica.glb ${(rawSize / 1024) | 0} kB raw → ${(fs.statSync(glb).size / 1024) | 0} kB meshopt; ${cols.length} colliders (${(fs.statSync(path.join(out, 'colliders.json')).size / 1024) | 0} kB)`)
