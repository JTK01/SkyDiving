/**
 * Mission zones: five spots around the basilica, inside the 350 m drop radius,
 * each placed where the Sagrada Família stands clear in the background — a
 * different face of the basilica from each one. Basilica frame (metres):
 * a toward the Nativity façade, b toward the Glory façade (the Eixample grid is
 * aligned with it: blocks every 133.3 m); collision extents of the basilica:
 * a ±48, b ±61, towers to ~100 m, the central tower to ~170 m.
 *
 *   nativity  Plaça de Gaudí — the Nativity façade across the pond
 *   passion   Plaça de la Sagrada Família — the Passion façade
 *   glory     Marina / Mallorca crossing — the Glory façade, at an angle
 *   avgaudi   Avinguda de Gaudí — the central towers rising over the avenue
 *   apse      Sardenya / Provença crossing — the apse and the central towers
 * (faces measured from each spot, see placeZones → zone.faces: each zone's
 * own face is the one it sees most; the Nativity face is only seen from the
 * Plaça de Gaudí)
 *
 * placeZones() searches each zone's area for open ground (no wall within a few
 * metres) from which rays to the façade's points (several heights, both sides,
 * the bell towers and the central tower) pass no building and no tree crown,
 * and keeps the best spot; the ray results are kept on the zone (view).
 * Each zone holds one mission animal among its 12–15 animals.
 */
export const ZONE_RADIUS = 45 // m: inside = NPCs present
export const ZONE_LEAVE = 58 // m: NPCs removed beyond this

const tower = (a, b) => [a, 95, b]
const CENTRAL = [0, 150, 1]
const facePts = (a, b, axis) => [10, 30, 50].flatMap((h) => [-9, 9].map((o) => (axis === 'a' ? [a, h, o] : [o, h, b])))
export const ZONES = [
  {
    id: 'nativity', face: '탄생', at: [145, 22], photo: [145, 22], name: '가우디 광장', view: '연못 너머 탄생 파사드', mission: 'dragon', pref: [178, 0],
    area: (k) => [105 + (k % 24) * 4, -50 + Math.floor(k / 24) * 4], count: 24 * 26,
    targets: [...facePts(47, 0, 'a'), tower(42, -6), tower(42, 6), CENTRAL],
  },
  {
    id: 'glory', face: '영광', at: [70, 72], photo: [90, 72], name: '마리나·마요르카 교차로', view: '영광 파사드 (비스듬히)', mission: 'lynx', pref: [70, 90],
    area: (k) => [-130 + (k % 66) * 4, 64 + Math.floor(k / 66) * 4], count: 66 * 66,
    targets: [...facePts(0, 60, 'b'), tower(-6, 47), tower(6, 47), CENTRAL],
  },
  {
    id: 'avgaudi', face: '중앙탑', at: [228.4, -214.3], photo: [228.4, -214.3], name: '가우디 대로', view: '대로 끝에서 건물 위로 솟은 중앙 탑들', mission: 'wildcat', pref: [150, -150],
    // along the avenue: from the Marina / Provença corner toward the north-east
    area: (k) => {
      const t = 125 + (k % 52) * 4
      const u = -14 + Math.floor(k / 52) * 4
      return [t * Math.SQRT1_2 + u * Math.SQRT1_2, -t * Math.SQRT1_2 + u * Math.SQRT1_2]
    },
    count: 52 * 8,
    targets: [tower(42, -6), tower(42, 6), [47, 40, -9], [40, 60, -30], [0, 120, -20], CENTRAL, [-6, 95, -30]],
  },
  {
    id: 'apse', face: '후진', at: [-70, -72], photo: [-62, -76], name: '사르데냐·프로벤사 교차로', view: '후진과 중앙 탑', mission: 'rabbit', pref: [-70, -90],
    area: (k) => [-130 + (k % 66) * 4, -64 - Math.floor(k / 66) * 4], count: 66 * 66,
    targets: [[-9, 15, -55], [9, 15, -55], [0, 35, -50], [-6, 60, -34], [6, 60, -34], [0, 120, -10], CENTRAL],
  },
  {
    id: 'passion', face: '수난', at: [-135, 0], photo: [-123, 20], name: '사그라다 파밀리아 광장', view: '수난 파사드', mission: 'bull', pref: [-150, 0],
    area: (k) => [-82 - (k % 31) * 4, -100 + Math.floor(k / 31) * 4], count: 31 * 51, near: 82,
    targets: [...facePts(-47, 0, 'a'), tower(-42, -6), tower(-42, 6), CENTRAL],
  }
]

/** the four faces of the basilica as target sets (for the per-zone report) */
export const FACES = {
  탄생: [...facePts(47, 0, 'a'), tower(42, -6), tower(42, 6)],
  수난: [...facePts(-47, 0, 'a'), tower(-42, -6), tower(-42, 6)],
  영광: [...facePts(0, 60, 'b'), tower(-6, 47), tower(6, 47)],
  후진: [[-9, 15, -55], [9, 15, -55], [0, 35, -50], [-6, 60, -34], [6, 60, -34]],
  중앙탑: [CENTRAL, [0, 120, -10]],
}

/**
 * zone centres in world space — trees: features.trees (x, z, y, size), crowns
 * taken as 4.5 m balls 9 m up. By default each zone sits at its fixed spot
 * (`at`, found with search: true — tens of seconds of rays, done once while
 * designing the map; search: 'photo' searches only the photo spots); the rays
 * from that spot are still cast (cheap) and kept on the zone: visible (its own
 * targets) and faces (each face of the basilica).
 */
