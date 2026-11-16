import * as THREE from 'three'
import { onSurface } from './builder.js'
import { buildFace } from './face.js'
import { buildBipedMesh } from './playerRig.js'

/**
 * Anthropomorphic animal NPCs (offline → public/models/characters/npcs.glb).
 * Like the two characters beside the boy in the reference image: they stand
 * on two legs with the player's human body proportions and the same skeleton
 * (so the same animations play on them), wear clothes and have the same
 * dot-eye / blush / smile face with blink and smile expressions. The animal
 * shows in the head (shape, ears, muzzle, horns…), the tail and the fur colour
 * (head, neck and paw-hands).
 *
 * Palette regions recoloured per NPC: 0 fur, 1 main garment, 2 trousers /
 * second garment (3 = fixed colour). Optional props by id: 1 flower crown,
 * 2 scarf, 3 bell, 4 barretina, 5 Sant Jordi rose.
 * Height = species.scale × the player's 1.6 m (0.8–1.1).
 */
export const PROPS = { crown: 1, scarf: 2, bell: 3, barretina: 4, rose: 5 }
const c = (h) => new THREE.Color(h).toArray()
const R = (r) => ({ c: [1, 1, 1], r }) // a palette region (colour comes from the NPC)
const FUR = R(0)
const TOP = R(1)
const LOW = R(2)
const WHITE = c('#f4efe6')
const SHOE = c('#3a2c24')
const HOOF = c('#2a2220')

/** outfits: body colour functions (left-side rest position p) */
const OUTFITS = {
  // the reference boy's look: white shirt, vest, trousers
  vest: { torso: (p) => (p[2] > 0.06 && Math.abs(p[0]) < 0.035 + Math.max(0, p[1] - 0.95) * 0.45 && p[1] > 0.95 ? { c: WHITE, r: 3 } : TOP), shoulder: { c: WHITE, r: 3 }, upper: { c: WHITE, r: 3 }, fore: { c: WHITE, r: 3 }, pelvis: LOW, leg: LOW },
  overalls: { torso: (p) => (p[2] > 0.0 && Math.abs(p[0]) < 0.12 && p[1] < 1.12 ? LOW : TOP), shoulder: TOP, upper: TOP, fore: TOP, pelvis: LOW, leg: LOW },
  apron: { torso: (p) => (p[2] > 0.08 && Math.abs(p[0]) < 0.11 && p[1] < 1.1 ? { c: WHITE, r: 3 } : TOP), shoulder: TOP, upper: TOP, fore: FUR, pelvis: TOP, leg: (p) => (p[1] > 0.5 ? TOP : FUR) },
  jacket: { torso: (p) => (p[2] > 0.08 && Math.abs(p[0]) < 0.02 ? { c: c('#e8d9a8'), r: 3 } : TOP), shoulder: TOP, upper: TOP, fore: TOP, pelvis: LOW, leg: LOW },
}

