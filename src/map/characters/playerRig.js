import * as THREE from 'three'
import { CharacterBuilder, onSurface, wave, ease } from './builder.js'
import { roundCone, ellipsoid, bodyField, surfaceNets, fieldNormals, partWeights } from './sdf.js'
import { buildFace, faceMorphs } from './face.js'

/**
 * Rigged player avatar (offline → public/models/characters/player.glb).
 * Original design after the reference image's centre figure: ≈ 4.2 heads
 * tall, round head, dot eyes, blush, short black hair with soft bangs,
 * mitten hands; in skydiving gear (jumpsuit with orange side panels, soft
 * helmet + goggles, gloves, altimeter, harness, container).
 *
 * The body (torso, neck, arms, hands, legs, shoes) is ONE continuous mesh:
 * smooth-blended distance-field parts meshed with surface nets; every vertex
 * blends up to 4 bones, so shoulders, elbows, hips and knees bend smoothly.
 * The head (with hair, helmet, face) and the gear are rigid parts bound to
 * one bone each, in the same skinned mesh (one draw).
 *
 * Rest pose: A-pose (arms 35° from the body, so they do not weld to the
 * torso); clips add the correction that brings the arms down. Model space:
 * metres, feet at y = 0, facing +z, character's left = +x, height 1.6 m.
 */
export const HIPS = 0.8
const A = (35 * Math.PI) / 180 // arm angle from vertical in the rest pose
const DIR = [Math.sin(A), -Math.cos(A), 0]
const add = (p, d, s) => [p[0] + d[0] * s, p[1] + d[1] * s, p[2] + d[2] * s]
const mir = (p) => [-p[0], p[1], p[2]]

const ARM = [0.19, 1.13, 0]
const ELBOW = add(ARM, DIR, 0.24)
const WRIST = add(ELBOW, DIR, 0.22)
const HIP = [0.1, 0.76, 0]
const KNEE = [0.103, 0.42, 0.005]
const ANKLE = [0.105, 0.085, 0]

/** skeleton: name, parent, rest position (model space) */
export const BONES = [
  ['hips', null, [0, HIPS, 0]],
  ['spine', 'hips', [0, 0.93, 0]],
  ['chest', 'spine', [0, 1.06, 0]],
  ['neck', 'chest', [0, 1.17, 0]],
  ['head', 'neck', [0, 1.24, 0]],
  ['shoulderL', 'chest', [0.07, 1.14, 0]],
  ['armL', 'shoulderL', ARM],
  ['foreL', 'armL', ELBOW],
  ['handL', 'foreL', WRIST],
  ['shoulderR', 'chest', mir([0.07, 1.14, 0])],
  ['armR', 'shoulderR', mir(ARM)],
  ['foreR', 'armR', mir(ELBOW)],
  ['handR', 'foreR', mir(WRIST)],
  ['thighL', 'hips', HIP],
  ['shinL', 'thighL', KNEE],
  ['footL', 'shinL', ANKLE],
  ['thighR', 'hips', mir(HIP)],
  ['shinR', 'thighR', mir(KNEE)],
  ['footR', 'shinR', mir(ANKLE)],
]
const B = Object.fromEntries(BONES.map(([n], i) => [n, i]))

const c = (h) => new THREE.Color(h).toArray()
const SKIN = '#efc39c'
const HAIR = '#1f1b1d'
const SUIT = c('#2c4774')
const PANEL = c('#e8742c')
const GLOVE = c('#26282c')
const SHOE = c('#2b2622')
const SKINC = c(SKIN)

/**
 * body colours per part: each a colour, { c, r } (palette region) or a
 * function of the rest-pose position p (left side; mirrored for the right)
 */
const suitPanels = (p) => (Math.abs(p[0]) > 0.15 && p[1] > 0.82 && p[1] < 1.12 ? PANEL : SUIT)
export const PLAYER_LOOK = {
  pelvis: SUIT,
  torso: suitPanels,
  neck: SKINC,
  shoulder: SUIT,
  upper: SUIT,
  fore: (p) => (Math.hypot(...p.map((v, i) => v - WRIST[i])) < 0.045 ? PANEL : SUIT),
  hand: GLOVE,
  leg: SUIT,
  shoe: SHOE,
}

