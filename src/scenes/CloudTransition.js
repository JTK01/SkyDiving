import gsap from 'gsap'
import { cine, CAMERA_POSES, anchorCloudsTo } from '../state/cinematic'
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
// Scene 02 — PRESS TO START → the camera flies into the hero cloud (≈3.5 s)
//
//  0.3 → 2.4  accelerating flight toward the hero cumulus (it grows by real
//             perspective until it fills the frame), fov opens 55 → 62
//  2.4 → 3.3  through the front face into the cloud, decelerating
//  2.5 → 3.0  the screen is already white → the interior layer fades in
//             underneath the 3D vapor and takes over; push keeps mist
//             streaming past the camera (and keeps drifting behind login)
//  3.5        login card (fades in from 3.8 s)
export function runConvergence() {
  if (store().locked) return null
  const tl = begin()
  const login = CAMERA_POSES.login
  tl.call(() => store().setPhase(PHASES.CONVERGING), null, 0)
    // arm the interior unseen: closed (open 0) but absent (cover 0)
    .to(cine, { open: 0, duration: MIN, ease: 'sine.inOut' }, 0)
    // flight: accelerate toward the cloud …
    .to(cine.cam, { z: 170, duration: 2.1, ease: 'power2.in' }, 0.3)
    .to(cine.cam, { y: login.y, pitch: login.pitch, duration: 2.1, ease: 'sine.inOut' }, 0.3)
    .to(cine.cam, { fov: 62, duration: 1.8, ease: 'power2.in' }, 0.6)
    // … and on into it, easing off once inside (speeds match at 2.4 s)
    .to(cine.cam, { z: login.z, duration: 0.9, ease: 'power1.out' }, 2.4)
    .to(cine.cam, { fov: login.fov, duration: 0.9, ease: 'sine.out' }, 2.4)
    // framing clouds: only a slight drift toward the flight path
    .to(cine, { converge: 1, duration: 2.6, ease: 'power1.in' }, 0.3)
    .to(cine, { brightness: 0.88, duration: 1.6, ease: 'sine.inOut' }, 0.8)
    .to(cine, { rays: 0.05, duration: 1.5, ease: 'sine.inOut' }, 0.8)
    .to(cine, { sway: 0.5, duration: 1.5, ease: 'sine.inOut' }, 0.8)
    // inside: mist rushes past, then settles into a slow drift
    .to(cine, { push: 1.1, duration: 0.7, ease: 'power1.in' }, 2.2)
    .to(cine, { push: 0.25, duration: 1.6, ease: 'sine.out' }, 3.0)
    // 2.5s: the hero cloud fills the frame → the interior takes over
    .to(cine, { cover: 1, duration: 0.5, ease: 'sine.inOut' }, 2.5)
    // 2.8s: prepare the login UI (mounted, still invisible)
    .call(() => store().setAuthMounted(true), null, 2.8)
    .to(cine, { brightness: 0.94, duration: 0.7, ease: 'sine.inOut' }, 2.8)
    // 3.5s: reveal login (card fades in from 3.8 s inside the cloud)
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
// Scene 05 — Login success → fly out of the cloud, world revealed (5 s)
//
//  0.0 → 0.6  login card fades out (AuthStage) inside the cloud
//  0.2 → 1.4  the camera accelerates forward, mist rushes past (push)
//  1.2 → 2.5  the interior vapor thins and opens ahead of the camera while
//             the 3D cloud around it still fills the frame
//  ≈1.9 → 2.5 the thinning back of the hero cloud streams past the frame,
//             clear sky opens up; god rays
//  3.0 → 5.0  tilt down to the diving space (unchanged world pose)
export function runDissipation() {
  const tl = begin()
  const world = CAMERA_POSES.world
  tl.call(() => store().setPhase(PHASES.DISSIPATING), null, 0)
    .to(cine, { push: 1.3, duration: 1.2, ease: 'power1.in' }, 0.2)
    // fly forward through the thinning back of the cloud …
    .to(cine.cam, { z: -20, duration: 2.2, ease: 'power1.in' }, 0.4)
    // … and on to the world pose, easing off (≈110 u/s at the hand-over)
    .to(cine.cam, { z: world.z, duration: 2.0, ease: 'power1.out' }, 2.6)
    // vapor thins (cover) and parts ahead of the camera (open)
    .to(cine, { cover: 0, duration: 1.3, ease: 'sine.inOut' }, 1.2)
  openBank(tl, 1.4, 1.4)
  tl
    // the framing clouds drift gently outward and fade once off-screen
    .to(cine, { disperse: 1, duration: 4.2, ease: 'sine.inOut' }, 0.0)
    .to(cine, { push: 0, duration: 1.2, ease: 'sine.out' }, 2.4)
    .to(cine, { brightness: 1.04, duration: 1.5, ease: 'sine.out' }, 0.8)
    .to(cine, { rays: 0.42, duration: 1.0, ease: 'power2.out' }, 1.8)
    .to(cine, { rays: 0.13, duration: 2.0, ease: 'sine.inOut' }, 3.0)
    // 2.0s: horizon & far world appear
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
    // the transition clouds are all faded out here (disperse = 1): re-anchor
    // them to the current view so they can roll back in around it
    .call(() => anchorCloudsTo(cine.cam), null, 0)
    // interior is still disarmed (cover 0, open 1): arm it unseen
    .to(cine, { open: 1, duration: MIN, ease: 'sine.inOut' }, 0)
    .to(cine, { cover: 1, duration: 0.6, ease: 'sine.inOut' }, 0.3)
    // the bodies drift back in from beyond the frame; HUD fades with them
    .to(cine, { worldReveal: 0, duration: 1.2, ease: 'sine.inOut' }, 0.4)
    .to(cine, { disperse: 0, duration: 2.4, ease: 'sine.inOut' }, 0)
    .to(cine, { densityBoost: 1.3, duration: 1.6, ease: 'sine.inOut' }, 0.6)
    .to(cine, { wind: 3.5, rays: 0.05, sway: 0.5, duration: 1.8, ease: 'sine.inOut' }, 0)
    .to(cine, { push: 0.9, duration: 1.2, ease: 'sine.in' }, 1.6)
    .to(cine, { push: 0.25, duration: 1.0, ease: 'sine.out' }, 2.9)
  // 1.4s → 2.7s: vapor closes in from the edges
  closeBank(tl, 1.4, 1.3)
  tl
    // 2.75s: bank fully closed → move the camera & restore fog, unseen
    .add(camTo(gsap.timeline(), login, 0, 0.6, 'sine.inOut'), 2.75)
    .to(cine, { terrainFog: 0.0018, cloudFog: 0.00055, duration: 0.6, ease: 'sine.inOut' }, 2.75)
    // still closed: put the clouds back on the intro flight path so the next
    // login flies out of the hero cloud exactly like the first time
    .call(() => anchorCloudsTo(CAMERA_POSES.intro), null, 3.0)
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
