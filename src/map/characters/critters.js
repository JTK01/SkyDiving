/**
 * Anthropomorphic animal NPCs ("critters"): species, looks and variants.
 * Shared by the offline mesh builder (tools/map-data/build_critters.mjs →
 * public/models/characters/critters.bin) and the runtime (play/Npcs.jsx,
 * characters/critterMaterial.js).
 *
 * Style: plush mascots standing on two legs — a big round head (~40 % of the
 * height), a soft pear-shaped body, short arms and legs; the animal shows in
 * the head (ears, muzzle / beak, horns), the tail, the fur colours and
 * markings. Clothes are separate meshes over the body (one set per outfit and
 * species, tools/map-data/garments.mjs; each NPC wears one); hats and neckwear are
 * optional props. Height (top of the head) = size × the player's 1.75 m (0.6–0.8).
 *
 * Model space (normalized, before the species' height scale): feet at y = 0,
 * top of the head at y = TOP, facing +z, the character's left = +x.
 */
export const TOP = 0.905
export const PLAYER_H = 1.75

/** skeleton for the vertex-shader animation (pivots in normalized units) */
export const BONE = { body: 0, head: 1, armL: 2, armR: 3, legL: 4, legR: 5, tail: 6, earL: 7, earR: 8 }
export const PIVOTS = {
  body: [0, 0.24, 0],
  head: [0, 0.55, 0],
  armL: [0.12, 0.49, 0],
  legL: [0.07, 0.235, 0],
}

/**
 * body zones (for the painted outfits; the shader finds them from the rest
 * position and the bone weights, so hems are clean): each outfit gives every zone a code
 * 0 fur · 1 top garment (colour B) · 2 bottom garment (colour C) · 3 shirt
 * (cream). Packed 2 bits per zone into one number (exact in a float).
 */
export const ZONE = { head: 0, neck: 1, chest: 2, belly: 3, hips: 4, upperArm: 5, hand: 6, thigh: 7, shin: 8, foot: 9, foreArm: 10, chestFront: 11, other: 0 }
const pack = (codes) => Object.entries(codes).reduce((s, [z, c]) => s + c * 4 ** ZONE[z], 0)
export const OUTFITS = {
  // short-sleeve tee + shorts
  tee: pack({ chest: 1, belly: 1, chestFront: 1, upperArm: 1, hips: 2, thigh: 2 }),
  // long-sleeved shirt + open vest + trousers (the boy in the reference image)
  vest: pack({ chest: 1, belly: 1, chestFront: 3, upperArm: 3, foreArm: 3, hips: 2, thigh: 2, shin: 2 }),
  // overalls over a tee
  overalls: pack({ chest: 1, chestFront: 2, belly: 2, upperArm: 1, hips: 2, thigh: 2, shin: 2 }),
  // dress
  dress: pack({ chest: 1, chestFront: 1, belly: 1, hips: 1, thigh: 1 }),
  // knitted jumper + trousers
  jumper: pack({ chest: 1, chestFront: 1, belly: 1, upperArm: 1, foreArm: 1, hips: 2, thigh: 2, shin: 2 }),
  // apron over fur (bakery / market)
  apron: pack({ chestFront: 1, belly: 1, hips: 1, thigh: 1 }),
}
/** garment colour pairs [top, bottom] */
export const GARMENTS = [
  ['#c9463b', '#2f4a72'],
  ['#e8c25a', '#3e6fb0'],
  ['#3f7a5a', '#6b4a32'],
  ['#e9e3d4', '#2c3550'],
  ['#8a5ab0', '#3a3a40'],
  ['#e58fa8', '#ffffff'],
  ['#4f9fd6', '#e9e3d4'],
  ['#f08a3c', '#3a5240'],
  ['#2c4774', '#c9463b'],
  ['#d9d3c2', '#7a4a2a'],
]

/** optional props (bit k−1 of the NPC's prop mask shows prop k) */
export const PROP = { barretina: 1, crown: 2, straw: 3, scarf: 4, bowtie: 5, beret: 6, bandana: 7, rose: 8 }
const HATS = [PROP.barretina, PROP.straw, PROP.beret]
const NECK = [PROP.scarf, PROP.bowtie, PROP.bandana]