/** continuous body: distance-field parts, grouped so left and right limbs never web together */
function bodyParts(look) {
  const P = {
    pelvis: { f: ellipsoid([0, 0.8, 0], [0.165, 0.12, 0.13]), bone: B.hips, color: look.pelvis },
    waist: { f: roundCone([0, 0.84, 0], [0, 1.0, 0], 0.165, 0.178), bone: B.spine, color: look.torso },
    chest: { f: ellipsoid([0, 1.07, 0], [0.19, 0.125, 0.14]), bone: B.chest, color: look.torso },
    neck: { f: roundCone([0, 1.13, 0], [0, 1.28, 0], 0.056, 0.05), bone: B.neck, color: look.neck },
  }
  const side = (s) => {
    const m = (p) => (s > 0 ? p : mir(p))
    const sx = s > 0 ? 'L' : 'R'
    // colour functions get the position mirrored to the left side
    const col = (v) => (typeof v === 'function' ? (p) => v(m(p)) : v)
    return {
      shoulder: { f: roundCone(m([0.1, 1.12, 0]), m(ARM), 0.085, 0.07), bone: B[`shoulder${sx}`], color: col(look.shoulder) },
      upper: { f: roundCone(m(ARM), m(ELBOW), 0.068, 0.06), bone: B[`arm${sx}`], color: col(look.upper) },
      fore: { f: roundCone(m(ELBOW), m(WRIST), 0.06, 0.053), bone: B[`fore${sx}`], color: col(look.fore) },
      hand: { f: roundCone(m(WRIST), m(add(WRIST, DIR, 0.085)), 0.052, 0.045), bone: B[`hand${sx}`], color: col(look.hand), blend: 0.02 },
      thigh: { f: roundCone(m(HIP), m(KNEE), 0.088, 0.078), bone: B[`thigh${sx}`], color: col(look.leg) },
      shin: { f: roundCone(m(KNEE), m(ANKLE), 0.077, 0.066), bone: B[`shin${sx}`], color: col(look.leg) },
      shoe: { f: ellipsoid(m([0.105, 0.05, 0.035]), [0.07, 0.055, 0.115]), bone: B[`foot${sx}`], color: col(look.shoe), blend: 0.02 },
    }
  }
  const L = side(1)
  const R = side(-1)
  const torso = [P.pelvis, P.waist, P.chest, P.neck]
  const groups = [
    torso,
    [P.chest, L.shoulder, L.upper, L.fore, L.hand],
    [P.chest, R.shoulder, R.upper, R.fore, R.hand],
    [P.pelvis, L.thigh, L.shin, L.shoe],
    [P.pelvis, R.thigh, R.shin, R.shoe],
  ]
  const all = [...torso, ...Object.values(L), ...Object.values(R)]
  return { groups, all }
}

/** field = hard minimum over groups, smooth union inside each group */
function groupField(groups) {
  const fs = groups.map((g) => bodyField(g))
  return (p) => {
    let d = Infinity
    for (const f of fs) d = Math.min(d, f(p))
    return d
  }
}

/** a builder with the shared skeleton, for rigid parts */
export function rigidBuilder(lod, opts) {
  const b = new CharacterBuilder(lod, opts)
  for (const [n, parent, p] of BONES) b.bone(n, parent, p)
  return b
}

