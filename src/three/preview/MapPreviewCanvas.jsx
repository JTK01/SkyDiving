import { Suspense, useEffect, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { usePerformanceTier } from '../../hooks/usePerformanceTier'
import { PREVIEW_SCENES } from './scenes'

/** fires once the scene has rendered a few frames (shaders compiled) */
function Ready({ onReady }) {
  const [done, setDone] = useState(false)
  useFrame(() => {
    if (!done) {
      setDone(true)
      requestAnimationFrame(() => requestAnimationFrame(onReady))
    }
  })
  return null
}

/**
 * Separate, small WebGL view for the map preview. Non-interactive: the
 * canvas ignores pointer events, and the camera only follows OrbitRig.
 */
export default function MapPreviewCanvas({ sceneKey, onReady }) {
  const quality = usePerformanceTier()
  const Scene = PREVIEW_SCENES[sceneKey]
  const [ready, setReady] = useState(false)
  useEffect(() => setReady(false), [sceneKey])
  if (!Scene) return null
  return (
    <Canvas
      className="map-preview__canvas"
      style={{ pointerEvents: 'none', opacity: ready ? 1 : 0 }}
      dpr={quality.tier === 'low' ? [0.75, 1] : [1, 1.5]}
      shadows={quality.tier !== 'low'}
      flat // same colour pipeline as the main scene (no tone mapping)
      camera={{ fov: 36, near: 5, far: 16000, position: [0, 400, 960] }}
      gl={{ antialias: quality.tier !== 'low', powerPreference: 'high-performance' }}
    >
      <Suspense fallback={null}>
        <Scene quality={quality} />
        <Ready
          onReady={() => {
            setReady(true)
            onReady?.()
          }}
        />
      </Suspense>
    </Canvas>
  )
}
