import { useMemo } from 'react'
import * as THREE from 'three'

/**
 * Procedural, long-range model of the Basílica de la Sagrada Família.
 * Proportions follow the real building (metres): Tower of Jesus Christ 172 m,
 * Tower of the Virgin Mary 138 m, four Evangelist towers 135 m, bell towers
 * of the Nativity (≈98–107 m) and Passion (≈107–112 m) façades, a 90 m nave
 * with aisles, the transept, the apse and the pinnacles along the roofs.
 *
 * Orientation in the preview: nave along z (apse at −z, Glory façade at +z),
 * transept along x (Nativity façade at +x facing Plaça de Gaudí, Passion
 * façade at −x facing Plaça de la Sagrada Família). Detail is tuned to be
 * read from 1 km away — faceted silhouettes, not ornament.
 */

// stone tones: aged Nativity sandstone, newer Passion / nave stone, the pale
// recently-finished central towers
const STONE_OLD = '#9c8566'
const STONE = '#c3ab88'
const STONE_NEW = '#ddd3c2'
const MOSAIC = ['#c8402f', '#e2b23c', '#f2efe6', '#3f6fa8']

/**
 * Tapered spire: lathe profile r(h) = r0 · (1 − (h/H)^k), with a few ring
 * bulges (the windowed stages) and a slender finial. Few radial segments +
 * flat shading → the ribbed look of the real towers at distance.
 */
function spireGeometry(r0, H, { k = 1.7, segments = 10, rings = 4 } = {}) {
  const pts = []
  const steps = 28
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    let r = r0 * (1 - Math.pow(t, k))
    // windowed stages: subtle bulges on the lower 60 %
    if (t < 0.62) r *= 1 + 0.06 * Math.max(0, Math.sin(t * Math.PI * rings * 2))
    pts.push(new THREE.Vector2(Math.max(r, 0.15), t * H))
  }
  pts.push(new THREE.Vector2(0, H))
  return new THREE.LatheGeometry(pts, segments)
}

/** pitched roof prism (gable along the local z axis) */
function gableGeometry(w, h, len) {
  const s = new THREE.Shape()
  s.moveTo(-w / 2, 0)
  s.lineTo(w / 2, 0)
  s.lineTo(0, h)
  s.closePath()
  const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false })
  g.translate(0, 0, -len / 2)
  return g
}

function Spire({ position, r0, H, color = STONE, finial = 0, k, segments }) {
  const geo = useMemo(() => spireGeometry(r0, H, { k, segments }), [r0, H, k, segments])
  return (
    <group position={position}>
      <mesh geometry={geo} castShadow receiveShadow>
        <meshStandardMaterial color={color} roughness={0.9} flatShading />
      </mesh>
      {/* Venetian-glass mosaic pinnacle */}
      <mesh position={[0, H - r0 * 0.9, 0]} castShadow>
        <icosahedronGeometry args={[r0 * 0.42, 0]} />
        <meshStandardMaterial color={MOSAIC[finial % MOSAIC.length]} roughness={0.35} metalness={0.2} flatShading />
      </mesh>
    </group>
  )
}

function Box({ position, size, color = STONE, rotation }) {
  return (
    <mesh position={position} rotation={rotation} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={0.92} flatShading />
    </mesh>
  )
}

function Gable({ position, w, h, len, rotationY = 0, color = STONE }) {
  const geo = useMemo(() => gableGeometry(w, h, len), [w, h, len])
  return (
    <mesh geometry={geo} position={position} rotation={[0, rotationY, 0]} castShadow receiveShadow>
      <meshStandardMaterial color={color} roughness={0.9} flatShading />
    </mesh>
  )
}

/** rows of small pinnacles ("fruit" finials) along the roofs */
function Pinnacles({ positions, height = 7, radius = 1.4, color = STONE }) {
  const geo = useMemo(() => spireGeometry(radius, height, { k: 1.2, segments: 6, rings: 1 }), [radius, height])
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true }), [color])
  return positions.map((p, i) => <mesh key={i} geometry={geo} material={mat} position={p} castShadow />)
}

