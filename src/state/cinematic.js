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
  // Scene 01 — looking slightly up into the sky, above the sea of clouds
  intro: { x: 0, y: 112, z: 60, pitch: 0.17, yaw: 0, roll: 0, fov: 55 },
  // Scene 02/03 — pushed forward into the cloud bank
  login: { x: 0, y: 108, z: 28, pitch: 0.14, yaw: 0, roll: 0, fov: 52 },
  // Main world — behind & above the jumper, looking over the cloud sea
  world: { x: 0, y: 142, z: -140, pitch: -0.21, yaw: 0, roll: 0, fov: 58 },
}

export const cine = {
  // ---- cloud transition controls --------------------------------------
  converge: 0, // 0 = clouds framing the screen edges, 1 = packed in the centre
  disperse: 0, // 0 = packed, 1 = scattered up / sideways past the screen edges
  densityBoost: 1, // >1 grows size & opacity of the transition clouds
  cover: 0, // full-screen "inside the cloud" layer coverage
  open: 0, // radial opening of the interior layer (cloud parting)

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

  // pointer, normalised -1..1 (for parallax)
  pointer: { x: 0, y: 0 },
}

export const SUN_DIRECTION = new THREE.Vector3(0.42, 0.3, -1).normalize()
