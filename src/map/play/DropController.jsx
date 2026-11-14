import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { BENCH, frameLog, summarizeFrames, useQuality } from '../quality'
import { edgeDist, polyDist } from './collision'

/**
 * Free fall above the landmark.
 *  - starts `altitude` m above the ground, straight above the landmark
 *  - accelerates to terminal velocity (no parachute)
 *  - WASD / arrow keys steer horizontally, drag the mouse (or a finger) to look
 *  - the horizontal position is held inside `radius` m of the landmark
 *  - ends the moment the body touches the terrain, a building or the
 *    basilica (`world`: CollisionWorld, swept every frame, see collision.js);
 *    state.contact = { kind, part, speed } and onEnd(contact)
 *  - physics runs at a fixed 120 Hz step, the camera is interpolated between
 *    the last two steps; no camera shake unless the 'wind sway' setting is on
 * The HUD reads the live state through `state` (no re-renders per frame).
 */
const G = 9.81
const STEP = 1 / 120 // physics step (s)
export const SWAY_RAD = 0.0005 // wind sway amplitude when enabled (≈ 0.03°)
const KEYS = { KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r', ShiftLeft: 'run', ShiftRight: 'run' }

// on foot after landing
export const WALK = { radius: 50, eye: 1.6, body: 0.35, speed: 1.4, run: 4, pitchMax: 1.48 }

/**
 * Where and how the jumper stands after touching something:
 *  ground → walk within WALK.radius m of the landing point (feet on the terrain)
 *  roof   → walk inside that roof's outline only
 *  look   → landed on the basilica: no walkable surface, look around only
 * A wall hit (steering into a façade) puts the jumper on the ground beside it.
 */
export function walkSetup(world, state) {
  const c = state.contact
  if (c?.kind === 'basilica') return { mode: 'look', feet: state.y - WALK.eye }
  if (c?.kind === 'building' && c.part === 'roof') {
    const b = world.buildingAt(state.x, state.z)
    if (b) {
      // keep the body off the parapet: step toward the roof's centre if needed
      let { x, z } = state
      const r = b.ring
      let cx = 0
      let cz = 0
      for (let k = 0; k < r.length; k += 2) {
        cx += r[k] / (r.length / 2)
        cz += r[k + 1] / (r.length / 2)
      }
      for (let k = 0; k < 20 && edgeDist(r, x, z) < WALK.body; k++) {
        x += (cx - x) * 0.15
        z += (cz - z) * 0.15
      }
      return { mode: 'roof', ring: r, feet: b.top, x, z }
    }
  }
  // ground: the nearest free spot (a wall contact leaves the body against it)
  for (let k = 0; k < 64; k++) {
    const a = k * 2.39996
    const d = k ? 0.4 * Math.sqrt(k) : 0
    const x = state.x + Math.cos(a) * d
    const z = state.z + Math.sin(a) * d
    const feet = world.heightAt(x, z)
    if (!world.blocked(x, feet, z, WALK.body)) return { mode: 'ground', ox: state.x, oz: state.z, feet, x, z }
  }
  return { mode: 'look', feet: world.heightAt(state.x, state.z) }
}

export function createDropState(drop, groundY, yawDeg) {
  return {
    x: drop.start?.[0] ?? 0,
    z: drop.start?.[1] ?? 0,
    y: groundY + drop.altitude,
    vy: 0,
    yaw: THREE.MathUtils.degToRad(yawDeg),
    pitch: -1.42, // almost straight down: the basilica is in the middle of the view
    ended: false,
    contact: null,
    walk: null, // on foot after the landing (walkSetup)
    agl: drop.altitude,
    t: 0,
  }
}

export default function DropController({ drop, world, state, onEnd, enabled = true }) {
  const { camera, gl } = useThree()
  const sway = useQuality((q) => q.sway)
  const keys = useRef(new Set()).current
  const drag = useRef(null)

  useEffect(() => {
    camera.rotation.order = 'YXZ'
    const kd = (e) => {
      if (KEYS[e.code]) {
        keys.add(KEYS[e.code])
        e.preventDefault()
      }
    }
    const ku = (e) => keys.delete(KEYS[e.code])
    const el = gl.domElement
    const pd = (e) => {
      drag.current = { x: e.clientX, y: e.clientY, yaw: state.yaw, pitch: state.pitch }
      el.setPointerCapture(e.pointerId)
    }
    const pm = (e) => {
      if (!drag.current) return
      state.yaw = drag.current.yaw - (e.clientX - drag.current.x) * 0.0045
      state.pitch = THREE.MathUtils.clamp(drag.current.pitch - (e.clientY - drag.current.y) * 0.0045, -1.52, state.walk ? WALK.pitchMax : 0.35)
    }
    const pu = () => (drag.current = null)
    window.addEventListener('keydown', kd)
    window.addEventListener('keyup', ku)
    el.addEventListener('pointerdown', pd)
    el.addEventListener('pointermove', pm)
    el.addEventListener('pointerup', pu)
    el.addEventListener('pointercancel', pu)
    el.style.touchAction = 'none'
    return () => {
      window.removeEventListener('keydown', kd)
      window.removeEventListener('keyup', ku)
      el.removeEventListener('pointerdown', pd)
      el.removeEventListener('pointermove', pm)
      el.removeEventListener('pointerup', pu)
      el.removeEventListener('pointercancel', pu)
    }
  }, [camera, gl, keys, state])

  // fixed-step simulation: the same motion at any frame rate; the camera is
  // drawn between the last two physics states (no judder, no slow motion)
  const sim = useRef({ acc: 0, prev: null }).current
  const physics = (dt) => {
    const from = { x: state.x, y: state.y, z: state.z }
    sim.prev = from
    state.t += dt
    // vertical: quadratic drag toward terminal velocity
    state.vy += G * (1 - (state.vy / drop.terminalSpeed) ** 2) * dt
    let { x, y, z } = from
    y -= state.vy * dt
    // horizontal steering relative to the view direction
    const f = (keys.has('f') ? 1 : 0) - (keys.has('b') ? 1 : 0)
    const s = (keys.has('r') ? 1 : 0) - (keys.has('l') ? 1 : 0)
    const sp = drop.steerSpeed * dt
    x += (-Math.sin(state.yaw) * f + Math.cos(state.yaw) * s) * sp
    z += (-Math.cos(state.yaw) * f - Math.sin(state.yaw) * s) * sp
    const r = Math.hypot(x, z)
    if (r > drop.radius) {
      x *= drop.radius / r
      z *= drop.radius / r
    }
    const hit = world.sweep(from, { x, y, z })
    if (hit) {
      ;({ x, y, z } = hit)
      state.ended = true
      state.contact = { kind: hit.kind, part: hit.part, speed: Math.hypot(state.vy, (f || s) && drop.steerSpeed), height: hit.y - world.R - hit.ground }
    }
    Object.assign(state, { x, y, z })
  }

  const walkStep = (dt) => {
    const w = state.walk
    if (w.mode === 'look') return
    const f = (keys.has('f') ? 1 : 0) - (keys.has('b') ? 1 : 0)
    const s = (keys.has('r') ? 1 : 0) - (keys.has('l') ? 1 : 0)
    if (!f && !s) return
    const sp = (keys.has('run') ? WALK.run : WALK.speed) * dt / Math.hypot(f, s)
    const dx = (-Math.sin(state.yaw) * f + Math.cos(state.yaw) * s) * sp
    const dz = (-Math.cos(state.yaw) * f - Math.sin(state.yaw) * s) * sp
    const feetAt = (x, z) => (w.mode === 'roof' ? w.feet : world.heightAt(x, z))
    const ok = (x, z) => {
      if (w.mode === 'roof') {
        if (polyDist(w.ring, x, z) > 0 || edgeDist(w.ring, x, z) < WALK.body) return false
      } else if (Math.hypot(x - w.ox, z - w.oz) > WALK.radius) return false
      return !world.blocked(x, feetAt(x, z), z, WALK.body)
    }
    // full step, else slide along the wall / boundary
    for (const [x, z] of [[state.x + dx, state.z + dz], [state.x + dx, state.z], [state.x, state.z + dz]])
      if (ok(x, z)) {
        state.x = x
        state.z = z
        w.feet = feetAt(x, z)
        break
      }
  }

  useFrame(({ clock }, rawDt) => {
    if (state.walk) {
      // on foot: no physics, the camera is the eye
      walkStep(Math.min(rawDt, 0.1))
      state.y = state.walk.feet + WALK.eye
      state.agl = state.walk.feet - world.heightAt(state.x, state.z)
      camera.position.set(state.x, state.y, state.z)
      camera.rotation.set(state.pitch, state.yaw, 0)
      return
    }
    const dt = Math.min(rawDt, 0.25) // after a stall: catch up at most 0.25 s
    let alpha = 1
    if (enabled && world && !state.ended && !state.frozen) { // frozen: ?debug inspection only
      if (state.t === 0) {
        // frame-time log of this drop (shown with ?bench / ?debug)
        frameLog.ms = []
        frameLog.recording = true
        sim.acc = 0
      }
      if (BENCH) {
        // hands-off benchmark: slow pan, tilting from straight down toward the horizon
        state.yaw += 0.12 * dt
        state.pitch = -1.42 + Math.min(1, state.t / 12) * 0.9
      }
      sim.acc += dt
      while (sim.acc >= STEP && !state.ended) {
        physics(STEP)
        sim.acc -= STEP
      }
      alpha = state.ended ? 1 : sim.acc / STEP
      if (state.ended) {
        frameLog.recording = false
        const sum = summarizeFrames(frameLog.ms)
        state.bench = sum && { ...sum, ...frameLog.info, buffer: `${gl.domElement.width}×${gl.domElement.height}`, css: `${gl.domElement.clientWidth}×${gl.domElement.clientHeight}`, dpr: window.devicePixelRatio || 1 }
        if (window.__skydive) window.__skydive.bench = state.bench
        if (state.bench) console.info('[bench]', JSON.stringify(state.bench))
        // stand up: look level from the landing spot
        const w = walkSetup(world, state)
        state.walk = w
        if (w.x !== undefined) Object.assign(state, { x: w.x, z: w.z })
        state.pitch = w.mode === 'look' ? Math.max(state.pitch, -0.6) : 0.05
        state.vy = 0
        onEnd?.(state.contact)
      }
    }
    if (world) state.agl = state.y - world.heightAt(state.x, state.z)
    const p = sim.prev && alpha < 1 ? sim.prev : null
    camera.position.set(p ? p.x + (state.x - p.x) * alpha : state.x, p ? p.y + (state.y - p.y) * alpha : state.y, p ? p.z + (state.z - p.z) * alpha : state.z)
    // optional wind sway (setting, off by default): ±0.03°, slow (0.3–0.6 Hz)
    let swayP = 0
    let swayY = 0
    if (sway && enabled && !state.ended && !state.frozen) {
      const a = SWAY_RAD * Math.min(1, state.vy / drop.terminalSpeed)
      const t = clock.elapsedTime
      swayP = a * (0.6 * Math.sin(t * 2.1) + 0.4 * Math.sin(t * 3.7 + 1.3))
      swayY = a * (0.6 * Math.sin(t * 1.7 + 0.5) + 0.4 * Math.sin(t * 2.9 + 2.1))
    }
    camera.rotation.set(state.pitch + swayP, state.yaw + swayY, 0)
  })
  return null
}
