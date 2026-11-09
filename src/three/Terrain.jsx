import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { cine, isBankClosed, SUN_DIRECTION } from '../state/cinematic'

/**
 * Snow-capped peaks piercing the sea of clouds in the distance.
 * The bases sit far below the cloud tops (y≈0) so only the summits show.
 * Revealed by thinning the scene fog during the login-success cinematic.
 */
const PEAKS = [
  { x: -620, z: 40, h: 330, r: 240 },
  { x: 380, z: 120, h: 300, r: 210 },
  { x: 980, z: -200, h: 380, r: 280 },
  { x: -1220, z: -200, h: 300, r: 260 },
  { x: 60, z: -420, h: 270, r: 300 },
  { x: 1650, z: -60, h: 250, r: 240 },
  { x: -1900, z: 40, h: 240, r: 240 },
]

function hash(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return s - Math.floor(s)
}
function noise(x, y) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  const a = hash(xi, yi)
  const b = hash(xi + 1, yi)
  const c = hash(xi, yi + 1)
  const d = hash(xi + 1, yi + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}
function ridged(x, y) {
  let sum = 0
  let amp = 0.5
  let f = 1
  for (let i = 0; i < 6; i++) {
    const n = 1 - Math.abs(noise(x * f, y * f) * 2 - 1)
    sum += n * n * amp
    f *= 2.03
    amp *= 0.5
  }
  return sum
}

export default function Terrain({ quality }) {
  const { scene } = useThree()
  const fogRef = useRef()

  const geometry = useMemo(() => {
    const [sx, sz] = quality.terrainSegments
    const geo = new THREE.PlaneGeometry(4400, 1500, sx, sz)
    geo.rotateX(-Math.PI / 2)
    const pos = geo.attributes.position
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      let env = 0
      for (const p of PEAKS) {
        const dx = x - p.x
        const dz = z - p.z
        env = Math.max(env, p.h * Math.exp(-(dx * dx + dz * dz) / (p.r * p.r)))
      }
      // ridges scale with the mountain envelope → sharp arêtes near the summits
      const rg = ridged(x * 0.0045 + 3.1, z * 0.0045 + 7.7)
      const h = -170 + env * (0.45 + rg * 0.95) + rg * 60
      pos.setY(i, h)
    }
    geo.computeVertexNormals()

    const nrm = geo.attributes.normal
    const colors = new Float32Array(pos.count * 3)
    const rock = new THREE.Color('#454b56')
    const rockDark = new THREE.Color('#2b3039')
    const snow = new THREE.Color('#eef3fa')
    const c = new THREE.Color()
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i)
      const ny = nrm.getY(i)
      const snowLine = -10 + hash(pos.getX(i) * 0.01, pos.getZ(i) * 0.01) * 40
      const snowAmt = THREE.MathUtils.smoothstep(y, snowLine, snowLine + 50) * THREE.MathUtils.smoothstep(ny, 0.5, 0.78)
      c.copy(rockDark).lerp(rock, THREE.MathUtils.clamp(ny, 0, 1)).lerp(snow, snowAmt)
      colors[i * 3] = c.r
      colors[i * 3 + 1] = c.g
      colors[i * 3 + 2] = c.b
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    return geo
  }, [quality.terrainSegments])

  const fog = useMemo(() => {
    const f = new THREE.FogExp2(new THREE.Color(0.74, 0.8, 0.87), cine.terrainFog)
    scene.fog = f
    return f
  }, [scene])

  useFrame(() => {
    fog.density = cine.terrainFog
    fog.color.setRGB(0.74 * cine.brightness, 0.8 * cine.brightness, 0.87 * cine.brightness, THREE.SRGBColorSpace)
    if (fogRef.current) fogRef.current.visible = !isBankClosed()
  })

  const sunPos = useMemo(() => SUN_DIRECTION.clone().multiplyScalar(1000), [])

  return (
    <group ref={fogRef}>
      <hemisphereLight args={['#a9c6ec', '#3b4250', 0.9]} />
      <directionalLight position={sunPos} color="#ffe2bd" intensity={2.6} />
      <mesh geometry={geometry} position={[0, 0, -1950]}>
        <meshStandardMaterial vertexColors roughness={0.92} metalness={0} />
      </mesh>
    </group>
  )
}
