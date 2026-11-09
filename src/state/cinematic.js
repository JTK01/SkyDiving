import * as THREE from 'three'

/**
 * Mutable cinematic parameters.
 *
 * GSAP timelines tween these numbers directly; the WebGL layer reads them every
 * frame inside useFrame. Nothing here triggers React re-renders, which keeps
 * the transitions perfectly smooth.
 */

/** Camera poses for each scene (position in world units, angles in radians). */
export const CAMERA_POSES = {
  // Scene 01 — high above two cloud layers: the start deck (y≈270–370,
  // see CLOUD_CONFIG.startDeck) and the sea of clouds far below; looking
  // slightly below the horizon through the open centre of the deck
  intro: { x: 0, y: 540, z: 60, pitch: -0.18, yaw: 0, roll: 0, fov: 58 },
  // Scene 02/03 — skydiving: inside the start deck's descent cluster,
  // looking almost straight down
  login: { x: 0, y: 300, z: -40, pitch: -1.2, yaw: 0, roll: 0, fov: 62 },
  // Main world — behind & above the jumper, looking over the cloud sea
  world: { x: 0, y: 142, z: -140, pitch: -0.21, yaw: 0, roll: 0, fov: 58 },
}

export const cine = {
  // ---- cloud transition controls --------------------------------------
  converge: 0, // 0 = clouds framing the screen edges, 1 = packed in the centre
  disperse: 0, // 0 = packed, 1 = scattered up / sideways past the screen edges
  densityBoost: 1, // >1 grows size & opacity of the transition clouds
  cover: 0, // full-screen "inside the cloud" layer coverage
  // radial opening of the interior layer. Resting state is 1 (hole fills
  // the frame → layer invisible even when cover changes); 1 → 0 closes the
  // bank in from the edges, 0 → 1 tears it open from the centre
  open: 1,
  // fly-through speed inside the cloud: how fast the interior vapor streams
  // past the camera (0 = still, ~0.25 = gentle drift, 1+ = rushing through)
  push: 0,
  deck: 1, // start-deck opacity (1 before WORLD, 0 in WORLD)

  // ---- atmosphere ------------------------------------------------------
  brightness: 0, // global light level (0 = black, 1 = normal)
  rays: 0.16, // god-ray intensity
  cloudFog: 0.00055, // aerial perspective on clouds
  terrainFog: 0.0018, // haze hiding the mountains until the world reveal
  wind: 3.5, // world units / s the cloud field streams toward the camera
  windOffset: 0, // accumulated wind travel (written by CloudSystem)
  worldReveal: 0, // avatar slots / world props
  sway: 1, // idle camera breathing amount

  // ---- camera ----------------------------------------------------------
  cam: { ...CAMERA_POSES.intro },

  // written by CameraController each frame — the un-swayed "rig" frame the
  // transition clouds are attached to
  rigMatrix: new THREE.Matrix4(),
  rigFov: 55,
  aspect: 16 / 9,

  // frame the transition cloud layout is defined in. It is the *intro* pose,
  // fixed in the world, so the camera can fly into / through the clouds.
  anchorMatrix: new THREE.Matrix4(),
  anchorFov: 55,

  // pointer, normalised -1..1 (for parallax)
  pointer: { x: 0, y: 0 },
}

const _anchor = new THREE.Object3D()
_anchor.rotation.order = 'YXZ'
/** Re-anchor the transition clouds to a camera pose (only while they are invisible). */
export function anchorCloudsTo(pose) {
  _anchor.position.set(pose.x, pose.y, pose.z)
  _anchor.rotation.set(pose.pitch, pose.yaw, pose.roll)
  _anchor.updateMatrixWorld(true)
  cine.anchorMatrix.copy(_anchor.matrixWorld)
  cine.anchorFov = pose.fov
}
anchorCloudsTo(CAMERA_POSES.intro)

/**
 * True while the cloud-interior layer is fully closed and opaque (its back
 * sheet has no gaps), so the 3D layers behind it can be skipped for free.
 * Requires open ≈ 0 as well: any opening would reveal what is behind.
 */
export const isBankClosed = () => cine.cover > 0.999 && cine.open < 0.001

export const SUN_DIRECTION = new THREE.Vector3(0.42, 0.3, -1).normalize()
