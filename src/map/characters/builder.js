import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * Plush-style character builder (procedural, no files): rounded parts are
 * merged into one geometry, each part rigidly bound to one bone.
 *
 * Per-vertex attributes:
 *   position, normal (smooth per part)
 *   color      fixed colour (used when region = 3)
 *   aBone      bone index (rigid skinning)
 *   aRegion    0 / 1 / 2 = palette colours A / B / C (set per instance), 3 = fixed
 *   aProp      0 = always shown, k > 0 = optional prop k (per-instance mask)
 *
 * Bones are defined in the rest pose without rotation: { name, parent, pivot }
 * (pivot in model space, metres). Animations rotate bones about their pivot.
 * LOD: lod 0 (near) uses smooth segment counts and all details; lod 1 (far)
 * a few segments and no small details (detail parts are skipped).
 */
export class CharacterBuilder {
  constructor(lod = 0) {
    this.lod = lod
    this.parts = []
    this.bones = []
    this.boneIndex = new Map()
  }

  bone(name, parent, pivot) {
    this.boneIndex.set(name, this.bones.length)
    this.bones.push({ name, parent: parent == null ? -1 : this.boneIndex.get(parent), pivot: new THREE.Vector3(...pivot) })
    return this
  }

  /** segment count scaled for the LOD */
  seg(n, min = 3) {
    return this.lod === 0 ? n : Math.max(min, Math.round(n / 3))
  }

  /**
   * add a part: geometry in its own frame, placed by pos / rot / scale,
   * opts: { bone, region (0-3), color (fixed colour), prop (0 = always), detail (skip on lod 1) }
   */
  add(geo, { pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1], bone, region = 3, color = '#ffffff', prop = 0, detail = false } = {}) {
    if (detail && this.lod > 0) {
      geo.dispose()
      return this
    }
    const g = geo.index ? geo.toNonIndexed() : geo
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name)
    if (!g.attributes.normal) g.computeVertexNormals()
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scale))
    g.applyMatrix4(m)
    const n = g.attributes.position.count
    const c = new THREE.Color(color)
    const col = new Float32Array(n * 3)
    for (let k = 0; k < n; k++) c.toArray(col, k * 3)
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    g.setAttribute('aBone', new THREE.BufferAttribute(new Float32Array(n).fill(this.boneIndex.get(bone) ?? 0), 1))
    g.setAttribute('aRegion', new THREE.BufferAttribute(new Float32Array(n).fill(region), 1))
    g.setAttribute('aProp', new THREE.BufferAttribute(new Float32Array(n).fill(prop), 1))
    this.parts.push(g)
    if (geo !== g) geo.dispose()
    return this
  }

  // ---- shape helpers (all return this) -----------------------------------
  ellipsoid(r, opts, segW = 20, segH = 14) {
    return this.add(new THREE.SphereGeometry(1, this.seg(segW, 6), this.seg(segH, 4)), { ...opts, scale: [r[0], r[1], r[2]] })
  }
  capsule(radius, length, opts, segs = 10) {
    return this.add(new THREE.CapsuleGeometry(radius, length, this.seg(4, 2), this.seg(segs, 5)), opts)
  }
  cyl(rTop, rBot, h, opts, segs = 14) {
    return this.add(new THREE.CylinderGeometry(rTop, rBot, h, this.seg(segs, 5), 1), opts)
  }
  cone(r, h, opts, segs = 12) {
    return this.add(new THREE.ConeGeometry(r, h, this.seg(segs, 4), 1), opts)
  }
  box(w, h, d, opts) {
    return this.add(new THREE.BoxGeometry(w, h, d), opts)
  }
  torus(r, tube, opts, segs = 16, tubeSegs = 6, arc = Math.PI * 2) {
    return this.add(new THREE.TorusGeometry(r, tube, this.seg(tubeSegs, 3), this.seg(segs, 6), arc), opts)
  }
  /** lathe from [radius, y] pairs */
  lathe(points, opts, segs = 18) {
    return this.add(new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.001), y)), this.seg(segs, 6)), opts)
  }

  /** merged geometry + bone list */
  build() {
    const g = mergeGeometries(this.parts, false)
    this.parts.forEach((p) => p.dispose())
    g.computeBoundingSphere()
    return { geometry: g, bones: this.bones }
  }
}

