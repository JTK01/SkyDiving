import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { cine } from '../state/cinematic'

/**
 * Main-world props for the SKY DIVE METAVERSE prototype:
 *  - the local player's jumper: the player avatar (the same model as in a drop)
 *    playing its free-fall clip — loaded lazily (avatarProp.js, a separate chunk,
 *    fetched when the browser is idle) so the first screen does not wait for it
 *  - formation slots where future multiplayer avatars will be placed
 *  - streaming air particles to sell the freefall speed
 * All of it fades in with `cine.worldReveal`.
 */
export const PLAYER_ANCHOR = new THREE.Vector3(0, 127, -172)
const AVATAR_SCALE = 3.4

/** Formation slots, relative to the player anchor — reserved for multiplayer. */
export const AVATAR_SLOTS = [
  [-9, 0.6, -4],
  [9, -0.4, -4],
  [-15, 1.5, 6],
  [15, 1.2, 6],
  [0, 2.2, -12],
  [-6, -1.2, 11],
  [6, -1.6, 11],
]

export default function WorldProps() {
  const group = useRef()
  const jumper = useRef()
  const slotsRef = useRef([])
  const particlesRef = useRef()

  const { gl } = useThree()
  const [avatar, setAvatar] = useState(null)
  useEffect(() => {
    let live = true
    let loaded = null
    const start = () =>
      import('./avatarProp')
        .then((m) => m.loadAvatarProp(gl))
        .then((a) => {
          loaded = a
          if (live) setAvatar(a)
          else a.dispose()
        })
        .catch(() => {})
    // after the first screen is up: idle time, or 2 s at the latest
    const idle = window.requestIdleCallback ? window.requestIdleCallback(start, { timeout: 2000 }) : setTimeout(start, 1200)
    return () => {
      live = false
      if (window.cancelIdleCallback && typeof idle === 'number') window.cancelIdleCallback(idle)
      loaded?.dispose()
    }
  }, [gl])

  const slotMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#ffffff',
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    [],
  )

  const particles = useMemo(() => {
    const n = 220
    const pos = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 120
      pos[i * 3 + 1] = (Math.random() - 0.5) * 70
      pos[i * 3 + 2] = -Math.random() * 160
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const mat = new THREE.PointsMaterial({
      color: '#ffffff',
      size: 0.35,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
    })
    return { geo, mat, n }
  }, [])

  useFrame((state, dt) => {
    const r = cine.worldReveal
    const g = group.current
    g.visible = r > 0.001
    if (!g.visible) return
    const t = state.clock.elapsedTime
    if (avatar) {
      avatar.setOpacity(r)
      avatar.mixer.update(Math.min(dt, 0.1))
    }
    slotMaterial.opacity = r * (0.22 + Math.sin(t * 1.6) * 0.08)

    // freefall body: gentle bob, roll & yaw corrections
    const j = jumper.current
    j.position.set(Math.sin(t * 0.5) * 0.6, Math.sin(t * 0.8) * 0.45, Math.sin(t * 0.37) * 0.4)
    j.rotation.set(Math.sin(t * 0.9) * 0.04, Math.sin(t * 0.3) * 0.08, Math.sin(t * 0.7) * 0.06)
    slotsRef.current.forEach((s, i) => {
      if (!s) return
      s.rotation.z = t * 0.4 + i
      s.position.y = AVATAR_SLOTS[i][1] + Math.sin(t * 0.9 + i) * 0.3
    })

    // air streaks streaming up past the camera
    const pos = particles.geo.attributes.position
    const speed = 28 * Math.min(dt, 0.1)
    for (let i = 0; i < particles.n; i++) {
      let y = pos.getY(i) + speed
      if (y > 35) y -= 70
      pos.setY(i, y)
    }
    pos.needsUpdate = true
    particles.mat.opacity = r * 0.45
  })

  return (
    <group ref={group} position={PLAYER_ANCHOR} visible={false}>
      <group ref={jumper}>
        {/* belly down, head toward −z, back to the camera; ≈ the old figure's size */}
        {avatar && <primitive object={avatar.scene} scale={AVATAR_SCALE} rotation={[0, Math.PI, 0]} position={[0, -AVATAR_SCALE * 0.96, 0]} />}
      </group>
      {AVATAR_SLOTS.map((p, i) => (
        <mesh
          key={i}
          ref={(el) => (slotsRef.current[i] = el)}
          position={p}
          rotation={[-Math.PI / 2, 0, 0]}
          material={slotMaterial}
        >
          <ringGeometry args={[1.1, 1.2, 48, 1, 0, Math.PI * 1.7]} />
        </mesh>
      ))}
      <points geometry={particles.geo} material={particles.mat} position={[0, 0, 60]} />
    </group>
  )
}
