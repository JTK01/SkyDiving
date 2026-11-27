/**
 * Player avatar from the Tripo + Mixamo source files (docs/reference/assets/avatar_src/*.fbx)
 *   → public/models/characters/player.glb        skinned mesh, 2 LODs on one skeleton, clips
 *   → public/models/characters/player_color.ktx2 base colour (2048², ETC1S)
 *   → public/models/characters/player_normal.ktx2 tangent-space normal map (512², UASTC)
 *
 * - mesh + skeleton (41 Mixamo bones) from Idle.fbx; every FBX carries the same rig, so its
 *   clip is used as is: idle, walk, run, freefall, landing, victory, stand1, stand2
 * - canopy (hands up on the toggles) is derived from the standing pose; photo poses
 *   with an NPC: fighting (화이팅, the victory clip held still at its peak), hug, jump
 * - root motion removed from the walk / run cycles (the game moves the body)
 * - scaled to 1.75 m; LOD0 ≈ 20 k, LOD1 ≈ 4.5 k triangles (meshoptimizer, UV seams kept)
 * - UV v flipped to the glTF convention (KTX2 textures are not flipped at load);
 *   float UVs (-vtf): quantized ones would need the glTF material's texture transform
 * usage: node build_avatar.mjs   (needs python3 + Pillow for the texture resize)
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// FBXLoader asks for an <img> for the embedded textures: not needed here (textures are
// extracted from the FBX separately), so a stub keeps it from failing in Node
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, style: {} }) }
globalThis.window = globalThis
globalThis.FileReader = class {
  readAsArrayBuffer(b) {
    b.arrayBuffer().then((r) => {
      this.result = r
      this.onloadend?.()
    })
  }
  readAsDataURL(b) {
    b.arrayBuffer().then((r) => {
      this.result = 'data:application/octet-stream;base64,' + Buffer.from(r).toString('base64')
      this.onloadend?.()
    })
  }
}
const THREE = await import('three')
const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js')
const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js')
const { mergeVertices } = await import('three/examples/jsm/utils/BufferGeometryUtils.js')
const { MeshoptSimplifier } = await import('meshoptimizer')

const here = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(here, '../../docs/reference/assets/avatar_src')
const OUT = path.resolve(here, '../../public/models/characters')
const TMP = path.resolve(here, '.tmp_avatar')
fs.mkdirSync(TMP, { recursive: true })
const HEIGHT = 1.75 // m

const read = (n) => {
  const b = fs.readFileSync(path.join(SRC, n + '.fbx'))
  return new FBXLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.length), '')
}

// ---- rig + mesh --------------------------------------------------------------
const root = read('Idle')
let body
root.traverse((o) => {
  if (o.isSkinnedMesh) body = o
})
root.updateMatrixWorld(true)
const box = new THREE.Box3().setFromObject(root, true)
const scale = HEIGHT / (box.max.y - box.min.y)

// ---- clips -------------------------------------------------------------------
const SOURCES = { idle: 'Idle', walk: 'Walking', run: 'Running', freefall: 'Falling', landing: 'Landing', victory: 'Victory Pose', stand1: 'Male Standing Pose', stand2: 'Male Standing Pose (1)' }
const clips = {}
for (const [name, file] of Object.entries(SOURCES)) {
  const c = (name === 'idle' ? root : read(file)).animations[0].clone()
  c.name = name
  // the scale tracks of an FBX clip are all 1
  c.tracks = c.tracks.filter((t) => !t.name.endsWith('.scale'))
  if (name === 'walk' || name === 'run') {
    const hp = c.tracks.find((t) => t.name === 'mixamorigHips.position')
    const v = hp.values
    const n = v.length / 3
    // remove the forward drift (z) and the sideways sway's mean (x)
    const x0 = v[0]
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1)
      v[i * 3 + 2] -= v[2] + (v[(n - 1) * 3 + 2] - v[2]) * t
      v[i * 3] -= x0
    }
  }
  clips[name] = c
}

/**
 * canopy: the standing pose with both hands up on the steering toggles. The upper
 * arm and forearm of each side are turned (in world space, on the posed skeleton) to
 * point up and a little outward / forward, then written back as local rotations.
 */
{
  const c = clips.stand1.clone()
  c.name = 'canopy'
  const mixer = new THREE.AnimationMixer(root)
  mixer.clipAction(clips.stand1).play()
  mixer.setTime(0)
  root.updateMatrixWorld(true)
  const aim = (boneName, childName, dir) => {
    const bone = root.getObjectByName(boneName)
    const child = root.getObjectByName(childName)
    root.updateMatrixWorld(true)
    const a = bone.getWorldPosition(new THREE.Vector3())
    const b = child.getWorldPosition(new THREE.Vector3())
    const cur = b.sub(a).normalize()
    const delta = new THREE.Quaternion().setFromUnitVectors(cur, dir.clone().normalize())
    const pq = bone.parent.getWorldQuaternion(new THREE.Quaternion())
    // local' = P⁻¹ · Δ · P · local
    bone.quaternion.premultiply(pq.clone().invert().multiply(delta).multiply(pq))
    const t = c.tracks.find((k) => k.name === `${boneName}.quaternion`)
    for (let i = 0; i < t.values.length; i += 4) bone.quaternion.toArray(t.values, i)
  }
  for (const [side, s] of [['Left', 1], ['Right', -1]]) {
    // the model faces +z, its left is +x
    aim(`mixamorig${side}Arm`, `mixamorig${side}ForeArm`, new THREE.Vector3(0.38 * s, 0.9, 0.12))
    aim(`mixamorig${side}ForeArm`, `mixamorig${side}Hand`, new THREE.Vector3(0.12 * s, 0.95, 0.25))
  }
  mixer.stopAllAction()
  mixer.uncacheRoot(root)
  clips.canopy = c
}

