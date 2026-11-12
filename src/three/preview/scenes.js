import { lazy } from 'react'

/**
 * Preview scene registry: maps.js `preview.scene` key → lazily loaded scene
 * (its own chunk, fetched only when the map is previewed). Each scene sets
 * up its own camera orbit (OrbitRig), lights and fog.
 */
export const PREVIEW_SCENES = {
  'sagrada-familia': lazy(() => import('./sagrada/SagradaScene')),
}