/** a point on an ellipsoid surface (centre c, radii r) in direction d (unnormalised ok) */
export function onSurface(c, r, d) {
  const v = new THREE.Vector3(...d).normalize()
  // scale so the point lies on the ellipsoid (x/rx)² + … = 1
  const k = 1 / Math.sqrt((v.x / r[0]) ** 2 + (v.y / r[1]) ** 2 + (v.z / r[2]) ** 2)
  return [c[0] + v.x * k, c[1] + v.y * k, c[2] + v.z * k]
}

/**
 * Pose sampling: pose(t) → { boneName: { r: [x, y, z] euler (rad), p: [dx, dy, dz] offset } }.
 * Returns per-bone skin matrices (world(t) × inverse(rest)) for one time.
 */
const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _v = new THREE.Vector3()
const ONE = new THREE.Vector3(1, 1, 1)
export function skinMatrices(bones, pose, out = bones.map(() => new THREE.Matrix4())) {
  const world = []
  bones.forEach((b, i) => {
    const pp = b.parent >= 0 ? bones[b.parent].pivot : new THREE.Vector3()
    const tr = pose[b.name] || {}
    _v.copy(b.pivot).sub(pp)
    if (tr.p) _v.add(new THREE.Vector3(...tr.p))
    _e.set(...(tr.r || [0, 0, 0]), 'YXZ')
    _q.setFromEuler(_e)
    _m.compose(_v, _q, tr.s ? new THREE.Vector3(...tr.s) : ONE)
    world[i] = b.parent >= 0 ? world[b.parent].clone().multiply(_m) : _m.clone()
    out[i].copy(world[i]).multiply(new THREE.Matrix4().makeTranslation(-b.pivot.x, -b.pivot.y, -b.pivot.z))
  })
  return out
}

/** THREE.AnimationClip from a pose function (bone local tracks, for SkinnedMesh) */
export function makeClip(name, bones, pose, duration, fps = 30, loop = true) {
  const n = Math.max(2, Math.round(duration * fps) + (loop ? 1 : 0))
  const times = new Float32Array(n)
  const tracks = bones.map(() => ({ q: new Float32Array(n * 4), p: new Float32Array(n * 3) }))
  for (let k = 0; k < n; k++) {
    const t = (k / (n - 1)) * duration
    times[k] = t
    const P = pose(loop ? t % duration : t, duration)
    bones.forEach((b, i) => {
      const tr = P[b.name] || {}
      _q.setFromEuler(_e.set(...(tr.r || [0, 0, 0]), 'YXZ')).toArray(tracks[i].q, k * 4)
      const pp = b.parent >= 0 ? bones[b.parent].pivot : new THREE.Vector3()
      _v.copy(b.pivot).sub(pp)
      if (tr.p) _v.add(new THREE.Vector3(...tr.p))
      _v.toArray(tracks[i].p, k * 3)
    })
  }
  const kt = []
  bones.forEach((b, i) => {
    kt.push(new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, times, tracks[i].q))
    kt.push(new THREE.VectorKeyframeTrack(`${b.name}.position`, times, tracks[i].p))
  })
  return new THREE.AnimationClip(name, duration, kt)
}

/** THREE.SkinnedMesh from a built character (rigid skinning from aBone) */
export function skinnedMesh(built, material) {
  const { geometry, bones } = built
  const n = geometry.attributes.position.count
  const si = new Uint16Array(n * 4)
  const sw = new Float32Array(n * 4)
  const ab = geometry.attributes.aBone.array
  for (let k = 0; k < n; k++) {
    si[k * 4] = ab[k]
    sw[k * 4] = 1
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4))
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4))
  const objs = bones.map((b) => {
    const o = new THREE.Bone()
    o.name = b.name
    return o
  })
  bones.forEach((b, i) => {
    const pp = b.parent >= 0 ? bones[b.parent].pivot : new THREE.Vector3()
    objs[i].position.copy(b.pivot).sub(pp)
    if (b.parent >= 0) objs[b.parent].add(objs[i])
  })
  const mesh = new THREE.SkinnedMesh(geometry, material)
  const roots = objs.filter((_, i) => bones[i].parent < 0)
  roots.forEach((r) => mesh.add(r))
  mesh.updateMatrixWorld(true)
  mesh.bind(new THREE.Skeleton(objs))
  return mesh
}

// small math helpers for pose functions
export const wave = (t, period, phase = 0) => Math.sin(((t / period) * 2 + phase) * Math.PI)
export const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x))
