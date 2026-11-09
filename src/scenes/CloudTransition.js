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
// sky area grows with the hole radius squared. This ease makes the *area*
// change roughly linearly in time with soft ends, so the sky closes at an
// even pace instead of the last part snapping shut (sign-out only).
const OPEN_VISIBLE = 0.95
const smooth = (p) => p * p * (3 - 2 * p)
const closeEase = (p) => 1 - Math.sqrt(Math.max(0, 1 - smooth(p))) // OPEN_VISIBLE → 0

/** close the bank from the frame edges: invisible 1 → 0.95, then visible → 0 */
const closeBank = (tl, at, duration) =>
  tl
    .to(cine, { open: OPEN_VISIBLE, duration: MIN, ease: 'sine.in' }, at - MIN)
    .to(cine, { open: 0, duration, ease: closeEase }, at)


// ---------------------------------------------------------------------------
// Scene 02 — PRESS TO START → skydive: tip over and fall into the deck (3.5 s)
//
//  0.1 → 1.5  the camera tips forward, pitch −0.14 → −1.2 (almost straight
//             down), fov opens 58 → 62
//  0.5 → 2.4  the fall starts and accelerates (y 540 → 375, ≈174 u/s at the
//             end) while drifting over the deck's descent cluster
//  2.35→ 2.85 the descent cluster fills the frame → the interior takes over
//  2.4 → 3.26 through the cloud top, easing into the login pose (y 300,
//             inside the cloud, looking down); mist keeps streaming past
//  3.5        login card (fades in from ≈3.8 s)
export function runConvergence() {
  if (store().locked) return null
  const tl = begin()
  const login = CAMERA_POSES.login
  tl.call(() => store().setPhase(PHASES.CONVERGING), null, 0)
    // arm the interior unseen: closed (open 0) but absent (cover 0)
    .to(cine, { open: 0, duration: MIN, ease: 'sine.inOut' }, 0)
    // tip over …
    .to(cine.cam, { pitch: login.pitch, duration: 1.4, ease: 'sine.inOut' }, 0.1)
    .to(cine.cam, { fov: login.fov, duration: 1.6, ease: 'sine.inOut' }, 1.0)
    // … and fall, accelerating toward the cloud top …
    // (GSAP power1 = quadratic: end speed 2·165/1.9 ≈ 174 u/s)
    .to(cine.cam, { y: 375, duration: 1.9, ease: 'power1.in' }, 0.5)
    // one continuous forward drift over the descent cluster (no velocity kink)
    .to(cine.cam, { z: login.z, duration: 2.7, ease: 'sine.inOut' }, 0.5)
    // … then through it, easing into the login pose (start speed
    // 2·75/0.86 ≈ 174 u/s — exactly the fall speed at 2.4 s)
    .to(cine.cam, { y: login.y, duration: 0.86, ease: 'power1.out' }, 2.4)
    .to(cine, { brightness: 0.9, duration: 1.6, ease: 'sine.inOut' }, 0.8)
    .to(cine, { rays: 0.05, duration: 1.5, ease: 'sine.inOut' }, 0.8)
    .to(cine, { sway: 0.5, duration: 1.5, ease: 'sine.inOut' }, 0.8)
    // inside: mist rushes past, then settles into a slow drift
    .to(cine, { push: 1.1, duration: 0.7, ease: 'power1.in' }, 2.2)
    .to(cine, { push: 0.25, duration: 1.6, ease: 'sine.out' }, 3.0)
    // the descent cluster fills the frame → the interior takes over
    .to(cine, { cover: 1, duration: 0.5, ease: 'sine.inOut' }, 2.35)
    // 2.8s: prepare the login UI (mounted, still invisible)
    .call(() => store().setAuthMounted(true), null, 2.8)
    .to(cine, { brightness: 0.94, duration: 0.7, ease: 'sine.inOut' }, 2.8)
    // 3.5s: reveal login (inside the cloud, looking down)
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
// Scene 05 — Login success → fall out of the deck, level out over the sea (5 s)
//
//  0.0 → 0.6  login card fades out (AuthStage) inside the cloud
//  0.2 → 0.8  the fall resumes (y 300 → 282), reaching ≈60 u/s
//  0.8 → 1.9  constant fall through the cloud (y 282 → 216, 60 u/s) and
//             out of the deck's underside (≈y 250, ≈1.4 s)
//  1.0 → 3.0  the vapor clears unevenly over the whole frame (thin parts
//             first, front sheet → back sheet), streaming upward; the sea of
//             clouds below shows through the growing gaps
//  1.7 → 2.6  the deck — now above, out of view — fades out (cine.deck)
//  1.9 → 4.4  the fall slows into level flight (y → 142, 60 u/s at 1.9 s)
//  2.0 → 4.6  the camera pulls up from −1.2 to the world pose (−0.21) while
//             gliding forward (z −40 → −140): the landscape opens up ahead
export function runDissipation() {
  const tl = begin()
  const world = CAMERA_POSES.world
  tl.call(() => store().setPhase(PHASES.DISSIPATING), null, 0)
    .to(cine, { push: 1.2, duration: 0.9, ease: 'power1.in' }, 0.1)
    // fall: accelerate → constant → decelerate into level flight
    .to(cine.cam, { y: 282, duration: 0.6, ease: 'power1.in' }, 0.2)
    .to(cine.cam, { y: 216, duration: 1.1, ease: 'none' }, 0.8)
    // start speed 2·74/2.47 = 60 u/s = the constant fall → seamless
    .to(cine.cam, { y: world.y, duration: 2.47, ease: 'power1.out' }, 1.9)
    // pull up & glide forward to the world pose
    .to(cine.cam, { pitch: world.pitch, yaw: world.yaw, fov: world.fov, duration: 2.6, ease: 'sine.inOut' }, 2.0)
    .to(cine.cam, { x: world.x, z: world.z, duration: 2.9, ease: 'sine.inOut' }, 1.9)
    // the vapor clears unevenly all over the frame — thin parts first, the
    // front sheet before the back one — while streaming upward past the
    // falling camera (no radial hole: see CloudInterior, uClear / uRise)
    .to(cine, { rise: 0.32, duration: 0.6, ease: 'sine.in' }, 0.8)
    .to(cine, { clear: 1, duration: 2.0, ease: 'sine.inOut' }, 1.0)
    .to(cine, { rise: 0, duration: 0.6, ease: 'sine.out' }, 3.0)
    // nothing left of the bank by 3.0 s → disarm it unseen and return to the
    // resting state (cover 0, open 1, clear 0) while it is invisible
    .to(cine, { cover: 0, duration: MIN, ease: 'sine.inOut' }, 3.05)
    .to(cine, { open: 1, clear: 0, duration: MIN, ease: 'sine.inOut' }, 3.5)
    .to(cine, { deck: 0, duration: 0.9, ease: 'sine.inOut' }, 1.7)
    .to(cine, { push: 0, duration: 1.2, ease: 'sine.out' }, 2.2)
    .to(cine, { brightness: 1.04, duration: 1.5, ease: 'sine.out' }, 0.8)
    .to(cine, { rays: 0.42, duration: 1.0, ease: 'power2.out' }, 3.2)
    .to(cine, { rays: 0.13, duration: 1.4, ease: 'sine.inOut' }, 4.2)
    // horizon & far world appear
    .to(cine, { terrainFog: 0.00055, cloudFog: 0.00045, duration: 2.6, ease: 'sine.inOut' }, 2.0)
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
// Sign out — vapor closes in over the world, back inside the deck (3.4 s)
//
//  0.0 → 0.9  interior armed unseen (open 1 → cover 1)
//  0.4 → 1.6  HUD / world props fade
//  0.6 → 2.6  the camera dips its nose (pitch −0.21 → −0.45)
//  1.4 → 2.7  vapor closes in from the frame edges
//  2.75→ 3.35 bank fully closed → camera to the login pose (inside the deck,
//             looking down), start deck & fog restored — all unseen
export function runReconvergence() {
  if (store().locked) return null
  const tl = begin()
  const login = CAMERA_POSES.login
  tl.call(() => store().setPhase(PHASES.RECONVERGING), null, 0)
    // interior is still disarmed (cover 0, open 1): arm it unseen
    .to(cine, { push: 0, duration: 0.5, ease: 'sine.inOut' }, 0)
    .to(cine, { open: 1, duration: MIN, ease: 'sine.inOut' }, 0)
    .to(cine, { cover: 1, duration: 0.6, ease: 'sine.inOut' }, 0.3)
    .to(cine, { worldReveal: 0, duration: 1.2, ease: 'sine.inOut' }, 0.4)
    .to(cine, { wind: 3.5, rays: 0.05, sway: 0.5, duration: 1.8, ease: 'sine.inOut' }, 0)
    .to(cine.cam, { pitch: -0.45, duration: 2.0, ease: 'sine.inOut' }, 0.6)
    .to(cine, { push: 0.9, duration: 1.2, ease: 'sine.in' }, 1.6)
    .to(cine, { push: 0.25, duration: 1.0, ease: 'sine.out' }, 2.9)
  closeBank(tl, 1.4, 1.3)
  tl
    // bank fully closed → back into the deck, unseen
    .add(camTo(gsap.timeline(), login, 0, 0.6, 'sine.inOut'), 2.75)
    .to(cine, { deck: 1, terrainFog: 0.0018, cloudFog: 0.00055, duration: 0.6, ease: 'sine.inOut' }, 2.75)
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
