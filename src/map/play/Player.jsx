import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { buildCanopy, HIPS } from '../characters/player'
import { gltfLoader, loadKTX2 } from '../world/loaders'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { withAerial } from '../world/aerial'
import { blobShadow } from './Npcs'
import { avatarMaterial } from '../characters/plush'

/**
 * The player's avatar, driven by the drop state (third-person view):
 *   free fall → 'freefall' · canopy open → 'canopy' (+ the ram-air canopy)
 *   on foot   → 'landing' (after a canopy landing), 'idle' / 'walk' / 'run',
 *               photo poses ('cheer', 'victory', 'stand1', 'stand2'; s.photoPose)
 * Rigged glTF built from the Tripo + Mixamo source (tools/map-data/
 * build_avatar.mjs → public/models/characters/player.glb + KTX2 colour and
 * normal maps): 41 Mixamo bones, two meshes (near within 30 m of the camera,
 * far beyond) share one skeleton and one AnimationMixer. Full-face helmet,
 * so no facial expressions. Hidden in the first-person view.
 */
const NEAR = 30
const BASE = import.meta.env.BASE_URL || '/'
const URL = `${BASE}models/characters/player.glb`
const ONCE = new Set(['landing'])

function setMap(m, key, t) {
  t.flipY = false
  t.anisotropy = 4
  m[key] = t
  m.needsUpdate = true
}

