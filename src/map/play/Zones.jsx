import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { ZONE_RADIUS } from './missionZones'

/**
 * Glowing markers of the five mission zones, visible from the start of the
 * drop to the landing: a column of light (wider toward the top, so it also
 * reads from straight above) and a pulsing ring + disc on the ground.
 * Additive, unlit, no fog. A zone the player stands in glows a bit softer.
 */
const COLUMN_H = 650
const GOLD = new THREE.Color('#ffd27a')

function columnGeometry() {
  // open cone: radius 3 m at the ground → 11 m at the top; alpha fades upward
  const g = new THREE.CylinderGeometry(11, 3, COLUMN_H, 32, 8, true)
  g.translate(0, COLUMN_H / 2, 0)
  const p = g.attributes.position
  const col = new Float32Array(p.count * 4)
  for (let v = 0; v < p.count; v++) {
    const t = p.getY(v) / COLUMN_H
    col.set([GOLD.r, GOLD.g, GOLD.b, 0.55 * (1 - t) ** 1.6], v * 4)
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 4))
  return g
}

/** soft radial glow (seen from straight above, where the column is end-on) */
function haloTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')
  // bright rim (a readable circle from 1 km up) around a soft core
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 63)
  gr.addColorStop(0, 'rgba(255,220,140,0.9)')
  gr.addColorStop(0.45, 'rgba(255,205,120,0.35)')
  gr.addColorStop(0.72, 'rgba(255,215,130,0.55)')
  gr.addColorStop(0.8, 'rgba(255,235,170,1)')
  gr.addColorStop(0.88, 'rgba(255,215,130,0.45)')
  gr.addColorStop(1, 'rgba(255,190,100,0)')
  g.fillStyle = gr
  g.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(c)
}

export default function Zones({ zones }) {
  const res = useMemo(() => {
    const haloTex = haloTexture()
    // drawn over roofs and trees (it only shows from high up, where it marks the spot like a map pin)
    const haloMat = new THREE.MeshBasicMaterial({ map: haloTex, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, fog: false })
    const haloGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
    const colMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false })
    const ringMat = new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false })
    const discMat = new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false })
    const colGeo = columnGeometry()
    const ringGeo = new THREE.RingGeometry(ZONE_RADIUS - 1.6, ZONE_RADIUS, 72).rotateX(-Math.PI / 2)
    const discGeo = new THREE.CircleGeometry(ZONE_RADIUS - 1.6, 72).rotateX(-Math.PI / 2)
    const groups = zones.map((z) => {
      const g = new THREE.Group()
      g.position.set(z.x, z.y, z.z)
      const column = new THREE.Mesh(colGeo, colMat.clone())
      const ring = new THREE.Mesh(ringGeo, ringMat.clone())
      const disc = new THREE.Mesh(discGeo, discMat.clone())
      ring.position.y = disc.position.y = 0.25 // above the terrain mesh (log depth)
      for (const m of [column, ring, disc]) {
        m.frustumCulled = false
        m.renderOrder = 2
      }
      // the halo grows with the camera height (set per frame) so it stays visible from the sky
      const halo = new THREE.Mesh(haloGeo, haloMat.clone())
      halo.position.y = 1
      halo.frustumCulled = false
      halo.renderOrder = 2
      g.add(column, ring, disc, halo)
      return { g, column, ring, disc, halo, zone: z }
    })
    return { groups, mats: [colMat, ringMat, discMat, haloMat], geos: [colGeo, ringGeo, discGeo, haloGeo], haloTex }
  }, [zones])
  useEffect(
    () => () => {
      res.geos.forEach((g) => g.dispose())
      res.mats.forEach((m) => m.dispose())
      res.groups.forEach((r) => [r.column, r.ring, r.disc, r.halo].forEach((m) => m.material.dispose()))
      res.haloTex.dispose()
    },
    [res],
  )
  useFrame(({ clock, camera }) => {
    const t = clock.elapsedTime
    for (const r of res.groups) {
      // ≈ 4 % of the view height from above (100 m wide from 1.2 km), the zone size near the ground
      const h = Math.max(0, camera.position.y - r.g.position.y)
      const size = Math.max(ZONE_RADIUS * 2.6, h * 0.085)
      r.halo.scale.set(size, 1, size)
      r.halo.material.opacity = THREE.MathUtils.clamp((h - 150) / 200, 0, 1) * (0.8 + 0.2 * Math.sin(t * 2.2 + r.zone.x))
      const pulse = 0.75 + 0.25 * Math.sin(t * 2.2 + r.zone.x)
      const k = r.zone.inside ? 0.55 : 1
      r.ring.material.opacity = 0.9 * pulse * k
      r.disc.material.opacity = 0.18 * pulse * k
      r.column.material.opacity = k
    }
  })
  return res.groups.map((r) => <primitive key={r.zone.id} object={r.g} />)
}
