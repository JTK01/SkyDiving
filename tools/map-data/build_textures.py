"""
Shared map textures → public/textures/ (KTX2):

  buildings.ktx2   2048² atlas, 4×4 cells of 512 px (sRGB, ETC1S)
     row 0  Eixample façades: stone, cream render, ochre, grey      (4 bays × 4 storeys = 14.4 × 12.4 m)
     row 1  modern façades: brick, white plaster, office glass, pale (same scale)
     row 2  roofs: terracotta tiles, pale terrace, grey concrete, mixed terrace (16 × 16 m)
     row 3  ground floors: shop fronts ×2, entrance/arcade, garage (4 bays × 1 storey = 14.4 × 4.5 m)
  detail_normal.ktx2  256² tileable micro-relief normal map (linear, UASTC)

All procedural (no third-party art). usage: python build_textures.py <out_dir>
"""
import os, subprocess, sys, tempfile
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(1882)
C = 512


def noise(n, scale, seed, octaves=4):
    """tileable value-noise fBm in [0,1]"""
    r = np.random.default_rng(seed)
    acc = np.zeros((n, n))
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        g = max(2, int(scale * 2 ** o))
        grid = r.random((g, g))
        img = Image.fromarray((grid * 255).astype(np.uint8)).resize((n, n), Image.BICUBIC)
        # make tileable: blend with rolled copy
        a = np.asarray(img, np.float32) / 255
        acc += amp * a
        tot += amp
        amp *= 0.5
    return acc / tot


def wall(base, seed, grime=0.12):
    n = noise(C, 6, seed)
    stains = noise(C, 3, seed + 1, 2)
    col = np.array(base, np.float32)[None, None, :] * (0.92 + 0.12 * n[..., None])
    col *= 1 - grime * np.clip(stains[..., None] - 0.4, 0, 1)
    return col


