"""
Build the streamed map tiles for one map (default: Sagrada Família).

Inputs (all public, no keys):
  * Overture Maps GeoParquet extracts (see fetch_overture.py):
      buildings.parquet, segments.parquet, landuse.parquet, water.parquet
  * Copernicus DEM GLO-30 (COG, s3://copernicus-dem-30m)
  * Sentinel-2 L2A true-colour (TCI, COG, s3://sentinel-cogs) — far range
  * ICGC Ortofoto de Catalunya 25 cm (WMS, geoserveis.icgc.cat) — near/mid range

Output (public/tiles/<map>/):
  manifest.json                 tile index, local frame, attribution
  height/<L>/<i>_<j>.png        65×65 terrain heights, terrarium-encoded RGB
  imagery/hybrid/<L>/<i>_<j>.ktx2  colour, Basis/KTX2 (ETC1S):
                                L0–L4 Sentinel-2 (256 px), L5–L8 ICGC orthophoto (512 px)
  buildings/near.bin            full footprints (radius NEAR_R)
  buildings/mid/<i>_<j>.bin     oriented boxes (NEAR_R … MID_R)
  features/near.bin             roads, parks / plazas / ponds, trees

Local frame: metres, x = east, z = south, y = elevation (m a.s.l.),
origin = centroid of the basilica footprint, UTM 31N (EPSG:32631).

usage: python build_tiles.py <raw_dir> <out_dir>
env:   CURL_CA_BUNDLE / GDAL_HTTP_PROXY as needed behind a proxy
"""
import json, math, os, struct, sys, hashlib, warnings, subprocess, urllib.request, io, tempfile
import numpy as np
import pyarrow.parquet as pq
import rasterio
from rasterio.warp import reproject, Resampling
from rasterio.transform import from_origin
import shapely
from shapely.ops import transform as shp_transform
from pyproj import Transformer
from scipy import ndimage
from PIL import Image

RAW, OUT = sys.argv[1], sys.argv[2]
MAP = 'sagrada-familia'
UTM = 'EPSG:32631'
HALF = 32768  # terrain extent ±HALF m (L0 tile = 65.5 km)
# include tile if its nearest point is closer to the centre than this (m)
LEVEL_RADIUS = {0: 1e9, 1: 1e9, 2: 1e9, 3: 16000, 4: 8000, 5: 3000, 6: 2100, 7: 1150, 8: 620}
MAX_LEVEL = 8
ICGC_FROM = 5  # levels ≥ this use the ICGC orthophoto
ICGC_WMS = 'https://geoserveis.icgc.cat/servei/catalunya/orto-territorial/wms'
ICGC_LAYER = 'ortofoto_25cm_color_2025'
ICGC_N = 512
HEIGHT_N = 65
IMG_N = 256
NEAR_R = 600  # full footprints
MID_R = 2700  # boxes
FEAT_R = 1300  # roads / parks / trees
MID_TILE = 1350

DEM_URLS = [
    'https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N41_00_E002_00_DEM/Copernicus_DSM_COG_10_N41_00_E002_00_DEM.tif',
    'https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N41_00_E001_00_DEM/Copernicus_DSM_COG_10_N41_00_E001_00_DEM.tif',
]
S2_DATE = '2025-08-11'
S2_URLS = [  # priority order (same pass → matching colours)
    'https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/31/T/DF/2025/8/S2A_31TDF_20250811_1_L2A/TCI.tif',
    'https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/31/T/DG/2025/8/S2A_31TDG_20250811_0_L2A/TCI.tif',
]

to_utm = Transformer.from_crs(4326, 32631, always_xy=True)
warnings.filterwarnings('ignore', category=DeprecationWarning)


def log(*a):
    print(*a, file=sys.stderr, flush=True)


