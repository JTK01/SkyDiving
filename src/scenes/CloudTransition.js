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
/** for tooling / debugging (see App.jsx `?debug`) */
export const getActiveTimeline = () => active
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
// Transition rules (from the frame-by-frame audit):
//  · no .set / sub-0.4 s tweens — every change is an eased tween ≥ 0.4 s
//  · the cloud-interior layer never fades as a flat veil: it is armed with
//    cover while open = 1 (invisible), then closes / opens spatially via open
//  · camera pose and fog only change while the bank is fully closed
//  · UI fades overlap the clouds covering it (see IntroScene / MetaverseScene)
const MIN = 0.4

// The interior's hole is only on screen for open < ~0.95 (beyond that it
// lies outside the frame corners, even on portrait screens), and the visible
// sky area grows with the hole radius squared. These eases make the *area*
// change roughly linearly in time with soft ends, so the sky closes / opens
// at an even pace instead of the last part snapping shut.
const OPEN_VISIBLE = 0.95
const smooth = (p) => p * p * (3 - 2 * p)
const closeEase = (p) => 1 - Math.sqrt(Math.max(0, 1 - smooth(p))) // OPEN_VISIBLE → 0
const openEase = (p) => Math.sqrt(smooth(p)) // 0 → OPEN_VISIBLE

/** close the bank from the frame edges: invisible 1 → 0.95, then visible → 0 */
const closeBank = (tl, at, duration) =>
  tl
    .to(cine, { open: OPEN_VISIBLE, duration: MIN, ease: 'sine.in' }, at - MIN)
    .to(cine, { open: 0, duration, ease: closeEase }, at)
/** tear the bank open from the centre: visible 0 → 0.95, then invisible → 1 */
const openBank = (tl, at, duration) =>
  tl
    .to(cine, { open: OPEN_VISIBLE, duration, ease: openEase }, at)
    .to(cine, { open: 1, duration: MIN, ease: 'sine.out' }, at + duration)

// ---------------------------------------------------------------------------
// Scene 02 — PRESS TO START → clouds converge & swallow the camera (≈3.5 s)
export function runConvergence() {
  if (store().locked) return null
  const tl = begin()
  tl.call(() => store().setPhase(PHASES.CONVERGING), null, 0)
    // arm the interior while its hole still fills the frame (invisible)
    .to(cine, { open: 1, duration: MIN, ease: 'sine.inOut' }, 0)
    .to(cine, { cover: 1, duration: 0.6, ease: 'sine.inOut' }, 0.3)
    // 0.3s: frame-edge clouds start drifting inward; speed keeps increasing
    .to(cine, { converge: 1, duration: 2.6, ease: 'power1.in' }, 0.3)
    // 0.8s: camera creeps toward the cloud bank, sky dims slightly
    .add(camTo(gsap.timeline(), CAMERA_POSES.login, 0, 2.7, 'power1.inOut'), 0.8)
    .to(cine, { brightness: 0.86, duration: 1.6, ease: 'sine.inOut' }, 0.8)
    .to(cine, { rays: 0.05, duration: 1.5, ease: 'sine.inOut' }, 0.8)
    .to(cine, { sway: 0.5, duration: 1.5, ease: 'sine.inOut' }, 0.8)
    // 1.5s: the bank thickens — density only; size grows through perspective
    .to(cine, { densityBoost: 1.3, duration: 1.3, ease: 'power1.in' }, 1.5)
    .to(cine, { push: 1, duration: 2.4, ease: 'power2.out' }, 2.2)
  // 1.8s → 3.1s: vapor closes in from the frame edges over the converging
  // bodies; the centre (where the title sits) closes last
  closeBank(tl, 1.8, 1.3)
  tl
    // 2.8s: prepare the login UI (mounted, still invisible)
    .call(() => store().setAuthMounted(true), null, 2.8)
    .to(cine, { brightness: 0.92, duration: 0.7, ease: 'sine.inOut' }, 2.8)
    // 3.5s: reveal login (card fades in from 3.8 s on a fully closed bank)
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
    // 0.0–0.6s: login card fades out on the closed bank (AuthStage)
    // 0.0s: bodies behind the bank start to drift apart well *before* the
    // bank opens, so the opening reveals clouds already leaving (no re-cover)
    .to(cine, { disperse: 1, duration: 4.2, ease: 'sine.inOut' }, 0.0)
    .to(cine, { push: 1.6, duration: 1.6, ease: 'power1.in' }, 0)
  // 1.0s → 3.3s: the interior tears open from the centre → blue sky
  openBank(tl, 1.0, 2.3)
  tl
    .to(cine, { brightness: 1.04, duration: 1.5, ease: 'sine.out' }, 0.8)
    // 1.5s: camera pushes forward, light floods through the gap
    .to(cine.cam, { z: world.z, duration: 3.5, ease: 'power2.inOut' }, 1.5)
    .to(cine, { rays: 0.42, duration: 1.0, ease: 'power2.out' }, 1.3)
    .to(cine, { rays: 0.13, duration: 2.2, ease: 'sine.inOut' }, 2.8)
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
    .to(cine, { brightness: 1, duration: 1.2, ease: 'sine.inOut' }, 3.4)
    // 3.2s+: the bank is fully open (invisible) — disarm it with a tween;
    // open stays 1 (resting state), so nothing on screen changes
    .to(cine, { cover: 0, duration: 0.6, ease: 'sine.inOut' }, 4.2)
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
  const login = CAMERA_POSES.login
  tl.call(() => store().setPhase(PHASES.RECONVERGING), null, 0)
    // interior is still disarmed (cover 0, open 1): reset push & arm it unseen
    .to(cine, { push: 0, duration: 0.5, ease: 'sine.inOut' }, 0)
    .to(cine, { open: 1, duration: MIN, ease: 'sine.inOut' }, 0)
    .to(cine, { cover: 1, duration: 0.6, ease: 'sine.inOut' }, 0.3)
    // the bodies drift back in from beyond the frame; HUD fades with them
    .to(cine, { worldReveal: 0, duration: 1.2, ease: 'sine.inOut' }, 0.4)
    .to(cine, { disperse: 0, duration: 2.4, ease: 'sine.inOut' }, 0)
    .to(cine, { densityBoost: 1.3, duration: 1.6, ease: 'sine.inOut' }, 0.6)
    .to(cine, { wind: 3.5, rays: 0.05, sway: 0.5, duration: 1.8, ease: 'sine.inOut' }, 0)
    .to(cine, { push: 1, duration: 2.0, ease: 'power2.out' }, 1.8)
  // 1.4s → 2.7s: vapor closes in from the edges
  closeBank(tl, 1.4, 1.3)
  tl
    // 2.75s: bank fully closed → move the camera & restore fog, unseen
    .add(camTo(gsap.timeline(), login, 0, 0.6, 'sine.inOut'), 2.75)
    .to(cine, { terrainFog: 0.0018, cloudFog: 0.00055, duration: 0.6, ease: 'sine.inOut' }, 2.75)
    .call(() => store().setAuthMounted(true), null, 2.9)
    .call(
      () => {
        store().setAuthView('login')
        store().setPhase(PHASES.LOGIN)
      },
      null,
      3.4,
    )
  return tl
}
