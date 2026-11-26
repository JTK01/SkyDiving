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
 *  - parachute: Space (or automatically at CANOPY.auto m above the ground)
 *    opens the canopy over CANOPY.open s: ≈ 5 m/s down, 8 m/s forward, A/D
 *    turn, W/S faster / brakes; a canopy landing is soft (landing animation)
 *  - camera: third person behind the avatar (V toggles first person);
 *    P on foot plays the photo pose with the camera in front
 * The HUD reads the live state through `state` (no re-renders per frame).
 */
const G = 9.81
export const CANOPY = { auto: 300, open: 2.5, sink: 5, forward: 8, turn: 0.7 }
const CAM = { fall: 6.5, canopy: 11, walk: 4.2 }
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
    view: 'third', // 'third' (avatar visible) or 'first'
    canopy: false,
    canopyT: 0, // canopy opening progress 0 … 1
    soft: false, // landed under an open canopy
    photoT: 0, // photo pose time left (s)
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
      if (e.code === 'Space' && !state.ended && !state.canopy) {
        state.deployReq = true
        e.preventDefault()
      }
      if (e.code === 'KeyV' && !e.repeat) state.view = state.view === 'first' ? 'third' : 'first'
      if (e.code === 'KeyP' && !e.repeat && state.walk && state.walk.mode !== 'look') state.photoT = 2.6
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
    const f = (keys.has('f') ? 1 : 0) - (keys.has('b') ? 1 : 0)
    const s = (keys.has('r') ? 1 : 0) - (keys.has('l') ? 1 : 0)
    let { x, y, z } = from
    // parachute: on request or automatically low enough
    if (!state.canopy && (state.deployReq || state.y - world.heightAt(state.x, state.z) < CANOPY.auto)) {
      state.canopy = true
      state.canopyT = 0
      state.pitch = -0.22 // look ahead under the canopy
    }
    if (state.canopy) {
      state.canopyT = Math.min(1, state.canopyT + dt / CANOPY.open)
      // sink rate and forward speed: W faster, S brakes; A/D turn the canopy
      const sink = f > 0 ? 6.5 : f < 0 ? 3.5 : CANOPY.sink
      const fwd = (f > 0 ? 11 : f < 0 ? 4 : CANOPY.forward) * state.canopyT
      state.vy += (sink - state.vy) * Math.min(1, dt * (0.6 + 2.4 * state.canopyT))
      state.yaw -= s * CANOPY.turn * dt
      y -= state.vy * dt
      x += -Math.sin(state.yaw) * fwd * dt
      z += -Math.cos(state.yaw) * fwd * dt
    } else {
      // vertical: quadratic drag toward terminal velocity
      state.vy += G * (1 - (state.vy / drop.terminalSpeed) ** 2) * dt
      y -= state.vy * dt
      // horizontal steering relative to the view direction
      const sp = drop.steerSpeed * dt
      x += (-Math.sin(state.yaw) * f + Math.cos(state.yaw) * s) * sp
      z += (-Math.cos(state.yaw) * f - Math.sin(state.yaw) * s) * sp
    }
    const r = Math.hypot(x, z)
    if (r > drop.radius) {
      x *= drop.radius / r
      z *= drop.radius / r
    }
    const hit = world.sweep(from, { x, y, z })
    if (hit) {
      ;({ x, y, z } = hit)
      state.ended = true
      const hs = state.canopy ? CANOPY.forward * state.canopyT : (f || s) && drop.steerSpeed
      state.contact = { kind: hit.kind, part: hit.part, speed: Math.hypot(state.vy, hs), height: hit.y - world.R - hit.ground }
      state.soft = state.canopy && state.canopyT >= 1 && state.vy < 8
      state.contact.soft = state.soft
    }
    Object.assign(state, { x, y, z })
  }

  const walkStep = (dt) => {
    const w = state.walk
    if (w.mode === 'look' || state.photoT > 0 || (state.soft && w.t < 1.1)) return
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

  // third person: the camera looks along (yaw, pitch) at the target from `dist` m behind
  const thirdPerson = (tx, ty, tz, dist, feet) => {
    const cp = Math.cos(state.pitch)
    const fx = -Math.sin(state.yaw) * cp
    const fy = Math.sin(state.pitch)
    const fz = -Math.cos(state.yaw) * cp
    let cx = tx - fx * dist
    let cy = ty - fy * dist
    let cz = tz - fz * dist
    if (feet !== null) cy = Math.max(cy, world.heightAt(cx, cz) + 0.3) // not under the ground
    camera.position.set(cx, cy, cz)
    camera.rotation.set(state.pitch, state.yaw, 0)
  }

  useFrame(({ clock }, rawDt) => {
    if (state.walk) {
      // on foot: no physics
      const w = state.walk
      w.t = (w.t || 0) + rawDt
      state.photoT = Math.max(0, state.photoT - rawDt)
      walkStep(Math.min(rawDt, 0.1))
      state.y = w.feet + WALK.eye
      state.agl = w.feet - world.heightAt(state.x, state.z)
      if (state.camOverride) {
        // ?debug captures: a fixed camera { pos: [x, y, z], look: [x, y, z] }
        camera.position.set(...state.camOverride.pos)
        camera.lookAt(...state.camOverride.look)
      } else if (state.view === 'first') {
        camera.position.set(state.x, state.y, state.z)
        camera.rotation.set(state.pitch, state.yaw, 0)
      } else if (state.photoT > 0 && state.face !== undefined) {
        // photo: the camera steps in front of the avatar
        const fx = Math.sin(state.face)
        const fz = Math.cos(state.face)
        camera.position.set(state.x + fx * 3 - fz * 0.4, w.feet + 1.35, state.z + fz * 3 + fx * 0.4)
        camera.lookAt(state.x, w.feet + 0.95, state.z)
      } else thirdPerson(state.x, w.feet + 1.25, state.z, CAM.walk, w.feet)
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
        state.face = state.yaw + Math.PI // facing where the jumper was heading
        state.vy = 0
        onEnd?.(state.contact)
      }
    }
    if (world) state.agl = state.y - world.heightAt(state.x, state.z)
    const p = sim.prev && alpha < 1 ? sim.prev : null
    camera.position.set(p ? p.x + (state.x - p.x) * alpha : state.x, p ? p.y + (state.y - p.y) * alpha : state.y, p ? p.z + (state.z - p.z) * alpha : state.z)
    if (state.camOverride && state.frozen) {
      // ?debug captures in the air (frozen drop)
      camera.position.set(...state.camOverride.pos)
      camera.lookAt(...state.camOverride.look)
      return
    }
    if (state.view !== 'first') {
      thirdPerson(camera.position.x, camera.position.y + (state.canopy ? 1.5 : 0), camera.position.z, state.canopy ? CAM.canopy : CAM.fall, null)
      return
    }
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