export const SPECIES = {
  // ---- the five mission animals ----
  bull: { name: '황소', scale: 1.08, outfit: 'vest', ears: 'side', horns: 'bull', muzzle: '#efe2cf', nose: '#3a2a26', tail: 'tuft', hoof: true, palettes: [['#5a3a2c', '#7a4a2a', '#2c3550'], ['#2b2523', '#8c2f2a', '#3a3a3a']], props: [PROPS.bell, PROPS.barretina] },
  lynx: { name: '이베리아스라소니', scale: 0.98, outfit: 'jacket', ears: 'tufted', muzzle: '#f3e7d2', nose: '#2a1d1a', tail: 'bob', spots: true, ruff: true, palettes: [['#c59253', '#3f6b4a', '#4a3a2a'], ['#b98448', '#2f4f80', '#3a3030']], props: [PROPS.scarf] },
  rabbit: { name: '토끼', scale: 0.84, outfit: 'apron', ears: 'long', muzzle: '#f6efe8', nose: '#d97b85', tail: 'pompom', palettes: [['#e9e4dc', '#e6a3b4', '#ffffff'], ['#a58a72', '#9cc3e6', '#ffffff']], props: [PROPS.crown] },
  dragon: { name: '드래곤', scale: 1.1, outfit: 'jacket', ears: 'none', horns: 'dragon', snout: true, muzzle: '#f1d77a', nose: '#24341f', tail: 'dragon', spikes: true, palettes: [['#4f9a5a', '#c42b2b', '#2f3b4a'], ['#5b84b8', '#e3b440', '#2f3b4a']], props: [PROPS.rose] },
  wildcat: { name: '카탈루냐 야생 고양이', scale: 0.92, outfit: 'overalls', ears: 'pointed', muzzle: '#e9e1d4', nose: '#d58a8a', tail: 'ringed', stripes: true, palettes: [['#8a8072', '#d9c27a', '#3e6fb0'], ['#9b8a74', '#c96a4a', '#3e6fb0']], props: [PROPS.barretina, PROPS.bell] },
  // ---- general animals around the zones ----
  donkey: { name: '카탈루냐 당나귀', scale: 1.02, outfit: 'vest', ears: 'donkey', muzzle: '#d9d2c8', nose: '#2b2524', tail: 'tuft', hoof: true, mane: true, palettes: [['#3c3433', '#6b4a32', '#2c3550'], ['#5a4c46', '#3f6b4a', '#3a3030']], props: [PROPS.barretina, PROPS.crown] },
  parakeet: { name: '몽크 앵무새', scale: 0.82, outfit: 'jacket', ears: 'none', beak: '#f0b38a', crest: true, muzzle: '#c9d3c8', tail: 'feather', palettes: [['#6fb04a', '#e8c25a', '#3a4a5a']], props: [PROPS.scarf] },
  pigeon: { name: '비둘기', scale: 0.86, outfit: 'vest', ears: 'none', beak: '#2f2d30', muzzle: '#b4b9c2', tail: 'feather', collar: '#4f8a72', palettes: [['#8c929c', '#6a4f86', '#3a3a40'], ['#7a7f88', '#4f6a86', '#2f2f35']], props: [] },
  dog: { name: '강아지', scale: 0.9, outfit: 'overalls', ears: 'floppy', muzzle: '#f6efe4', nose: '#2a2426', tail: 'curl', palettes: [['#d8b98c', '#c9463b', '#3e6fb0'], ['#6b4a34', '#e8c25a', '#3e6fb0']], props: [PROPS.scarf, PROPS.bell] },
  gull: { name: '갈매기', scale: 0.88, outfit: 'jacket', ears: 'none', beak: '#f2c94c', beakSpot: true, muzzle: '#ffffff', tail: 'feather', palettes: [['#f3f3f0', '#2c4774', '#9aa3ad']], props: [] },
  hedgehog: { name: '고슴도치', scale: 0.8, outfit: 'apron', ears: 'round', snout: true, muzzle: '#f4eadc', nose: '#2a2224', tail: 'none', spines: true, palettes: [['#d9c2a6', '#8fb36a', '#ffffff']], props: [PROPS.crown] },
}
export const MISSION = ['bull', 'lynx', 'rabbit', 'dragon', 'wildcat']
export const AMBIENT = ['donkey', 'parakeet', 'pigeon', 'dog', 'gull', 'hedgehog']

const HC = [0, 1.43, 0.02]
const HR = [0.235, 0.22, 0.215]

