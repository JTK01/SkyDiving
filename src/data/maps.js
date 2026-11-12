/**
 * Map catalogue — the single source of truth for the map select panel.
 *
 * Adding a map = adding an entry here (no component changes needed):
 *  id         : URL-safe id, also the route  →  /maps/<id>
 *  name       : display name (Korean), nameEn / location: secondary lines
 *  status     : 'ready'        — playable, has a preview scene
 *               'coming-soon'  — placeholder card ("준비 중"), cannot be entered
 *  thumbnail  : image under /public (null → generated placeholder tile)
 *  preview    : { scene } key of the long-range preview scene
 *               (see src/three/preview/scenes.js), null when not available
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
    preview: { scene: 'sagrada-familia' },
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
    unlock: { cost: null },
  })),
]

export const getMap = (id) => MAPS.find((m) => m.id === id) ?? null
export const isPlayable = (map) => map?.status === 'ready'