# --------------------------------------------------------------------------
# local frame: centre on the basilica footprint
b_tab = pq.read_table(os.path.join(RAW, 'buildings.parquet'))
b_geom = shapely.from_wkb(b_tab.column('geometry').to_pylist())
b_names = b_tab.column('names').to_pylist()
b_class = b_tab.column('class').to_pylist()
church_i = next(i for i, n in enumerate(b_names) if n and n.get('primary') and 'Sagrada Fam' in n['primary'] and b_class[i] == 'church')
church_ll = b_geom[church_i]
cent = church_ll.centroid
E0, N0 = to_utm.transform(cent.x, cent.y)
log(f'origin: {cent.y:.6f}, {cent.x:.6f}  UTM {E0:.1f} {N0:.1f}')


def to_local(geom):
    def f(x, y, z=None):
        e, n = to_utm.transform(x, y)
        return np.asarray(e) - E0, -(np.asarray(n) - N0)
    return shp_transform(f, geom)


church = to_local(church_ll)

# --------------------------------------------------------------------------
# rasters on a local grid (row ↔ z, col ↔ x)
def local_grid(res, half):
    n = int(2 * half / res)
    return n, from_origin(E0 - half, N0 + half, res, res)


def warp(urls, res, half, band_count, dtype, resampling, nodata):
    n, tr = local_grid(res, half)
    out = np.zeros((band_count, n, n), dtype=np.float32)
    filled = np.zeros((n, n), bool)
    for u in urls:
        with rasterio.open('/vsicurl/' + u) as src:
            tmp = np.full((band_count, n, n), nodata, np.float32)
            reproject(rasterio.band(src, list(range(1, band_count + 1))), tmp, src_transform=src.transform, src_crs=src.crs,
                      dst_transform=tr, dst_crs=UTM, resampling=resampling, src_nodata=nodata, dst_nodata=nodata)
            valid = (tmp != nodata).all(0) & ~filled
            if band_count == 3:
                valid &= tmp.sum(0) > 30  # TCI no-data edges carry faint non-zero values
                # Sentinel-2 scene classification: drop no-data, defective,
                # dark-area, cloud-shadow and cloud pixels (water / land kept)
                scl = np.zeros((n, n), np.float32)
                with rasterio.open('/vsicurl/' + u.replace('TCI.tif', 'SCL.tif')) as sc:
                    reproject(rasterio.band(sc, 1), scl, src_transform=sc.transform, src_crs=sc.crs, dst_transform=tr, dst_crs=UTM,
                              resampling=Resampling.nearest, src_nodata=None, dst_nodata=0)
                valid &= np.isin(scl, [4, 5, 6, 7, 11])
            out[:, valid] = tmp[:, valid]
            filled |= valid
            log(f'  {u.split("/")[-1]}: +{valid.mean() * 100:.1f}% coverage')
    return out, filled


log('DEM 16 m …')
dem, dem_ok = warp(DEM_URLS, 16, HALF, 1, np.float32, Resampling.bilinear, -9999)
dem = dem[0]
dem[~dem_ok] = 0
dem = np.maximum(dem, 0)  # sea & voids → 0
# Copernicus is a surface model (includes buildings/trees). Approximate bare
# ground on the plain: morphological opening + blur, faded out on the slopes
opened = ndimage.gaussian_filter(ndimage.grey_opening(dem, size=7), 1.5)
w = np.clip((dem - 90) / 120, 0, 1)
ground = opened * (1 - w) + ndimage.gaussian_filter(dem, 0.8) * w
ground[dem <= 0.5] = 0


def sample(grid, res, half, x, z):
    c = (np.asarray(x) + half) / res - 0.5
    r = (np.asarray(z) + half) / res - 0.5
    return ndimage.map_coordinates(grid, [r, c], order=1, mode='nearest')


ORIGIN_Y = float(sample(ground, 16, HALF, [0.0], [0.0])[0])
log(f'ground at church: {ORIGIN_Y:.1f} m')


