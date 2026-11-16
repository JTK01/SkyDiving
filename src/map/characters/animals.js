import { CharacterBuilder, onSurface, wave, ease } from './builder.js'

/**
 * Animal NPCs in one plush style (original designs after the reference
 * image's look: big round head ≈ half the height, stubby legs, small dot
 * eyes, pink blush, light muzzle / belly patch, felt texture, small props).
 *
 * Variation = body type × parts × palette × props:
 *   body types: quad (four legs), hop (rabbit gait), bird, dragon
 *   parts: ears, tail, horns, wings, spines, spots / stripes, mane, beak
 *   palette regions (per instance): A main fur, B muzzle / belly, C accent
 *   props (per-instance mask bits): 1 flower crown, 2 bell collar, 3 scarf,
 *     4 barretina (red Catalan cap), 5 Sant Jordi rose
 * Model space: unit size (≈ 1 m tall before the species scale), feet at
 * y = 0, facing +z, left = +x.
 */
export const PROPS = { crown: 1, bell: 2, scarf: 3, barretina: 4, rose: 5 }

export const SPECIES = {
  // ---- the five mission animals ----
  bull: {
    name: '황소', body: 'quad', scale: 1.35, head: 0.24, ears: 'round', tail: 'tuft', horns: 'bull', hoof: true, nose: '#3a2a26',
    palettes: [['#5a3a2c', '#efe2cf', '#2a1f1c'], ['#2b2523', '#e8dccb', '#141111'], ['#9a5a34', '#f2e6d4', '#3a2418']], props: [PROPS.bell, PROPS.crown],
  },
  lynx: {
    name: '이베리아스라소니', body: 'quad', scale: 0.95, head: 0.27, ears: 'tufted', tail: 'bob', spots: true, ruff: true, nose: '#2a1d1a',
    palettes: [['#c59253', '#f3e7d2', '#2c211b'], ['#b98448', '#efe0c8', '#3a2a1e']], props: [PROPS.scarf],
  },
  rabbit: {
    name: '토끼', body: 'hop', scale: 0.62, head: 0.29, ears: 'long', tail: 'pompom', nose: '#d97b85',
    palettes: [['#a58a72', '#f4ece2', '#e7a7b0'], ['#e9e4dc', '#ffffff', '#efb3bb'], ['#6f625a', '#ece3d8', '#d99aa4']], props: [PROPS.crown, PROPS.scarf],
  },
  dragon: {
    name: '드래곤', body: 'dragon', scale: 1.5, head: 0.25, ears: 'none', tail: 'dragon', horns: 'dragon', spikes: true, wings: true, nose: '#24341f',
    palettes: [['#4f9a5a', '#f1d77a', '#2f6e3c'], ['#5b84b8', '#f2e2a6', '#2f4f80'], ['#c0563f', '#f5d78c', '#7a2e22']], props: [PROPS.rose],
  },
  wildcat: {
    name: '카탈루냐 야생 고양이', body: 'quad', scale: 0.72, head: 0.28, ears: 'pointed', tail: 'ringed', stripes: true, nose: '#d58a8a',
    palettes: [['#8a8072', '#e9e1d4', '#3b342e'], ['#9b8a74', '#efe6d8', '#43382e']], props: [PROPS.bell, PROPS.barretina],
  },
  // ---- general animals around the mission area ----
  donkey: {
    name: '카탈루냐 당나귀', body: 'quad', scale: 1.2, head: 0.25, ears: 'donkey', tail: 'tuft', hoof: true, mane: true, nose: '#2b2524',
    palettes: [['#3c3433', '#eae4dc', '#1c1818'], ['#5a4c46', '#f0e9e0', '#2a2220']], props: [PROPS.barretina, PROPS.crown],
  },
  parakeet: {
    name: '몽크 앵무새', body: 'bird', scale: 0.42, head: 0.3, beak: '#f0b38a', feet: '#8f8a80',
    palettes: [['#6fb04a', '#c9d3c8', '#3f7fb0'], ['#7cc05a', '#d6ddd2', '#4a8fbe']], props: [],
  },
  pigeon: {
    name: '비둘기', body: 'bird', scale: 0.45, head: 0.27, beak: '#2f2d30', feet: '#c8524a',
    palettes: [['#8c929c', '#b4b9c2', '#4f8a72'], ['#7a7f88', '#a8adb6', '#6a4f86']], props: [],
  },
  dog: {
    name: '강아지', body: 'quad', scale: 0.78, head: 0.28, ears: 'floppy', tail: 'curl', nose: '#2a2426',
    palettes: [['#d8b98c', '#f6efe4', '#8a6644'], ['#f1ece4', '#ffffff', '#c09a74'], ['#6b4a34', '#e9d8c2', '#2f2219']], props: [PROPS.scarf, PROPS.bell],
  },
  gull: {
    name: '갈매기', body: 'bird', scale: 0.55, head: 0.26, beak: '#f2c94c', feet: '#e8c25a',
    palettes: [['#f3f3f0', '#ffffff', '#9aa3ad']], props: [],
  },
  hedgehog: {
    name: '고슴도치', body: 'quad', scale: 0.48, head: 0.27, ears: 'round', tail: 'none', spines: true, short: true, nose: '#2a2224',
    palettes: [['#d9c2a6', '#f4eadc', '#6e5440'], ['#cdb498', '#efe2d0', '#54402f']], props: [PROPS.crown],
  },
}
export const MISSION = ['bull', 'lynx', 'rabbit', 'dragon', 'wildcat']
export const AMBIENT = ['donkey', 'parakeet', 'pigeon', 'dog', 'gull', 'hedgehog']

