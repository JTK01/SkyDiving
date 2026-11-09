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
  lit: new THREE.Color(1.0, 0.99, 0.975),
  shadow: new THREE.Color(0.6, 0.66, 0.76), // grey-blue shade
  deep: new THREE.Color(0.4, 0.47, 0.6), // deepest pockets, sky-blue bounce
  sun: new THREE.Color(1.0, 0.86, 0.66).multiplyScalar(0.6),
  haze: new THREE.Color(0.74, 0.8, 0.87),
}

const bezier = (a, c, b, t) => {
  const u = 1 - t
  return u * u * a + 2 * u * t * c + t * t * b
}

/**
 * Per-frame state of one transition cloud body: an organic, curved path from
 * its rest framing to the converged bank and on to its scatter direction,
 * with its own delay / speed, slow spin, slight growth and turbulence.
 */
function updateCloudBody(cl, C, P, time, frame) {
  if (cl.frame === frame) return cl.state
  cl.frame = frame
  const ci = ease(clamp01((C - cl.delayC) * cl.speedC))
  const pi = ease(clamp01((P - cl.delayD) * cl.speedD))

  let x = bezier(cl.rest.x, cl.ctrlC.x, cl.conv.x, ci)
  let y = bezier(cl.rest.y, cl.ctrlC.y, cl.conv.y, ci)
  // ease-in on depth: drifts sideways first, then rushes toward the camera
  let d = lerp(cl.rest.d, cl.conv.d, ci * ci * 0.4 + ci * 0.6)
  if (pi > 0) {
    x = bezier(x, cl.ctrlD.x + (x - cl.conv.x), cl.disp.x, pi)
    y = bezier(y, cl.ctrlD.y + (y - cl.conv.y), cl.disp.y, pi)
    d = lerp(d, cl.disp.d, pi)
  }
  // turbulence, strongest while moving
  const moving = Math.sin(ci * Math.PI) + Math.sin(pi * Math.PI)
  const w = cl.wobble
  x += Math.sin(time * 0.11 + w) * 0.018 + Math.sin(time * 0.7 + w * 2) * 0.012 * moving
  y += Math.cos(time * 0.09 + w * 1.3) * 0.012 + Math.cos(time * 0.6 + w) * 0.01 * moving

  const st = cl.state
  st.x = x
  st.y = y
  st.d = d
  st.ang = cl.rot0 + cl.spinC * ci + cl.spinD * pi + Math.sin(time * 0.05 + w) * 0.02
  st.scale = 1 + cl.grow * ci + 0.08 * pi
  st.ci = ci
  st.pi = pi
  return st
}

/**
 * CloudSystem — every cloud on screen, in one depth-sorted instanced draw.
 * Positions are recomputed each frame from the cinematic parameters
 * (converge / disperse / densityBoost / wind), so GSAP only animates numbers.
 * Transition clouds are cloud *bodies* (several puffs) on foreground /
 * midground / background layers; each body keeps its own shape while it
 * travels, so the bank closes like real clouds instead of one white blob.
 */
export default function CloudSystem({ quality }) {
  const { camera } = useThree()
  const meshRef = useRef()
  const frameRef = useRef(0)

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
    const iExtra = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4)
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
        uVapor: { value: textures.vapor },
        uSunView: { value: new THREE.Vector3() },
        uLit: { value: CLOUD_COLORS.lit },
        uShadow: { value: CLOUD_COLORS.shadow },
        uDeep: { value: CLOUD_COLORS.deep },
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
      rot: new Float32Array(count),
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

    const { px, py, pz, sx, sy, a, rot, depth, order } = buffers.work
    const frame = ++frameRef.current
    const time = u.uTime.value
    const seaCfg = CLOUD_CONFIG.sea
    const cuCfg = CLOUD_CONFIG.cumulus
    const tanH = Math.tan(THREE.MathUtils.degToRad(cine.rigFov) / 2)
    const aspect = cine.aspect
    const rig = cine.rigMatrix.elements
    const C = cine.converge
    const P = cine.disperse
    const boost = cine.densityBoost
    // keep the cloud-to-screen-WIDTH proportion of a 16:9 frame on narrow screens
    const portrait = Math.min(1, Math.max(0.6, aspect / 1.2))

    camera.getWorldDirection(tmp.fwd)
    const cx = camera.position.x
    const cy = camera.position.y
    const cz = camera.position.z

    for (let i = 0; i < count; i++) {
      const p = puffs[i]
      if (p.layer !== LAYER.TRANSITION) rot[i] = 0
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
          (1 - smooth(cuCfg.zRange[1] - 260, cuCfg.zRange[1], zc))
      } else {
        // ---- camera-relative transition cloud body ------------------------
        const st = updateCloudBody(p.cloud, C, P, time, frame)
        const cl = p.cloud
        // world size fixed from the rest framing → real perspective growth
        // portrait screens: size the bodies against the (narrow) width instead
        const S = cl.sizeNorm * 2 * cl.rest.d * tanH * st.scale * portrait
        const ca = Math.cos(st.ang)
        const sa = Math.sin(st.ang)
        const ox = (p.ox * ca - p.oy * sa) * S
        const oy = (p.ox * sa + p.oy * ca) * S
        const dd = Math.max(st.d, 0.5)
        const halfH = dd * tanH
        const lx = st.x * halfH * aspect + ox
        const ly = st.y * halfH + oy
        const lz = -st.d + p.oz * S
        // rig matrix (column-major)
        px[i] = rig[0] * lx + rig[4] * ly + rig[8] * lz + rig[12]
        py[i] = rig[1] * lx + rig[5] * ly + rig[9] * lz + rig[13]
        pz[i] = rig[2] * lx + rig[6] * ly + rig[10] * lz + rig[14]
        const size = p.size * S
        sx[i] = size
        sy[i] = size * p.flatten
        rot[i] = p.rot + st.ang
        // density rises a little as the bank packs together — never a fade-out
        // only once a body has left the frame does it dissolve (keeps the
        // world view clean) — on screen, clouds always leave by moving
        a[i] = Math.min(1, p.alpha * (1 + (boost - 1) * 0.35 * st.ci)) * (1 - smooth(0.82, 1, st.pi))
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
      ext[k * 4] = p.tile
      ext[k * 4 + 1] = p.shade
      ext[k * 4 + 2] = p.light
      ext[k * 4 + 3] = rot[i]
    }
    buffers.iPos.needsUpdate = true
    buffers.iData.needsUpdate = true
    buffers.iExtra.needsUpdate = true
  })

  return <mesh ref={meshRef} geometry={geometry} material={material} frustumCulled={false} renderOrder={2} />
}
