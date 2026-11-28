"""
Street-level ground for the walkable area around the landmark (offline).

From the near features (Overture road centrelines with class, park / plaza /
water areas, trees) and the building footprints already in the tiles:

  streets/mask.png  RGB, 0.5 m per pixel over the square ±HALF m (x east, z south;
                    row 0 = z −HALF):
      R  signed distance to the carriageway edge (+ inside the road),
         128 + d·16 (±8 m, 1/16 m steps) — sampled bilinearly, so the
         curb line stays sharp at any distance
      G  ground class (read unfiltered): 0 pavement (panot), 1 grass,
         2 sauló (packed sand: park paths, plazas, playgrounds),
         3 gravel (tree pits), 4 water, 5 pitch, 6 carriageway
      B  signed distance to the water edge (+ inside), 128 + d·16
      A  soft ground blend (bilinear): 0 paving, ½ sauló, 1 lawn — the
         class indicators blurred over ~0.4 m, so edges between them are
         smooth curves instead of 0.5 m pixel steps (A ≥ 1/255: no
         premultiplied-alpha loss)
  streets/streets.bin   'SST1' · u32 counts · markings (triangles, x z) ·
                    curbs (u32 n, n × (inner x z, outer x z)) · rims (same,
                    around ponds). Coordinates i16 in 1.5 cm units (±491 m).

Road markings follow Barcelona street practice: dashed white lane lines
(3 m dash, 4 m gap) between ~3.2 m lanes on two-lane-plus streets, zebra
crossings (0.5 m bars / 0.5 m gaps, 4 m deep) where a street enters a
junction, set back 1 m from it; none inside junctions. Curbs follow the
carriageway outline (rounded 2 m at the junction corners).

usage: python build_streets.py ../../public/tiles/sagrada-familia
"""
import json
import math
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import distance_transform_edt
from shapely.geometry import LineString, Point, Polygon, box
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

UNIT = 0.015  # m per unit in streets.bin (i16: ±491 m)
HALF = 450.0  # m: covers the 350 m drop radius + the 50 m walk + margin
RES = 0.5  # m per mask pixel
FINE = 0.125  # m per pixel for the distance fields (then averaged down)
# carriageway widths (m) by Overture class: Eixample streets are 20 m between
# facades with a 10 m roadway; avenues wider. Pedestrian streets have none.
WIDTH = {'motorway': 22, 'trunk': 20, 'primary': 16, 'secondary': 12, 'tertiary': 10, 'residential': 10, 'living_street': 7, 'unclassified': 8, 'service': 5}
MARKED = {'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential'}
PAVEMENT, GRASS, SAULO, GRAVEL, WATER, PITCH, ROAD = range(7)


def read_features(root, m):
    b = (root / m['features']['file']).read_bytes()
    nr, na, nt = struct.unpack_from('<3I', b, 4)
    o = 16

    def poly():
        nonlocal o
        t, _, n = struct.unpack_from('<BBH', b, o)
        o += 4
        p = struct.unpack_from('<%dh' % (n * 3), b, o)
        o += n * 6
        return t, [(p[i] / 10, p[i + 1] / 10) for i in range(0, len(p), 3)]

    roads = [poly() for _ in range(nr)]
    areas = [poly() for _ in range(na)]
    trees = [struct.unpack_from('<3hBB', b, o + k * 8) for k in range(nt)]
    rc, at = m['features']['roadClasses'], m['features']['areaTypes']
    return ([(rc[t], p) for t, p in roads], [(at[t], p) for t, p in areas], [(x / 10, z / 10, s / 10) for x, z, _, s, _ in trees])


def read_buildings(root, m):
    b = (root / m['buildings']['near']['file']).read_bytes()
    n = struct.unpack_from('<I', b, 4)[0]
    o = 8
    out = []
    for _ in range(n):
        nv = struct.unpack_from('<H', b, o)[0]
        o += 8
        r = struct.unpack_from('<%dh' % (nv * 2), b, o)
        o += nv * 4
        out.append([(r[2 * k] / 10, r[2 * k + 1] / 10) for k in range(nv)])
    return out