def fill_gaps(img, ok):
    """No-data areas (scene edges, 25+ km away, under haze): soft average of
    the surrounding valid colour (normalised Gaussian), no streaks."""
    if ok.all():
        return img
    w = ok.astype(np.float32)
    out = img.copy()
    for sigma in (24, 96):
        den = ndimage.gaussian_filter(w, sigma)
        for b in range(img.shape[0]):
            num = ndimage.gaussian_filter(out[b] * w, sigma)  # `out`: earlier passes already filled
            fillv = np.where(den > 1e-3, num / np.maximum(den, 1e-6), 0)
            out[b] = np.where(w > 0, out[b], fillv)
        w = np.maximum(w, (den > 1e-3).astype(np.float32))
    return out


def grade(img):
    """Sentinel TCI → natural daylight look (TCI is dark and hazy)."""
    x = img / 255.0
    x = np.clip((x - 0.015) * 1.6, 0, 1) ** 0.82
    lum = x.mean(0, keepdims=True)
    x = np.clip(lum + (x - lum) * 1.12, 0, 1)
    return (x * 255 + 0.5).astype(np.uint8)


log('Sentinel-2 16 m …')
img16, ok16 = warp(S2_URLS, 16, HALF, 3, np.uint8, Resampling.average, 0)
img16 = grade(fill_gaps(img16, ok16))
log('Sentinel-2 8 m (centre) …')
img8, ok8 = warp(S2_URLS, 8, 4096, 3, np.uint8, Resampling.bilinear, 0)
img8 = grade(fill_gaps(img8, ok8))

# --------------------------------------------------------------------------
# terrain tiles
def tile_bounds(L, i, j):
    s = 2 * HALF / 2 ** L
    return -HALF + i * s, -HALF + j * s, s


def terrarium(h):
    v = np.clip(h, -32768, 32767) + 32768.0
    r = np.floor(v / 256)
    g = np.floor(v - r * 256)
    b = np.floor((v - r * 256 - g) * 256)
    return np.stack([r, g, b], -1).astype(np.uint8)


def icgc(x0, z0, s, n=ICGC_N):
    """ICGC orthophoto for a local square (cached in RAW/icgc/)."""
    e0, n1 = E0 + x0, N0 - z0
    bbox = f'{e0:.2f},{n1 - s:.2f},{e0 + s:.2f},{n1:.2f}'
    cache = os.path.join(RAW, 'icgc', hashlib.md5(f'{ICGC_LAYER}{bbox}{n}'.encode()).hexdigest() + '.jpg')
    if not os.path.exists(cache):
        url = (f'{ICGC_WMS}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS={ICGC_LAYER}&STYLES=&CRS=EPSG:32631'
               f'&BBOX={bbox}&WIDTH={n}&HEIGHT={n}&FORMAT=image/jpeg')
        os.makedirs(os.path.dirname(cache), exist_ok=True)
        for attempt in range(4):
            try:
                data = urllib.request.urlopen(url, timeout=120).read()
                Image.open(io.BytesIO(data)).verify()
                open(cache, 'wb').write(data)
                break
            except Exception as e:  # noqa: BLE001
                log(f'  ICGC retry {attempt + 1}: {e}')
        else:
            raise RuntimeError('ICGC download failed: ' + bbox)
    return np.asarray(Image.open(cache).convert('RGB')).astype(np.float32)


# colour-match the orthophoto to the Sentinel-2 grade (per-channel mean/std
# over the 8 km centre) so the L4 → L5 hand-over shows no colour step
ref = icgc(-4096, -4096, 8192, 1024)
sen = np.moveaxis(img8, 0, -1).astype(np.float32)  # 8 m grid over the same 8 km
# contrast ratio clamped: the 10 m grade is soft, a full match blows out the 25 cm detail
icgc_gain = np.clip(sen.reshape(-1, 3).std(0) / np.maximum(ref.reshape(-1, 3).std(0), 1), 0.9, 1.1)
icgc_off = sen.reshape(-1, 3).mean(0) - ref.reshape(-1, 3).mean(0) * icgc_gain
icgc_off *= 0.5  # halfway: the L4→L5 hand-over is ≥4 km away, softened by haze
log(f'ICGC colour match: gain {np.round(icgc_gain, 2)}, offset {np.round(icgc_off, 1)}')