/** animal head, face, tail and props on the shared skeleton */
function animalRigid(S) {
  return (b) => {
    const head = (geo) => geo
    void head
    b.ellipsoid(HR, { pos: HC, bone: 'head', region: 0 }, 26, 18)
    const face = (dx, dy) => onSurface(HC, HR, [dx, dy, 1])
    // muzzle / beak
    if (S.beak) {
      b.cone(0.05, 0.12, { pos: face(0, -0.18).map((v, i) => v + [0, 0, 0.03][i]), rot: [Math.PI / 2, 0, 0], bone: 'head', color: S.beak }, 10)
      if (S.beakSpot) b.ellipsoid([0.012, 0.01, 0.01], { pos: face(0, -0.26).map((v, i) => v + [0, -0.012, 0.06][i]), bone: 'head', color: '#d9463b', detail: true }, 6, 4)
      b.ellipsoid([0.15, 0.1, 0.06], { pos: face(0, -0.4).map((v, i) => v - [0, 0, 0.05][i]), bone: 'head', color: S.muzzle }, 12, 8)
    } else {
      const m = face(0, -0.36)
      const sn = S.snout ? 1.35 : 1
      b.ellipsoid([0.1 * (S.ears === 'side' ? 1.3 : 1), 0.072, 0.07 * sn], { pos: [m[0], m[1], m[2] - 0.03 + (sn - 1) * 0.05], bone: 'head', color: S.muzzle }, 14, 10)
      b.ellipsoid([0.03, 0.02, 0.02], { pos: [m[0], m[1] + 0.025, m[2] + 0.035 + (sn - 1) * 0.09], bone: 'head', color: S.nose }, 10, 8)
    }
    buildFace(b, HC, HR, 'head', { eyeY: 0.08, mouthY: S.beak ? -0.62 : -0.56, browY: 0.32, size: 1.1 })
    // ears
    for (const s of [-1, 1]) {
      const base = [s * 0.13, HC[1] + 0.17, HC[2] - 0.01]
      switch (S.ears) {
        case 'side':
          b.ellipsoid([0.07, 0.035, 0.045], { pos: [s * 0.24, HC[1] + 0.06, HC[2]], rot: [0, 0, -s * 0.3], bone: 'head', region: 0 }, 12, 8)
          break
        case 'pointed':
        case 'tufted':
          b.cone(0.065, 0.14, { pos: [base[0], base[1] + 0.06, base[2]], rot: [0, 0, -s * 0.25], scale: [1, 1, 0.5], bone: 'head', region: 0 }, 10)
          b.cone(0.038, 0.09, { pos: [base[0], base[1] + 0.05, base[2] + 0.015], rot: [0, 0, -s * 0.25], scale: [1, 1, 0.3], bone: 'head', color: '#e9b9b4', detail: true }, 8)
          if (S.ears === 'tufted') b.cone(0.014, 0.08, { pos: [base[0] + s * 0.035, base[1] + 0.16, base[2]], rot: [0, 0, -s * 0.25], bone: 'head', color: '#211b17' }, 6)
          break
        case 'long':
          b.ellipsoid([0.045, 0.16, 0.025], { pos: [s * 0.09, HC[1] + 0.33, HC[2] - 0.02], rot: [-0.1, 0, -s * 0.12], bone: 'head', region: 0 }, 12, 10)
          b.ellipsoid([0.026, 0.12, 0.01], { pos: [s * 0.09, HC[1] + 0.33, HC[2] + 0.005], rot: [-0.1, 0, -s * 0.12], bone: 'head', color: '#efb3bb', detail: true }, 10, 8)
          break
        case 'donkey':
          b.ellipsoid([0.045, 0.14, 0.03], { pos: [s * 0.15, HC[1] + 0.27, HC[2] - 0.02], rot: [0, 0, -s * 0.45], bone: 'head', region: 0 }, 12, 10)
          break
        case 'floppy':
          b.ellipsoid([0.05, 0.12, 0.025], { pos: [s * 0.23, HC[1] - 0.02, HC[2] - 0.01], rot: [0, 0, s * 0.3], bone: 'head', region: 2 }, 12, 10)
          break
        case 'round':
          b.ellipsoid([0.055, 0.055, 0.02], { pos: [base[0], base[1] + 0.02, base[2]], bone: 'head', region: 0 }, 10, 8)
          break
        default:
      }
    }
    if (S.horns === 'bull')
      for (const s of [-1, 1]) {
        b.capsule(0.022, 0.08, { pos: [s * 0.2, HC[1] + 0.13, HC[2] - 0.02], rot: [0, 0, -s * 1.1], bone: 'head', color: '#efe3c4' }, 8)
        b.cone(0.022, 0.07, { pos: [s * 0.27, HC[1] + 0.2, HC[2] - 0.02], rot: [0, 0, -s * 0.3], bone: 'head', color: '#efe3c4' }, 8)
      }
    if (S.horns === 'dragon') for (const s of [-1, 1]) b.cone(0.025, 0.1, { pos: [s * 0.1, HC[1] + 0.22, HC[2] - 0.04], rot: [-0.45, 0, -s * 0.2], bone: 'head', color: '#efe3c4' }, 8)
    if (S.spikes) for (let k = 0; k < 4; k++) b.cone(0.03, 0.07, { pos: [0, HC[1] + 0.18 - k * 0.12, HC[2] - 0.2 - k * 0.03], rot: [-0.6, 0, 0], bone: k < 2 ? 'head' : 'chest', region: 2 }, 6)
    if (S.crest) for (let k = 0; k < 3; k++) b.ellipsoid([0.02, 0.07, 0.015], { pos: [0, HC[1] + 0.24, HC[2] - 0.03 - k * 0.04], rot: [-0.4 - k * 0.2, 0, 0], bone: 'head', region: 0 }, 8, 6)
    if (S.collar) b.torus(0.07, 0.03, { pos: [0, 1.22, 0.005], rot: [Math.PI / 2, 0, 0], bone: 'neck', color: S.collar }, 14, 5)
    if (S.mane) for (let k = 0; k < 5; k++) b.ellipsoid([0.025, 0.045, 0.035], { pos: [0, HC[1] + 0.21 - k * 0.06, HC[2] - 0.18 - k * 0.02], bone: k < 3 ? 'head' : 'neck', color: '#1c1818' }, 8, 6)
    if (S.ruff) for (const s of [-1, 1]) b.cone(0.05, 0.1, { pos: face(s * 0.95, -0.45), rot: [0, 0, s * 2.2], scale: [1, 1, 0.5], bone: 'head', color: '#f3e7d2' }, 8)
    if (S.spots) for (let k = 0; k < 7; k++) b.ellipsoid([0.014, 0.014, 0.006], { pos: onSurface(HC, HR, [Math.cos(k * 2.4) * 0.8, 0.5 + 0.3 * Math.sin(k), -0.2 + Math.sin(k * 2.4) * 0.6]), bone: 'head', color: '#2c211b', detail: true }, 6, 4)
    if (S.stripes) for (const dx of [-0.05, 0, 0.05]) b.box(0.012, 0.07, 0.01, { pos: onSurface(HC, [HR[0] + 0.002, HR[1], HR[2] + 0.002], [dx * 4, 0.75, 0.8]), rot: [-0.7, 0, 0], bone: 'head', color: '#3b342e', detail: true })
    if (S.spines) {
      const n = b.lod === 0 ? 30 : 10
      for (let k = 0; k < n; k++) {
        const u = (k * 0.618034) % 1
        const v = k / n
        const az = Math.PI + (u - 0.5) * 2.6
        const d = [Math.sin(az) * Math.sin(v * 2.2 + 0.5), Math.cos(v * 2.2 + 0.5), Math.cos(az) * Math.sin(v * 2.2 + 0.5)]
        const p = onSurface(HC, [HR[0] * 1.02, HR[1] * 1.02, HR[2] * 1.02], d)
        b.cone(0.03, 0.12, { pos: p, rot: [-Math.atan2(d[2], d[1]), 0, Math.atan2(d[0], d[1])], bone: 'head', color: '#6e5440' }, 5)
      }
      for (let k = 0; k < (b.lod === 0 ? 18 : 6); k++) {
        const a = (k / 18) * Math.PI - Math.PI / 2
        b.cone(0.03, 0.11, { pos: [Math.sin(a) * 0.15, 0.95 + (k % 3) * 0.1, -0.15], rot: [-1.2, 0, Math.sin(a) * 0.6], bone: 'chest', color: '#6e5440' }, 5)
      }
    }
    // tail (on the hips, behind)
    const tb = [0, 0.82, -0.14]
    switch (S.tail) {
      case 'tuft':
        b.cyl(0.015, 0.015, 0.3, { pos: [0, tb[1] - 0.12, tb[2] - 0.05], rot: [0.35, 0, 0], bone: 'hips', region: 0 }, 6)
        b.ellipsoid([0.04, 0.06, 0.04], { pos: [0, tb[1] - 0.28, tb[2] - 0.1], bone: 'hips', color: '#1c1818' }, 8, 6)
        break
      case 'bob':
        b.ellipsoid([0.05, 0.06, 0.06], { pos: [0, tb[1], tb[2] - 0.03], bone: 'hips', region: 0 }, 10, 8)
        break
      case 'pompom':
        b.ellipsoid([0.07, 0.07, 0.07], { pos: [0, tb[1] - 0.02, tb[2] - 0.03], bone: 'hips', color: '#ffffff' }, 12, 8)
        break
      case 'ringed':
      case 'curl':
        for (let k = 0; k < 5; k++) {
          const t = k / 4
          const curl = S.tail === 'curl'
          const pos = curl ? [0, tb[1] + 0.05 + Math.sin(t * 2.6) * 0.14, tb[2] - Math.sin(t * 1.4) * 0.14] : [0.06 * t, tb[1] - 0.05 - t * 0.2 + t * t * 0.25, tb[2] - 0.05 - t * 0.2]
          b.ellipsoid([0.045 - t * 0.008, 0.045 - t * 0.008, 0.055], { pos, bone: 'hips', ...(S.tail === 'ringed' && k % 2 ? { color: '#3b342e' } : { region: 0 }) }, 10, 8)
        }
        break
      case 'dragon':
        for (let k = 0; k < 6; k++) {
          const t = k / 5
          b.ellipsoid([0.08 - t * 0.055, 0.07 - t * 0.045, 0.08], { pos: [0, tb[1] - 0.1 - t * 0.5, tb[2] - 0.05 - t * 0.32], bone: 'hips', region: 0 }, 10, 8)
          if (k % 2 === 0) b.cone(0.025, 0.06, { pos: [0, tb[1] - 0.04 - t * 0.5, tb[2] - 0.08 - t * 0.32], rot: [-0.6, 0, 0], bone: 'hips', region: 2 }, 6)
        }
        break
      case 'feather':
        for (const s of [-1, 0, 1]) b.ellipsoid([0.04, 0.012, 0.14], { pos: [s * 0.045, tb[1] - 0.08, tb[2] - 0.1], rot: [-0.6, s * 0.25, 0], bone: 'hips', region: 0 }, 10, 6)
        break
      default:
    }
    // props (optional per NPC)
    const top = [0, HC[1] + HR[1] * 0.92, HC[2] - 0.02]
    if (S.props.includes(PROPS.crown))
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2
        b.ellipsoid([0.028, 0.022, 0.028], { pos: [Math.cos(a) * 0.12, top[1] - 0.02, top[2] + Math.sin(a) * 0.12], bone: 'head', color: ['#f29bb0', '#f6d36b', '#ffffff', '#b9a2e6'][k % 4], prop: PROPS.crown }, 8, 6)
      }
    if (S.props.includes(PROPS.scarf)) {
      b.torus(0.075, 0.03, { pos: [0, 1.2, 0.01], rot: [Math.PI / 2, 0, 0], bone: 'neck', color: '#c9463b', prop: PROPS.scarf }, 16, 6)
      b.box(0.05, 0.14, 0.02, { pos: [0.04, 1.1, 0.13], rot: [0.2, 0, 0.15], bone: 'chest', color: '#c9463b', prop: PROPS.scarf })
    }
    if (S.props.includes(PROPS.bell)) {
      b.torus(0.07, 0.014, { pos: [0, 1.2, 0.01], rot: [Math.PI / 2, 0, 0], bone: 'neck', color: '#c8463b', prop: PROPS.bell }, 16, 5)
      b.ellipsoid([0.032, 0.032, 0.032], { pos: [0, 1.15, 0.09], bone: 'chest', color: '#e6b53c', prop: PROPS.bell }, 10, 8)
    }
    if (S.props.includes(PROPS.barretina)) {
      b.cone(0.13, 0.2, { pos: [0, top[1] + 0.06, top[2] - 0.02], rot: [0.5, 0, 0], bone: 'head', color: '#c42b2b', prop: PROPS.barretina }, 12)
      b.torus(0.13, 0.016, { pos: [0, top[1] - 0.02, top[2] - 0.02], rot: [Math.PI / 2, 0, 0], bone: 'head', color: '#8f1f22', prop: PROPS.barretina }, 14, 4)
    }
    if (S.props.includes(PROPS.rose)) {
      b.ellipsoid([0.04, 0.04, 0.04], { pos: [0.1, 1.06, 0.15], bone: 'chest', color: '#c8213a', prop: PROPS.rose }, 10, 8)
      b.cyl(0.006, 0.006, 0.12, { pos: [0.08, 1.0, 0.15], rot: [0, 0, 0.3], bone: 'chest', color: '#3f7a46', prop: PROPS.rose }, 5)
    }
  }
}

/** body look for a species: outfit + fur on the neck and paw-hands, shoes or hooves */
function lookOf(S) {
  const o = OUTFITS[S.outfit]
  return { pelvis: o.pelvis, torso: o.torso, neck: FUR, shoulder: o.shoulder, upper: o.upper, fore: o.fore, hand: FUR, leg: o.leg, shoe: S.hoof ? { c: HOOF, r: 3 } : { c: SHOE, r: 3 } }
}

/** one species, one level → same structure as buildPlayerMesh */
export function buildNpcMesh(id, lod = 0) {
  const S = SPECIES[id]
  return buildBipedMesh(lod, lookOf(S), animalRigid(S), { segScale: 0.75 })
}