/**
 * species
 *   mission: one of the five animals to find; lookalike: the mission animal it
 *   can be confused with. size: height factor. colors: [[main, light, mark], …]
 *   head [rx, ry, rz] (× the base head), muzzle, ears, tail, horns, marks,
 *   extras; face: eye spacing / height / size, mouth style ('cat' ω, 'smile',
 *   'beak' none), blush. outfits / props allowed.
 */
const ALL_OUT = Object.keys(OUTFITS)
export const SPECIES = {
  // ---------------- the five mission animals ----------------
  bull: {
    name: '황소', mission: true, size: 0.79, build: 'stocky',
    colors: [['#3b2a24', '#d9c7ad', '#1f1714'], ['#4a2e22', '#e2cfb3', '#2a1a14']],
    head: [1.04, 1, 1], muzzle: 'long', ears: 'cow', horns: 'bull', tail: 'tuft', marks: ['blaze'], hooves: true,
    face: { ex: 0.42, ey: 0.12, es: 1.1, mouth: 'smile', blush: 0.5 }, outfits: ['vest', 'jumper', 'tee'], props: [PROP.barretina, PROP.bandana, PROP.scarf],
  },
  lynx: {
    name: '이베리아스라소니', mission: true, size: 0.72,
    colors: [['#c99a5b', '#f3e8d4', '#3a2a1e'], ['#bf8c4e', '#f1e3cb', '#33241a']],
    head: [1.03, 1, 1], muzzle: 'cat', ears: 'tufted', tail: 'bob', marks: ['spots', 'belly'], extras: ['ruff'],
    face: { ex: 0.4, ey: 0.16, es: 1.18, mouth: 'cat', blush: 0.35 }, outfits: ['vest', 'jumper', 'overalls'], props: [PROP.scarf, PROP.beret, PROP.bandana],
  },
  rabbit: {
    name: '토끼', mission: true, size: 0.63,
    colors: [['#9c8670', '#f4ede4', '#6e5c4a'], ['#a8917a', '#f6efe6', '#76624f']],
    head: [1, 1, 1], muzzle: 'bunny', ears: 'bunny', tail: 'pompom', marks: ['belly'],
    face: { ex: 0.42, ey: 0.1, es: 1.1, mouth: 'bunny', blush: 0.7 }, outfits: ['dress', 'apron', 'overalls', 'tee'], props: [PROP.crown, PROP.bowtie, PROP.scarf],
  },
  dragon: {
    name: '드래곤', mission: true, size: 0.80, build: 'stocky',
    colors: [['#4f9a5a', '#f1d77a', '#2f6b3c'], ['#5b8f4a', '#f0d27a', '#356a30']],
    head: [1.03, 1, 1], muzzle: 'dragon', ears: 'fin', horns: 'dragon', tail: 'dragon', marks: ['belly'], extras: ['spikes', 'wings'],
    face: { ex: 0.42, ey: 0.2, es: 1.14, mouth: 'smile', blush: 0.4 }, outfits: ['vest', 'tee'], props: [PROP.rose, PROP.scarf],
  },
  wildcat: {
    name: '카탈루냐 야생 고양이', mission: true, size: 0.68,
    colors: [['#8f8574', '#e6ddcc', '#3b342e'], ['#958a76', '#e9dfcd', '#40372f']],
    head: [1.02, 1, 1], muzzle: 'cat', ears: 'pointed', tail: 'ringed', marks: ['stripes', 'belly'],
    face: { ex: 0.4, ey: 0.16, es: 1.18, mouth: 'cat', blush: 0.35 }, outfits: ['overalls', 'jumper', 'tee'], props: [PROP.barretina, PROP.bandana, PROP.bowtie],
  },
  // ---------------- lookalikes ----------------
  housecat: {
    name: '집고양이', lookalike: 'wildcat', size: 0.65,
    colors: [['#e08b3e', '#f6ead8', '#b8621f'], ['#e9e4dc', '#ffffff', '#8a8a8a'], ['#2e2a2a', '#f1ece6', '#151212']],
    head: [1.02, 1, 1], muzzle: 'cat', ears: 'pointed', tail: 'long', marks: ['tabbyLight', 'belly'],
    face: { ex: 0.4, ey: 0.16, es: 1.18, mouth: 'cat', blush: 0.5 }, outfits: ['tee', 'dress', 'jumper'], props: [PROP.bowtie, PROP.crown, PROP.beret],
  },
  hare: {
    name: '산토끼', lookalike: 'rabbit', size: 0.67,
    colors: [['#b98d5e', '#efe3cf', '#2a221c'], ['#a98257', '#ebdcc6', '#2a221c']],
    head: [0.96, 1.02, 1], muzzle: 'bunny', ears: 'hare', tail: 'hareTail', marks: ['belly', 'earTips'], build: 'lanky',
    face: { ex: 0.44, ey: 0.12, es: 1.12, mouth: 'bunny', blush: 0.4 }, outfits: ['vest', 'tee', 'jumper'], props: [PROP.scarf, PROP.straw, PROP.bandana],
  },
  cow: {
    name: '젖소', lookalike: 'bull', size: 0.75, build: 'stocky',
    colors: [['#f4f1ea', '#f2c7c0', '#2a2524']],
    head: [1.03, 1, 1], muzzle: 'cowMuzzle', ears: 'cow', horns: 'cow', tail: 'tuft', marks: ['patches'], hooves: true,
    face: { ex: 0.42, ey: 0.12, es: 1.05, mouth: 'smile', blush: 0.6 }, outfits: ['apron', 'dress', 'overalls'], props: [PROP.bowtie, PROP.straw, PROP.crown],
  },
  lizard: {
    name: '도마뱀', lookalike: 'dragon', size: 0.64, build: 'lanky',
    colors: [['#7fae4a', '#e6e2a8', '#4d7a2c'], ['#6f9e7a', '#dfe6b8', '#3f6e4c']],
    head: [1, 0.98, 1], muzzle: 'dragon', ears: 'none', tail: 'lizard', marks: ['belly', 'dots'],
    face: { ex: 0.46, ey: 0.22, es: 1.14, mouth: 'smile', blush: 0.3 }, outfits: ['tee', 'jumper'], props: [PROP.straw, PROP.bandana],
  },
  // ---------------- general animals ----------------
  fox: {
    name: '여우', size: 0.68,
    colors: [['#d8743a', '#f6efe4', '#3a2a24']],
    head: [1.02, 1, 1], muzzle: 'fox', ears: 'fox', tail: 'fox', marks: ['foxMask', 'socks'],
    face: { ex: 0.4, ey: 0.16, es: 1.16, mouth: 'smile', blush: 0.35 }, outfits: ['vest', 'jumper', 'tee'], props: [PROP.scarf, PROP.beret, PROP.bowtie],
  },
  deer: {
    name: '사슴', size: 0.73, build: 'lanky',
    colors: [['#b7804c', '#f6eadb', '#8a5a32']],
    head: [0.98, 1, 1], muzzle: 'deer', ears: 'deer', horns: 'antlers', tail: 'deer', marks: ['fawnSpots', 'belly'], hooves: true,
    face: { ex: 0.42, ey: 0.12, es: 1.14, mouth: 'smile', blush: 0.55 }, outfits: ['dress', 'vest', 'jumper'], props: [PROP.crown, PROP.scarf],
  },
  boar: {
    name: '멧돼지', size: 0.69, build: 'stocky',
    colors: [['#6e5242', '#b89a82', '#3e2c22']],
    head: [1.03, 1, 1], muzzle: 'boar', ears: 'boar', tail: 'curly', extras: ['bristles'], hooves: true,
    face: { ex: 0.38, ey: 0.16, es: 1.1, mouth: 'smile', blush: 0.4 }, outfits: ['overalls', 'tee', 'vest'], props: [PROP.bandana, PROP.straw, PROP.barretina],
  },
  goat: {
    name: '염소', size: 0.71,
    colors: [['#ebe5da', '#ffffff', '#9a8e7e'], ['#7a5c44', '#e9dcc8', '#3e2c22']],
    head: [0.96, 1.02, 1], muzzle: 'long', ears: 'goat', horns: 'goat', tail: 'short', extras: ['beard'], hooves: true,
    face: { ex: 0.44, ey: 0.12, es: 1, mouth: 'smile', blush: 0.4 }, outfits: ['vest', 'jumper', 'overalls'], props: [PROP.bandana, PROP.scarf, PROP.straw],
  },
  sheep: {
    name: '양', size: 0.67, build: 'round',
    colors: [['#f3efe6', '#2e2a2a', '#d9d3c6'], ['#e9e2d2', '#3a3434', '#cfc6b4']],
    head: [0.98, 0.98, 1], muzzle: 'sheep', ears: 'sheep', tail: 'short', marks: ['darkFace'], extras: ['wool'], hooves: true,
    face: { ex: 0.42, ey: 0.06, es: 1.08, mouth: 'smile', blush: 0.6, light: true }, outfits: ['jumper', 'dress', 'tee'], props: [PROP.bowtie, PROP.crown, PROP.scarf],
  },
  horse: {
    name: '말', size: 0.77, build: 'lanky',
    colors: [['#8a5a36', '#e9dcc8', '#2a1e18'], ['#e9e4dc', '#ffffff', '#b9b2a6']],
    head: [0.96, 1.04, 1], muzzle: 'horse', ears: 'horse', tail: 'horse', marks: ['blaze', 'socks'], extras: ['mane'], hooves: true,
    face: { ex: 0.44, ey: 0.16, es: 1.12, mouth: 'smile', blush: 0.4 }, outfits: ['vest', 'jumper'], props: [PROP.bandana, PROP.barretina, PROP.scarf],
  },
  donkey: {
    name: '카탈루냐 당나귀', size: 0.73,
    colors: [['#3c3433', '#d9d2c8', '#1c1818']],
    head: [0.98, 1.02, 1], muzzle: 'horse', ears: 'donkey', tail: 'tuft', marks: ['eyeRings', 'belly'], extras: ['mane'], hooves: true,
    face: { ex: 0.44, ey: 0.14, es: 1.1, mouth: 'smile', blush: 0.4 }, outfits: ['vest', 'overalls'], props: [PROP.barretina, PROP.crown, PROP.bandana],
  },
  bear: {
    name: '곰', size: 0.76, build: 'round',
    colors: [['#6b4a34', '#c9a27c', '#4a3222'], ['#2c2624', '#d9c3a3', '#1a1614']],
    head: [1.06, 0.98, 1], muzzle: 'bear', ears: 'round', tail: 'short', marks: ['belly'],
    face: { ex: 0.42, ey: 0.14, es: 0.95, mouth: 'smile', blush: 0.5 }, outfits: ['overalls', 'jumper', 'tee'], props: [PROP.beret, PROP.scarf, PROP.bowtie],
  },
  hedgehog: {
    name: '고슴도치', size: 0.60, build: 'round',
    colors: [['#d9c2a6', '#f4eadc', '#6e5440']],
    head: [1, 0.98, 1], muzzle: 'hedgehog', ears: 'small', tail: 'none', extras: ['spines'],
    face: { ex: 0.38, ey: 0.08, es: 1.14, mouth: 'smile', blush: 0.7 }, outfits: ['apron', 'dress', 'tee'], props: [PROP.crown, PROP.bowtie],
  },
  squirrel: {
    name: '다람쥐', size: 0.61,
    colors: [['#c4652e', '#f4e6d2', '#7a3a18']],
    head: [1, 1, 1], muzzle: 'bunny', ears: 'squirrel', tail: 'squirrel', marks: ['belly'], extras: ['cheeks'],
    face: { ex: 0.42, ey: 0.14, es: 1.12, mouth: 'bunny', blush: 0.6 }, outfits: ['vest', 'overalls', 'tee'], props: [PROP.bowtie, PROP.scarf, PROP.straw],
  },
  owl: {
    name: '부엉이', size: 0.63, build: 'round', bird: true,
    colors: [['#8a6a4a', '#efe2c8', '#4a3524']],
    head: [1.04, 1, 1], muzzle: 'owlBeak', ears: 'owl', tail: 'feather', marks: ['faceDisc', 'chestBars'], extras: ['wingArms'],
    face: { ex: 0.42, ey: 0.14, es: 1.35, mouth: 'beak', blush: 0.3 }, outfits: ['vest', 'jumper'], props: [PROP.bowtie, PROP.scarf, PROP.beret],
  },
  eagle: {
    name: '독수리', size: 0.75, bird: true,
    colors: [['#5a4030', '#f6f3ec', '#3a281e']],
    head: [0.98, 0.98, 1.02], muzzle: 'eagleBeak', ears: 'none', tail: 'feather', marks: ['whiteHead'], extras: ['wingArms'],
    face: { ex: 0.46, ey: 0.16, es: 0.95, mouth: 'beak', blush: 0.2, brows: 1 }, outfits: ['vest', 'jumper'], props: [PROP.scarf, PROP.bandana],
  },
  parakeet: {
    name: '몽크 앵무새', size: 0.61, bird: true,
    colors: [['#7cbc4e', '#cfd6cc', '#4f8a32']],
    head: [1, 1, 1], muzzle: 'parrotBeak', ears: 'none', tail: 'feather', marks: ['greyFace'], extras: ['wingArms', 'crest'],
    face: { ex: 0.44, ey: 0.14, es: 1.05, mouth: 'beak', blush: 0.5 }, outfits: ['tee', 'jumper', 'dress'], props: [PROP.crown, PROP.bowtie, PROP.scarf],
  },
  pigeon: {
    name: '비둘기', size: 0.64, bird: true, build: 'round',
    colors: [['#8d939c', '#c9ccd2', '#5f6b8a']],
    head: [0.96, 0.96, 1], muzzle: 'pigeonBeak', ears: 'none', tail: 'feather', marks: ['neckSheen', 'wingBars'], extras: ['wingArms'],
    face: { ex: 0.46, ey: 0.12, es: 1.08, mouth: 'beak', blush: 0.3 }, outfits: ['vest', 'tee'], props: [PROP.bowtie, PROP.beret],
  },
  dog: {
    name: '강아지', size: 0.65,
    colors: [['#d8b98c', '#f6efe4', '#8a6a44'], ['#f1ece4', '#ffffff', '#6b4a34'], ['#6b4a34', '#e8d4b8', '#3a281c']],
    head: [1.04, 0.98, 1], muzzle: 'dog', ears: 'floppy', tail: 'curl', marks: ['eyePatch'],
    face: { ex: 0.42, ey: 0.14, es: 1.12, mouth: 'smile', blush: 0.5 }, outfits: ['overalls', 'vest', 'tee'], props: [PROP.bandana, PROP.bowtie, PROP.scarf],
  },
}
for (const [id, S] of Object.entries(SPECIES)) {
  S.id = id
  S.outfits = S.outfits || ALL_OUT
}
export const MISSION = ['bull', 'lynx', 'rabbit', 'dragon', 'wildcat']
export const SPECIES_IDS = Object.keys(SPECIES)

/** small deterministic RNG (mulberry32) */
export function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * one NPC's look: fur colours (species palette), outfit + garment colours,
 * props (at most one hat and one neck piece), a small size jitter
 */
export function variant(id, rand) {
  const S = SPECIES[id]
  const pick = (a) => a[Math.floor(rand() * a.length) % a.length]
  const fur = pick(S.colors)
  const outfit = pick(S.outfits)
  const garment = pick(GARMENTS)
  let mask = 0
  const hats = S.props.filter((p) => HATS.includes(p) || p === PROP.crown)
  const necks = S.props.filter((p) => NECK.includes(p))
  if (hats.length && rand() < 0.55) mask |= 1 << (pick(hats) - 1)
  if (necks.length && rand() < 0.6) mask |= 1 << (pick(necks) - 1)
  if (S.props.includes(PROP.rose) && rand() < 0.7) mask |= 1 << (PROP.rose - 1)
  return { id, fur, outfit, outfitCode: OUTFITS[outfit], top: garment[0], bottom: garment[1], mask, jitter: 0.97 + rand() * 0.06 }
}
