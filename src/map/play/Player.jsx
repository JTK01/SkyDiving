import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { buildPlayer, buildCanopy, PLAYER_CLIPS, HIPS } from '../characters/player'
import { makeClip, skinnedMesh } from '../characters/builder'
import { plushMaterial } from '../characters/plush'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { withAerial } from '../world/aerial'

/**
 * The player's avatar, driven by the drop state (third-person view):
 *   free fall → 'freefall' · canopy open → 'canopy' (+ the ram-air canopy)
 *   on foot   → 'landing' (after a canopy landing), 'walk' / 'idle', 'photo'
 * Two levels: near (≈ 7 k triangles) within 30 m of the camera, far (≈ 1.4 k)
 * beyond. Hidden in the first-person view.
 */
const NEAR = 30

function avatar(lod, material) {
  const built = buildPlayer(lod)
  const mesh = skinnedMesh(built, material)
  mesh.castShadow = true
  mesh.frustumCulled = false
  const mixer = new THREE.AnimationMixer(mesh)
  const actions = {}
  for (const [name, c] of Object.entries(PLAYER_CLIPS)) {
    const clip = makeClip(name, built.bones, c.pose, c.duration, 30, c.loop !== false)
    const a = mixer.clipAction(clip)
    if (c.loop === false) {
      a.setLoop(THREE.LoopOnce)
      a.clampWhenFinished = true
    }
    actions[name] = a
  }
  return { mesh, mixer, actions, tris: built.geometry.attributes.position.count / 3 }
}

export default function Player({ state }) {
  const camera = useThree((s) => s.camera)
  const group = useRef()
  const res = useMemo(() => {
    const material = plushMaterial()
    const levels = [avatar(0, material), avatar(1, material)]
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
    return { material, canopyMat, levels, rig, current: null, last: new THREE.Vector3(), speed: 0 }
  }, [])
  useEffect(
    () => () => {
      res.levels.forEach((l) => {
        l.mixer.stopAllAction()
        l.mesh.geometry.dispose()
        l.mesh.skeleton.dispose()
      })
      res.material.dispose()
      res.canopyMat.dispose()
      res.rig.children.forEach((o) => o.geometry.dispose())
    },
    [res],
  )

  const play = (name) => {
    if (res.current === name) return
    for (const l of res.levels) {
      const next = l.actions[name]
      const prev = res.current && l.actions[res.current]
      next.reset().play()
      if (prev) prev.crossFadeTo(next, name === 'landing' ? 0.12 : 0.3, false)
    }
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
      if (s.photoT > 0) anim = 'photo'
      else if (s.soft && s.walk.t < 1.1) anim = 'landing'
      else anim = res.speed > 0.3 ? 'walk' : 'idle'
    }
    play(anim)
    const walk = res.levels.map((l) => l.actions.walk)
    walk.forEach((a) => (a.timeScale = anim === 'walk' ? Math.max(0.8, res.speed / 1.5) : 1))
    // level of detail by camera distance; both mixers stay in step
    const d = camera.position.distanceTo(g.position)
    res.levels[0].mesh.visible = d < NEAR
    res.levels[1].mesh.visible = d >= NEAR
    res.levels.forEach((l) => l.mixer.update(dt))
    // canopy: unfolds over the opening time, stays over the landing
    const open = s.canopy ? Math.min(1, s.canopyT ?? 1) : 0
    res.rig.visible = open > 0 && !(onFoot && s.walk.t > 1.5)
    res.rig.scale.set(0.2 + 0.8 * open, 0.3 + 0.7 * open, 0.2 + 0.8 * open)
    if (onFoot) res.rig.rotation.x = Math.min(1.4, s.walk.t * 1.2) // collapses behind
    else res.rig.rotation.x = 0
  })

  return (
    <group ref={group}>
      <primitive object={res.levels[0].mesh} />
      <primitive object={res.levels[1].mesh} />
      <primitive object={res.rig} />
    </group>
  )
}
