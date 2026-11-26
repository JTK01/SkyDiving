/**
 * Mission zones: five open spots around the basilica, inside the 350 m drop
 * radius and well apart. Basilica frame (metres): x toward the Nativity
 * façade, z toward the Glory façade; the Eixample grid is aligned with it
 * (blocks every 133.3 m, chamfered crossings in between).
 *   west   Plaça de la Sagrada Família (the block west of the basilica)
 *   east   Plaça de Gaudí (the block east, with the pond)
 *   north  crossing behind the apse side
 *   south  crossing beyond the Glory side
 *   corner crossing to the south-west
 * Each zone holds one mission animal and two general animals.
 */
export const ZONE_RADIUS = 45 // m: inside = NPCs present
export const ZONE_LEAVE = 58 // m: NPCs removed beyond this

export const ZONES = [
  { id: 'west', name: '사그라다 파밀리아 광장', at: [-133, 0], mission: 'bull', ambient: ['donkey', 'pigeon'] },
  { id: 'east', name: '가우디 광장', at: [133, 0], mission: 'dragon', ambient: ['parakeet', 'dog'] },
  { id: 'north', name: '북쪽 교차로', at: [66.7, -200], mission: 'rabbit', ambient: ['hedgehog', 'pigeon'] },
  { id: 'south', name: '남쪽 교차로', at: [-66.7, 200], mission: 'lynx', ambient: ['gull', 'dog'] },
  { id: 'corner', name: '남서쪽 교차로', at: [-200, 200], mission: 'wildcat', ambient: ['donkey', 'parakeet'] },
]

/**
 * zone centres in world space, each moved to the nearest open ground
 * (not inside a building) within 40 m
 */
export function placeZones(world, landmark) {
  const rot = (landmark.rotationDeg * Math.PI) / 180
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  return ZONES.map((z) => {
    const wx = landmark.x + c * z.at[0] + s * z.at[1]
    const wz = landmark.z - s * z.at[0] + c * z.at[1]
    let best = [wx, wz]
    for (let k = 0; k < 400; k++) {
      const a = k * 2.39996
      const d = k ? 2 * Math.sqrt(k) : 0
      const x = wx + Math.cos(a) * d
      const zz = wz + Math.sin(a) * d
      // open: no building within a few metres around
      let free = true
      for (const [ox, oz] of [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4]]) if (world.blocked(x + ox, world.heightAt(x + ox, zz + oz), zz + oz, 0.5, 1.5)) free = false
      if (free) {
        best = [x, zz]
        break
      }
    }
    return { ...z, x: best[0], z: best[1], y: world.heightAt(best[0], best[1]) }
  })
}