/**
 * photo poses with an NPC (the NPC, 60–80 % of the player's height, stands at the
 * player's left, +x): hug: left arm over the partner's shoulders / head
 */
function posed(name, aims) {
  const c = clips.stand1.clone()
  c.name = name
  const mixer = new THREE.AnimationMixer(root)
  mixer.clipAction(clips.stand1).play()
  mixer.setTime(0)
  root.updateMatrixWorld(true)
  for (const [boneName, childName, dir] of aims) {
    const bone = root.getObjectByName(boneName)
    const child = root.getObjectByName(childName)
    root.updateMatrixWorld(true)
    const cur = child.getWorldPosition(new THREE.Vector3()).sub(bone.getWorldPosition(new THREE.Vector3())).normalize()
    const delta = new THREE.Quaternion().setFromUnitVectors(cur, new THREE.Vector3(...dir).normalize())
    const pq = bone.parent.getWorldQuaternion(new THREE.Quaternion())
    bone.quaternion.premultiply(pq.clone().invert().multiply(delta).multiply(pq))
    const t = c.tracks.find((k) => k.name === `${boneName}.quaternion`)
    for (let i = 0; i < t.values.length; i += 4) bone.quaternion.toArray(t.values, i)
  }
  mixer.stopAllAction()
  mixer.uncacheRoot(root)
  clips[name] = c
}
posed('hug', [
  ['mixamorigLeftArm', 'mixamorigLeftForeArm', [0.8, -0.5, 0.08]],
  ['mixamorigLeftForeArm', 'mixamorigLeftHand', [0.5, -0.85, 0.12]],
])

/**
 * a still pose: one frame of a clip, as two identical keys. (Holding a pose with a
 * short loop of several frames — the earlier 'cheer' looped frames 15–17 of the
 * victory clip, where the fist is still pumping — makes the hand shake.)
 */
function hold(clip, frame, name) {
  const t = frame / 30
  const tracks = clip.tracks.map((tr) => {
    const v = tr.createInterpolant().evaluate(t).slice()
    return new tr.constructor(tr.name, [0, 1 / 30], [...v, ...v])
  })
  return new THREE.AnimationClip(name, 1 / 30, tracks)
}
// 화이팅: the victory clip at its peak (fist up); jump: the airborne first frame of the landing
clips.fighting = hold(clips.victory, 15, 'fighting')
clips.jump = hold(clips.landing, 0, 'jump')

// ---- LODs --------------------------------------------------------------------
function indexed(g) {
  const h = new THREE.BufferGeometry()
  for (const k of ['position', 'normal', 'uv', 'skinIndex', 'skinWeight']) h.setAttribute(k, g.attributes[k])
  return mergeVertices(h, 1e-5)
}
await MeshoptSimplifier.ready
function simplify(g, targetTris, error) {
  const idx = new Uint32Array(g.index.array)
  const pos = new Float32Array(g.attributes.position.array)
  const [out, err] = MeshoptSimplifier.simplify(idx, pos, 3, targetTris * 3, error, [])
  // compact the vertices still used
  const remap = new Int32Array(g.attributes.position.count).fill(-1)
  let n = 0
  for (const i of out) if (remap[i] < 0) remap[i] = n++
  const h = new THREE.BufferGeometry()
  for (const [k, a] of Object.entries(g.attributes)) {
    const arr = new a.array.constructor(n * a.itemSize)
    for (let v = 0; v < remap.length; v++) if (remap[v] >= 0) for (let c = 0; c < a.itemSize; c++) arr[remap[v] * a.itemSize + c] = a.array[v * a.itemSize + c]
    h.setAttribute(k, new THREE.BufferAttribute(arr, a.itemSize, a.normalized))
  }
  h.setIndex(new THREE.BufferAttribute(Uint32Array.from(out, (i) => remap[i]), 1))
  return { geo: h, err }
}
const full = indexed(body.geometry)
// glTF UV convention (v down; KTX2 textures are not flipped at load)
const uv = full.attributes.uv
for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i))
const lod0 = simplify(full, 20000, 0.004)
const lod1 = simplify(full, 4500, 0.02)
const tris = (g) => g.index.count / 3