/** player rigid parts: head with hair, helmet and face; collar; harness; container; altimeter */
function playerRigid(b) {
  const HC = [0, 1.39, 0.01]
  const HR = [0.205, 0.195, 0.19]
  b.ellipsoid(HR, { pos: HC, bone: 'head', color: SKIN }, 28, 20)
  for (const s of [-1, 1]) b.ellipsoid([0.035, 0.05, 0.03], { pos: [s * 0.2, 1.38, 0.0], bone: 'head', color: SKIN, detail: true }, 8, 6)
  b.ellipsoid([0.215, 0.13, 0.205], { pos: [0, 1.48, -0.01], bone: 'head', color: HAIR }, 24, 12)
  b.ellipsoid([0.2, 0.17, 0.12], { pos: [0, 1.4, -0.09], bone: 'head', color: HAIR }, 18, 12)
  ;[[-0.11, 0.06], [-0.035, 0.08], [0.045, 0.075], [0.12, 0.05]].forEach(([x, dy], i) => {
    b.ellipsoid([0.075, 0.06, 0.035], { pos: onSurface(HC, [0.21, 0.2, 0.195], [x * 4.5, 1.0 + dy * 2, 1.1]), rot: [0.5, 0, (i - 1.5) * 0.25], bone: 'head', color: HAIR }, 10, 8)
  })
  for (const s of [-1, 1]) b.ellipsoid([0.04, 0.09, 0.05], { pos: [s * 0.185, 1.38, 0.05], bone: 'head', color: HAIR, detail: true }, 8, 6)
  b.ellipsoid([0.222, 0.1, 0.212], { pos: [0, 1.53, -0.02], bone: 'head', color: '#2c4774' }, 24, 10)
  b.torus(0.205, 0.012, { pos: [0, 1.5, -0.005], rot: [Math.PI / 2 + 0.18, 0, 0], bone: 'head', color: '#2f3237' }, 24, 4)
  for (const s of [-1, 1]) b.ellipsoid([0.055, 0.035, 0.03], { pos: onSurface([0, 1.5, 0], [0.215, 0.13, 0.21], [s * 0.42, 0.75, 1]), rot: [-0.6, s * 0.35, 0], bone: 'head', color: '#5d8fb8' }, 12, 8)
  // face (as before the rigging): dot eyes, highlights, brows, blush, smile — tagged for the morph targets
  buildFace(b, HC, HR, 'head')
  // collar, harness, container, leg straps, altimeter
  b.torus(0.066, 0.02, { pos: [0, 1.205, 0.004], rot: [Math.PI / 2, 0, 0], bone: 'neck', color: '#f1ede4' }, 16, 5)
  for (const s of [-1, 1]) b.box(0.045, 0.3, 0.02, { pos: [s * 0.085, 1.0, 0.15], rot: [0.08, 0, s * 0.08], bone: 'chest', color: '#3c3f45' })
  b.box(0.24, 0.035, 0.02, { pos: [0, 1.04, 0.162], bone: 'chest', color: '#3c3f45' })
  b.box(0.05, 0.045, 0.025, { pos: [0, 1.04, 0.175], bone: 'chest', color: '#9aa0a6', detail: true })
  b.box(0.32, 0.42, 0.13, { pos: [0, 0.98, -0.2], bone: 'chest', color: '#2f3237' })
  b.capsule(0.065, 0.24, { pos: [0, 1.0, -0.265], rot: [0, 0, Math.PI / 2], bone: 'chest', color: '#2f3237', detail: true }, 8)
  b.box(0.28, 0.04, 0.02, { pos: [0, 1.17, -0.27], bone: 'chest', color: '#e8742c' })
  b.ellipsoid([0.025, 0.025, 0.012], { pos: [0.1, 0.8, -0.27], bone: 'spine', color: '#e8742c', detail: true }, 8, 6)
  for (const [s, bone] of [[1, 'thighL'], [-1, 'thighR']]) b.torus(0.09, 0.016, { pos: [s * 0.1, 0.62, 0.003], rot: [Math.PI / 2, 0, 0], bone, color: '#3c3f45' }, 14, 4)
  const alt = add(ELBOW, DIR, 0.17)
  b.cyl(0.035, 0.035, 0.02, { pos: [alt[0] + 0.045, alt[1] + 0.03, 0.02], rot: [0, 0, Math.PI / 2 - A], bone: 'foreL', color: '#16181b' }, 12)
  b.cyl(0.026, 0.026, 0.004, { pos: [alt[0] + 0.056, alt[1] + 0.038, 0.02], rot: [0, 0, Math.PI / 2 - A], bone: 'foreL', color: '#cfd9a6', detail: true }, 12)
}