export default function Player({ state }) {
  const { camera, gl } = useThree()
  const group = useRef()
  const [avatar, setAvatar] = useState(null)
  const res = useMemo(() => {
    const material = avatarMaterial()
    // canopy (mesh + suspension lines), attached at the hips
    const c = buildCanopy(0)
    const canopyMat = withAerial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide }))
    const canopy = new THREE.Mesh(mergeGeometries(c.parts), canopyMat)
    c.parts.forEach((p) => p.dispose())
    canopy.castShadow = true
    const lg = new THREE.BufferGeometry()
    lg.setAttribute('position', new THREE.BufferAttribute(c.line, 3))
    const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: '#2a2a2a', transparent: true, opacity: 0.55 }))
    const rig = new THREE.Group()
    rig.add(canopy, lines)
    rig.position.y = HIPS
    rig.visible = false
    const shadow = blobShadow(1)
    return { material, canopyMat, rig, shadow, current: null, last: new THREE.Vector3(), speed: 0 }
  }, [])

  useEffect(() => {
    let live = true
    loadKTX2(gl, `${BASE}models/characters/player_color.ktx2`).then((t) => {
      t.colorSpace = THREE.SRGBColorSpace
      if (live) setMap(res.material, 'map', t)
    })
    loadKTX2(gl, `${BASE}models/characters/player_normal.ktx2`).then((t) => {
      t.colorSpace = THREE.NoColorSpace
      if (live) setMap(res.material, 'normalMap', t)
    })
    gltfLoader(gl).load(URL, (g) => {
      if (!live) return
      const meshes = []
      g.scene.traverse((o) => {
        if (!o.isSkinnedMesh) return
        o.material = res.material
        o.castShadow = true
        o.frustumCulled = false
        meshes.push(o)
      })
      // the level is in the name of a node above the mesh (three names the meshes mesh_0, mesh_1)
      const levelOf = (o) => {
        for (let n = o; n; n = n.parent) {
          const m = /_lod(\d)/.exec(n.name || '')
          if (m) return +m[1]
        }
        return -1
      }
      const lod = (k) => meshes.find((m) => levelOf(m) === k)
      const mixer = new THREE.AnimationMixer(g.scene)
      const actions = {}
      for (const clip of g.animations) {
        const a = mixer.clipAction(clip)
        if (ONCE.has(clip.name)) {
          a.setLoop(THREE.LoopOnce)
          a.clampWhenFinished = true
        }
        actions[clip.name] = a
      }
      setAvatar({ scene: g.scene, near: lod(0), far: lod(1), meshes, mixer, actions })
    })
    return () => {
      live = false
    }
  }, [gl, res])

  useEffect(
    () => () => {
      res.material.map?.dispose()
      res.material.normalMap?.dispose()
      res.material.dispose()
      res.canopyMat.dispose()
      res.rig.children.forEach((o) => o.geometry.dispose())
      res.shadow.geometry.dispose()
      res.shadow.material.map?.dispose()
      res.shadow.material.dispose()
    },
    [res],
  )
  useEffect(
    () => () => {
      if (!avatar) return
      avatar.mixer.stopAllAction()
      avatar.scene.traverse((o) => {
        if (o.isSkinnedMesh) {
          o.geometry.dispose()
          o.skeleton.dispose()
        }
      })
    },
    [avatar],
  )

  const play = (name) => {
    if (!avatar || res.current === name) return
    const next = avatar.actions[name]
    const prev = res.current && avatar.actions[res.current]
    next.reset().play()
    if (prev) prev.crossFadeTo(next, name === 'landing' ? 0.12 : 0.3, false)
    res.current = name
  }

  useFrame((_, dt) => {
    const g = group.current
    if (!g) return
    const s = state
    const first = s.view === 'first'
    g.visible = !first
    // position: hips at the body centre in the air, feet on the surface on foot
    const onFoot = !!s.walk
    const feet = onFoot ? s.walk.feet : s.y - HIPS
    g.position.set(s.x, feet, s.z)
    const moved = Math.hypot(s.x - res.last.x, s.z - res.last.z)
    res.speed = THREE.MathUtils.lerp(res.speed, dt > 0 ? moved / dt : 0, 0.2)
    if (onFoot && moved > 1e-4) s.face = Math.atan2(s.x - res.last.x, s.z - res.last.z)
    res.last.set(s.x, 0, s.z)
    // facing: heading in the air, walking direction on foot (model faces +z)
    const face = onFoot ? (s.face ?? s.yaw + Math.PI) : s.yaw + Math.PI
    g.rotation.set(0, face, 0)
    // animation state
    let anim = 'freefall'
    if (s.canopy && !s.ended) anim = 'canopy'
    if (onFoot) {
      if (s.photoT > 0 || s.photoPose) anim = s.photoPose || 'cheer'
      else if (s.soft && s.walk.t < 1.1) anim = 'landing'
      else anim = res.speed > 2.4 ? 'run' : res.speed > 0.3 ? 'walk' : 'idle'
    }
    if (avatar) {
      play(anim)
      // the clips' own speeds: walk ≈ 1.5 m/s, run ≈ 3.8 m/s
      avatar.actions.walk.timeScale = anim === 'walk' ? THREE.MathUtils.clamp(res.speed / 1.5, 0.7, 1.6) : 1
      avatar.actions.run.timeScale = anim === 'run' ? THREE.MathUtils.clamp(res.speed / 3.8, 0.7, 1.4) : 1
      // level of detail by camera distance (one skeleton, one mixer)
      const d = camera.position.distanceTo(g.position)
      avatar.near.visible = d < NEAR
      avatar.far.visible = d >= NEAR
      avatar.mixer.update(dt)
    }
    // contact shadow on foot (world space: the group is not its parent)
    res.shadow.visible = onFoot && !first
    if (onFoot) {
      res.shadow.setMatrixAt(0, new THREE.Matrix4().compose(new THREE.Vector3(s.x, feet + 0.07, s.z), new THREE.Quaternion(), new THREE.Vector3(0.75, 1, 0.75)))
      res.shadow.instanceMatrix.needsUpdate = true
    }
    // canopy: unfolds over the opening time, stays over the landing
    const open = s.canopy ? Math.min(1, s.canopyT ?? 1) : 0
    res.rig.visible = open > 0 && !(onFoot && s.walk.t > 1.5)
    res.rig.scale.set(0.2 + 0.8 * open, 0.3 + 0.7 * open, 0.2 + 0.8 * open)
    if (onFoot) res.rig.rotation.x = Math.min(1.4, s.walk.t * 1.2) // collapses behind
    else res.rig.rotation.x = 0
  })

  return (
    <>
      <primitive object={res.shadow} />
      <group ref={group}>
        {avatar && <primitive object={avatar.scene} />}
        <primitive object={res.rig} />
      </group>
    </>
  )
}
