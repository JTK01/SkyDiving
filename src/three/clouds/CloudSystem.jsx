import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { cine, SUN_DIRECTION } from '../../state/cinematic'
import { buildPuffs, CLOUD_CONFIG, LAYER } from './cloudLayout'
import { cloudVertex, cloudFragment } from './cloudShader'
import { getCloudTextures } from './cloudTextures'

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const ease = (t) => t * t * (3 - 2 * t)
const lerp = (a, b, t) => a + (b - a) * t
const smooth = (e0, e1, x) => ease(clamp01((x - e0) / (e1 - e0)))
const wrap = (v, min, max) => {
  const r = max - min
  return ((((v - min) % r) + r) % r) + min
}

export const CLOUD_COLORS = {
  lit: new THREE.Color(1.0, 0.985, 0.965),
  shadow: new THREE.Color(0.5, 0.57, 0.68),
  sun: new THREE.Color(1.0, 0.84, 0.64).multiplyScalar(0.65),
  haze: new THREE.Color(0.74, 0.8, 0.87),
}

/**
 * CloudSystem — every cloud on screen, in one depth-sorted instanced draw.
 * Positions are recomputed each frame from the cinematic parameters
 * (converge / disperse / densityBoost / wind), so GSAP only animates numbers.
 */
export default function CloudSystem({ quality }) {
  const { camera } = useThree()
  const meshRef = useRef()

  const puffs = useMemo(() => buildPuffs(quality.cloudScale), [quality.cloudScale])
  const count = puffs.length

  const { geometry, material, buffers } = useMemo(() => {
    const textures = getCloudTextures(quality.atlasTile)
    const base = new THREE.PlaneGeometry(1, 1)
    const geo = new THREE.InstancedBufferGeometry()
    geo.index = base.index
    geo.setAttribute('position', base.getAttribute('position'))
    geo.setAttribute('uv', base.getAttribute('uv'))

    const iPos = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3)
    const iData = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4)
    const iExtra = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3)
    ;[iPos, iData, iExtra].forEach((a) => a.setUsage(THREE.DynamicDrawUsage))
    geo.setAttribute('iPos', iPos)
    geo.setAttribute('iData', iData)
    geo.setAttribute('iExtra', iExtra)
    geo.instanceCount = count

    const mat = new THREE.ShaderMaterial({
      vertexShader: cloudVertex,
      fragmentShader: cloudFragment,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      uniforms: {
        uAtlas: { value: textures.atlas },
        uDetail: { value: textures.detail },
        uSunView: { value: new THREE.Vector3() },
        uLit: { value: CLOUD_COLORS.lit },
        uShadow: { value: CLOUD_COLORS.shadow },
        uSunColor: { value: CLOUD_COLORS.sun },
        uHaze: { value: CLOUD_COLORS.haze },
        uFog: { value: cine.cloudFog },
        uBrightness: { value: 1 },
        uTime: { value: 0 },
      },
    })

    // scratch arrays used for sorting
    const work = {
      px: new Float32Array(count),
      py: new Float32Array(count),
      pz: new Float32Array(count),
      sx: new Float32Array(count),
      sy: new Float32Array(count),
      a: new Float32Array(count),
      depth: new Float32Array(count),
      order: Array.from({ length: count }, (_, i) => i),
    }
    return { geometry: geo, material: mat, buffers: { iPos, iData, iExtra, work } }
  }, [count, quality.atlasTile])

  const tmp = useMemo(
    () => ({ v: new THREE.Vector3(), fwd: new THREE.Vector3(), sun: new THREE.Vector3() }),
    [],
  )

  useFrame((_, rawDt) => {
    const mesh = meshRef.current
    if (!mesh) return
    const dt = Math.min(rawDt, 0.1)
    const u = material.uniforms
    u.uTime.value += dt
    cine.windOffset += cine.wind * dt

    // Fully hidden behind the cloud interior layer → skip all work.
    const hidden = cine.cover > 0.995 && cine.open < 0.001
    mesh.visible = !hidden
    if (hidden) return

    u.uBrightness.value = cine.brightness
    u.uFog.value = cine.cloudFog
    u.uSunView.value.copy(SUN_DIRECTION).transformDirection(camera.matrixWorldInverse)

    const { px, py, pz, sx, sy, a, depth, order } = buffers.work
    const time = u.uTime.value
    const seaCfg = CLOUD_CONFIG.sea
    const cuCfg = CLOUD_CONFIG.cumulus
    const tanH = Math.tan(THREE.MathUtils.degToRad(cine.rigFov) / 2)
    const aspect = cine.aspect
    const rig = cine.rigMatrix.elements
    const C = cine.converge
    const P = cine.disperse
    const boost = cine.densityBoost

    camera.getWorldDirection(tmp.fwd)
    const cx = camera.position.x
    const cy = camera.position.y
    const cz = camera.position.z

    for (let i = 0; i < count; i++) {
      const p = puffs[i]
      if (p.layer === LAYER.SEA) {
        const z = wrap(p.z + cine.windOffset, seaCfg.z[0], seaCfg.z[1])
        px[i] = p.x + Math.sin(time * 0.03 + p.seed * 40) * 4
        py[i] = p.y + Math.sin(time * 0.05 + p.seed * 20) * 1.5
        pz[i] = z
        sx[i] = p.sx
        sy[i] = p.sy
        a[i] = p.alpha * smooth(seaCfg.z[0], seaCfg.z[0] + 550, z) * (1 - smooth(seaCfg.z[1] - 140, seaCfg.z[1], z))
      } else if (p.layer === LAYER.CUMULUS) {
        const cl = cuCfg.clusters[p.cluster]
        const zc = wrap(cl.z + cine.windOffset * 0.85, cuCfg.zRange[0], cuCfg.zRange[1])
        const z = p.z + (zc - cl.z)
        px[i] = p.x + Math.sin(time * 0.02 + p.seed * 10) * 3
        py[i] = p.y + Math.sin(time * 0.04 + p.seed * 30) * 2
        pz[i] = z
        sx[i] = p.sx * (1 + Math.sin(time * 0.05 + p.seed * 12) * 0.03)
        sy[i] = p.sy
        a[i] =
          p.alpha *
          smooth(cuCfg.zRange[0], cuCfg.zRange[0] + 600, zc) *
          (1 - smooth(cuCfg.zRange[1] - 300, cuCfg.zRange[1], zc))
      } else {
        // ---- camera-relative transition cloud -----------------------------
        const ci = ease(clamp01((C - p.convDelay) / (1 - p.convDelay)))
        const pi = ease(clamp01((P - p.dispDelay) / (1 - p.dispDelay)))

        let x = lerp(p.rest.x, p.conv.x, ci)
        let y = lerp(p.rest.y, p.conv.y, ci)
        let d = lerp(p.rest.d, p.conv.d, ci)
        let s = lerp(p.rest.s, p.conv.s, ci)

        // curved, swirling path while converging
        const sw = p.swirl * Math.sin(ci * Math.PI)
        const cs = Math.cos(sw)
        const sn = Math.sin(sw)
        const rx = x * cs - y * sn
        const ry = x * sn + y * cs
        x = rx
        y = ry

        // scatter: up & sideways, some fly past the camera
        x = lerp(x, p.disp.x, pi)
        y = lerp(y, p.disp.y, pi)
        d = lerp(d, p.disp.d, pi)
        s = lerp(s, p.disp.s, pi)

        // idle breathing
        x += Math.sin(time * 0.11 + p.seed * 40) * 0.025
        y += Math.cos(time * 0.09 + p.seed * 25) * 0.018

        s *= 1 + (boost - 1) * 0.4 * ci

        const dd = Math.max(d, 0.5)
        const halfH = dd * tanH
        const lx = x * halfH * aspect
        const ly = y * halfH
        const lz = -d
        // rig matrix (column-major)
        px[i] = rig[0] * lx + rig[4] * ly + rig[8] * lz + rig[12]
        py[i] = rig[1] * lx + rig[5] * ly + rig[9] * lz + rig[13]
        pz[i] = rig[2] * lx + rig[6] * ly + rig[10] * lz + rig[14]
        const size = s * halfH * 2
        sx[i] = size
        sy[i] = size * p.flatten
        a[i] = Math.min(1, lerp(p.alpha, 1, ci) * (1 + (boost - 1) * 0.5 * ci)) * (1 - CLOUD_CONFIG.transition.disperse.fade * pi)
      }
      depth[i] = (px[i] - cx) * tmp.fwd.x + (py[i] - cy) * tmp.fwd.y + (pz[i] - cz) * tmp.fwd.z
    }

    // back-to-front for correct premultiplied blending
    order.sort((i, j) => depth[j] - depth[i])

    const pos = buffers.iPos.array
    const dat = buffers.iData.array
    const ext = buffers.iExtra.array
    for (let k = 0; k < count; k++) {
      const i = order[k]
      const p = puffs[i]
      pos[k * 3] = px[i]
      pos[k * 3 + 1] = py[i]
      pos[k * 3 + 2] = pz[i]
      dat[k * 4] = sx[i]
      dat[k * 4 + 1] = sy[i]
      dat[k * 4 + 2] = a[i]
      dat[k * 4 + 3] = p.seed
      ext[k * 3] = p.tile
      ext[k * 3 + 1] = p.shade
      ext[k * 3 + 2] = p.light
    }
    buffers.iPos.needsUpdate = true
    buffers.iData.needsUpdate = true
    buffers.iExtra.needsUpdate = true
  })

  return <mesh ref={meshRef} geometry={geometry} material={material} frustumCulled={false} renderOrder={2} />
}