const EYE = '#151315'
const BLUSH = '#f2a1a4'
const HORN = '#efe3c4'

/** build one species at a level of detail → { geometry, bones } */
export function buildAnimal(id, lod = 0) {
  const S = SPECIES[id]
  const b = new CharacterBuilder(lod, { segScale: 0.7 })
  const bird = S.body === 'bird'
  const short = S.short ? 0.6 : 1
  const legLen = bird ? 0.16 : 0.24 * short
  const bodyY = bird ? 0.34 : legLen + 0.16
  const bodyR = bird ? [0.2, 0.22, 0.24] : [0.24, 0.21, 0.3]
  const hr = S.head // head radius (≈ half the height with the body)
  const headC = bird ? [0, bodyY + 0.24, 0.1] : [0, bodyY + 0.26, 0.22]
  const HR = [hr * 1.05, hr, hr * 0.95]

  b.bone('root', null, [0, bodyY, 0]).bone('head', 'root', [0, bodyY + 0.12, bird ? 0.06 : 0.16])
  b.bone('earL', 'head', [hr * 0.55, headC[1] + hr * 0.7, headC[2]]).bone('earR', 'head', [-hr * 0.55, headC[1] + hr * 0.7, headC[2]])
  b.bone('tail', 'root', [0, bodyY + 0.04, -bodyR[2] + 0.04])
  if (bird) b.bone('legL', 'root', [0.08, bodyY - 0.12, 0]).bone('legR', 'root', [-0.08, bodyY - 0.12, 0])
  else
    b.bone('legFL', 'root', [0.12, bodyY - 0.06, 0.15]).bone('legFR', 'root', [-0.12, bodyY - 0.06, 0.15])
      .bone('legBL', 'root', [0.12, bodyY - 0.06, -0.15]).bone('legBR', 'root', [-0.12, bodyY - 0.06, -0.15])
  if (bird || S.wings) b.bone('wingL', 'root', [bodyR[0] * 0.8, bodyY + 0.08, 0]).bone('wingR', 'root', [-bodyR[0] * 0.8, bodyY + 0.08, 0])

  // ---- body & belly ------------------------------------------------------
  if (bird) {
    b.ellipsoid(bodyR, { pos: [0, bodyY, -0.02], rot: [0.35, 0, 0], bone: 'root', region: 0 }, 20, 14)
    b.ellipsoid([0.15, 0.17, 0.12], { pos: [0, bodyY - 0.02, 0.1], rot: [0.35, 0, 0], bone: 'root', region: 1 }, 16, 10)
  } else {
    b.ellipsoid(bodyR, { pos: [0, bodyY, 0], bone: 'root', region: 0 }, 20, 14)
    b.ellipsoid([0.15, 0.13, 0.12], { pos: onSurface([0, bodyY, 0], bodyR, [0, -0.25, 1]).map((v, i) => v - [0, 0, 0.05][i]), bone: 'root', region: 1 }, 14, 10)
  }
  // ---- head & face -------------------------------------------------------
  b.ellipsoid(HR, { pos: headC, bone: 'head', region: 0 }, 24, 18)
  const face = (dx, dy) => onSurface(headC, HR, [dx, dy, 1])
  if (bird) {
    b.cone(hr * 0.22, hr * 0.5, { pos: face(0, -0.12), rot: [Math.PI / 2, 0, 0], bone: 'head', color: S.beak }, 10)
    b.ellipsoid([hr * 0.55, hr * 0.5, hr * 0.3], { pos: face(0, -0.25).map((v, i) => v - [0, 0, hr * 0.25][i]), bone: 'head', region: 1 }, 12, 8)
  } else {
    // muzzle (light), nose, mouth line
    const m = face(0, -0.35)
    b.ellipsoid([hr * 0.42, hr * 0.3, hr * 0.26], { pos: [m[0], m[1], m[2] - hr * 0.14], bone: 'head', region: 1 }, 14, 10)
    b.ellipsoid([hr * 0.12, hr * 0.08, hr * 0.07], { pos: [m[0], m[1] + hr * 0.08, m[2] + hr * 0.08], bone: 'head', color: S.nose }, 10, 8)
  }
  for (const s of [-1, 1]) {
    b.ellipsoid([hr * 0.09, hr * 0.12, hr * 0.06], { pos: face(s * 0.42, 0.08), rot: [0, s * 0.4, 0], bone: 'head', color: EYE }, 10, 8)
    b.ellipsoid([hr * 0.03, hr * 0.03, hr * 0.02], { pos: face(s * 0.4, 0.14), bone: 'head', color: '#ffffff', detail: true }, 6, 4)
    b.ellipsoid([hr * 0.14, hr * 0.07, hr * 0.03], { pos: face(s * 0.62, -0.22), rot: [0, s * 0.6, 0], bone: 'head', color: BLUSH, detail: true }, 10, 6)
  }
  // ---- ears ----------------------------------------------------------------
  const ear = (s) => {
    const bone = s > 0 ? 'earL' : 'earR'
    const base = [s * hr * 0.55, headC[1] + hr * 0.72, headC[2]]
    switch (S.ears) {
      case 'round':
        b.ellipsoid([hr * 0.24, hr * 0.24, hr * 0.1], { pos: [base[0], base[1] + hr * 0.12, base[2]], bone, region: 0 }, 12, 8)
        b.ellipsoid([hr * 0.15, hr * 0.15, hr * 0.05], { pos: [base[0], base[1] + hr * 0.12, base[2] + hr * 0.07], bone, region: 2, detail: true }, 10, 6)
        break
      case 'pointed':
      case 'tufted':
        b.cone(hr * 0.24, hr * 0.5, { pos: [base[0], base[1] + hr * 0.2, base[2]], rot: [0, 0, -s * 0.25], scale: [1, 1, 0.45], bone, region: 0 }, 10)
        b.cone(hr * 0.14, hr * 0.32, { pos: [base[0], base[1] + hr * 0.16, base[2] + hr * 0.05], rot: [0, 0, -s * 0.25], scale: [1, 1, 0.3], bone, color: '#e9b9b4', detail: true }, 8)
        if (S.ears === 'tufted') b.cone(hr * 0.05, hr * 0.28, { pos: [base[0] + s * hr * 0.12, base[1] + hr * 0.55, base[2]], rot: [0, 0, -s * 0.25], bone, color: '#211b17' }, 6)
        break
      case 'long':
        b.ellipsoid([hr * 0.17, hr * 0.62, hr * 0.09], { pos: [base[0] * 0.8, base[1] + hr * 0.55, base[2] - hr * 0.05], rot: [-0.15, 0, -s * 0.12], bone, region: 0 }, 12, 10)
        b.ellipsoid([hr * 0.1, hr * 0.48, hr * 0.04], { pos: [base[0] * 0.8, base[1] + hr * 0.55, base[2] + hr * 0.03], rot: [-0.15, 0, -s * 0.12], bone, region: 2, detail: true }, 10, 8)
        break
      case 'donkey':
        b.ellipsoid([hr * 0.16, hr * 0.5, hr * 0.1], { pos: [base[0] * 1.1, base[1] + hr * 0.4, base[2]], rot: [0, 0, -s * 0.45], bone, region: 0 }, 12, 10)
        b.ellipsoid([hr * 0.07, hr * 0.12, hr * 0.06], { pos: [base[0] * 1.1 + s * hr * 0.35, base[1] + hr * 0.75, base[2]], bone, region: 2, detail: true }, 8, 6)
        break
      case 'floppy':
        b.ellipsoid([hr * 0.18, hr * 0.42, hr * 0.08], { pos: [base[0] * 1.35, base[1] - hr * 0.25, base[2]], rot: [0, 0, s * 0.35], bone, region: 2 }, 12, 10)
        break
      default:
    }
  }
  if (!bird && S.ears !== 'none') {
    ear(1)
    ear(-1)
  }
  // ---- legs ---------------------------------------------------------------
  if (bird) {
    for (const [s, bone] of [[1, 'legL'], [-1, 'legR']]) {
      b.cyl(0.018, 0.018, 0.16, { pos: [s * 0.08, 0.1, 0.02], bone, color: S.feet }, 6)
      b.ellipsoid([0.05, 0.015, 0.06], { pos: [s * 0.08, 0.015, 0.05], bone, color: S.feet }, 8, 4)
    }
  } else {
    for (const [sx, sz, bone] of [[1, 1, 'legFL'], [-1, 1, 'legFR'], [1, -1, 'legBL'], [-1, -1, 'legBR']]) {
      b.capsule(0.07, legLen * 0.7, { pos: [sx * 0.12, legLen * 0.62, sz * 0.15], bone, region: 0 }, 10)
      b.ellipsoid([0.075, 0.05, 0.085], { pos: [sx * 0.12, 0.045, sz * 0.15 + 0.015], bone, region: S.hoof ? 2 : 1 }, 10, 6)
    }
  }
  // ---- tail ----------------------------------------------------------------
  const tb = [0, bodyY + 0.04, -bodyR[2] + 0.04]
  switch (bird ? 'bird' : S.tail) {
    case 'bird':
      b.ellipsoid([0.12, 0.03, 0.18], { pos: [0, bodyY - 0.02, -0.26], rot: [-0.35, 0, 0], bone: 'tail', region: 2 }, 12, 6)
      break
    case 'tuft':
      b.cyl(0.02, 0.02, 0.3, { pos: [0, tb[1] - 0.1, tb[2] - 0.05], rot: [0.35, 0, 0], bone: 'tail', region: 0 }, 6)
      b.ellipsoid([0.05, 0.08, 0.05], { pos: [0, tb[1] - 0.26, tb[2] - 0.1], bone: 'tail', region: 2 }, 8, 6)
      break
    case 'bob':
      b.ellipsoid([0.06, 0.07, 0.08], { pos: [0, tb[1] + 0.03, tb[2] - 0.04], bone: 'tail', region: 0 }, 10, 8)
      b.ellipsoid([0.04, 0.04, 0.04], { pos: [0, tb[1] + 0.06, tb[2] - 0.1], bone: 'tail', region: 2 }, 8, 6)
      break
    case 'pompom':
      b.ellipsoid([0.09, 0.09, 0.09], { pos: [0, tb[1], tb[2] - 0.04], bone: 'tail', region: 1 }, 12, 8)
      break
    case 'ringed':
    case 'curl': {
      const curl = S.tail === 'curl'
      for (let k = 0; k < 5; k++) {
        const t = k / 4
        const pos = curl ? [0, tb[1] + 0.06 + Math.sin(t * 2.6) * 0.16, tb[2] - Math.sin(t * 1.4) * 0.14] : [0, tb[1] + 0.02 + t * 0.12, tb[2] - 0.04 - t * 0.26]
        b.ellipsoid([0.065 - t * 0.012, 0.065 - t * 0.012, 0.08], { pos, bone: 'tail', region: S.tail === 'ringed' && k % 2 ? 2 : 0 }, 10, 8)
      }
      break
    }
    case 'dragon':
      for (let k = 0; k < 6; k++) {
        const t = k / 5
        b.ellipsoid([0.1 - t * 0.07, 0.09 - t * 0.06, 0.1], { pos: [0, tb[1] - t * 0.12, tb[2] - 0.05 - t * 0.42], bone: 'tail', region: 0 }, 10, 8)
        if (k % 2 === 0) b.cone(0.035, 0.08, { pos: [0, tb[1] - t * 0.12 + 0.09 - t * 0.05, tb[2] - 0.05 - t * 0.42], bone: 'tail', region: 2 }, 6)
      }
      b.cone(0.07, 0.12, { pos: [0, tb[1] - 0.14, tb[2] - 0.58], rot: [-Math.PI / 2, 0, 0], scale: [1, 1, 0.4], bone: 'tail', region: 2 }, 6)
      break
    default:
  }
  // ---- species extras -------------------------------------------------------
  if (S.horns === 'bull')
    for (const s of [-1, 1]) {
      b.capsule(0.035, 0.12, { pos: [s * hr * 0.85, headC[1] + hr * 0.55, headC[2] - 0.02], rot: [0, 0, -s * 1.1], bone: 'head', color: HORN }, 8)
      b.cone(0.033, 0.1, { pos: [s * hr * 1.18, headC[1] + hr * 0.82, headC[2] - 0.02], rot: [0, 0, -s * 0.3], bone: 'head', color: HORN }, 8)
    }
  if (S.horns === 'dragon') for (const s of [-1, 1]) b.cone(0.04, 0.14, { pos: [s * hr * 0.45, headC[1] + hr * 0.95, headC[2] - 0.05], rot: [-0.45, 0, -s * 0.2], bone: 'head', color: HORN }, 8)
  if (S.spikes) for (let k = 0; k < 4; k++) b.cone(0.045, 0.1, { pos: [0, bodyY + bodyR[1] - 0.01, 0.12 - k * 0.12], rot: [-0.2, 0, 0], bone: 'root', region: 2 }, 6)
  if (S.wings)
    for (const [s, bone] of [[1, 'wingL'], [-1, 'wingR']]) {
      b.ellipsoid([0.2, 0.025, 0.14], { pos: [s * (bodyR[0] + 0.12), bodyY + 0.14, -0.04], rot: [0, 0, s * 0.5], bone, region: 2 }, 12, 6)
      for (let k = 0; k < 3; k++) b.capsule(0.015, 0.16, { pos: [s * (bodyR[0] + 0.1 + k * 0.05), bodyY + 0.16 + k * 0.03, 0.02 - k * 0.05], rot: [0.9, 0, s * 1.2], bone, region: 0, detail: true }, 5)
    }
  if (bird)
    for (const [s, bone] of [[1, 'wingL'], [-1, 'wingR']]) b.ellipsoid([0.05, 0.13, 0.17], { pos: [s * (bodyR[0] - 0.02), bodyY + 0.02, -0.03], rot: [0.35, 0, s * 0.12], bone, region: 2 }, 12, 8)
  if (id === 'pigeon') b.torus(0.12, 0.035, { pos: [0, bodyY + 0.14, 0.06], rot: [Math.PI / 2 + 0.4, 0, 0], bone: 'root', region: 2 }, 14, 6) // iridescent neck
  if (id === 'gull') b.ellipsoid([hr * 0.08, hr * 0.06, hr * 0.06], { pos: onSurface(headC, HR, [0, -0.2, 1]).map((v, i) => v + [0, -0.01, hr * 0.42][i]), bone: 'head', color: '#d9463b', detail: true }, 6, 4)
  if (S.spots) for (let k = 0; k < 10; k++) {
    const a = k * 2.39996
    const p = onSurface([0, bodyY, 0], bodyR, [Math.cos(a), 0.4 + 0.5 * Math.sin(k * 1.7), Math.sin(a) * 1.2])
    b.ellipsoid([0.03, 0.03, 0.015], { pos: p, rot: [0, a, 0], bone: 'root', region: 2, detail: true }, 6, 4)
  }
  if (S.ruff) for (const s of [-1, 1]) b.cone(hr * 0.22, hr * 0.42, { pos: face(s * 0.95, -0.45), rot: [0, 0, s * 2.2], scale: [1, 1, 0.5], bone: 'head', region: 1 }, 8)
  if (S.stripes) {
    for (let k = 0; k < 4; k++) b.torus(bodyR[0] * 0.98, 0.012, { pos: [0, bodyY + 0.02, 0.12 - k * 0.1], rot: [0, 0, 0], scale: [1, 0.9, 1], bone: 'root', region: 2, detail: true }, 18, 3, Math.PI)
    for (const s of [-1, 1]) b.box(0.012, 0.012, hr * 0.5, { pos: [s * hr * 0.2, headC[1] + hr * 0.75, headC[2] + hr * 0.2], rot: [0.9, 0, 0], bone: 'head', region: 2, detail: true })
  }
  if (S.mane) for (let k = 0; k < 6; k++) b.ellipsoid([0.035, 0.06, 0.05], { pos: [0, headC[1] + hr * 0.6 - k * 0.07, headC[2] - hr * 0.5 - k * 0.05], bone: k < 2 ? 'head' : 'root', region: 2 }, 8, 6)
  if (S.spines) {
    const n = lod === 0 ? 46 : 14
    for (let k = 0; k < n; k++) {
      const u = (k * 0.618034) % 1
      const v = k / n
      const az = u * Math.PI * 2
      const d = [Math.cos(az) * Math.sin(v * 2.4 + 0.3), Math.cos(v * 2.4 + 0.3) * 0.9 + 0.2, Math.sin(az) * Math.sin(v * 2.4 + 0.3) * 1.2 - 0.3]
      if (d[2] > 0.55 && d[1] < 0.6) continue // leave the face free
      const p = onSurface([0, bodyY + 0.02, -0.04], [bodyR[0] * 1.05, bodyR[1] * 1.1, bodyR[2] * 1.05], d)
      const dir = Math.atan2(d[0], d[1])
      b.cone(0.04, 0.16, { pos: p, rot: [-Math.atan2(d[2], d[1]) * 0.9, 0, -dir * 0.9], bone: 'root', region: 2 }, 5)
    }
  }
  // ---- props (optional per instance) ---------------------------------------
  const top = [headC[0], headC[1] + HR[1] * 0.92, headC[2] - 0.02]
  if (S.props.includes(PROPS.crown))
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2
      b.ellipsoid([0.032, 0.026, 0.032], { pos: [top[0] + Math.cos(a) * hr * 0.42, top[1] - 0.01, top[2] + Math.sin(a) * hr * 0.42], bone: 'head', color: ['#f29bb0', '#f6d36b', '#ffffff', '#b9a2e6'][k % 4], prop: PROPS.crown }, 8, 6)
    }
  if (S.props.includes(PROPS.bell)) {
    b.torus(hr * 0.6, 0.02, { pos: [0, bodyY + 0.12, 0.15], rot: [Math.PI / 2 + 0.5, 0, 0], bone: 'root', color: '#c8463b', prop: PROPS.bell }, 16, 5)
    b.ellipsoid([0.045, 0.045, 0.045], { pos: [0, bodyY + 0.02, 0.29], bone: 'root', color: '#e6b53c', prop: PROPS.bell }, 10, 8)
  }
  if (S.props.includes(PROPS.scarf)) {
    b.torus(hr * 0.62, 0.035, { pos: [0, bodyY + 0.12, 0.13], rot: [Math.PI / 2 + 0.5, 0, 0], bone: 'root', color: '#3e6fb0', prop: PROPS.scarf }, 16, 6)
    b.box(0.07, 0.14, 0.02, { pos: [0.06, bodyY, 0.27], rot: [0.3, 0, 0.2], bone: 'root', color: '#3e6fb0', prop: PROPS.scarf })
  }
  if (S.props.includes(PROPS.barretina)) {
    // the red Catalan cap, its tip flopping forward
    b.cone(hr * 0.5, hr * 0.7, { pos: [top[0], top[1] + hr * 0.2, top[2]], rot: [0.5, 0, 0], bone: 'head', color: '#c42b2b', prop: PROPS.barretina }, 12)
    b.torus(hr * 0.5, 0.02, { pos: [top[0], top[1] - 0.03, top[2]], rot: [Math.PI / 2, 0, 0], bone: 'head', color: '#8f1f22', prop: PROPS.barretina }, 14, 4)
  }
  if (S.props.includes(PROPS.rose)) {
    const m = face(0.2, -0.45)
    b.ellipsoid([0.05, 0.05, 0.05], { pos: [m[0] + 0.06, m[1], m[2] + 0.03], bone: 'head', color: '#c8213a', prop: PROPS.rose }, 10, 8)
    b.cyl(0.008, 0.008, 0.16, { pos: [m[0] - 0.02, m[1] - 0.02, m[2] + 0.02], rot: [0, 0, 1.35], bone: 'head', color: '#3f7a46', prop: PROPS.rose }, 5)
  }
  return b.build()
}