/**
 * one level of detail → { position, normal, color, joints, weights, index }
 * lod 0: 3.2 cm cells; lod 1: 5.5 cm cells, fewer head segments
 */
export function buildPlayerMesh(lod = 0) {
  return buildBipedMesh(lod, PLAYER_LOOK, playerRigid)
}

/**
 * any biped on the shared skeleton: continuous body with `look` colours and
 * rigid parts added by rigid(builder) (head, face, gear, tail, props…)
 */
export function buildBipedMesh(lod, look, rigid, builderOpts) {
  const { groups, all } = bodyParts(look)
  const field = groupField(groups)
  const h = lod === 0 ? 0.032 : 0.055
  const { positions, indices } = surfaceNets(field, [-0.62, -0.06, -0.24], [0.62, 1.34, 0.24], h)
  const normals = fieldNormals(field, positions)
  // winding: make each triangle face along the field gradient
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c2] = [indices[t], indices[t + 1], indices[t + 2]]
    const p = (i) => new THREE.Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])
    const n = new THREE.Vector3().crossVectors(p(b).sub(p(a)), p(c2).sub(p(a)))
    const g = new THREE.Vector3(normals[a * 3] + normals[b * 3] + normals[c2 * 3], normals[a * 3 + 1] + normals[b * 3 + 1] + normals[c2 * 3 + 1], normals[a * 3 + 2] + normals[b * 3 + 2] + normals[c2 * 3 + 2])
    if (n.dot(g) < 0) {
      indices[t + 1] = c2
      indices[t + 2] = b
    }
  }
  const { joints, weights, colors, regions } = partWeights(all, positions)
  // rigid parts (non-indexed) appended
  const rb0 = rigidBuilder(lod, builderOpts)
  rigid(rb0, lod)
  const built = rb0.build()
  const r = built.geometry
  const rp = r.attributes.position.array
  const rn = r.attributes.normal.array
  const rc = r.attributes.color.array
  const rb = r.attributes.aBone.array
  const nb = positions.length / 3
  const nr = rp.length / 3
  const out = {
    position: new Float32Array((nb + nr) * 3),
    normal: new Float32Array((nb + nr) * 3),
    color: new Float32Array((nb + nr) * 3),
    joints: new Uint16Array((nb + nr) * 4),
    weights: new Float32Array((nb + nr) * 4),
    index: new Uint32Array(indices.length + nr),
    region: new Float32Array(nb + nr), // palette region (0/1/2 recoloured per NPC, 3 fixed)
    prop: new Float32Array(nb + nr), // optional prop id (0 = always shown)
  }
  out.region.set(regions)
  out.region.set(r.attributes.aRegion.array, nb)
  out.prop.set(r.attributes.aProp.array, nb)
  out.position.set(positions)
  out.position.set(rp, nb * 3)
  out.normal.set(normals)
  out.normal.set(rn, nb * 3)
  out.color.set(colors)
  out.color.set(rc, nb * 3)
  out.joints.set(joints)
  out.weights.set(weights)
  for (let v = 0; v < nr; v++) {
    out.joints[(nb + v) * 4] = rb[v]
    out.weights[(nb + v) * 4] = 1
  }
  out.index.set(indices)
  for (let v = 0; v < nr; v++) out.index[indices.length + v] = nb + v
  // facial expressions as morph targets (rigid face parts follow the head bone)
  out.morphs = faceMorphs(out.position, built.tags, nb, nb + nr)
  r.dispose()
  return out
}