export function placeZones(world, landmark, trees = null, { search = false } = {}) {
  const rot = (landmark.rotationDeg * Math.PI) / 180
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  const toW = (a, b) => [landmark.x + c * a + s * b, landmark.z - s * a + c * b]
  const g0 = world.heightAt(landmark.x, landmark.z)
  const crowns = []
  if (trees) for (let k = 0; k < trees.length; k += 4) crowns.push([trees[k], trees[k + 2] + 9, trees[k + 1]])
  const open = (x, z) => {
    for (const [ox, oz] of [[0, 0], [5, 0], [-5, 0], [0, 5], [0, -5], [3.5, 3.5], [-3.5, -3.5], [3.5, -3.5], [-3.5, 3.5]]) if (world.blocked(x + ox, world.heightAt(x + ox, z + oz), z + oz, 0.5, 1.8)) return false
    return true
  }
  /** is the segment eye → target clear of buildings and tree crowns (the basilica itself near the target counts as reached) */
  const clear = (e, t) => {
    const d = [t[0] - e[0], t[1] - e[1], t[2] - e[2]]
    const L = Math.hypot(...d)
    const u = d.map((v) => v / L)
    for (let r = 2; r < L - 14; r += 1.5) {
      const x = e[0] + u[0] * r
      const y = e[1] + u[1] * r
      const z = e[2] + u[2] * r
      const k = world.contact(x, y, z)
      if (k && k.kind !== 'ground') return false
      if (k && k.kind === 'ground' && y < k.ground - 0.5) return false
    }
    for (const q of crowns) {
      // distance from the crown centre to the segment
      const w = [q[0] - e[0], q[1] - e[1], q[2] - e[2]]
      const along = Math.max(0, Math.min(L, w[0] * u[0] + w[1] * u[1] + w[2] * u[2]))
      const dd = Math.hypot(w[0] - u[0] * along, w[1] - u[1] * along, w[2] - u[2] * along)
      if (dd < 4.5) return false
    }
    return true
  }
  /** fraction of each face's points visible from the eye */
  const faceVis = (eye) =>
    Object.fromEntries(
      Object.entries(FACES).map(([f, pts]) => [
        f,
        pts.filter(([a, h, b]) => {
          const [x, z] = toW(a, b)
          return clear(eye, [x, g0 + h, z])
        }).length / pts.length,
      ]),
    )
  const placed = []
  return ZONES.map((Z) => {
    const T = Z.targets.map(([a, h, b]) => {
      const [x, z] = toW(a, b)
      return [x, g0 + h, z]
    })
    let best = null
    const full = search === true
    const n = full ? Z.count : 1
    for (let k = 0; k < n; k++) {
      const [a, b] = full ? Z.area(k) : Z.at
      if (full && (Math.hypot(a, b) > 330 || Math.hypot(a, b) < (Z.near ?? 95))) continue
      const [x, z] = toW(a, b)
      if (full && placed.some((p) => Math.hypot(p.x - x, p.z - z) < ZONE_RADIUS * 2)) continue
      if (full && !open(x, z)) continue
      const y = world.heightAt(x, z)
      const eye = [x, y + 1.6, z]
      let vis = 0
      for (const t of T) if (clear(eye, t)) vis++
      // search: the zone's own face as clear as possible, the other faces as little as
      // possible (each zone shows a different side); among equals the preferred spot
      let score = vis - Math.hypot(a - Z.pref[0], b - Z.pref[1]) / 1000
      if (full) {
        const f = faceVis(eye)
        score = f[Z.face] + 0.5 * f.중앙탑 - 0.7 * Object.entries(f).reduce((m, [k, v]) => (k === Z.face || k === '중앙탑' ? m : Math.max(m, v)), 0) - Math.hypot(a - Z.pref[0], b - Z.pref[1]) / 1000
      }
      if (!best || score > best.score) best = { x, z, y, vis, score, a, b }
    }
    const eye = [best.x, best.y + 1.6, best.z]
    const faces = Object.fromEntries(
      Object.entries(FACES).map(([f, pts]) => {
        const vis = pts.filter(([a, h, b]) => {
          const [x, z] = toW(a, b)
          return clear(eye, [x, g0 + h, z])
        }).length
        return [f, `${vis}/${pts.length}`]
      }),
    )
    // photo spot (함께 사진 찍기): inside the zone, the clearest view of the zone's face and the
    // central towers from camera height; searched with the zone (search: true), else Z.photo
    let photo = Z.photo ? toW(...Z.photo) : [best.x, best.z]
    let photoFrame = Z.photo || [best.a, best.b]
    if (search) {
      let pb = null
      for (let i = -9; i <= 9; i++)
        for (let j = -9; j <= 9; j++) {
          const a = best.a + i * 4
          const b = best.b + j * 4
          if (Math.hypot(i * 4, j * 4) > ZONE_RADIUS - 6) continue
          const [x, z] = toW(a, b)
          if (!open(x, z)) continue
          const f = faceVis([x, world.heightAt(x, z) + 1.2, z])
          const sc = f[Z.face] + f.중앙탑 - Math.hypot(i, j) * 0.002 // max 2
          if (!pb || sc > pb.sc) pb = { sc, x, z, a, b }
        }
      if (pb) {
        photo = [pb.x, pb.z]
        photoFrame = [+pb.a.toFixed(1), +pb.b.toFixed(1), +pb.sc.toFixed(2)]
      }
    }
    const zone = { ...Z, photo, photoFrame, x: best.x, z: best.z, y: best.y, frame: [+best.a.toFixed(1), +best.b.toFixed(1)], visible: `${best.vis}/${T.length}`, faces, look: Math.atan2(landmark.x - best.x, landmark.z - best.z) }
    delete zone.area
    delete zone.targets
    placed.push(zone)
    return zone
  })
}
