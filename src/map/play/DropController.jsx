import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { BENCH, frameLog, summarizeFrames } from '../quality'

/**
 * Free fall above the landmark.
 *  - starts `altitude` m above the ground, straight above the landmark
 *  - accelerates to terminal velocity (no parachute)
 *  - WASD / arrow keys steer horizontally, drag the mouse (or a finger) to look
 *  - the horizontal position is held inside `radius` m of the landmark
 *  - ends the moment the body touches the terrain, a building or the
 *    basilica (`world`: CollisionWorld, swept every frame, see collision.js);
 *    state.contact = { kind, part, speed } and onEnd(contact)
 * The HUD reads the live state through `state` (no re-renders per frame).
 */
const G = 9.81
const KEYS = { KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r' }

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
    agl: drop.altitude,
    t: 0,
  }
}

export default function DropController({ drop, world, state, onEnd, enabled = true }) {
  const { camera, gl } = useThree()
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
      state.pitch = THREE.MathUtils.clamp(drag.current.pitch - (e.clientY - drag.current.y) * 0.0045, -1.52, 0.35)
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

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    if (enabled && world && !state.ended && !state.frozen) { // frozen: ?debug inspection only
      const from = { x: state.x, y: state.y, z: state.z }
      if (state.t === 0) {
        // frame-time log of this drop (shown with ?bench / ?debug)
        frameLog.ms = []
        frameLog.recording = true
      }
      state.t += dt
      if (BENCH) {
        // hands-off benchmark: slow pan, tilting from straight down toward the horizon
        state.yaw += 0.12 * dt
        state.pitch = -1.42 + Math.min(1, state.t / 12) * 0.9
      }
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
      if (state.ended) {
        frameLog.recording = false
        const sum = summarizeFrames(frameLog.ms)
        state.bench = sum && { ...sum, ...frameLog.info, buffer: `${gl.domElement.width}×${gl.domElement.height}`, css: `${gl.domElement.clientWidth}×${gl.domElement.clientHeight}`, dpr: window.devicePixelRatio || 1 }
        if (window.__skydive) window.__skydive.bench = state.bench
        if (state.bench) console.info('[bench]', JSON.stringify(state.bench))
        onEnd?.(state.contact)
      }
    }
    if (world) state.agl = state.y - world.heightAt(state.x, state.z)
    // a little buffeting at speed
    const shake = enabled && !state.ended ? (state.vy / drop.terminalSpeed) * 0.004 : 0
    camera.position.set(state.x, state.y, state.z)
    camera.rotation.set(state.pitch + Math.sin(state.t * 23) * shake, state.yaw + Math.sin(state.t * 17) * shake, 0)
  })
  return null
}