# basilica footprint (+ margin): the orthophoto shows the cranes and the
# scaffolding of the works in progress — paint the area as plaza paving
church_mask_poly = church.buffer(14)


def paint_church(img, x0, z0, s):
    n = img.shape[0]
    if not church_mask_poly.intersects(shapely.box(x0, z0, x0 + s, z0 + s)):
        return img
    from PIL import ImageDraw, ImageFilter
    m = Image.new('L', (n, n), 0)
    ring = [((x - x0) / s * n, (z - z0) / s * n) for x, z in church_mask_poly.exterior.coords]
    ImageDraw.Draw(m).polygon(ring, fill=255)
    m = np.asarray(m.filter(ImageFilter.GaussianBlur(n / s * 3))).astype(np.float32)[..., None] / 255
    plaza = np.array([196, 186, 168], np.float32)
    rng_ = np.random.default_rng(7)
    noise = rng_.normal(0, 5, img.shape[:2])[..., None]
    return img * (1 - m) + (plaza + noise) * m


levels = []
sizes = {'height': 0, 'imagery': 0}
png_jobs = []
tmpdir = tempfile.mkdtemp(prefix='sd_img_')
for L in range(MAX_LEVEL + 1):
    n = 2 ** L
    tiles = []
    for j in range(n):
        for i in range(n):
            x0, z0, s = tile_bounds(L, i, j)
            dx = max(x0 - 0, 0 - (x0 + s), 0)
            dz = max(z0 - 0, 0 - (z0 + s), 0)
            if math.hypot(dx, dz) > LEVEL_RADIUS[L]:
                continue
            tiles.append([i, j])
            k = np.linspace(0, s, HEIGHT_N)
            X, Z = np.meshgrid(x0 + k, z0 + k)
            h = sample(ground, 16, HALF, X, Z)
            p = os.path.join(OUT, 'height', str(L), f'{i}_{j}.png')
            os.makedirs(os.path.dirname(p), exist_ok=True)
            Image.fromarray(terrarium(h)).save(p, optimize=True)
            sizes['height'] += os.path.getsize(p)
            # imagery (PNG now, KTX2 after the loop)
            dst = os.path.join(OUT, 'imagery', 'hybrid', str(L), f'{i}_{j}.ktx2')
            tmp = os.path.join(tmpdir, f'{L}_{i}_{j}.png')
            png_jobs.append(f'{tmp}:{dst}')
            if L >= ICGC_FROM:
                im = np.clip(icgc(x0, z0, s) * icgc_gain + icgc_off, 0, 255)
                im = paint_church(im, x0, z0, s)
                Image.fromarray(im.astype(np.uint8)).save(tmp)
                continue
            if L <= 4:
                c0 = int((x0 + HALF) / 16)
                r0 = int((z0 + HALF) / 16)
                crop = img16[:, r0:r0 + int(s / 16), c0:c0 + int(s / 16)]
            else:
                c0 = int((x0 + 4096) / 8)
                r0 = int((z0 + 4096) / 8)
                crop = img8[:, r0:r0 + int(s / 8), c0:c0 + int(s / 8)]
            Image.fromarray(np.moveaxis(crop, 0, -1)).resize((IMG_N, IMG_N), Image.LANCZOS).save(tmp)
    levels.append({'level': L, 'size': 2 * HALF / n, 'tiles': tiles, 'imageSize': ICGC_N if L >= ICGC_FROM else IMG_N})
    log(f'L{L}: {len(tiles)} tiles')

log(f'KTX2 encoding {len(png_jobs)} tiles …')
subprocess.run(['node', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'encode_ktx2.mjs'), '--q=120'],
               input='\n'.join(png_jobs), text=True, check=True, stdout=subprocess.DEVNULL)
sizes['imagery'] = sum(os.path.getsize(j.split(':')[1]) for j in png_jobs)

