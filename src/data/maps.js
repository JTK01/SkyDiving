/**
 * Map catalogue — the single source of truth for the map select panel.
 *
 * Adding a map = adding an entry here (no component changes needed):
 *  id         : URL-safe id, also the route  →  /maps/<id>
 *  name       : display name (Korean), nameEn / location: secondary lines
 *  status     : 'ready'        — playable (has a world)
 *               'coming-soon'  — placeholder card ("준비 중"), cannot be entered
 *  thumbnail  : image under /public (null → generated placeholder tile)
 *  preview    : long-range preview of `world` (same assets, mid/far detail)
 *               capture : image of the first preview frame, shown while loading
 *               orbit   : camera orbit around the landmark — radius (m),
 *                         altitude above ground (m), lookAt height above ground
 *                         (m), period (s per revolution), startDeg (bearing
 *                         of the camera from the landmark, 0 = south, 90 = east), fov
 *  world      : the playable 3D map (null = not built yet)
 *               tiles    : tile set under VITE_TILES_BASE_URL (public/tiles/<tiles>)
 *               landmark : position (local metres) and heading of the landmark model
 *               drop     : skydive — start height above ground, horizontal limit,
 *                          end height above ground, terminal & steering speed (m, m/s)
 *  unlock     : lock data for the future point-based unlock flow.
 *               cost = points needed (null = not decided yet). The per-user
 *               lock state lives in src/state/useMapAccess.js.
 */
export const MAPS = [
  {
    id: 'sagrada-familia',
    name: '사그라다 파밀리아',
    nameEn: 'Sagrada Família',
    location: 'Barcelona, Spain',
    status: 'ready',
    thumbnail: '/maps/sagrada-familia/thumb.jpg',
    preview: {
      capture: '/maps/sagrada-familia/preview.jpg',
      // from the south-west looking north-east: Collserola on the left, the coast on the right
      orbit: { radius: 2100, altitude: 1250, lookAt: 300, period: 150, startDeg: 315, fov: 50 },
    },
    world: {
      tiles: 'sagrada-familia',
      // origin = basilica footprint centroid; the Eixample grid runs 44.25° from east
      landmark: { x: 0, z: 0, rotationDeg: 44.25 },
      // the drop ends when the jumper touches the ground, a building or the basilica (play/collision.js)
      drop: { altitude: 1200, radius: 350, terminalSpeed: 55, steerSpeed: 22 },
    },
    unlock: { cost: null },
  },
  ...[2, 3, 4, 5, 6].map((n) => ({
    id: `coming-soon-${n}`,
    name: '준비 중',
    nameEn: 'Coming soon',
    location: 'New drop zone',
    status: 'coming-soon',
    thumbnail: null,
    preview: null,
    world: null,
    unlock: { cost: null },
  })),
]

export const getMap = (id) => MAPS.find((m) => m.id === id) ?? null
export const isPlayable = (map) => map?.status === 'ready'