def facade(base, seed, style):
    img = wall(base, seed)
    im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    bay, storey = C // 4, C // 4
    for s in range(4):
        y0 = s * storey
        # cornice / floor line
        d.rectangle([0, y0 + storey - 6, C, y0 + storey - 2], fill=tuple(int(c * 1.08) for c in base))
        for b in range(4):
            x0 = b * bay
            if style == 'eixample':
                wx0, wx1, wy0, wy1 = x0 + 40, x0 + bay - 40, y0 + 22, y0 + storey - 22
                # shutters (green or wood) half open, dark glass, iron balcony
                shutter = (63, 92, 72) if (seed + b) % 3 else (120, 86, 60)
                d.rectangle([wx0 - 14, wy0, wx0 - 2, wy1], fill=shutter)
                d.rectangle([wx1 + 2, wy0, wx1 + 14, wy1], fill=shutter)
                d.rectangle([wx0, wy0, wx1, wy1], fill=(38, 42, 48))
                d.rectangle([wx0 + 4, wy0 + 4, wx1 - 4, wy0 + 20], fill=(70, 84, 98))  # sky reflection
                d.rectangle([wx0 - 18, wy1 - 2, wx1 + 18, wy1 + 4], fill=tuple(int(c * 0.8) for c in base))  # slab
                for x in range(wx0 - 16, wx1 + 18, 6):
                    d.line([x, wy1 - 26, x, wy1 - 2], fill=(30, 30, 32), width=2)
                d.line([wx0 - 18, wy1 - 27, wx1 + 18, wy1 - 27], fill=(30, 30, 32), width=3)
            elif style == 'glass':
                d.rectangle([x0 + 6, y0 + 10, x0 + bay - 6, y0 + storey - 12], fill=(66, 86, 104))
                d.rectangle([x0 + 6, y0 + 10, x0 + bay - 6, y0 + 40], fill=(120, 146, 168))
                d.line([x0 + bay // 2, y0 + 10, x0 + bay // 2, y0 + storey - 12], fill=(40, 46, 52), width=3)
            else:  # modern: horizontal ribbon windows
                d.rectangle([x0, y0 + 34, x0 + bay, y0 + storey - 34], fill=(46, 52, 60))
                d.rectangle([x0, y0 + 34, x0 + bay, y0 + 46], fill=(92, 110, 126))
                d.line([x0 + 2, y0 + 34, x0 + 2, y0 + storey - 34], fill=tuple(int(c * 0.85) for c in base), width=4)
    return np.asarray(im.filter(ImageFilter.GaussianBlur(0.6)), np.float32)


def roof(kind, seed):
    if kind == 'tiles':
        y = np.arange(C)[:, None]
        x = np.arange(C)[None, :]
        rows = (y % 11) / 11.0
        wave = 0.5 + 0.5 * np.cos((x % 9) / 9.0 * 2 * np.pi)
        shade = 0.72 + 0.28 * rows * (0.7 + 0.3 * wave)
        base = np.array([184, 92, 58], np.float32)
        n = noise(C, 8, seed)
        img = base[None, None, :] * shade[..., None] * (0.85 + 0.25 * n[..., None])
        # ridge lines every 8 m
        img[(np.arange(C) % 256) < 4, :] *= 0.8
        return img
    if kind == 'terrace':
        n = noise(C, 24, seed, 3)
        img = np.array([206, 196, 178], np.float32)[None, None, :] * (0.88 + 0.18 * n[..., None])
        im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
        d = ImageDraw.Draw(im)
        for k in range(0, C, 64):  # paving joints
            d.line([k, 0, k, C], fill=(176, 166, 150), width=1)
            d.line([0, k, C, k], fill=(176, 166, 150), width=1)
        for k in range(5):  # water tanks / skylights / plants
            x, y = rng.integers(40, C - 80, 2)
            d.rectangle([x, y, x + 36, y + 26], fill=(150, 150, 152) if k % 2 else (110, 140, 80))
        return np.asarray(im, np.float32)
    if kind == 'concrete':
        n = noise(C, 12, seed, 3)
        img = np.array([150, 150, 148], np.float32)[None, None, :] * (0.85 + 0.2 * n[..., None])
        im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
        d = ImageDraw.Draw(im)
        for k in range(6):
            x, y = rng.integers(30, C - 90, 2)
            d.rectangle([x, y, x + 60, y + 40], fill=(110, 112, 116))
            d.rectangle([x + 4, y + 4, x + 56, y + 36], fill=(170, 176, 182))
        return np.asarray(im, np.float32)
    # mixed: tiles on half, terrace on the other
    a = roof('tiles', seed)
    b = roof('terrace', seed + 9)
    m = np.zeros((C, C, 1), np.float32)
    m[:, : C // 2] = 1
    return a * m + b * (1 - m)


def ground_floor(kind, base, seed):
    img = wall(base, seed, 0.2) * 0.86
    im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    bay = C // 4
    for b in range(4):
        x0 = b * bay
        if kind == 'shop':
            d.rectangle([x0 + 10, 80, x0 + bay - 10, C - 4], fill=(34, 38, 44))
            d.rectangle([x0 + 10, 80, x0 + bay - 10, 150], fill=[(170, 60, 50), (40, 90, 120), (190, 150, 60), (60, 110, 70)][(b + seed) % 4])
            d.rectangle([x0 + 18, 170, x0 + bay - 18, 300], fill=(90, 110, 124))
        elif kind == 'arcade':
            d.rectangle([x0 + 22, 120, x0 + bay - 22, C], fill=(40, 36, 34))
            d.pieslice([x0 + 22, 60, x0 + bay - 22, 180], 180, 360, fill=(40, 36, 34))
        else:  # garage / closed
            d.rectangle([x0 + 8, 140, x0 + bay - 8, C], fill=(96, 98, 102))
            for y in range(150, C, 14):
                d.line([x0 + 8, y, x0 + bay - 8, y], fill=(80, 82, 86), width=2)
    return np.asarray(im, np.float32)


cells = [
    facade((212, 188, 152), 1, 'eixample'),
    facade((228, 214, 190), 2, 'eixample'),
    facade((206, 160, 104), 3, 'eixample'),
    facade((176, 170, 160), 4, 'eixample'),
    facade((168, 96, 70), 5, 'modern'),
    facade((226, 224, 218), 6, 'modern'),
    facade((120, 132, 140), 7, 'glass'),
    facade((222, 204, 160), 8, 'modern'),
    roof('tiles', 11),
    roof('terrace', 12),
    roof('concrete', 13),
    roof('mixed', 14),
    ground_floor('shop', (200, 180, 150), 21),
    ground_floor('shop', (180, 168, 150), 22),
    ground_floor('arcade', (190, 170, 140), 23),
    ground_floor('garage', (170, 166, 160), 24),
]
atlas = np.zeros((C * 4, C * 4, 3), np.float32)
for k, cell in enumerate(cells):
    r, c = divmod(k, 4)
    atlas[r * C:(r + 1) * C, c * C:(c + 1) * C] = cell[..., :3]

# detail normal map: tileable fBm height → normals
h = noise(C, 16, 99, 5) * 0.7 + noise(C, 48, 98, 3) * 0.3
gx = np.roll(h, -1, 1) - np.roll(h, 1, 1)
gz = np.roll(h, -1, 0) - np.roll(h, 1, 0)
nrm = np.stack([-gx * 6, -gz * 6, np.ones_like(h)], -1)
nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
nimg = ((nrm * 0.5 + 0.5) * 255).astype(np.uint8)

tmp = tempfile.mkdtemp()
Image.fromarray(np.clip(atlas, 0, 255).astype(np.uint8)).save(os.path.join(tmp, 'buildings.png'))
Image.fromarray(nimg).resize((256, 256), Image.LANCZOS).save(os.path.join(tmp, 'detail_normal.png'))  # tiles ×N, 256 is plenty
enc = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'encode_ktx2.mjs')
subprocess.run(['node', enc, '--q=180', f'{tmp}/buildings.png:{OUT}/buildings.ktx2'], check=True, stdout=subprocess.DEVNULL)
subprocess.run(['node', enc, '--uastc', '--normal', f'{tmp}/detail_normal.png:{OUT}/detail_normal.ktx2'], check=True, stdout=subprocess.DEVNULL)
print(tmp)
