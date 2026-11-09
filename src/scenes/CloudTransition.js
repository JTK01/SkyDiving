import gsap from 'gsap'
import { cine, CAMERA_POSES } from '../state/cinematic'
import { useExperience, PHASES } from '../state/useExperience'

/**
 * CloudTransition — the cinematic director.
 *
 * Each scene change is one GSAP timeline that tweens the shared `cine`
 * parameters (read by the WebGL layer every frame) and flips the scene state
 * at exact times. UI components animate themselves in response to the phase.
 *
 * Timelines are kept in `active` so a new one always kills the previous one
 * (no fighting tweens → no flicker), and the global `locked` flag blocks
 * double clicks while a transition runs.
 */
let active = null
const store = () => useExperience.getState()

function begin() {
  if (active) active.kill()
  store().setLocked(true)
  active = gsap.timeline({ defaults: { overwrite: 'auto' } })
  return active
}

const camTo = (tl, pose, at, duration, ease = 'power2.inOut', extra = {}) =>
  tl.to(cine.cam, { ...pose, ...extra, duration, ease }, at)

// ---------------------------------------------------------------------------
// Scene 01 — Initial sky intro (0 → ~2.5 s, then idles)
export function runIntro() {
  const tl = begin()
  Object.assign(cine.cam, CAMERA_POSES.intro, { z: CAMERA_POSES.intro.z + 14, pitch: CAMERA_POSES.intro.pitch + 0.04 })
  tl.call(() => store().setPhase(PHASES.INTRO), null, 0)
    .to(cine, { brightness: 1, duration: 1.6, ease: 'power2.out' }, 0)
    // slow settling dolly so the first frame is already in motion
    .to(cine.cam, { z: CAMERA_POSES.intro.z, pitch: CAMERA_POSES.intro.pitch, duration: 4, ease: 'power2.out' }, 0)
    .call(() => store().setLocked(false), null, 2.5)
  return tl
}

// ---------------------------------------------------------------------------
// Scene 02 — PRESS TO START → clouds converge & swallow the camera (≈3.5 s)
export function runConvergence() {
  if (store().locked) return null
  const tl = begin()
  tl.call(() => store().setPhase(PHASES.CONVERGING), null, 0)
    // 0.3s: frame-edge clouds start drifting inward; speed keeps increasing
    .to(cine, { converge: 1, duration: 2.5, ease: 'power2.in' }, 0.3)
    // 0.8s: camera creeps toward the cloud bank, sky dims slightly
    .add(camTo(gsap.timeline(), CAMERA_POSES.login, 0, 2.7, 'power1.inOut'), 0.8)
    .to(cine, { brightness: 0.86, duration: 1.6, ease: 'sine.inOut' }, 0.8)
    .to(cine, { rays: 0.05, duration: 1.5, ease: 'sine.inOut' }, 0.8)
    .to(cine, { sway: 0.5, duration: 1.5 }, 0.8)
    // 1.5s: clouds pack the centre — grow in size & density
    .to(cine, { densityBoost: 1.7, duration: 1.3, ease: 'power1.in' }, 1.5)
    // 2.2s → 2.8s: we are inside the cloud
    .to(cine, { cover: 1, duration: 0.6, ease: 'sine.inOut' }, 2.2)
    // 2.8s: prepare the login UI (mounted, still invisible)
    .call(() => store().setAuthMounted(true), null, 2.8)
    .to(cine, { brightness: 0.92, duration: 0.7 }, 2.8)
    // 3.5s: reveal login
    .call(
      () => {
        store().setAuthView('login')
        store().setPhase(PHASES.LOGIN)
      },
      null,
      3.5,
    )
  // the login card unlocks input when its own reveal finishes
  return tl
}

// ---------------------------------------------------------------------------
// Scene 05 — Login success → clouds part, world revealed (≈5 s)
export function runDissipation() {
  const tl = begin()
  const world = CAMERA_POSES.world
  tl.call(() => store().setPhase(PHASES.DISSIPATING), null, 0)
    // 0.5s: central clouds start to drift up & to the sides
    .to(cine, { disperse: 1, duration: 3.6, ease: 'power2.inOut' }, 0.5)
    // 1.0s: the interior layer tears open from the centre → blue sky
    .to(cine, { open: 1, duration: 2.1, ease: 'power2.inOut' }, 0.7)
    .to(cine, { brightness: 1.04, duration: 1.5, ease: 'sine.out' }, 0.8)
    // 1.5s: camera pushes forward, light floods through the gap
    .to(cine.cam, { z: world.z, duration: 3.5, ease: 'power2.inOut' }, 1.5)
    .to(cine, { rays: 0.7, duration: 1.0, ease: 'power2.out' }, 1.3)
    .to(cine, { rays: 0.2, duration: 2.2, ease: 'sine.inOut' }, 2.8)
    // 2.0s: density drops, horizon & far world appear
    .to(cine, { densityBoost: 1, duration: 2.0, ease: 'sine.inOut' }, 2.0)
    .to(cine, { terrainFog: 0.00055, cloudFog: 0.00045, duration: 2.6, ease: 'sine.inOut' }, 2.0)
    // 3.0s: tilt from sky view to the diving space below
    .to(
      cine.cam,
      { x: world.x, y: world.y, pitch: world.pitch, yaw: world.yaw, fov: world.fov, duration: 2.0, ease: 'power2.inOut' },
      3.0,
    )
    .to(cine, { worldReveal: 1, duration: 1.8, ease: 'sine.out' }, 3.0)
    .to(cine, { wind: 14, sway: 1, duration: 2.5, ease: 'sine.inOut' }, 2.5)
    // 4.0s: remaining clouds have cleared to the edges
    .to(cine, { brightness: 1, duration: 1.2, ease: 'sine.inOut' }, 3.4)
    .set(cine, { cover: 0, open: 0 }, 4.2)
    // 5.0s: SKY DIVE METAVERSE
    .call(
      () => {
        store().setAuthMounted(false)
        store().setPhase(PHASES.WORLD)
        store().setLocked(false)
      },
      null,
      5.0,
    )
  return tl
}

// ---------------------------------------------------------------------------
// Sign out — the clouds roll back in over the world and return to login
export function runReconvergence() {
  if (store().locked) return null
  const tl = begin()
  tl.call(() => store().setPhase(PHASES.RECONVERGING), null, 0)
    .to(cine, { worldReveal: 0, duration: 1.0, ease: 'sine.in' }, 0)
    .to(cine, { disperse: 0, duration: 2.2, ease: 'power2.inOut' }, 0)
    .to(cine, { densityBoost: 1.7, duration: 1.6 }, 0.6)
    .to(cine, { wind: 3.5, rays: 0.05, sway: 0.5, duration: 1.8 }, 0)
    .to(cine, { cover: 1, duration: 0.7, ease: 'sine.inOut' }, 1.6)
    .add(camTo(gsap.timeline(), CAMERA_POSES.login, 0, 0.01), 2.35)
    .set(cine, { terrainFog: 0.0018, cloudFog: 0.00055 }, 2.35)
    .call(() => store().setAuthMounted(true), null, 2.4)
    .call(
      () => {
        store().setAuthView('login')
        store().setPhase(PHASES.LOGIN)
      },
      null,
      2.8,
    )
  return tl
}