// ---------------------------------------------------------------------------
// clips: pose(t, duration) → { bone: { r: [x, y, z] (YXZ euler), p: [dx, dy, dz] } }
// Values are written for arms hanging down; ARMS_DOWN adds the A-pose
// correction (rotation about z happens first in YXZ order).
// ---------------------------------------------------------------------------
function withArmsDown(pose) {
  return (t, d) => {
    const P = pose(t, d)
    const out = { ...P }
    out.armL = { ...(P.armL || {}), r: [...(P.armL?.r || [0, 0, 0])] }
    out.armR = { ...(P.armR || {}), r: [...(P.armR?.r || [0, 0, 0])] }
    out.armL.r[2] -= A
    out.armR.r[2] += A
    return out
  }
}

const CLIP_POSES = {
  idle: {
    duration: 4,
    pose: (t) => ({
      spine: { r: [0.02 * wave(t, 4), 0, 0] },
      chest: { r: [0.025 * wave(t, 2), 0, 0] },
      neck: { r: [0.02 * wave(t, 4, 0.3), 0.1 * wave(t, 8), 0] },
      head: { r: [0.03 * wave(t, 4, 0.3), 0.18 * wave(t, 8), 0] },
      armL: { r: [0.04 * wave(t, 2, 0.5), 0, 0.12] },
      armR: { r: [0.04 * wave(t, 2, 0.5), 0, -0.12] },
      foreL: { r: [-0.18, 0, 0] },
      foreR: { r: [-0.18, 0, 0] },
    }),
  },
  walk: {
    duration: 0.9,
    pose: (t, d) => {
      const s = wave(t, d)
      const c2 = wave(t, d, 0.5)
      return {
        hips: { p: [0, 0.025 * Math.abs(c2), 0], r: [0.04, 0.06 * s, 0] },
        chest: { r: [0, -0.1 * s, 0] },
        head: { r: [-0.03, 0.06 * s, 0] },
        thighL: { r: [-0.5 * s, 0, 0] },
        thighR: { r: [0.5 * s, 0, 0] },
        shinL: { r: [Math.max(0, 0.8 * c2), 0, 0] },
        shinR: { r: [Math.max(0, -0.8 * c2), 0, 0] },
        footL: { r: [-0.25 * Math.max(0, c2), 0, 0] },
        footR: { r: [-0.25 * Math.max(0, -c2), 0, 0] },
        armL: { r: [0.45 * s, 0, 0.1] },
        armR: { r: [-0.45 * s, 0, -0.1] },
        foreL: { r: [-0.35 - 0.25 * Math.max(0, -s), 0, 0] },
        foreR: { r: [-0.35 - 0.25 * Math.max(0, s), 0, 0] },
      }
    },
  },
  freefall: {
    duration: 1.6,
    pose: (t) => {
      const f = 0.05 * wave(t, 0.4)
      return {
        hips: { r: [Math.PI / 2 - 0.08, 0, 0] },
        spine: { r: [-0.18, 0, 0] },
        chest: { r: [-0.1, 0, 0] },
        neck: { r: [-0.3, 0, 0] },
        head: { r: [-0.3, 0, 0] },
        armL: { r: [-0.15, 0, 1.35 + f] },
        armR: { r: [-0.15, 0, -1.35 - f] },
        foreL: { r: [0, 0, 1.15] },
        foreR: { r: [0, 0, -1.15] },
        thighL: { r: [0.15, 0, 0.28] },
        thighR: { r: [0.15, 0, -0.28] },
        shinL: { r: [1.15 + f, 0, 0] },
        shinR: { r: [1.15 - f, 0, 0] },
        footL: { r: [0.4, 0, 0] },
        footR: { r: [0.4, 0, 0] },
      }
    },
  },
  canopy: {
    duration: 3,
    pose: (t) => ({
      hips: { r: [0.06 * wave(t, 3), 0, 0.04 * wave(t, 3, 0.5)] },
      head: { r: [-0.15, 0, 0] },
      armL: { r: [-0.25, 0, 2.55] },
      armR: { r: [-0.25, 0, -2.55] },
      foreL: { r: [0, 0, 0.35] },
      foreR: { r: [0, 0, -0.35] },
      thighL: { r: [-0.25 + 0.1 * wave(t, 3), 0, 0.06] },
      thighR: { r: [-0.2 + 0.1 * wave(t, 3, 0.4), 0, -0.06] },
      shinL: { r: [0.35, 0, 0] },
      shinR: { r: [0.3, 0, 0] },
      footL: { r: [0.3, 0, 0] },
      footR: { r: [0.3, 0, 0] },
    }),
  },
  landing: {
    duration: 1.2,
    loop: false,
    pose: (t) => {
      const flare = ease(t / 0.25)
      const crouch = ease((t - 0.15) / 0.25) * (1 - ease((t - 0.6) / 0.5))
      return {
        hips: { p: [0, -0.22 * crouch, 0], r: [0.25 * crouch, 0, 0] },
        head: { r: [-0.2 * crouch, 0, 0] },
        armL: { r: [-0.6 * crouch, 0, 2.55 * (1 - flare) + 0.25] },
        armR: { r: [-0.6 * crouch, 0, -2.55 * (1 - flare) - 0.25] },
        foreL: { r: [-0.4 * crouch, 0, 0] },
        foreR: { r: [-0.4 * crouch, 0, 0] },
        thighL: { r: [-0.85 * crouch, 0, 0.05] },
        thighR: { r: [-0.85 * crouch, 0, -0.05] },
        shinL: { r: [1.4 * crouch, 0, 0] },
        shinR: { r: [1.4 * crouch, 0, 0] },
        footL: { r: [-0.55 * crouch, 0, 0] },
        footR: { r: [-0.55 * crouch, 0, 0] },
      }
    },
  },
  photo: {
    duration: 2.5,
    pose: (t) => {
      const k = ease(t / 0.35)
      return {
        hips: { r: [0, 0.25 * k, 0.04 * k] },
        chest: { r: [0, -0.1 * k, 0] },
        head: { r: [0.05 * k, -0.12 * k, -0.16 * k + 0.02 * wave(t, 2.5)] },
        armR: { r: [-1.25 * k, 0, -0.35 * k] },
        foreR: { r: [-1.9 * k, 0, 0.3 * k] },
        handR: { r: [0, 0, 0.3 * k] },
        armL: { r: [0.15 * k, 0, 0.55 * k] },
        foreL: { r: [-1.2 * k, 0, -0.9 * k] },
        thighL: { r: [0, 0, 0.08 * k] },
        thighR: { r: [0.1 * k, 0, -0.04 * k] },
      }
    },
  },
}
// NPC greeting on discovery: a wave with the right hand and a little hop
CLIP_POSES.react = {
  duration: 1.6,
  loop: false,
  pose: (t) => {
    const up = ease(t / 0.25) * (1 - ease((t - 1.25) / 0.35))
    const hop = t < 0.5 ? Math.sin((t / 0.5) * Math.PI) : 0
    return {
      hips: { p: [0, 0.07 * hop, 0] },
      chest: { r: [-0.08 * up, 0, 0] },
      head: { r: [-0.12 * up, 0, -0.18 * up] },
      armR: { r: [-0.3 * up, 0, -2.35 * up] },
      foreR: { r: [0, 0, (-0.5 + 0.45 * Math.sin(t * 14)) * up] },
      armL: { r: [0, 0, 0.15] },
      thighL: { r: [-0.4 * hop, 0, 0] },
      thighR: { r: [-0.4 * hop, 0, 0] },
      shinL: { r: [0.7 * hop, 0, 0] },
      shinR: { r: [0.7 * hop, 0, 0] },
    }
  },
}

const ALL_CLIPS = Object.fromEntries(Object.entries(CLIP_POSES).map(([k, v]) => [k, { ...v, pose: withArmsDown(v.pose) }]))
const pick = (names) => Object.fromEntries(names.map((n) => [n, ALL_CLIPS[n]]))
export const PLAYER_CLIPS = pick(['idle', 'walk', 'freefall', 'canopy', 'landing', 'photo'])
export const NPC_CLIPS = pick(['idle', 'walk', 'react'])
