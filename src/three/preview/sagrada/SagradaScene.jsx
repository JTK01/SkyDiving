import { useMemo } from 'react'
import * as THREE from 'three'
import Eixample from './Eixample'
import SagradaFamilia from './SagradaFamilia'
import OrbitRig from '../OrbitRig'

/**
 * Long-range preview of the Sagrada Família map: late-afternoon Barcelona —
 * the church in the Eixample grid, the Collserola ridge behind (−z) and the
 * Mediterranean in front (+z), all softened by warm coastal haze.
 */
const VIEW = {
  // camera orbit around the church (metres)
  // target above the church so the horizon (ridge, sea, sky) shows at the top
  orbit: { target: [0, 120, 0], radius: 960, height: 400, fov: 36, period: 110, start: 0.55 },
  haze: '#d8d3c9',
  fog: [900, 6200],
}

const SUN = new THREE.Vector3(0.5, 0.42, 0.76).normalize()

function SkyDome() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { uSun: { value: SUN } },
        vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `
          uniform vec3 uSun; varying vec3 vDir;
          void main(){
            float h = vDir.y;
            vec3 zen = vec3(0.32, 0.5, 0.74);
            vec3 hor = vec3(0.86, 0.8, 0.72);
            vec3 col = mix(hor, zen, smoothstep(-0.02, 0.45, h));
            float s = max(dot(normalize(vDir), uSun), 0.0);
            col += vec3(1.0, 0.82, 0.6) * (pow(s, 8.0) * 0.35 + pow(s, 300.0) * 1.2);
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    [],
  )
  return (
    <mesh material={mat} renderOrder={-1}>
      <sphereGeometry args={[8000, 32, 16]} />
    </mesh>
  )
}

function Ridge() {
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(12000, 1, 160, 1)
    const p = g.attributes.position
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i)
      if (p.getY(i) > 0) {
        const h = 260 + Math.sin(x * 0.0011) * 110 + Math.sin(x * 0.0037 + 1.3) * 60 + Math.sin(x * 0.011) * 18
        p.setY(i, h)
      } else p.setY(i, -10)
    }
    g.computeVertexNormals()
    return g
  }, [])
  return (
    <mesh geometry={geo} position={[0, 0, -4600]}>
      <meshStandardMaterial color="#56604c" roughness={1} />
    </mesh>
  )
}

export default function SagradaScene({ quality }) {
  const shadows = quality.tier !== 'low'
  return (
    <>
      <OrbitRig {...VIEW.orbit} />
      <fog attach="fog" args={[VIEW.haze, ...VIEW.fog]} />
      <SkyDome />
      <hemisphereLight args={['#dfe8f5', '#8a7660', 1.1]} />
      <directionalLight
        position={SUN.clone().multiplyScalar(900)}
        color="#ffd7a8"
        intensity={1.9}
        castShadow={shadows}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-420}
        shadow-camera-right={420}
        shadow-camera-top={420}
        shadow-camera-bottom={-420}
        shadow-camera-near={100}
        shadow-camera-far={2200}
        shadow-bias={-0.0004}
      />
      <Eixample quality={quality} />
      <SagradaFamilia />
      <Ridge />
      {/* the Mediterranean beyond the city (+z) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.3, 5600]}>
        <planeGeometry args={[16000, 4800]} />
        <meshStandardMaterial color="#5b7f99" roughness={0.3} metalness={0.15} />
      </mesh>
    </>
  )
}
