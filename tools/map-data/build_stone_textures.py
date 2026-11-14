"""
Basilica surface textures → public/textures/stone_albedo.ktx2, stone_normal.ktx2
All procedural (no photos, no third-party art). Tileable, sampled triplanar
from world position in the basilica shaders (no UVs needed).

  1024 × 256, 4 cells of 256 px (1 cell = 4 m of surface), drawn at 512 px:
    0  ashlar      sandstone blocks, chisel marks, edge wear
    1  carved      Nativity-style organic relief: lumps, folds, drips
    2  porous      weathered porous stone (Montjuïc sandstone look)
    3  mosaic      trencadís / Venetian glass tesserae with grout
  albedo: greyscale-ish detail around 1.0 (multiplied with the vertex colour)
  normal: tangent-space RG + AO in B (linear, UASTC)

usage: python build_stone_textures.py <out_dir>
"""
import os, subprocess, sys, tempfile
import numpy as np
from PIL import Image

OUT = sys.argv[1]
C = 512


def fbm(n, beta, seed):
    r = np.random.default_rng(seed)
    w = np.fft.fft2(r.standard_normal((n, n)))
    fy = np.fft.fftfreq(n)[:, None]
    fx = np.fft.fftfreq(n)[None, :]
    f = np.sqrt(fx * fx + fy * fy)
    f[0, 0] = 1
    img = np.real(np.fft.ifft2(w / f ** beta))
    img -= img.min()
    return img / img.max()


def worley(n, cells, seed):
    """tileable cellular noise: (F1 distance, cell id)"""
    r = np.random.default_rng(seed)
    pts = r.random((cells, 2)) * n
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    d1 = np.full((n, n), 1e9, np.float32)
    d2 = np.full((n, n), 1e9, np.float32)
    ids = np.zeros((n, n), np.int32)
    for k, (px, py) in enumerate(pts):
        dx = np.abs(xx - px)
        dx = np.minimum(dx, n - dx)
        dy = np.abs(yy - py)
        dy = np.minimum(dy, n - dy)
        d = np.sqrt(dx * dx + dy * dy)
        closer = d < d1
        d2 = np.where(closer, d1, np.minimum(d2, d))
        ids = np.where(closer, k, ids)
        d1 = np.where(closer, d, d1)
    return d1, d2, ids


def ashlar(seed):
    """height + albedo: 4 courses of 1 m (128 px), blocks 1.3–2 m, staggered"""
    h = np.zeros((C, C), np.float32)
    alb = np.ones((C, C), np.float32)
    r = np.random.default_rng(seed)
    rows = 4
    rh = C // rows
    y = np.arange(C)[:, None]
    x = np.arange(C)[None, :]
    for k in range(rows):
        # joints along the row: blocks of 128–256 px, wrapping
        cuts = [0]
        while cuts[-1] < C - 100:
            cuts.append(cuts[-1] + int(r.integers(128, 224)))
        cuts[-1] = C
        off = int(r.integers(0, C))
        band = (y >= k * rh) & (y < (k + 1) * rh)
        xs = (x + off) % C
        for a, b in zip(cuts[:-1], cuts[1:]):
            m = band & (xs >= a) & (xs < b)
            # block face: slight bulge, per-block tone
            u = np.clip((xs - a) / (b - a), 0, 1)
            v = np.clip((y - k * rh) / rh, 0, 1)
            bulge = np.minimum(np.minimum(u, 1 - u), np.minimum(v, 1 - v))
            h = np.where(m, np.clip(bulge * 6, 0, 1) * 0.6 + 0.4, h)
            alb = np.where(m, 0.92 + 0.14 * r.random(), alb)
    grain = fbm(C, 1.0, seed + 1)
    chisel = np.sin((np.arange(C)[None, :] * 0.9 + np.arange(C)[:, None] * 0.35)) * 0.5 + 0.5
    h = h * (0.85 + 0.1 * grain + 0.05 * chisel)
    alb = alb * (0.9 + 0.18 * fbm(C, 1.4, seed + 2))
    return h, alb


