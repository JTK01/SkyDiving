import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { cine } from '../state/cinematic'

/**
 * CameraController
 *
 * GSAP tweens `cine.cam` (the base "rig" pose). Each frame this component:
 *  1. builds the rig matrix (used by the camera-relative transition clouds)
 *  2. adds idle breathing + pointer parallax on top → the real camera
 *  3. widens the FOV in portrait so mobile keeps the same framing
 */
export default function CameraController() {
  const { camera, size } = useThree()
  const rig = useMemo(() => new THREE.Object3D(), [])
  const smoothPointer = useMemo(() => ({ x: 0, y: 0 }), [])

  useEffect(() => {
    rig.rotation.order = 'YXZ'
    camera.rotation.order = 'YXZ'
    const onMove = (e) => {
      const p = e.touches ? e.touches[0] : e
      cine.pointer.x = (p.clientX / window.innerWidth) * 2 - 1
      cine.pointer.y = (p.clientY / window.innerHeight) * 2 - 1
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [camera, rig])

  useFrame((state, dt) => {
    const c = cine.cam
    const aspect = size.width / size.height
    // keep a similar horizontal framing on portrait screens
    const fov = aspect < 1 ? Math.min(c.fov + (1 - aspect) * 34, 80) : c.fov

    rig.position.set(c.x, c.y, c.z)
    rig.rotation.set(c.pitch, c.yaw, c.roll)
    rig.updateMatrixWorld()
    cine.rigMatrix.copy(rig.matrixWorld)
    cine.rigFov = fov
    cine.aspect = aspect

    const t = state.clock.elapsedTime
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * 2.5)
    smoothPointer.x += (cine.pointer.x - smoothPointer.x) * k
    smoothPointer.y += (cine.pointer.y - smoothPointer.y) * k

    const sway = cine.sway
    camera.position.set(
      c.x + Math.sin(t * 0.17) * 0.9 * sway,
      c.y + Math.sin(t * 0.23 + 1.3) * 0.6 * sway,
      c.z,
    )
    camera.rotation.set(
      c.pitch + Math.sin(t * 0.21) * 0.006 * sway - smoothPointer.y * 0.025 * sway,
      c.yaw + Math.sin(t * 0.13 + 0.7) * 0.008 * sway - smoothPointer.x * 0.04 * sway,
      c.roll + Math.sin(t * 0.19 + 2.1) * 0.004 * sway,
    )
    if (Math.abs(camera.fov - fov) > 1e-3) {
      camera.fov = fov
      camera.updateProjectionMatrix()
    }
  })

  return null
}
