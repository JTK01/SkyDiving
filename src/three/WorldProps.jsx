import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { cine } from '../state/cinematic'

/**
 * Main-world props for the SKY DIVE METAVERSE prototype:
 *  - the local player's jumper (stylised placeholder, belly-to-earth arch)
 *  - formation slots where future multiplayer avatars will be placed
 *  - streaming air particles to sell the freefall speed
 * All of it fades in with `cine.worldReveal`.
 */
export const PLAYER_ANCHOR = new THREE.Vector3(0, 127, -172)

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

function Limb({ from, to, radius, material }) {
  const { position, quaternion, length } = useMemo(() => {
    const a = new THREE.Vector3(...from)
    const b = new THREE.Vector3(...to)
    const dir = b.clone().sub(a)
    const len = dir.length()
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())
    return { position: a.clone().add(b).multiplyScalar(0.5), quaternion: q, length: len }
  }, [from, to])
  return (
    <mesh position={position} quaternion={quaternion} material={material}>
      <capsuleGeometry args={[radius, Math.max(0.01, length - radius * 2), 4, 10]} />
    </mesh>
  )
}

function Jumper({ materials }) {
  const { suit, accent, helmet, skin } = materials
  // body lies along -Z (head forward), +Y is the back (facing the camera)
  return (
    <group>
      <Limb from={[0, 0, 0.9]} to={[0, 0, -0.9]} radius={0.42} material={suit} />
      <Limb from={[0, 0.05, -0.2]} to={[0, 0.05, -0.85]} radius={0.44} material={accent} />
      {/* rig / container */}
      <mesh position={[0, 0.42, -0.15]} material={helmet}>
        <boxGeometry args={[0.75, 0.3, 1.05]} />
      </mesh>
      <mesh position={[0, 0.12, -1.45]} material={helmet}>
        <sphereGeometry args={[0.33, 20, 16]} />
      </mesh>
      {/* arms: out & bent forward */}
      <Limb from={[-0.45, 0.05, -0.6]} to={[-1.25, 0.15, -0.75]} radius={0.15} material={suit} />
      <Limb from={[-1.25, 0.15, -0.75]} to={[-1.45, 0.3, -1.55]} radius={0.13} material={accent} />
      <Limb from={[0.45, 0.05, -0.6]} to={[1.25, 0.15, -0.75]} radius={0.15} material={suit} />
      <Limb from={[1.25, 0.15, -0.75]} to={[1.45, 0.3, -1.55]} radius={0.13} material={accent} />
      <mesh position={[-1.47, 0.32, -1.66]} material={skin}>
        <sphereGeometry args={[0.11, 10, 8]} />
      </mesh>
      <mesh position={[1.47, 0.32, -1.66]} material={skin}>
        <sphereGeometry args={[0.11, 10, 8]} />
      </mesh>
      {/* legs: spread, knees bent up */}
      <Limb from={[-0.22, 0, 0.8]} to={[-0.6, 0.05, 1.75]} radius={0.18} material={suit} />
      <Limb from={[-0.6, 0.05, 1.75]} to={[-0.75, 0.75, 2.3]} radius={0.15} material={suit} />
      <Limb from={[0.22, 0, 0.8]} to={[0.6, 0.05, 1.75]} radius={0.18} material={suit} />
      <Limb from={[0.6, 0.05, 1.75]} to={[0.75, 0.75, 2.3]} radius={0.15} material={suit} />
    </group>
  )
}

export default function WorldProps() {
  const group = useRef()
  const jumper = useRef()
  const slotsRef = useRef([])
  const particlesRef = useRef()

  const materials = useMemo(() => {
    const m = {
      suit: new THREE.MeshStandardMaterial({ color: '#1d2f55', roughness: 0.7, transparent: true }),
      accent: new THREE.MeshStandardMaterial({ color: '#e5533d', roughness: 0.6, transparent: true }),
      helmet: new THREE.MeshStandardMaterial({ color: '#15171c', roughness: 0.35, metalness: 0.2, transparent: true }),
      skin: new THREE.MeshStandardMaterial({ color: '#d9d3c8', roughness: 0.8, transparent: true }),
    }
    return m
  }, [])

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
    Object.values(materials).forEach((m) => (m.opacity = r))
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
      <group ref={jumper} scale={1.6}>
        <Jumper materials={materials} />
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