def carved(seed):
    """organic lumps (cellular), folds and vertical drips"""
    d1, d2, _ = worley(C, 90, seed)
    lumps = 1 - np.clip(d1 / 40, 0, 1) ** 1.5
    folds = np.abs(np.sin(fbm(C, 1.6, seed + 3) * 18))
    drips = fbm(C, 1.2, seed + 4)
    drips = np.repeat(drips[::8].mean(0, keepdims=True), C, 0) * 0.5 + drips * 0.5
    h = lumps * 0.6 + folds * 0.15 + (drips > 0.62) * 0.15 + fbm(C, 1.0, seed + 5) * 0.1
    alb = 0.82 + 0.25 * h + 0.08 * fbm(C, 1.3, seed + 6)
    return h, alb


def porous(seed):
    pores = fbm(C, 0.6, seed)
    pits = (pores > 0.68).astype(np.float32) * (pores - 0.68) * 3
    base = fbm(C, 1.5, seed + 1)
    h = base * 0.7 - pits * 0.6 + fbm(C, 0.9, seed + 2) * 0.2
    alb = 0.88 + 0.2 * base - 0.25 * pits
    return h, alb


def mosaic(seed):
    """irregular tesserae (3–6 cm) with grout"""
    d1, d2, ids = worley(C, 900, seed)
    edge = np.clip((d2 - d1) / 3.0, 0, 1)  # 0 at the grout line
    r = np.random.default_rng(seed + 9)
    tone = r.random(900)[ids]
    h = edge ** 0.5 * (0.85 + 0.15 * tone)
    alb = np.where(edge < 0.25, 0.55, 0.85 + 0.3 * tone)
    return h, alb


def normal_ao(h, strength):
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * strength
    n = np.stack([-gx, -gy, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    # cavity AO from the height relative to its blurred neighbourhood
    blur = np.real(np.fft.ifft2(np.fft.fft2(h) * np.exp(-((np.fft.fftfreq(C)[:, None] ** 2 + np.fft.fftfreq(C)[None, :] ** 2) * (C / 10) ** 2))))
    ao = np.clip(1 - np.clip(blur - h, 0, 1) * 3.5, 0.35, 1)
    return n, ao


cells = [(ashlar(1), 6), (carved(2), 10), (porous(3), 7), (mosaic(4), 5)]
alb_atlas = np.zeros((C, 4 * C, 3), np.float32)
nrm_atlas = np.zeros((C, 4 * C, 3), np.float32)
for k, ((h, alb), s) in enumerate(cells):
    n, ao = normal_ao(h, s)
    alb_atlas[:, k * C:(k + 1) * C] = np.clip(alb * 200, 0, 255)[..., None]
    nrm_atlas[:, k * C:(k + 1) * C, 0] = (n[..., 0] * 0.5 + 0.5) * 255
    nrm_atlas[:, k * C:(k + 1) * C, 1] = (n[..., 1] * 0.5 + 0.5) * 255
    nrm_atlas[:, k * C:(k + 1) * C, 2] = ao * 255

tmp = tempfile.mkdtemp()
# stored at half resolution: 1024 × 256 (256 px = 4 m ≈ 1.6 cm per texel)
Image.fromarray(alb_atlas.astype(np.uint8)).resize((2 * C, C // 2), Image.LANCZOS).save(f'{tmp}/stone_albedo.png')
Image.fromarray(nrm_atlas.astype(np.uint8)).resize((2 * C, C // 2), Image.LANCZOS).save(f'{tmp}/stone_normal.png')
os.makedirs(OUT, exist_ok=True)
enc = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'encode_ktx2.mjs')
subprocess.run(['node', enc, '--q=160', f'{tmp}/stone_albedo.png:{OUT}/stone_albedo.ktx2'], check=True, stdout=subprocess.DEVNULL)
subprocess.run(['node', enc, '--uastc', '--linear', f'{tmp}/stone_normal.png:{OUT}/stone_normal.ktx2'], check=True, stdout=subprocess.DEVNULL)
print(tmp)
