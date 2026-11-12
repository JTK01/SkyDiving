import * as THREE from 'three'

/**
 * Fixed clear-day atmosphere shared by every map scene (preview and play).
 * Sky horizon, fog and the colour of everything below the horizon are the
 * same, so terrain fades into the sky with no visible edge or solid floor.
 */
export const SUN_DIR = new THREE.Vector3(0.38, 0.8, 0.46).normalize() // high, from the south-east
export const HAZE = new THREE.Color('#c4d3e2') // horizon / fog colour
export const ZENITH = new THREE.Color('#3f74b8')
export const FOG_DENSITY = 6.2e-5 // exp² fog: ~8 % at 5 km, ~97 % at 32 km (terrain edge)
export const SUN_COLOR = new THREE.Color('#fff4e2')
