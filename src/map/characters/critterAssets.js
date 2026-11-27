import * as THREE from 'three'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { SPECIES, variant } from './critters'
import { TEXELS, T, critterData } from './critterMaterial'

/**
 * critters.bin (tools/map-data/build_critters.mjs): fetched once, on the first
 * zone entry. Each species' two levels decode to 24-byte vertices (see the
 * builder) + uint16 indices; a zone's NPCs are merged into one geometry per
 * level with the NPC index in aCode.w.
 */
const URL = `${import.meta.env.BASE_URL || '/'}models/characters/critters.bin`
let pending = null

export function loadCritters() {
  if (pending) return pending
  pending = (async () => {
    const [buf] = await Promise.all([fetch(URL).then((r) => r.arrayBuffer()), MeshoptDecoder.ready])
    const dv = new DataView(buf)
    const hl = dv.getUint32(4, true)
    const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, hl)))
    const base = 8 + hl + ((4 - (hl % 4)) % 4)
    const out = { posScale: header.posScale, species: {} }
    const decode = (l) => {
      const vb = new Uint8Array(l.vertices * 24)
      MeshoptDecoder.decodeVertexBuffer(vb, l.vertices, 24, new Uint8Array(buf, base + l.vb[0], l.vb[1]))
      const ib = new Uint16Array(l.indices)
      MeshoptDecoder.decodeIndexBuffer(new Uint8Array(ib.buffer), l.indices, 2, new Uint8Array(buf, base + l.ib[0], l.ib[1]))
      return { n: l.vertices, vb, ib }
    }
    for (const [id, e] of Object.entries(header.species)) {
      out.species[id] = {
        ...e,
        lods: e.lods.map(decode),
        garments: Object.fromEntries(Object.entries(e.garments || {}).map(([k, g]) => [k, g.map(decode)])),
      }
    }
    return out
  })()
  pending.catch(() => (pending = null))
  return pending
}

/** merged geometry of the NPCs ([{ id, look: { outfit } }]) at one level: body + the outfit's clothes */
export function mergeCritters(assets, npcs, lod) {
  const parts = []
  const owner = []
  npcs.forEach((n, k) => {
    const A = assets.species[n.id]
    parts.push(A.lods[lod])
    owner.push(k)
    const g = A.garments?.[n.look.outfit]
    if (g) {
      parts.push(g[lod])
      owner.push(k)
    }
  })
  const nv = parts.reduce((s, p) => s + p.n, 0)
  const ni = parts.reduce((s, p) => s + p.ib.length, 0)
  const pos = new Float32Array(nv * 3)
  const nrm = new Int8Array(nv * 3)
  const bone = new Uint8Array(nv * 4)
  const code = new Uint8Array(nv * 4)
  const col = new Uint8Array(nv * 3)
  const face = new Int8Array(nv * 3)
  const index = new (nv > 65535 ? Uint32Array : Uint16Array)(ni)
  let vo = 0
  let io = 0
  const s = assets.posScale
  parts.forEach((p, k) => {
    const dv = new DataView(p.vb.buffer)
    const i8 = new Int8Array(p.vb.buffer)
    for (let v = 0; v < p.n; v++) {
      const o = v * 24
      const w = vo + v
      pos[w * 3] = dv.getInt16(o, true) * s
      pos[w * 3 + 1] = dv.getInt16(o + 2, true) * s
      pos[w * 3 + 2] = dv.getInt16(o + 4, true) * s
      nrm[w * 3] = i8[o + 6]
      nrm[w * 3 + 1] = i8[o + 7]
      nrm[w * 3 + 2] = i8[o + 8]
      bone[w * 4] = p.vb[o + 10]
      bone[w * 4 + 1] = p.vb[o + 11]
      bone[w * 4 + 2] = p.vb[o + 12]
      bone[w * 4 + 3] = p.vb[o + 13]
      code[w * 4] = p.vb[o + 9]
      code[w * 4 + 1] = p.vb[o + 17]
      code[w * 4 + 2] = p.vb[o + 21]
      code[w * 4 + 3] = owner[k]
      col[w * 3] = p.vb[o + 14]
      col[w * 3 + 1] = p.vb[o + 15]
      col[w * 3 + 2] = p.vb[o + 16]
      face[w * 3] = i8[o + 18]
      face[w * 3 + 1] = i8[o + 19]
      face[w * 3 + 2] = i8[o + 20]
    }
    for (let i = 0; i < p.ib.length; i++) index[io + i] = p.ib[i] + vo
    vo += p.n
    io += p.ib.length
  })
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3, true))
  g.setAttribute('aBone', new THREE.BufferAttribute(bone, 4))
  g.setAttribute('aCode', new THREE.BufferAttribute(code, 4))
  g.setAttribute('aCol', new THREE.BufferAttribute(col, 3, true))
  g.setAttribute('aFace', new THREE.BufferAttribute(face, 3, true))
  g.setIndex(new THREE.BufferAttribute(index, 1))
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6) // positions move in the shader
  return g
}

