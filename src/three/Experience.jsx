import { useEffect, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { usePerformanceTier } from '../hooks/usePerformanceTier'
import CameraController from './CameraController'
import Sky from './Sky'
import Terrain from './Terrain'
import CloudSystem from './clouds/CloudSystem'
import CloudFloor from './clouds/CloudFloor'
import GodRays from './GodRays'
import CloudInterior from './clouds/CloudInterior'
import WorldProps from './WorldProps'

/** Lowers the pixel ratio if the frame rate stays low (mobile safety net). */
function AdaptiveResolution({ range }) {
  const setDpr = useThree((s) => s.setDpr)
  const stats = useRef({ frames: 0, time: 0, dpr: Math.min(window.devicePixelRatio, range[1]) })
  useFrame((_, dt) => {
    const s = stats.current
    s.frames++
    s.time += dt
    if (s.time < 2) return
    const fps = s.frames / s.time
    s.frames = 0
    s.time = 0
    if (fps < 42 && s.dpr > range[0]) {
      s.dpr = Math.max(range[0], s.dpr - 0.2)
      setDpr(s.dpr)
    } else if (fps > 58 && s.dpr < Math.min(window.devicePixelRatio, range[1])) {
      s.dpr = Math.min(range[1], s.dpr + 0.1)
      setDpr(s.dpr)
    }
  })
  return null
}

function ReadySignal({ onReady }) {
  const frames = useRef(0)
  const done = useRef(false)
  useFrame(() => {
    if (done.current) return
    // wait a few frames so shaders are compiled and textures uploaded
    if (++frames.current > 3) {
      done.current = true
      onReady()
    }
  })
  return null
}

export default function Experience({ onReady }) {
  const quality = usePerformanceTier()
  useEffect(() => {
    document.documentElement.dataset.tier = quality.tier
  }, [quality.tier])

  return (
    <Canvas
      className="webgl"
      dpr={quality.dpr}
      flat
      gl={{ antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false }}
      camera={{ fov: 55, near: 0.5, far: 6000, position: [0, 112, 60] }}
      onCreated={({ gl }) => gl.setClearColor(new THREE.Color('#0b1220'))}
    >
      <CameraController />
      <Sky />
      <Terrain quality={quality} />
      <WorldProps />
      <CloudSystem quality={quality} />
      <CloudFloor />
      <GodRays />
      <CloudInterior />
      <AdaptiveResolution range={quality.dpr} />
      <ReadySignal onReady={onReady} />
    </Canvas>
  )
}
