"""
Tree texture atlas → public/textures/trees.ktx2 (+ trees.png kept in the tmp dir
for the impostor bake). All procedural (no third-party art).

  2048 × 1024, 4 × 2 cells of 512 px, RGBA:
    row 0  foliage cards (alpha):  London plane · hackberry · stone pine · cypress
    row 1  bark (opaque, tileable): plane (mottled) · hackberry (smooth grey) ·
                                    stone pine (red-brown plates) · cypress (fibrous)

Species and colours from the reference photos (docs/reference/sagrada-familia/,
street rows of plane trees, the pines and cypresses of Plaça de la Sagrada
Família) and the city tree census (plane ≈ 27–30 % of street trees).

usage: python build_tree_textures.py <out_dir>   (prints the png path)
"""
import math, os, subprocess, sys, tempfile
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = sys.argv[1]
C = 512
rng = np.random.default_rng(2029)


def fbm(n, beta, seed):
    """periodic (tileable) noise in [0,1] with a 1/f^beta spectrum"""
    r = np.random.default_rng(seed)
    w = np.fft.fft2(r.standard_normal((n, n)))
    fy = np.fft.fftfreq(n)[:, None]
    fx = np.fft.fftfreq(n)[None, :]
    f = np.sqrt(fx * fx + fy * fy)
    f[0, 0] = 1
    img = np.real(np.fft.ifft2(w / f ** beta))
    img -= img.min()
    return img / img.max()


def jit(col, a=0.12):
    return tuple(int(max(0, min(255, c * (1 - a + 2 * a * rng.random())))) for c in col)


# ---------------------------------------------------------------- foliage cards
def twig(d, x0, y0, x1, y1, w, col):
    d.line([x0, y0, x1, y1], fill=col + (255,), width=w)


def leaf_poly(cx, cy, size, ang, kind):
    """outline of one leaf, pointing along ang"""
    pts = []
    if kind == 'palmate':  # plane: five pointed lobes
        for k in range(0, 61):
            t = k / 60 * 2 * math.pi
            lobe = 0.62 + 0.38 * abs(math.cos(2.5 * (t - ang)))
            r = size * lobe * (0.55 if math.cos(t - ang) < -0.6 else 1.0)
            pts.append((cx + math.cos(t) * r, cy + math.sin(t) * r))
    else:  # ovate with a pointed tip (hackberry), serrated
        L, W = size * 1.15, size * 0.5
        for k in range(0, 41):
            t = k / 40 * 2 * math.pi
            x = math.cos(t) * L * (0.5 + 0.5 * math.cos(t)) ** 0.9
            y = math.sin(t) * W * (1 + 0.08 * math.sin(14 * t))
            pts.append((cx + x * math.cos(ang) - y * math.sin(ang), cy + x * math.sin(ang) + y * math.cos(ang)))
    return pts