const lin = (hex) => new THREE.Color(hex) // linear (colour management on)
const MOUTH = { cat: 0, smile: 1, bunny: 2, beak: 3 }

/**
 * a zone's NPC set on the GPU: data texture rows (one per NPC) with the
 * static rows (colours, outfit, props, face layout, pivots) filled here;
 * the per-frame rows are written by write().
 */
export function critterRows(assets, npcs) {
  const tex = critterData(Math.max(1, npcs.length))
  const d = tex.image.data
  const put = (i, k, a, b, c, w) => d.set([a, b, c, w], (i * TEXELS + k) * 4)
  npcs.forEach((n, i) => {
    const S = SPECIES[n.id]
    const A = assets.species[n.id]
    const v = n.look
    const [m, l, k] = v.fur.map(lin)
    put(i, T.colA, m.r, m.g, m.b, v.jitter)
    put(i, T.colD, l.r, l.g, l.b, v.outfitCode)
    put(i, T.colE, k.r, k.g, k.b, v.mask)
    const top = lin(v.top)
    const bot = lin(v.bottom)
    put(i, T.colB, top.r, top.g, top.b, 0)
    put(i, T.colC, bot.r, bot.g, bot.b, n.seed)
    const F = S.face
    // mouth height: under the muzzle (face units of the head radius)
    const my = { cat: -0.48, bunny: -0.52, smile: S.muzzle === 'long' || S.muzzle === 'horse' || S.muzzle === 'cowMuzzle' || S.muzzle === 'sheep' || S.muzzle === 'deer' ? -0.72 : -0.55, beak: 0 }[F.mouth]
    put(i, T.layout, F.ex, F.ey, F.es, MOUTH[F.mouth])
    put(i, T.layout2, F.blush ?? 0.4, F.brows ?? 0, F.light ? 1 : 0, my)
    const P = A.pivots
    put(i, T.pHead, ...P.head, 0)
    put(i, T.pArm, ...P.armL, 0)
    put(i, T.pLeg, ...P.legL, 0)
    put(i, T.pTail, ...P.tail, 0)
    put(i, T.pEar, ...P.earL, 0)
    put(i, T.pBody, ...P.body, 0)
  })
  tex.needsUpdate = true
  return tex
}

/** per-frame rows of NPC i */
export function writeCritter(tex, i, n) {
  const d = tex.image.data
  const o = i * TEXELS * 4
  d[o + T.pos * 4] = n.x
  d[o + T.pos * 4 + 1] = n.y
  d[o + T.pos * 4 + 2] = n.z
  d[o + T.pos * 4 + 3] = n.heading
  d.set([n.phase, n.walk, n.wave, n.hop], o + T.motion * 4)
  d.set([n.blink, n.smile, n.headYaw, n.headPitch], o + T.face * 4)
  d[o + T.colB * 4 + 3] = n.lod
  const P = n.armPose || ZERO
  d.set(P, o + T.pose * 4)
  d[o + T.extra * 4] = n.talk || 0
}
const ZERO = [0, 0, 0, 0]

export { variant }
