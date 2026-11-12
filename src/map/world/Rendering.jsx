import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { useQuality, preset, FIXED_SCALE, frameLog, gpuName } from '../quality'

/**
 * Light post-processing: scene → half-float target, a weak half-resolution
 * bloom (sun disc, glints, bright stone), then OutputPass applies the
 * renderer's Neutral tone mapping and sRGB. Without bloom (low preset) the
 * renderer tone-maps directly — no extra passes at all.
 */
export function PostFX({ samples = 0 }) {
  const { gl, scene, camera, size } = useThree()
  const dpr = useThree((s) => s.viewport.dpr)
  const composer = useMemo(() => {
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples })
    const c = new EffectComposer(gl, target)
    // Render → bloom (in place) → output to screen never needs a ping-pong:
    // everything happens in readBuffer (renderTarget2, the MSAA clone).
    // renderTarget1 stays 1×1 (a full-size multisampled half-float copy would
    // cost 1920×1080×8×samples bytes + depth for nothing).
    c.renderTarget1.samples = 0
    c.renderTarget1.depthBuffer = false
    c.addPass(new RenderPass(scene, camera))
    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.16, 0.4, 1.0) // only true highlights
    c.addPass(bloom)
    const output = new OutputPass()
    output.needsSwap = false // keep readBuffer as the scene target every frame
    c.addPass(output)
    c.bloom = bloom
    return c
  }, [gl, scene, camera, samples])
  useEffect(() => {
    composer.setPixelRatio(dpr)
    composer.setSize(size.width, size.height)
    composer.renderTarget1.setSize(1, 1)
    // bloom at half resolution (UnrealBloomPass halves again internally per mip)
    composer.bloom.setSize(Math.round((size.width * dpr) / 2), Math.round((size.height * dpr) / 2))
  }, [composer, size, dpr])
  useEffect(() => () => composer.dispose(), [composer])
  useFrame(() => composer.render(), 1)
  return null
}

/**
 * Frame statistics + automatic resolution scale within the preset's range:
 * every second, avg frame > 17.5 ms → −5 %, < 13 ms → +5 %.
 * Also counts draw calls / triangles per frame (gl.info) for the HUD.
 */
export function AutoResolution({ quality }) {
  const gl = useThree((s) => s.gl)
  // the Canvas reads its dpr from the store (a setDpr() here would be undone
  // by the Canvas' own dpr prop on its next render)
  const setDpr = (v) => useQuality.setState({ dpr: v })
  const st = useRef({ t: 0, n: 0, sum: 0, worst: 0, scale: FIXED_SCALE ?? preset(quality).dpr[1] })
  const base = Math.min(window.devicePixelRatio || 1, 1.5)
  useEffect(() => {
    gl.info.autoReset = false
    st.current.scale = FIXED_SCALE ?? preset(quality).dpr[1]
    setDpr(base * st.current.scale)
    frameLog.info = { gpu: gpuName(gl), preset: quality }
    return () => {
      gl.info.autoReset = true
    }
  }, [gl, quality, base]) // eslint-disable-line react-hooks/exhaustive-deps
  // priority 0 only: a positive priority would switch off R3F's own render.
  // gl.info accumulates over the previous frame (all passes), read then reset.
  useFrame((_, dt) => {
    const s = st.current
    const calls = gl.info.render.calls
    const triangles = gl.info.render.triangles
    gl.info.reset()
    s.calls = calls
    s.tris = triangles
    const ms = dt * 1000
    if (frameLog.recording) frameLog.ms.push(ms)
    s.n++
    s.sum += ms
    s.worst = Math.max(s.worst, ms)
    s.t += dt
    if (s.t < 1) return
    const avg = s.sum / s.n
    const [lo, hi] = preset(quality).dpr
    let next = s.scale
    if (FIXED_SCALE) next = s.scale
    else if (avg > 17.5) next = Math.max(lo, s.scale - 0.05)
    else if (avg < 13) next = Math.min(hi, s.scale + 0.05)
    if (next !== s.scale) {
      s.scale = next
      setDpr(base * next)
    }
    useQuality.getState().setStats({
      fps: Math.round(s.n / s.t),
      frameMs: +avg.toFixed(1),
      worstMs: +s.worst.toFixed(1),
      scale: +(base * s.scale).toFixed(2),
      calls: s.calls,
      triangles: s.tris,
      geometries: gl.info.memory.geometries,
      textures: gl.info.memory.textures,
    })
    Object.assign(s, { t: 0, n: 0, sum: 0, worst: 0 })
  })
  return null
}