export default function SagradaFamilia() {
  const pinnacles = useMemo(() => {
    const p = []
    for (let z = -30; z <= 50; z += 7) for (const x of [-23, 23, -37, 37]) p.push([x, x * x > 900 ? 30 : 45, z])
    for (let x = -28; x <= 28; x += 7) for (const z of [-16, 16]) if (Math.abs(x) > 12) p.push([x, 45, z])
    // apse chapels crown
    for (let a = 0; a < 7; a++) {
      const ang = Math.PI + (a / 6) * Math.PI
      p.push([Math.cos(ang) * 26, 32, -36 + Math.sin(ang) * 26])
    }
    return p
  }, [])

  return (
    <group>
      {/* ---- body: nave, aisles, transept, apse ---------------------- */}
      <Box position={[0, 22.5, 8]} size={[45, 45, 88]} />
      <Gable position={[0, 45, 8]} w={45} h={17} len={88} color={STONE_NEW} />
      <Box position={[-30, 15, 8]} size={[15, 30, 82]} />
      <Box position={[30, 15, 8]} size={[15, 30, 82]} />
      <Box position={[0, 22.5, 0]} size={[64, 45, 30]} />
      <Gable position={[0, 45, 0]} w={30} h={15} len={64} rotationY={Math.PI / 2} color={STONE_NEW} />
      {/* apse (−z) with ring of chapels */}
      <mesh position={[0, 0, -36]} castShadow receiveShadow>
        <cylinderGeometry args={[24, 26, 38, 14, 1, false, Math.PI / 2, Math.PI]} />
        <meshStandardMaterial color={STONE} roughness={0.92} flatShading />
      </mesh>
      {/* Glory façade (+z): unfinished, a stepped porch */}
      <Box position={[0, 12, 56]} size={[50, 24, 10]} color={STONE_NEW} />

      {/* ---- Nativity façade (+x, oldest, darkest stone) ------------- */}
      <Box position={[38, 20, 0]} size={[10, 40, 46]} color={STONE_OLD} />
      {[-11, 0, 11].map((z, i) => (
        <Gable key={z} position={[43, 30 + (i === 1 ? 6 : 0), z]} w={9} h={i === 1 ? 22 : 15} len={4} rotationY={Math.PI / 2} color={STONE_OLD} />
      ))}
      {[
        [-15, 98],
        [-5, 107],
        [5, 107],
        [15, 98],
      ].map(([z, H], i) => (
        <Spire key={`n${i}`} position={[40, 0, z]} r0={4.6} H={H} color={STONE_OLD} finial={i} />
      ))}

      {/* ---- Passion façade (−x): angular porch of leaning columns ---- */}
      <Box position={[-38, 22, 0]} size={[10, 44, 46]} />
      <Box position={[-46, 26, 0]} size={[8, 3, 40]} color={STONE_NEW} />
      {[-15, -7.5, 0, 7.5, 15].map((z, i) => (
        <Box key={z} position={[-46, 12, z]} size={[2.4, 26, 2.4]} rotation={[0, 0, (i % 2 ? 1 : -1) * 0.14]} color={STONE_NEW} />
      ))}
      {[
        [-15, 107],
        [-5, 112],
        [5, 112],
        [15, 107],
      ].map(([z, H], i) => (
        <Spire key={`p${i}`} position={[-40, 0, z]} r0={4.6} H={H} finial={i + 1} />
      ))}

      {/* ---- central towers ----------------------------------------- */}
      <Spire position={[0, 0, 2]} r0={10} H={172} color={STONE_NEW} k={1.9} segments={12} finial={2} />
      <Spire position={[0, 0, -30]} r0={8} H={138} color={STONE_NEW} k={1.9} segments={12} finial={1} />
      {[
        [-15, -12],
        [15, -12],
        [-15, 16],
        [15, 16],
      ].map(([x, z], i) => (
        <Spire key={`e${i}`} position={[x, 0, z]} r0={6.4} H={135} color={STONE_NEW} k={1.9} segments={10} finial={i} />
      ))}
      {/* cross on the Tower of Jesus Christ */}
      <Box position={[0, 178, 2]} size={[1.6, 12, 1.6]} color="#f4f1ea" />
      <Box position={[0, 180, 2]} size={[9, 1.6, 1.6]} color="#f4f1ea" />
      <Box position={[0, 180, 2]} size={[1.6, 1.6, 9]} color="#f4f1ea" />

      <Pinnacles positions={pinnacles} />
      {/* church grounds */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.5, 0]} receiveShadow>
        <planeGeometry args={[110, 110]} />
        <meshStandardMaterial color="#cdbfa8" roughness={1} />
      </mesh>
    </group>
  )
}
