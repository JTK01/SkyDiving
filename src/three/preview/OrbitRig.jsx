import { useFrame, useThree } from '@react-three/fiber'

/**
 * Slow, fixed orbit around a landmark — the only camera motion in a map
 * preview (no user control). One revolution every `period` seconds.
 */
export default function OrbitRig({ target = [0, 0, 0], radius, height, fov, period = 120, start = 0 }) {
  const camera = useThree((s) => s.camera)
  useFrame((state) => {
    const a = start + (state.clock.elapsedTime / period) * Math.PI * 2
    camera.position.set(target[0] + Math.sin(a) * radius, height, target[2] + Math.cos(a) * radius)
    camera.lookAt(target[0], target[1], target[2])
    if (camera.fov !== fov) {
      camera.fov = fov
      camera.updateProjectionMatrix()
    }
  })
  return null
}