// ---------------------------------------------------------------------------
// clips (seconds): idle loops, walk loops, react plays once (hop, ears up)
// ---------------------------------------------------------------------------
export const CLIPS = { idle: 3, walk: 0.9, react: 1.3 }

export function animalPose(id, clip) {
  const S = SPECIES[id]
  const bird = S.body === 'bird'
  const hop = S.body === 'hop'
  if (clip === 'idle')
    return (t) => {
      const twitch = Math.max(0, Math.sin(t * 2.1) - 0.85) * 2
      const P = {
        root: { r: [bird ? 0.05 * wave(t, 1.5) : -0.04, 0, 0], p: [0, 0.006 * wave(t, 1.5), 0] },
        head: { r: [bird ? 0.25 * Math.max(0, wave(t, 1.5)) : 0.05 * wave(t, 3), 0.35 * wave(t, 3, 0.2), 0.08 * wave(t, 3, 0.6)] },
        earL: { r: [0, 0, 0.25 * twitch] },
        earR: { r: [0, 0, -0.1 * twitch] },
        tail: { r: [0.1, 0.35 * wave(t, 1.5), 0] },
      }
      if (S.wings) Object.assign(P, { wingL: { r: [0, 0, 0.25 + 0.15 * wave(t, 3)] }, wingR: { r: [0, 0, -0.25 - 0.15 * wave(t, 3)] } })
      return P
    }
  if (clip === 'walk')
    return (t, d) => {
      const s = wave(t, d)
      const c = Math.abs(wave(t, d, 0.5))
      if (bird)
        return {
          root: { r: [0.1, 0, 0.12 * s], p: [0, 0.02 * c, 0] },
          head: { r: [0.15 * s, 0, 0], p: [0, 0, 0.02 * s] },
          legL: { r: [-0.6 * s, 0, 0] },
          legR: { r: [0.6 * s, 0, 0] },
          tail: { r: [0, 0, 0.15 * s] },
          wingL: { r: [0, 0, 0.1] },
          wingR: { r: [0, 0, -0.1] },
        }
      if (hop) {
        const h = Math.max(0, Math.sin((t / d) * Math.PI * 2))
        return {
          root: { p: [0, 0.12 * h, 0], r: [-0.2 * h, 0, 0] },
          head: { r: [0.15 * h, 0, 0] },
          earL: { r: [0.5 * h, 0, 0] },
          earR: { r: [0.5 * h, 0, 0] },
          legFL: { r: [-0.7 * h, 0, 0] },
          legFR: { r: [-0.7 * h, 0, 0] },
          legBL: { r: [0.8 * h, 0, 0] },
          legBR: { r: [0.8 * h, 0, 0] },
        }
      }
      return {
        root: { p: [0, 0.02 * c, 0], r: [0, 0, 0.04 * s] },
        head: { r: [0.06 * c, 0.05 * s, 0] },
        legFL: { r: [-0.55 * s, 0, 0] },
        legBR: { r: [-0.55 * s, 0, 0] },
        legFR: { r: [0.55 * s, 0, 0] },
        legBL: { r: [0.55 * s, 0, 0] },
        tail: { r: [0.2, 0.3 * s, 0] },
        wingL: { r: [0, 0, 0.3] },
        wingR: { r: [0, 0, -0.3] },
      }
    }
  // react: a happy hop, ears and tail up, wings spread
  return (t) => {
    const j = t < 0.7 ? Math.sin((t / 0.7) * Math.PI) : 0
    const up = ease(t / 0.2) * (1 - ease((t - 0.9) / 0.4))
    const flap = Math.sin(t * 28) * up
    return {
      root: { p: [0, (bird ? 0.12 : 0.22) * j, 0], r: [-0.25 * j, 0, 0] },
      head: { r: [-0.3 * up, 0, 0.12 * Math.sin(t * 9) * up] },
      earL: { r: [-0.2 * up, 0, -0.25 * up] },
      earR: { r: [-0.2 * up, 0, 0.25 * up] },
      tail: { r: [-0.6 * up, 0.4 * Math.sin(t * 14) * up, 0] },
      legFL: { r: [-0.5 * j, 0, 0] },
      legFR: { r: [-0.5 * j, 0, 0] },
      legBL: { r: [0.4 * j, 0, 0] },
      legBR: { r: [0.4 * j, 0, 0] },
      legL: { r: [0.4 * j, 0, 0] },
      legR: { r: [0.4 * j, 0, 0] },
      wingL: { r: [0, 0, (bird ? 1.1 : 0.9) * up + 0.4 * flap] },
      wingR: { r: [0, 0, -(bird ? 1.1 : 0.9) * up - 0.4 * flap] },
    }
  }
}