const mat = new THREE.MeshStandardMaterial({ name: 'player', roughness: 0.75 })
body.geometry = lod0.geo
body.material = mat
body.name = 'player_lod0'
const far = new THREE.SkinnedMesh(lod1.geo, mat)
far.name = 'player_lod1'
body.parent.add(far)
far.position.copy(body.position)
far.quaternion.copy(body.quaternion)
far.scale.copy(body.scale)
far.bind(body.skeleton, body.bindMatrix)
root.name = 'player'
root.scale.setScalar(scale)
root.updateMatrixWorld(true)
// hips height of the standing rest (m) and of the free-fall pose, for the game
const hipsY = (clip) => clip.tracks.find((t) => t.name === 'mixamorigHips.position').values[1] * scale

const anims = Object.values(clips)
const glb = await new Promise((res, rej) => new GLTFExporter().parse(root, res, rej, { binary: true, animations: anims, onlyVisible: false }))
const raw = path.join(TMP, 'player_raw.glb')
fs.writeFileSync(raw, Buffer.from(glb))
const gltfpack = path.resolve(here, 'node_modules/gltfpack/cli.js')
const dst = path.join(OUT, 'player.glb')
execFileSync('node', [gltfpack, '-i', raw, '-o', dst, '-cc', '-kn', '-km', '-kv', '-vp', '14', '-vtf', '-af', '30'], { stdio: 'inherit' })

// ---- textures ----------------------------------------------------------------
const fbx = fs.readFileSync(path.join(SRC, 'Idle.fbx'))
const pngs = {}
for (let i = fbx.indexOf(Buffer.from('\x89PNG\r\n\x1a\n', 'latin1')); i >= 0; i = fbx.indexOf(Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), i + 8)) {
  const end = fbx.indexOf(Buffer.from('IEND'), i) + 8
  const name = fbx.subarray(Math.max(0, i - 400), i).toString('latin1')
  const kind = /BaseColor/.test(name.slice(name.lastIndexOf('.png') - 40)) ? 'color' : /Normal/.test(name.slice(name.lastIndexOf('.png') - 40)) ? 'normal' : null
  if (kind && !pngs[kind]) pngs[kind] = fbx.subarray(i, end)
}
for (const [kind, size] of [['color', 2048], ['normal', 512]]) {
  const src = path.join(TMP, `${kind}_src.png`)
  const png = path.join(TMP, `${kind}.png`)
  fs.writeFileSync(src, pngs[kind])
  execFileSync('python3', ['-c', `from PIL import Image; Image.open(${JSON.stringify(src)}).convert('RGB').resize((${size},${size}), Image.LANCZOS).save(${JSON.stringify(png)})`])
  const args = kind === 'color' ? ['--q=220'] : ['--uastc', '--normal']
  execFileSync('node', [path.join(here, 'encode_ktx2.mjs'), ...args, `${png}:${path.join(OUT, `player_${kind}.ktx2`)}`], { stdio: 'inherit' })
}
fs.rmSync(TMP, { recursive: true, force: true })

console.log(
  JSON.stringify({
    scale: +scale.toFixed(5),
    tris: { lod0: tris(lod0.geo), lod1: tris(lod1.geo), source: body.geometry && 50000 },
    error: [lod0.err, lod1.err].map((e) => +e.toFixed(4)),
    hips: { stand: +hipsY(clips.idle).toFixed(3), freefall: +hipsY(clips.freefall).toFixed(3) },
    clips: anims.map((c) => [c.name, +c.duration.toFixed(2)]),
    bytes: ['player.glb', 'player_color.ktx2', 'player_normal.ktx2'].map((f) => [f, fs.statSync(path.join(OUT, f)).size]),
  }),
)