def raster(geom, res, half=HALF):
    """polygon(s) → bool image (row = z)"""
    n = int(round(2 * half / res))
    im = Image.new('1', (n, n), 0)
    d = ImageDraw.Draw(im)
    geoms = getattr(geom, 'geoms', [geom])
    for g in geoms:
        if g.is_empty or g.geom_type != 'Polygon':
            continue
        px = lambda c: [((x + half) / res, (z + half) / res) for x, z in c]
        d.polygon(px(g.exterior.coords), fill=1)
        for h in g.interiors:
            d.polygon(px(h.coords), fill=0)
    return np.array(im, dtype=bool)


def sdf(mask, res):
    """signed distance (m), + inside"""
    inside = distance_transform_edt(mask) * res
    outside = distance_transform_edt(~mask) * res
    return np.where(mask, inside - res / 2, -(outside - res / 2))


def down(a, k):
    n = a.shape[0] // k
    return a[: n * k, : n * k].reshape(n, k, n, k).mean(axis=(1, 3))


def main():
    root = Path(sys.argv[1])
    m = json.loads((root / 'manifest.json').read_text())
    roads, areas, trees = read_features(root, m)
    clip = box(-HALF - 40, -HALF - 40, HALF + 40, HALF + 40)

    # ---- carriageway: centrelines buffered by their width, flat ends, rounded junction corners
    lines = []
    for cls, pts in roads:
        if cls not in WIDTH or len(pts) < 2:
            continue
        ln = LineString(pts)
        if not ln.intersects(clip):
            continue
        lines.append((cls, ln, WIDTH[cls]))
    bufs = [ln.buffer(w / 2, cap_style='flat', join_style='mitre', mitre_limit=3) for _, ln, w in lines]
    road = unary_union(bufs)
    road = road.buffer(-2.0, join_style='round').buffer(2.0, join_style='round')  # round inner corners (curb radius)
    road = road.buffer(0.01).intersection(clip)

    # junction cores: where carriageways of different streets overlap
    cores = []
    for i in range(len(bufs)):
        for j in range(i + 1, len(bufs)):
            if bufs[i].intersects(bufs[j]):
                x = bufs[i].intersection(bufs[j])
                if x.area > 4:
                    cores.append(x)
    core = unary_union(cores).buffer(0.5)

    # ---- markings
    marks = []
    for cls, ln, w in lines:
        if cls not in MARKED or w < 8:
            continue
        lanes = max(2, int(round(w / 3.2)))
        free = ln.difference(core.buffer(6.5))  # no lane lines in or next to a junction
        for k in range(1, lanes):
            off = -w / 2 + k * w / lanes
            for part in getattr(free, 'geoms', [free]):
                if part.length < 1 or part.geom_type != 'LineString':
                    continue
                side = part.offset_curve(off)
                if side.is_empty or side.geom_type != 'LineString':
                    continue
                s = 0.0
                while s < side.length:
                    a, b = s, min(s + 3.0, side.length)
                    if b - a > 0.5:
                        seg = LineString([side.interpolate(a).coords[0], side.interpolate(b).coords[0]])
                        marks.append(seg.buffer(0.06, cap_style='flat'))
                    s += 7.0
        # zebra crossings where the centreline leaves a junction core
        hit = ln.intersection(core.boundary)
        for p in getattr(hit, 'geoms', [hit]):
            if p.is_empty or p.geom_type != 'Point':
                continue
            d = ln.project(p)
            for sgn in (-1, 1):
                q = ln.interpolate(max(0, min(ln.length, d + sgn * 0.5)))
                if core.contains(q):
                    continue  # this side is inside the junction
                q1 = ln.interpolate(max(0, min(ln.length, d + sgn * 1.0)))
                q2 = ln.interpolate(max(0, min(ln.length, d + sgn * 5.0)))
                dx, dz = q2.x - q1.x, q2.y - q1.y
                L = math.hypot(dx, dz)
                if L < 3:
                    continue
                ux, uz = dx / L, dz / L
                nx, nz = -uz, ux
                k = -w / 2 + 0.5
                while k + 0.5 <= w / 2 - 0.3:
                    c0 = (q1.x + nx * k, q1.y + nz * k)
                    c1 = (q1.x + nx * (k + 0.5), q1.y + nz * (k + 0.5))
                    marks.append(Polygon([c0, c1, (c1[0] + ux * L, c1[1] + uz * L), (c0[0] + ux * L, c0[1] + uz * L)]))
                    k += 1.0
    marks = unary_union(marks).intersection(road.buffer(-0.25)).intersection(box(-HALF, -HALF, HALF, HALF))

    # ---- areas
    def poly(pts):
        p = Polygon(pts)
        return p if p.is_valid else p.buffer(0)

    by = {}
    for t, pts in areas:
        if len(pts) >= 3:
            by.setdefault(t, []).append(poly(pts))
    U = lambda t: unary_union(by.get(t, [])) if by.get(t) else Polygon()
    park = unary_union([U('park'), U('grass')])
    water = U('water').intersection(box(-HALF, -HALF, HALF, HALF))
    peds = unary_union([LineString(p).buffer(1.6) for c, p in roads if c == 'pedestrian' and len(p) > 1])
    tree_pts = [(x, z) for x, z, _ in trees if abs(x) < HALF and abs(z) < HALF]
    # sauló inside parks: along the paths, a 1.5 m band at the edge, under the trees
    park_saulo = unary_union([peds.intersection(park), park.difference(park.buffer(-1.5)), unary_union([Point(t).buffer(1.6) for t in tree_pts]).intersection(park)])
    # street trees (not in a park / plaza): square gravel pits (escocells) 1.4 m
    pits = unary_union([box(x - 0.7, z - 0.7, x + 0.7, z + 0.7) for x, z in tree_pts if not park.buffer(2).contains(Point(x, z))])

    n = int(round(2 * HALF / RES))
    k = int(RES / FINE)
    # soft blend field from fine rasters: lawn 1, sauló ½, paving 0
    from scipy.ndimage import gaussian_filter
    lawn_f = raster(unary_union([park.difference(park_saulo), U('pitch')]), FINE).astype(np.float32)
    saulo_f = raster(unary_union([U('plaza'), U('playground'), park_saulo]), FINE).astype(np.float32)
    saulo_f = np.maximum(saulo_f - lawn_f, 0)
    soft = down(gaussian_filter(lawn_f + 0.5 * saulo_f, 0.35 / FINE), k)
    cls = np.full((n, n), PAVEMENT, np.uint8)
    for geom, c in [(park, GRASS), (U('pitch'), PITCH), (U('plaza'), SAULO), (U('playground'), SAULO), (park_saulo, SAULO), (pits, GRAVEL), (water, WATER)]:
        cls[raster(geom, RES)] = c
    road_fine = raster(road, FINE)
    road_d = down(sdf(road_fine, FINE), k)
    cls[road_d > 0] = ROAD
    water_d = down(sdf(raster(water, FINE), FINE), k) if not water.is_empty else np.full((n, n), -8.0)
    enc = lambda d: np.clip(np.round(128 + d * 16), 0, 255).astype(np.uint8)
    alpha = np.clip(np.round(1 + soft * 254), 1, 255).astype(np.uint8)
    rgba = np.dstack([enc(road_d), cls, enc(water_d), alpha])
    out = root / 'streets'
    out.mkdir(exist_ok=True)
    Image.fromarray(rgba, 'RGBA').save(out / 'mask.png', optimize=True)

    # ---- curbs / pond rims: strips along the outlines (inner edge on the outline, outer 0.25 m away)
    def strips(geom, width, away_from):
        res = []
        for g in getattr(geom, 'geoms', [geom]):
            if g.geom_type != 'Polygon':
                continue
            g = orient(g, 1.0)
            for ring in [g.exterior, *g.interiors]:
                c = list(ring.coords)
                for part in split_ring(c):
                    res.append(offset_strip(part, width, away_from))
        return [s for s in res if s]

    def split_ring(c):
        # drop the pieces lying on the clip square edge (not a real curb)
        parts, cur = [], []
        for p in c:
            on_edge = abs(abs(p[0]) - (HALF + 8)) < 0.05 or abs(abs(p[1]) - (HALF + 8)) < 0.05
            if on_edge:
                if len(cur) > 1:
                    parts.append(cur)
                cur = []
            else:
                cur.append(p)
        if len(cur) > 1:
            parts.append(cur)
        return parts

    def offset_strip(pts, width, away_from):
        # densify to ≤ 2 m so the strip follows the terrain
        dense = []
        for a, b in zip(pts, pts[1:]):
            L = math.hypot(b[0] - a[0], b[1] - a[1])
            steps = max(1, int(math.ceil(L / 2.0)))
            for s in range(steps):
                dense.append((a[0] + (b[0] - a[0]) * s / steps, a[1] + (b[1] - a[1]) * s / steps))
        dense.append(pts[-1])
        if len(dense) < 2:
            return None
        out = []
        for i, p in enumerate(dense):
            a = dense[max(0, i - 1)]
            b = dense[min(len(dense) - 1, i + 1)]
            dx, dz = b[0] - a[0], b[1] - a[1]
            L = math.hypot(dx, dz) or 1
            nx, nz = -dz / L, dx / L
            # point away from the given area (road / water)
            if away_from.contains(Point(p[0] + nx * 0.3, p[1] + nz * 0.3)):
                nx, nz = -nx, -nz
            out.append((p[0], p[1], p[0] + nx * width, p[1] + nz * width))
        return out

    sq = box(-HALF, -HALF, HALF, HALF)
    curbs = strips(road.intersection(box(-HALF - 8, -HALF - 8, HALF + 8, HALF + 8)), 0.25, road)
    rims = strips(water, 0.45, water) if not water.is_empty else []

    # ---- binary
    tri = []
    for g in getattr(marks, 'geoms', [marks]):
        if g.geom_type != 'Polygon' or g.area < 0.01:
            continue
        from shapely.ops import triangulate
        for t in triangulate(g):
            if g.contains(t.representative_point()):
                c = list(t.exterior.coords)[:3]
                tri.extend(c)
    cm = lambda v: int(round(v / UNIT))
    blob = bytearray(b'SST1')
    blob += struct.pack('<3I', len(tri) // 3, len(curbs), len(rims))
    for x, z in tri:
        blob += struct.pack('<2h', cm(x), cm(z))
    for s in curbs + rims:
        blob += struct.pack('<I', len(s))
        for v in s:
            blob += struct.pack('<4h', *map(cm, v))
    (out / 'streets.bin').write_bytes(bytes(blob))
    m['streets'] = {'mask': 'streets/mask.png', 'geometry': 'streets/streets.bin', 'half': HALF, 'res': RES, 'unit': UNIT, 'classes': ['pavement', 'grass', 'saulo', 'gravel', 'water', 'pitch', 'road']}
    (root / 'manifest.json').write_text(json.dumps(m, ensure_ascii=False, separators=(',', ':')))
    counts = {c: int((cls == i).sum() * RES * RES) for i, c in enumerate(m['streets']['classes'])}
    print('mask', (out / 'mask.png').stat().st_size // 1024, 'kB; streets.bin', len(blob) // 1024, 'kB; marking triangles', len(tri) // 3, '; curbs', len(curbs), 'rims', len(rims))
    print('area m²', counts)


if __name__ == '__main__':
    main()