# --------------------------------------------------------------------------
# buildings
heights = b_tab.column('height').to_pylist()
floors = b_tab.column('num_floors').to_pylist()
under = b_tab.column('is_underground').to_pylist()
church_zone = church.buffer(4)


def bheight(i):
    if heights[i]:
        return float(heights[i])
    if floors[i]:
        return float(floors[i]) * 3.1 + 1.6
    return {'house': 8.0, 'garage': 3.5, 'parking': 6.0, 'industrial': 10.0, 'retail': 9.0, 'public': 12.0}.get(b_class[i], 18.0)


def hidx(*vals, mod):
    return int(hashlib.md5(repr(vals).encode()).hexdigest()[:6], 16) % mod


near, mid = [], {}
skipped = 0
for i, g in enumerate(b_geom):
    if i == church_i or under[i]:
        continue
    gl = to_local(g)
    c = gl.centroid
    d = math.hypot(c.x, c.y)
    if d > MID_R:
        continue
    if gl.intersects(church_zone) and gl.intersection(church_zone).area > 0.3 * gl.area:
        skipped += 1
        continue
    h = max(bheight(i), 3.0)
    base = float(sample(ground, 16, HALF, [c.x], [c.y])[0])
    roof = hidx(i, 'r', mod=8)
    fac = hidx(i, 'f', mod=8)
    if d <= NEAR_R:
        polys = list(gl.geoms) if gl.geom_type == 'MultiPolygon' else [gl]
        for p in polys:
            p = shapely.geometry.polygon.orient(p.simplify(0.3), 1.0)
            if p.area < 6 or p.is_empty:
                continue
            ring = np.array(p.exterior.coords)[:-1]
            near.append((ring, base, h, roof, fac))
    else:
        if gl.area < 20:
            continue
        r = gl.minimum_rotated_rectangle
        q = np.array(r.exterior.coords)[:4]
        e1 = q[1] - q[0]
        e2 = q[2] - q[1]
        w_, d_ = np.hypot(*e1), np.hypot(*e2)
        ang = math.atan2(e1[1], e1[0]) % math.pi
        key = (int((c.x + MID_R) // MID_TILE), int((c.y + MID_R) // MID_TILE))
        mid.setdefault(key, []).append((c.x, c.y, w_, d_, ang, h, base, roof, fac))
log(f'buildings: near {len(near)} footprints, mid {sum(len(v) for v in mid.values())} boxes, church overlaps removed {skipped}')

q10 = lambda v: int(round(v * 10))
os.makedirs(os.path.join(OUT, 'buildings', 'mid'), exist_ok=True)
with open(os.path.join(OUT, 'buildings', 'near.bin'), 'wb') as f:
    f.write(b'SDB1' + struct.pack('<I', len(near)))
    for ring, base, h, roof, fac in near:
        f.write(struct.pack('<HBBhH', len(ring), roof, fac, q10(base), q10(h)))
        f.write(np.round(ring * 10).astype('<i2').tobytes())
mid_tiles = []
for (i, j), boxes in sorted(mid.items()):
    p = os.path.join(OUT, 'buildings', 'mid', f'{i}_{j}.bin')
    with open(p, 'wb') as f:
        f.write(b'SDM1' + struct.pack('<I', len(boxes)))
        for cx, cz, w_, d_, ang, h, base, roof, fac in boxes:
            f.write(struct.pack('<hhHHHHhBB', q10(cx), q10(cz), q10(w_), q10(d_), int(ang / math.pi * 65535), q10(h), q10(base), roof, fac))
    mid_tiles.append({'i': i, 'j': j, 'file': f'buildings/mid/{i}_{j}.bin', 'count': len(boxes),
                      'bounds': [-MID_R + i * MID_TILE, -MID_R + j * MID_TILE, MID_TILE]})

# --------------------------------------------------------------------------
# near features: roads, parks / plazas / ponds, trees
ROAD_W = {'motorway': 22, 'trunk': 20, 'primary': 14, 'secondary': 12, 'tertiary': 10, 'residential': 8, 'living_street': 7,
          'unclassified': 7, 'service': 5, 'pedestrian': 7}
ROAD_CLS = {k: i for i, k in enumerate(ROAD_W)}
TREE_ROADS = {'primary', 'secondary', 'tertiary', 'residential'}
seg = pq.read_table(os.path.join(RAW, 'segments.parquet'))
roads = []
for g, sub, cl in zip(shapely.from_wkb(seg.column('geometry').to_pylist()), seg.column('subtype').to_pylist(), seg.column('class').to_pylist()):
    if sub != 'road' or cl not in ROAD_W:
        continue
    gl = to_local(g)
    if gl.distance(shapely.Point(0, 0)) > FEAT_R:
        continue
    xy = np.array(gl.coords)
    roads.append((cl, xy))

AREA_T = {'park': 0, 'garden': 0, 'grass': 1, 'meadow': 1, 'flowerbed': 1, 'dog_park': 1, 'playground': 2, 'pitch': 3, 'pedestrian': 4, 'plaza': 4}
lu = pq.read_table(os.path.join(RAW, 'landuse.parquet'))
areas = []
for g, cl in zip(shapely.from_wkb(lu.column('geometry').to_pylist()), lu.column('class').to_pylist()):
    if cl not in AREA_T:
        continue
    gl = to_local(g)
    for p in (gl.geoms if gl.geom_type == 'MultiPolygon' else [gl]):
        if p.geom_type != 'Polygon' or p.distance(shapely.Point(0, 0)) > FEAT_R or p.area < 30:
            continue
        areas.append((AREA_T[cl], p))
wt = pq.read_table(os.path.join(RAW, 'water.parquet'))
for g, sub in zip(shapely.from_wkb(wt.column('geometry').to_pylist()), wt.column('subtype').to_pylist()):
    gl = to_local(g)
    for p in (gl.geoms if gl.geom_type == 'MultiPolygon' else [gl]):
        if p.geom_type == 'Polygon' and p.distance(shapely.Point(0, 0)) < FEAT_R and p.area < 200000 and sub != 'ocean':
            areas.append((5, p))  # ponds / fountains

# trees: both kerbs of tree-lined streets, scattered in parks; never inside
# buildings or the church
fp = shapely.STRtree([shapely.Polygon(r) for r, *_ in near] + [church_zone])
rng = np.random.default_rng(1882)
trees = []
for cl, xy in roads:
    if cl not in TREE_ROADS:
        continue
    line = shapely.LineString(xy)
    off = ROAD_W[cl] / 2 + 2.2
    for side in (-1, 1):
        try:
            o = line.offset_curve(side * off)
        except Exception:
            continue
        if o.is_empty or o.length < 8:
            continue
        for t in np.arange(5, o.length - 5, 10.0):
            p = o.interpolate(t)
            trees.append((p.x, p.y, 4.2 + rng.random() * 1.6))
for t_, p in areas:
    if t_ not in (0, 2):
        continue
    n = int(p.area / 110)
    minx, miny, maxx, maxy = p.bounds
    k = 0
    while k < n * 3 and n:
        x, y = rng.uniform(minx, maxx), rng.uniform(miny, maxy)
        k += 1
        if p.contains(shapely.Point(x, y)):
            trees.append((x, y, 4.5 + rng.random() * 3))
pts = shapely.points([(x, y) for x, y, _ in trees])
inside = set(fp.query(pts, predicate='intersects')[0].tolist())
water = shapely.union_all([p for t_, p in areas if t_ == 5]) if any(t_ == 5 for t_, _ in areas) else None
trees = [t for k, t in enumerate(trees) if k not in inside and math.hypot(t[0], t[1]) < FEAT_R
         and not (water and water.contains(shapely.Point(t[0], t[1])))]
log(f'features: {len(roads)} roads, {len(areas)} areas, {len(trees)} trees')

os.makedirs(os.path.join(OUT, 'features'), exist_ok=True)
with open(os.path.join(OUT, 'features', 'near.bin'), 'wb') as f:
    f.write(b'SDF1' + struct.pack('<III', len(roads), len(areas), len(trees)))
    for cl, xy in roads:
        y = sample(ground, 16, HALF, xy[:, 0], xy[:, 1])
        f.write(struct.pack('<BBH', ROAD_CLS[cl], 0, len(xy)))
        f.write(np.round(np.column_stack([xy * 10, y * 10])).astype('<i2').tobytes())
    for t_, p in areas:
        ring = np.array(shapely.geometry.polygon.orient(p.simplify(0.4), 1.0).exterior.coords)[:-1]
        y = sample(ground, 16, HALF, ring[:, 0], ring[:, 1])
        f.write(struct.pack('<BBH', t_, 0, len(ring)))
        f.write(np.round(np.column_stack([ring * 10, y * 10])).astype('<i2').tobytes())
    tx = np.array([[x, z] for x, z, _ in trees]) if trees else np.zeros((0, 2))
    ty = sample(ground, 16, HALF, tx[:, 0], tx[:, 1]) if len(tx) else []
    for (x, z, s), y in zip(trees, ty):
        f.write(struct.pack('<hhhBB', q10(x), q10(z), q10(y), int(s * 10), 0))

# --------------------------------------------------------------------------
# church placement: footprint orientation (minimum rotated rectangle)
r = np.array(church.minimum_rotated_rectangle.exterior.coords)[:4]
edges = [np.hypot(*(r[(k + 1) % 4] - r[k])) for k in range(4)]
manifest = {
    'version': 1,
    'map': MAP,
    'frame': {'crs': 'EPSG:32631', 'originUTM': [round(E0, 2), round(N0, 2)], 'originLatLon': [round(cent.y, 7), round(cent.x, 7)],
              'axes': 'x=east, z=south, y=elevation (m a.s.l.)', 'groundY': round(ORIGIN_Y, 2)},
    'church': {'footprint': [round(min(edges), 1), round(max(edges), 1)], 'area': round(church.area, 1)},
    'terrain': {'half': HALF, 'heightSize': HEIGHT_N, 'heightEncoding': 'terrarium', 'imageSize': IMG_N, 'levels': levels,
                'imagery': {'hybrid': {'path': 'imagery/hybrid', 'ext': 'ktx2',
                                       'sources': {f'L0-L{ICGC_FROM - 1}': f'Sentinel-2 L2A {S2_DATE}', f'L{ICGC_FROM}-L{MAX_LEVEL}': f'ICGC {ICGC_LAYER}'}}}},
    'buildings': {'near': {'file': 'buildings/near.bin', 'radius': NEAR_R, 'count': len(near)},
                  'mid': {'radius': MID_R, 'tileSize': MID_TILE, 'tiles': mid_tiles}},
    'features': {'file': 'features/near.bin', 'radius': FEAT_R, 'roadClasses': list(ROAD_W.keys()), 'roadWidths': list(ROAD_W.values()),
                 'areaTypes': ['park', 'grass', 'playground', 'pitch', 'plaza', 'water']},
    'attribution': [
        '© OpenStreetMap contributors (ODbL), via Overture Maps Foundation — buildings, roads, land use, water',
        f'Contains modified Copernicus Sentinel data {S2_DATE[:4]} — imagery',
        'Ortofoto de Catalunya 25 cm 2025 © Institut Cartogràfic i Geològic de Catalunya (ICGC), CC BY 4.0 — near/mid-range imagery',
        'Copernicus DEM GLO-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA — terrain',
    ],
}
with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
    json.dump(manifest, f, ensure_ascii=False, separators=(',', ':'))

total = 0
for root, _, files in os.walk(OUT):
    total += sum(os.path.getsize(os.path.join(root, x)) for x in files)
log(f'heights {sizes["height"] / 1024:.0f} kB, imagery {sizes["imagery"] / 1024:.0f} kB, total {total / 1024:.0f} kB')