def broadleaf(kind, greens, n, size, seed):
    r = np.random.default_rng(seed)
    im = Image.new('RGBA', (C, C), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    # twigs from the bottom centre fanning out
    tips = []
    for k in range(9):
        a = -math.pi / 2 + (k - 4) * 0.3 + r.normal(0, 0.06)
        L = C * (0.62 + 0.2 * r.random()) * (1 - 0.25 * abs(k - 4) / 4)
        x1, y1 = C / 2 + math.cos(a) * L, C * 0.95 + math.sin(a) * L
        twig(d, C / 2, C * 0.95, x1, y1, 5, (92, 78, 52))
        for s in np.linspace(0.25, 1.0, 8):
            tips.append((C / 2 + (x1 - C / 2) * s, C * 0.95 + (y1 - C * 0.95) * s, a))
    order = r.permutation(len(tips))
    for k in range(n):
        x, y, a = tips[order[k % len(tips)]]
        x += r.normal(0, size * 0.5)
        y += r.normal(0, size * 0.5)
        ang = a + r.normal(0, 0.7)
        g = greens[r.integers(len(greens))]
        shade = 0.75 + 0.35 * r.random()
        col = tuple(int(min(255, c * shade)) for c in g)
        d.polygon(leaf_poly(x, y, size * (0.8 + 0.4 * r.random()), ang, kind), fill=col + (255,))
        # midrib
        d.line([x, y, x + math.cos(ang) * size * 0.9, y + math.sin(ang) * size * 0.9], fill=tuple(int(c * 0.8) for c in col) + (255,), width=1)
    return im


def needles(seed):
    """stone pine: radiating needle bunches on short shoots"""
    r = np.random.default_rng(seed)
    im = Image.new('RGBA', (C, C), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    greens = [(58, 86, 44), (72, 102, 52), (50, 74, 40), (84, 112, 60)]
    for k in range(11):
        a = -math.pi / 2 + (k - 5) * 0.26
        L = C * (0.78 - 0.3 * abs(k - 5) / 5)
        x1, y1 = C / 2 + math.cos(a) * L, C * 0.96 + math.sin(a) * L
        twig(d, C / 2, C * 0.96, x1, y1, 6, (110, 78, 54))
        for s in np.linspace(0.3, 1.0, 8):
            cx, cy = C / 2 + (x1 - C / 2) * s, C * 0.96 + (y1 - C * 0.96) * s
            for m in range(34):
                t = r.uniform(0, 2 * math.pi)
                L = r.uniform(24, 46)
                g = greens[r.integers(4)]
                d.line([cx, cy, cx + math.cos(t) * L, cy + math.sin(t) * L * 0.85 - 6], fill=jit(g) + (255,), width=2)
    return im


def cypress(seed):
    """Mediterranean cypress: dense scale-leaf sprays, flattened fans"""
    r = np.random.default_rng(seed)
    im = Image.new('RGBA', (C, C), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    greens = [(44, 66, 40), (52, 76, 44), (38, 58, 36), (60, 84, 50)]
    for k in range(2600):
        x = r.normal(C / 2, C * 0.17)
        y = r.uniform(C * 0.05, C * 0.97)
        w = C * 0.44 * math.sin(math.pi * (y / C) ** 0.8)  # flame-shaped spray
        if abs(x - C / 2) > w:
            continue
        g = greens[r.integers(4)]
        a = -math.pi / 2 + r.normal(0, 0.5)
        for s in range(6):
            L = 18 - s * 2
            d.line([x, y, x + math.cos(a + (s - 2.5) * 0.25) * L, y + math.sin(a + (s - 2.5) * 0.25) * L], fill=jit(g) + (255,), width=3)
    return im


# ------------------------------------------------------------------- bark
def bark(kind, seed):
    n1 = fbm(C, 1.1, seed)
    n2 = fbm(C, 1.6, seed + 1)
    if kind == 'plane':  # flaking: cream / olive / grey patches
        cols = np.array([(201, 195, 163), (141, 138, 98), (154, 154, 140), (176, 170, 128)], np.float32)
        idx = np.clip((n1 * 4).astype(int), 0, 3)
        img = cols[idx] * (0.9 + 0.2 * n2[..., None])
    elif kind == 'celtis':  # smooth grey, faint horizontal lenticels
        img = np.array([142, 140, 134], np.float32)[None, None] * (0.85 + 0.25 * n1[..., None])
        img[(np.arange(C)[:, None] % 23 < 2) & (n2 > 0.55)] *= 0.85
    elif kind == 'pine':  # red-brown plates, dark fissures
        plates = fbm(C, 1.8, seed + 2)
        fiss = np.abs(np.sin(np.linspace(0, 12 * np.pi, C))[None, :] * 0.6 + 1.4 * (n1 - 0.5) + 0.5 * (plates - 0.5))
        img = np.array([128, 78, 52], np.float32)[None, None] * (0.75 + 0.45 * plates[..., None])
        img *= np.clip(0.45 + fiss[..., None], 0.45, 1.0)
    else:  # cypress: fibrous vertical strips
        strips = fbm(C, 1.3, seed + 3)
        strips = np.repeat(strips[:1], C, 0) * 0.7 + strips * 0.3
        img = np.array([108, 88, 72], np.float32)[None, None] * (0.7 + 0.5 * strips[..., None])
    a = np.full((C, C, 1), 255, np.float32)
    return Image.fromarray(np.clip(np.concatenate([img, a], -1), 0, 255).astype(np.uint8), 'RGBA')


cells = [
    broadleaf('palmate', [(98, 138, 58), (122, 158, 70), (84, 120, 50), (134, 166, 78)], 150, 38, 1),  # London plane
    broadleaf('ovate', [(70, 110, 52), (82, 122, 58), (62, 98, 46), (96, 132, 64)], 330, 22, 2),  # hackberry
    needles(3),  # stone pine
    cypress(4),  # cypress
    bark('plane', 11), bark('celtis', 12), bark('pine', 13), bark('cypress', 14),
]
atlas = Image.new('RGBA', (4 * C, 2 * C), (0, 0, 0, 0))
for k, im in enumerate(cells):
    atlas.paste(im, ((k % 4) * C, (k // 4) * C))
# foliage: dilate colour into the transparent texels so mips / filtering do not
# pull black fringes into the alpha edge
rgb = np.asarray(atlas, np.float32)
fol = rgb[:C]
for _ in range(8):
    m = fol[..., 3:4] > 0
    blur = np.asarray(Image.fromarray(fol.astype(np.uint8), 'RGBA').filter(ImageFilter.MaxFilter(5)), np.float32)
    fol[..., :3] = np.where(m, fol[..., :3], blur[..., :3])
    fol[..., 3:4] = np.where(m, fol[..., 3:4], np.where(blur[..., 3:4] > 0, 1, 0))
fol[..., 3] = np.where(np.asarray(atlas, np.float32)[:C, :, 3] > 0, 255, 0)
rgb[:C] = fol
atlas = Image.fromarray(rgb.astype(np.uint8), 'RGBA')

tmp = tempfile.mkdtemp()
png = os.path.join(tmp, 'trees.png')
atlas.save(png)
os.makedirs(OUT, exist_ok=True)
enc = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'encode_ktx2.mjs')
subprocess.run(['node', enc, '--q=200', f'{png}:{os.path.join(OUT, "trees.ktx2")}'], check=True, stdout=subprocess.DEVNULL)
print(png)
