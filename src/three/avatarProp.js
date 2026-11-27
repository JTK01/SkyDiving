import * as THREE from 'three'
import { gltfLoader, loadKTX2 } from '../map/world/loaders'

/**
 * The player's avatar for the main-world screen (after login): the same glTF and
 * textures as in a drop (public/models/characters/player.glb, player_color /
 * player_normal KTX2), near mesh only, playing the free-fall clip. Loaded through a
 * dynamic import of this module (a separate chunk with the glTF / KTX2 loaders),
 * so the first screen does not wait for it. Fades with the world reveal
 * (setOpacity).
 */
const BASE = import.meta.env.BASE_URL || '/'

export async function loadAvatarProp(gl) {
  const [g, color, normal] = await Promise.all([
    gltfLoader(gl).loadAsync(`${BASE}models/characters/player.glb`),
    loadKTX2(gl, `${BASE}models/characters/player_color.ktx2`),
    loadKTX2(gl, `${BASE}models/characters/player_normal.ktx2`),
  ])
  color.colorSpace = THREE.SRGBColorSpace
  normal.colorSpace = THREE.NoColorSpace
  for (const t of [color, normal]) {
    t.flipY = false
    t.anisotropy = 4
  }
  const material = new THREE.MeshStandardMaterial({ map: color, normalMap: normal, roughness: 0.72, metalness: 0, transparent: true, opacity: 0 })
  const drop = []
  g.scene.traverse((o) => {
    if (!o.isSkinnedMesh) return
    // keep the near level (the node above the mesh is named …_lod0)
    let n = o
    while (n && !/_lod\d/.test(n.name || '')) n = n.parent
    if (n && /_lod0/.test(n.name)) {
      o.material = material
      o.frustumCulled = false
    } else drop.push(o)
  })
  drop.forEach((o) => {
    o.parent.remove(o)
    o.geometry.dispose()
  })
  const mixer = new THREE.AnimationMixer(g.scene)
  const clip = g.animations.find((c) => c.name === 'freefall')
  if (clip) mixer.clipAction(clip).play()
  return {
    scene: g.scene,
    mixer,
    setOpacity(r) {
      material.opacity = r
      material.transparent = r < 0.999
      material.depthWrite = r > 0.5
    },
    dispose() {
      mixer.stopAllAction()
      g.scene.traverse((o) => o.isSkinnedMesh && o.geometry.dispose())
      material.dispose()
      color.dispose()
      normal.dispose()
    },
  }
}
