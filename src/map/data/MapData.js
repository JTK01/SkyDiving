import { TILES_BASE, IMAGERY_SOURCE } from '../env'

/**
 * Streams and decodes one map's tile set (see tools/map-data/README.md).
 *
 * Everything is fetched on demand and cached *decoded* (height arrays,
 * ImageBitmaps, parsed buildings) so the preview and the playable map share
 * it: entering a map after previewing it needs no new downloads. release()
 * drops the cache (ImageBitmaps closed) when the map is no longer shown.
 */
const registry = new Map() // mapId → MapData

export function getMapData(tileSet) {
  if (!registry.has(tileSet)) registry.set(tileSet, new MapData(tileSet))
  return registry.get(tileSet)
}
export function releaseMapData(tileSet) {
  registry.get(tileSet)?.release()
  registry.delete(tileSet)
}

const key = (L, i, j) => `${L}/${i}_${j}`

async function decodeHeights(blob, n) {
  const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(n, n) : Object.assign(document.createElement('canvas'), { width: n, height: n })
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(bmp, 0, 0)
  bmp.close()
  const px = ctx.getImageData(0, 0, n, n).data
  const h = new Float32Array(n * n)
  for (let k = 0; k < n * n; k++) h[k] = px[k * 4] * 256 + px[k * 4 + 1] + px[k * 4 + 2] / 256 - 32768
  return h
}

export class MapData {
  constructor(tileSet) {
    this.tileSet = tileSet
    this.base = `${TILES_BASE}/${tileSet}`
    this.cache = new Map() // url-ish key → Promise<decoded>
    this.bytes = 0 // downloaded bytes (for diagnostics)
    this.released = false
    this.abort = new AbortController()
  }

  async fetch(path) {
    const res = await fetch(`${this.base}/${path}`, { signal: this.abort.signal })
    if (!res.ok) throw new Error(`${path}: ${res.status}`)
    const buf = await res.arrayBuffer()
    this.bytes += buf.byteLength
    return buf
  }

  memo(k, fn) {
    if (!this.cache.has(k)) {
      const p = fn()
      p.catch(() => this.cache.delete(k))
      this.cache.set(k, p)
    }
    return this.cache.get(k)
  }

  manifest() {
    return this.memo('manifest', async () => {
      const m = JSON.parse(new TextDecoder().decode(await this.fetch('manifest.json')))
      // tile existence lookup
      m.terrain.has = new Set(m.terrain.levels.flatMap((l) => l.tiles.map(([i, j]) => key(l.level, i, j))))
      m.terrain.imagerySource = m.terrain.imagery[IMAGERY_SOURCE] ? IMAGERY_SOURCE : Object.keys(m.terrain.imagery)[0]
      return m
    })
  }

  /** { heights: Float32Array(n²), ktx2: ArrayBuffer } (or image: ImageBitmap for jpg/png sets) */
  terrainTile(L, i, j) {
    return this.memo(`t${key(L, i, j)}`, async () => {
      const m = await this.manifest()
      const img = m.terrain.imagery[m.terrain.imagerySource]
      const [hb, ib] = await Promise.all([this.fetch(`height/${key(L, i, j)}.png`), this.fetch(`${img.path}/${key(L, i, j)}.${img.ext}`)])
      const heights = await decodeHeights(new Blob([hb], { type: 'image/png' }), m.terrain.heightSize)
      // KTX2 stays compressed until the renderer transcodes it (Terrain)
      if (img.ext === 'ktx2') return { heights, ktx2: ib }
      const image = await createImageBitmap(new Blob([ib], { type: `image/${img.ext === 'jpg' ? 'jpeg' : img.ext}` }), { imageOrientation: 'none' })
      if (this.released) image.close()
      return { heights, image }
    })
  }

  /** mid-zone boxes of one tile: Float32Array stride 9 (cx, cz, w, d, angle, h, baseY, roof, facade) */
  midTile(file) {
    return this.memo(file, async () => {
      const v = new DataView(await this.fetch(file))
      const n = v.getUint32(4, true)
      const out = new Float32Array(n * 9)
      for (let k = 0, o = 8; k < n; k++, o += 16) {
        out.set([v.getInt16(o, true) / 10, v.getInt16(o + 2, true) / 10, v.getUint16(o + 4, true) / 10, v.getUint16(o + 6, true) / 10,
          (v.getUint16(o + 8, true) / 65535) * Math.PI, v.getUint16(o + 10, true) / 10, v.getInt16(o + 12, true) / 10, v.getUint8(o + 14), v.getUint8(o + 15)], k * 9)
      }
      return out
    })
  }

  /** near-zone footprints: [{ ring: Float32Array (x,z…), baseY, height, roof, facade }] */
  nearBuildings() {
    return this.memo('near', async () => {
      const m = await this.manifest()
      const v = new DataView(await this.fetch(m.buildings.near.file))
      const n = v.getUint32(4, true)
      const out = []
      let o = 8
      for (let k = 0; k < n; k++) {
        const nv = v.getUint16(o, true)
        const b = { roof: v.getUint8(o + 2), facade: v.getUint8(o + 3), baseY: v.getInt16(o + 4, true) / 10, height: v.getUint16(o + 6, true) / 10 }
        o += 8
        b.ring = new Float32Array(nv * 2)
        for (let q = 0; q < nv * 2; q++, o += 2) b.ring[q] = v.getInt16(o, true) / 10
        out.push(b)
      }
      return out
    })
  }

  /** near features: { roads: [{cls, pts(x,z,y…)}], areas: [{type, pts}], trees: Float32Array stride 4 (x,z,y,size) } */
  features() {
    return this.memo('features', async () => {
      const m = await this.manifest()
      const v = new DataView(await this.fetch(m.features.file))
      const [nr, na, nt] = [v.getUint32(4, true), v.getUint32(8, true), v.getUint32(12, true)]
      let o = 16
      const poly = () => {
        const t = v.getUint8(o)
        const n = v.getUint16(o + 2, true)
        o += 4
        const pts = new Float32Array(n * 3)
        for (let q = 0; q < n * 3; q++, o += 2) pts[q] = v.getInt16(o, true) / 10
        return { t, pts }
      }
      const roads = Array.from({ length: nr }, () => {
        const { t, pts } = poly()
        return { cls: m.features.roadClasses[t], width: m.features.roadWidths[t], pts }
      })
      const areas = Array.from({ length: na }, () => {
        const { t, pts } = poly()
        return { type: m.features.areaTypes[t], pts }
      })
      const trees = new Float32Array(nt * 4)
      for (let k = 0; k < nt; k++, o += 8) trees.set([v.getInt16(o, true) / 10, v.getInt16(o + 2, true) / 10, v.getInt16(o + 4, true) / 10, v.getUint8(o + 6) / 10], k * 4)
      return { roads, areas, trees }
    })
  }

  release() {
    this.released = true
    this.abort.abort()
    for (const p of this.cache.values()) p.then((d) => d?.image?.close?.()).catch(() => {})
    this.cache.clear()
  }
}

export const tileKey = key
