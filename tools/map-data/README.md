# Map data pipeline

Builds the streamed tiles in `public/tiles/<map>/` from open data. Run once
per map (outputs are committed; nothing here runs in the app).

```bash
pip install pyarrow rasterio pyproj shapely numpy pillow scipy
npm install            # in tools/map-data: KTX2 encoder, gltfpack (meshopt)
RAW=/tmp/raw && mkdir -p $RAW
export OVERTURE_RELEASE=2026-10-21.0 CENTER=41.4036,2.1744
python fetch_overture.py buildings building 2700 $RAW/buildings.parquet
python fetch_overture.py transportation segment 1300 $RAW/segments.parquet
python fetch_overture.py base land_use 1300 $RAW/landuse.parquet
python fetch_overture.py base water 1300 $RAW/water.parquet
python build_tiles.py $RAW ../../public/tiles/sagrada-familia   # + ICGC WMS, cached in $RAW/icgc
python build_textures.py ../../public/textures                  # building atlas, detail normal (KTX2)
node build_basilica.mjs                                          # basilica.glb (meshopt) + colliders.json
```

Behind a proxy: `AWS_CA_BUNDLE`, `CURL_CA_BUNDLE`, `GDAL_HTTP_PROXY`.

## Layout

| Path | Content | Loaded |
|---|---|---|
| `manifest.json` | local frame, tile index, attribution | always |
| `height/<L>/<i>_<j>.png` | 65×65 heights, terrarium RGB (`h = R·256 + G + B/256 − 32768`) | by camera distance |
| `imagery/hybrid/<L>/<i>_<j>.ktx2` | KTX2/ETC1S colour: L0–L4 Sentinel-2 256 px, L5–L8 ICGC 25 cm orthophoto 512 px (4 → 0.5 m/px); set selectable with `VITE_MAP_IMAGERY` | with the height tile |
| `buildings/mid/<i>_<j>.bin` | oriented boxes, 600 m–2.7 km | preview + play |
| `buildings/near.bin` | footprints ≤ 600 m | play, or a close camera |
| `features/near.bin` | roads, parks/plazas/ponds, trees ≤ 1.3 km | play, or a close camera |

Terrain quadtree: L0 = 65.5 km tile … L8 = 256 m tile, deeper levels only near
the centre (L3 ≤ 16 km, L4 ≤ 8 km, L5 ≤ 3 km, L6 ≤ 2.1 km, L7 ≤ 1.15 km, L8 ≤ 620 m).

Binary formats (little-endian, lengths in 0.1 m):
- `SDB1` u32 n; per building: u16 verts, u8 roof, u8 facade, i16 baseY, u16 height, verts × (i16 x, i16 z)
- `SDM1` u32 n; per box: i16 cx, i16 cz, u16 w, u16 d, u16 angle (0..65535 = 0..π), u16 h, i16 baseY, u8 roof, u8 facade
- `SDF1` u32 roads, u32 areas, u32 trees; road: u8 class, u8 _, u16 n, n × (i16 x, z, y); area: u8 type, u8 _, u16 n, n × (i16 x, z, y); tree: i16 x, z, y, u8 size, u8 _

## Imagery sets

Write another tile grid to `imagery/<name>/…`, add `<name>` to
`manifest.terrain.imagery`, and select it with `VITE_MAP_IMAGERY=<name>`.
The ICGC layer (`ICGC_LAYER`) and the level where it takes over (`ICGC_FROM`)
are constants in `build_tiles.py`.

## Other assets

- `public/textures/buildings.ktx2` — façade/roof/ground-floor atlas (procedural)
- `public/textures/detail_normal.ktx2` — tileable micro-relief normal map
- `public/models/sagrada-familia/basilica.glb` (EXT_meshopt_compression) + `colliders.json`
- `public/vendor/basis/` — Basis transcoder (from three.js) for KTX2
