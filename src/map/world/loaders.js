import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

/**
 * Shared loaders for compressed map assets:
 *  - KTX2 / Basis Universal textures, transcoded in a worker to the GPU's
 *    native format (BC on desktop, ETC/ASTC on mobile) — 4–8× less GPU
 *    memory than RGBA. Transcoder in public/vendor/basis/.
 *  - glTF with EXT_meshopt_compression (meshopt decoder, WebAssembly).
 * One KTX2Loader per page (three.js warns about several worker pools).
 */
const BASE = import.meta.env.BASE_URL || '/'
let ktx2 = null
let ktx2Renderer = null
export function ktx2Loader(renderer) {
  if (!ktx2) ktx2 = new KTX2Loader().setTranscoderPath(`${BASE}vendor/basis/`).setWorkerLimit(2)
  if (ktx2Renderer !== renderer) {
    ktx2.detectSupport(renderer)
    ktx2Renderer = renderer
  }
  return ktx2
}

/** ArrayBuffer (KTX2) → CompressedTexture */
export function parseKTX2(renderer, buffer) {
  return new Promise((resolve, reject) => ktx2Loader(renderer).parse(buffer.slice(0), resolve, reject))
}

export function loadKTX2(renderer, url) {
  return ktx2Loader(renderer).loadAsync(url)
}

let gltf = null
export function gltfLoader(renderer) {
  if (!gltf) gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  gltf.setKTX2Loader(ktx2Loader(renderer))
  return gltf
}
