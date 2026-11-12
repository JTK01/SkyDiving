/**
 * Map data location & imagery source, overridable per deployment:
 *   VITE_TILES_BASE_URL  base URL of the tile sets (default: /tiles, i.e. public/tiles)
 *   VITE_MAP_IMAGERY     imagery set inside each tile set (default: sentinel2;
 *                        e.g. an ICGC orthophoto set later — see tools/map-data)
 */
export const TILES_BASE = (import.meta.env.VITE_TILES_BASE_URL || '/tiles').replace(/\/$/, '')
export const IMAGERY_SOURCE = import.meta.env.VITE_MAP_IMAGERY || 'sentinel2'
