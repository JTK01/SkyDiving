# Map data pipeline

Builds the streamed tiles in `public/tiles/<map>/` from open data. Run once
per map (outputs are committed; nothing here runs in the app).

```bash
pip install pyarrow rasterio pyproj shapely numpy pillow scipy
RAW=/tmp/raw && mkdir -p $RAW
export OVERTURE_RELEASE=2026-10-21.0 CENTER=41.4036,2.1744
python fetch_overture.py buildings building 2700 $RAW/buildings.parquet
python fetch_overture.py transportation segment 1300 $RAW/segments.parquet
python fetch_overture.py base land_use 1300 $RAW/landuse.parquet
python fetch_overture.py base water 1300 $RAW/water.parquet
python build_tiles.py $RAW ../../public/tiles/sagrada-familia
```

Behind a proxy: `AWS_CA_BUNDLE`, `CURL_CA_BUNDLE`, `GDAL_HTTP_PROXY`.

## Layout

| Path | Content | Loaded |
|---|---|---|
| `manifest.json` | local frame, tile index, attribution | always |
| `height/<L>/<i>_<j>.png` | 65×65 heights, terrarium RGB (`h = R·256 + G + B/256 − 32768`) | by camera distance |
| `imagery/<source>/<L>/<i>_<j>.jpg` | 256 px colour; `<source>` is selectable (`VITE_MAP_IMAGERY`) | with the height tile |
| `buildings/mid/<i>_<j>.bin` | oriented boxes, 600 m–2.7 km | preview + play |
| `buildings/near.bin` | footprints ≤ 600 m | play, or a close camera |
| `features/near.bin` | roads, parks/plazas/ponds, trees ≤ 1.3 km | play, or a close camera |

Terrain quadtree: L0 = 65.5 km tile … L5 = 2 km tile (256 m … 8 m per pixel),
deeper levels only near the centre (L3 ≤ 16 km, L4 ≤ 8 km, L5 ≤ 3 km).

Binary formats (little-endian, lengths in 0.1 m):
- `SDB1` u32 n; per building: u16 verts, u8 roof, u8 facade, i16 baseY, u16 height, verts × (i16 x, i16 z)
- `SDM1` u32 n; per box: i16 cx, i16 cz, u16 w, u16 d, u16 angle (0..65535 = 0..π), u16 h, i16 baseY, u8 roof, u8 facade
- `SDF1` u32 roads, u32 areas, u32 trees; road: u8 class, u8 _, u16 n, n × (i16 x, z, y); area: u8 type, u8 _, u16 n, n × (i16 x, z, y); tree: i16 x, z, y, u8 size, u8 _

## Adding another imagery source (e.g. ICGC 25 cm orthophoto, CC BY 4.0)

Write the same tile grid to `imagery/<name>/…`, add `<name>` to
`manifest.terrain.imagery`, and select it with `VITE_MAP_IMAGERY=<name>`.
