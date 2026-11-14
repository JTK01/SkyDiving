/**
 * Trees → public/models/trees/trees.glb (meshopt) + public/textures/tree_impostors.ktx2
 *
 *   glb:  per species (plane, celtis, pine, cypress) two levels, meshes named
 *         "<species>_lod0" (near, ≈ 0.6–1.5 k triangles) and "<species>_lod1"
 *         (mid, ≈ 140–210 triangles). Attributes: POSITION, NORMAL,
 *         TEXCOORD_0 (card / bark uv), TEXCOORD_1 (atlas column, row).
 *   impostors: each species' near model rendered from 8 × 8 directions over
 *         the upper hemisphere (hemi-octahedral layout, 128 px cells) into a
 *         2048² atlas (one 1024² quadrant per species), lit by a sky/ground
 *         hemisphere so the cards do not depend on the instance's rotation.
 *
 * usage: node build_trees.mjs <trees.png from build_tree_textures.py>
 * needs: the preinstalled Playwright + Chromium (offline bake only).
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildTree, SPECIES_NAMES } from '../../src/map/world/treeGeometry.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const atlasPng = process.argv[2]
if (!atlasPng) throw new Error('usage: node build_trees.mjs <trees.png>')
const outModels = path.join(root, 'public/models/trees')
fs.mkdirSync(outModels, { recursive: true })

// ------------------------------------------------------------------ glb
const trees = {}
for (const s of SPECIES_NAMES) trees[s] = [buildTree(s, 0, 7), buildTree(s, 1, 7)]

const chunks = []
let offset = 0
const bufferViews = []
const accessors = []
function acc(array, type, comps, target, minmax) {
  const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength)
  const pad = (4 - (bytes.length % 4)) % 4
  chunks.push(bytes, Buffer.alloc(pad))
  bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target })
  offset += bytes.length + pad
  const a = { bufferView: bufferViews.length - 1, componentType: array instanceof Uint32Array ? 5125 : 5126, count: array.length / comps, type }
  if (minmax) Object.assign(a, minmax)
  accessors.push(a)
  return accessors.length - 1
}
const meshes = []
const nodes = []
for (const s of SPECIES_NAMES)
  trees[s].forEach((g, lod) => {
    const pos = g.attributes.position.array
    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < pos.length; i += 3)
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], pos[i + k])
        max[k] = Math.max(max[k], pos[i + k])
      }
    const prim = {
      attributes: {
        POSITION: acc(pos, 'VEC3', 3, 34962, { min, max }),
        NORMAL: acc(g.attributes.normal.array, 'VEC3', 3, 34962),
        TEXCOORD_0: acc(g.attributes.uv.array, 'VEC2', 2, 34962),
        TEXCOORD_1: acc(g.attributes.uv1.array, 'VEC2', 2, 34962),
      },
      indices: acc(new Uint32Array(g.index.array), 'SCALAR', 1, 34963),
      material: 0,
    }
    meshes.push({ name: `${s}_lod${lod}`, primitives: [prim] })
    nodes.push({ name: `${s}_lod${lod}`, mesh: meshes.length - 1 })
  })
const json = {
  asset: { version: '2.0', generator: 'sky-dive build_trees.mjs' },
  scene: 0,
  scenes: [{ nodes: nodes.map((_, k) => k) }],
  nodes,
  meshes,
  materials: [{ name: 'tree', alphaMode: 'MASK', alphaCutoff: 0.5, doubleSided: true, pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 0.9 } }],
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
const raw = path.join(outModels, 'trees.raw.glb')
fs.writeFileSync(raw, Buffer.concat([hdr, ch(js.length, 0x4e4f534a), js, ch(bin.length, 0x004e4942), bin]))
const glb = path.join(outModels, 'trees.glb')
// keep the uv precision (bark tiles up to ~8× around the trunk)
execFileSync('node', [path.join(here, 'node_modules/gltfpack/cli.js'), '-i', raw, '-o', glb, '-cc', '-kn', '-km', '-kv', '-vp', '14', '-vt', '14', '-vn', '10', '-noq'], { stdio: 'inherit' })
fs.unlinkSync(raw)

// ------------------------------------------------------------- impostor bake
const require = createRequire(import.meta.url)
const { chromium } = require(require.resolve('playwright', { paths: [root, '/opt/node22/lib/node_modules', '/usr/lib/node_modules', '/usr/local/lib/node_modules'] }))
const three = fs.readFileSync(path.join(root, 'node_modules/three/build/three.module.js'), 'utf8')
const data = {}
for (const s of SPECIES_NAMES) {
  const g = trees[s][0]
  data[s] = { p: [...g.attributes.position.array], n: [...g.attributes.normal.array], uv: [...g.attributes.uv.array], uv1: [...g.attributes.uv1.array], idx: [...g.index.array], H: g.userData.H }
}
const atlasUrl = 'data:image/png;base64,' + fs.readFileSync(atlasPng).toString('base64')
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage()
await page.setContent('<canvas id="c" width="1024" height="1024"></canvas>')
await page.addScriptTag({ type: 'module', content: three.replace(/export \{[^}]*\};?\s*$/, '') + '\nwindow.THREE_READY = { WebGLRenderer, Scene, OrthographicCamera, BufferGeometry, Float32BufferAttribute, Mesh, MeshLambertMaterial, HemisphereLight, AmbientLight, TextureLoader, Vector3, DoubleSide, SRGBColorSpace, LinearMipmapLinearFilter, Color };' })
await page.waitForFunction(() => window.THREE_READY)
const N = 8
const out = await page.evaluate(
  async ({ data, atlasUrl, N }) => {
    const T = window.THREE_READY
    const canvas = document.getElementById('c')
    const renderer = new T.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true })
    renderer.setClearColor(0x000000, 0)
    renderer.outputColorSpace = T.SRGBColorSpace
    const tex = await new T.TextureLoader().loadAsync(atlasUrl)
    tex.colorSpace = T.SRGBColorSpace
    tex.minFilter = T.LinearMipmapLinearFilter
    const mat = new T.MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: T.DoubleSide })
    // same atlas addressing as the runtime material (bark tiles inside its cell)
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 uv1;\nvarying vec2 vCell;\nvarying vec2 vUvT;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvCell = uv1;\nvUvT = uv;')
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vCell;\nvarying vec2 vUvT;')
        .replace(
          '#include <map_fragment>',
          `vec2 f = vCell.y > 0.5 ? fract(vUvT) : clamp(vUvT, 0.002, 0.998);
           vec2 auv = (vCell + vec2(f.x, f.y)) * vec2(0.25, 0.5);
           // flipY = false: v = 0 is the png's top row (foliage), as for KTX2 at runtime
           vec4 texel = textureGrad(map, auv, dFdx(vUvT) * vec2(0.25, 0.5), dFdy(vUvT) * vec2(0.25, 0.5));
           diffuseColor *= texel;`,
        )
    }
    tex.flipY = false
    const scene = new T.Scene()
    scene.add(new T.HemisphereLight(0xf2f5f8, 0x6a604e, 3.0))
    scene.add(new T.AmbientLight(0xffffff, 0.6))
    const res = {}
    for (const [name, d] of Object.entries(data)) {
      const g = new T.BufferGeometry()
      g.setAttribute('position', new T.Float32BufferAttribute(d.p, 3))
      g.setAttribute('normal', new T.Float32BufferAttribute(d.n, 3))
      g.setAttribute('uv', new T.Float32BufferAttribute(d.uv, 2))
      g.setAttribute('uv1', new T.Float32BufferAttribute(d.uv1, 2))
      g.setIndex(d.idx)
      g.computeBoundingSphere()
      const bs = g.boundingSphere
      const mesh = new T.Mesh(g, mat)
      scene.add(mesh)
      const cam = new T.OrthographicCamera(-bs.radius, bs.radius, bs.radius, -bs.radius, 0.1, bs.radius * 4) // the runtime quad spans the same ±radius
      renderer.setScissorTest(true)
      renderer.setClearColor(0x000000, 0)
      renderer.clear()
      const cell = 1024 / N
      for (let j = 0; j < N; j++)
        for (let i = 0; i < N; i++) {
          const u = ((i + 0.5) / N) * 2 - 1
          const v = ((j + 0.5) / N) * 2 - 1
          const x = (u + v) / 2
          const z = (u - v) / 2
          const y = 1 - Math.abs(x) - Math.abs(z)
          const dir = new T.Vector3(x, Math.max(y, 0), z).normalize()
          cam.position.copy(bs.center).addScaledVector(dir, bs.radius * 2)
          cam.up.set(0, 1, 0)
          if (dir.y > 0.999) cam.up.set(0, 0, -1)
          cam.lookAt(bs.center)
          // row j from the bottom in GL; the png is read top-down, flipped below
          renderer.setViewport(i * cell, j * cell, cell, cell)
          renderer.setScissor(i * cell, j * cell, cell, cell)
          renderer.render(scene, cam)
        }
      scene.remove(mesh)
      res[name] = { url: canvas.toDataURL('image/png'), center: [bs.center.x, bs.center.y, bs.center.z], radius: bs.radius }
    }
    return res
  },
  { data, atlasUrl, N },
)
await browser.close()

// combine 4 species quadrants into one 2048² png and encode
const tmp = fs.mkdtempSync('/tmp/imp-')
const meta = { grid: N, species: {} }
const files = []
SPECIES_NAMES.forEach((s, k) => {
  const f = path.join(tmp, `${s}.png`)
  fs.writeFileSync(f, Buffer.from(out[s].url.split(',')[1], 'base64'))
  files.push(f)
  meta.species[s] = { quadrant: [k % 2, k >> 1], center: out[s].center.map((v) => +v.toFixed(3)), radius: +out[s].radius.toFixed(3) }
})
execFileSync('python3', ['-c', `
import sys
from PIL import Image
files = sys.argv[1:5]
A = Image.new('RGBA', (2048, 2048), (0, 0, 0, 0))
for k, f in enumerate(files):
    im = Image.open(f).convert('RGBA')
    A.paste(im, ((k % 2) * 1024, (k // 2) * 1024))
A.save(sys.argv[5])
`, ...files, path.join(tmp, 'impostors.png')])
execFileSync('node', [path.join(here, 'encode_ktx2.mjs'), '--q=200', `${path.join(tmp, 'impostors.png')}:${path.join(root, 'public/textures/tree_impostors.ktx2')}`], { stdio: 'inherit' })
fs.writeFileSync(path.join(outModels, 'impostors.json'), JSON.stringify(meta))
console.error(`trees.glb ${(fs.statSync(glb).size / 1024) | 0} kB · tree_impostors.ktx2 ${(fs.statSync(path.join(root, 'public/textures/tree_impostors.ktx2')).size / 1024) | 0} kB · ${tmp}`)
