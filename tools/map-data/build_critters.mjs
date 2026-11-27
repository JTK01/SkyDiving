/**
 * Critter NPC bodies → public/models/characters/critters.bin
 *   for every species (src/map/characters/critters.js) two levels of detail
 *   (≈ 4.2 k / 1.1 k triangles + props) built by critterMesh.mjs.
 * File: 'CRIT' · u32 header length · JSON header · meshopt-encoded buffers.
 *   header.species[id] = { height, pivots, head, lods: [{ vertices, indices,
 *   vb: [offset, length], ib: [offset, length] }], garments: { outfit: [lod0, lod1] } },
 *   header.posScale
 * Vertex (24 bytes): i16×3 position (× posScale m) · i8×3 normal · u8 colour code ·
 *   u8 bone a, bone b, weight a (/255), zone · u8×3 fixed colour · u8 prop ·
 *   i8 face x, face y (/100), face flag (127) · u8 fur (255) / cloth (128) flag · 2 pad.
 * usage: node build_critters.mjs [speciesId …]   (all by default)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MeshoptEncoder } from 'meshoptimizer'
import { SPECIES, TOP, PLAYER_H } from '../../src/map/characters/critters.js'
import { buildSpecies } from './critterMesh.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(here, '../../public/models/characters/critters.bin')
const POS_SCALE = 2.5 / 32767
await MeshoptEncoder.ready

const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SPECIES)
const header = { posScale: POS_SCALE, species: {} }
const blobs = []
let offset = 0
const put = (u8) => {
  const pad = (4 - (u8.length % 4)) % 4
  blobs.push(Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength), Buffer.alloc(pad))
  const r = [offset, u8.length]
  offset += u8.length + pad
  return r
}
const stats = []
for (const id of ids) {
  const S = SPECIES[id]
  const t0 = Date.now()
  const B = await buildSpecies(S)
  const height = S.size * PLAYER_H
  const k = height / TOP
  const sc = (v) => v.map((x) => +(x * k).toFixed(4))
  const entry = { height: +height.toFixed(3), scale: +k.toFixed(5), pivots: Object.fromEntries(Object.entries(B.pivots).map(([n, v]) => [n, sc(v)])), head: { c: sc(B.head.c), r: sc(B.head.r) }, lods: [] }
  const encode = (L) => {
    const n = L.positions.length / 3
    const vb = new ArrayBuffer(n * 24)
    const dv = new DataView(vb)
    for (let v = 0; v < n; v++) {
      const o = v * 24
      for (let c = 0; c < 3; c++) dv.setInt16(o + c * 2, Math.round((L.positions[v * 3 + c] * k) / POS_SCALE), true)
      for (let c = 0; c < 3; c++) dv.setInt8(o + 6 + c, Math.round(L.normals[v * 3 + c] * 127))
      dv.setUint8(o + 9, L.code[v * 4])
      for (let c = 0; c < 4; c++) dv.setUint8(o + 10 + c, L.bone[v * 4 + c])
      for (let c = 0; c < 3; c++) dv.setUint8(o + 14 + c, L.color[v * 4 + c])
      dv.setUint8(o + 17, L.code[v * 4 + 1])
      for (let c = 0; c < 3; c++) dv.setInt8(o + 18 + c, L.face[v * 4 + c])
      dv.setUint8(o + 21, L.code[v * 4 + 2])
    }
    const idx = Uint16Array.from(L.index)
    const evb = MeshoptEncoder.encodeVertexBuffer(new Uint8Array(vb), n, 24)
    const eib = MeshoptEncoder.encodeIndexBuffer(new Uint8Array(idx.buffer), idx.length, 2)
    return { vertices: n, indices: idx.length, vb: put(evb), ib: put(eib) }
  }
  for (const L of B.lods) entry.lods.push(encode(L))
  entry.garments = Object.fromEntries(Object.entries(B.garments).map(([k, lods]) => [k, lods.map(encode)]))
  header.species[id] = entry
  stats.push([id, entry.lods.map((l) => l.indices / 3), Object.fromEntries(Object.entries(entry.garments).map(([k, g]) => [k, g.map((l) => l.indices / 3)])), ((Date.now() - t0) / 1000).toFixed(1) + 's'])
  console.log(JSON.stringify(stats.at(-1)))
}
const json = Buffer.from(JSON.stringify(header))
const head = Buffer.alloc(8)
head.write('CRIT', 0)
head.writeUInt32LE(json.length, 4)
const jpad = Buffer.alloc((4 - (json.length % 4)) % 4, 32)
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, Buffer.concat([head, json, jpad, ...blobs]))
console.log('critters.bin', (fs.statSync(OUT).size / 1024).toFixed(0), 'kB')
