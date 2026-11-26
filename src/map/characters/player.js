import * as THREE from 'three'

/**
 * Parachute geometry for the player (the avatar itself is the rigged glTF
 * built by tools/map-data/build_avatar.mjs: public/models/characters/player.glb).
 * HIPS: height of the avatar's hips above its feet in the free-fall pose
 * (body centre in the air; the canopy hangs from here).
 */
export const HIPS = 0.96

/**
 * Ram-air canopy, 9 cells, above the player (root frame, metres): span 7 m,
 * chord 2.6 m, anhedral arc; plus suspension lines to the risers.
 * Returns { parts: BufferGeometry[], line: Float32Array (segment pairs) }.
 */
export function buildCanopy(lod = 0) {
  const cells = 9
  const span = 7
  const chord = 2.6
  const parts = []
  const cols = ['#f1ede4', '#e8742c', '#2c4774']
  const color = new THREE.Color()
  const top = 5.4 // above the hips
  for (let k = 0; k < cells; k++) {
    const u = (k + 0.5) / cells - 0.5
    const x = u * span
    const y = top - 1.3 * (2 * u) ** 2
    const roll = -u * 0.9
    // airfoil-ish cell: thick at the front, thin at the trailing edge
    const g = new THREE.BoxGeometry(span / cells - 0.03, 0.34, chord, 1, 1, lod === 0 ? 4 : 1)
    const p = g.attributes.position
    for (let v = 0; v < p.count; v++) {
      const z = p.getZ(v) / chord + 0.5 // 0 trailing … 1 leading
      p.setY(v, p.getY(v) * (0.25 + 0.75 * Math.sin(Math.PI * Math.min(1, z * 0.9 + 0.1))) + 0.06 * Math.sin(Math.PI * z))
    }
    g.computeVertexNormals()
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, 0.2), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.08, 0, roll)), new THREE.Vector3(1, 1, 1)))
    const c = new Float32Array(p.count * 3)
    color.set(cols[k === 4 ? 1 : k % 3 === 2 ? 2 : 0]).toArray(c, 0)
    for (let v = 0; v < p.count; v++) color.toArray(c, v * 3)
    g.setAttribute('color', new THREE.BufferAttribute(c, 3))
    g.deleteAttribute('uv')
    parts.push(g)
  }
  // suspension lines: 4 rows (A–D) per rib to the two risers at the shoulders
  const line = []
  for (let k = 0; k <= cells; k++) {
    const u = k / cells - 0.5
    const x = u * span
    const y = top - 1.3 * (2 * u) ** 2 - 0.18
    for (const z of [1.2, 0.5, -0.2, -0.9]) {
      const rx = (u < 0 ? -1 : 1) * 0.2
      line.push(x, y, z, rx, 0.55, 0)
    }
  }
  return { parts, line: new Float32Array(line) }
}
