"""
Ground material atlases for the street-level ground (Terrain.jsx, near the player):
3 × 2 cells, each a seamless CC0 texture from ambientCG (https://ambientcg.com,
CC0 1.0 — no attribution required; listed in docs/ASSETS.md all the same):

  0 Asphalt031   carriageway asphalt
  1 Concrete034  cement base of the panot paving (the 20 cm four-tablet relief
                 of the Barcelona panot is drawn in the shader)
  2 Grass004     park lawn
  3 Ground054    sauló — the packed sand of Barcelona parks and plazas
  4 Gravel023    gravel (tree pits)
  5 Concrete046  light stone (curbs, pond rim)

→ ground_albedo.png (3072×2048) and ground_normal.png (1536×1024, OpenGL
  convention), then encode_ktx2.mjs → public/textures/*.ktx2 (ETC1S). Each cell
  holds its texture in the middle 15/16 with a wrapped border of 1/32 on every
  side, so bilinear filtering and the smaller mip levels at a tile edge read
  the texture's own opposite edge, not the neighbour cell (no seam lines).

Set 'facade' (2 × 2, Facades.jsx): Plaster001, Bricks105, Bricks066, Bricks090 →
facade_albedo.png (2048²) / facade_normal.png (1024²).

usage: python build_ground_textures.py <download dir> <out dir> [ground|facade]
"""
import io
import sys
import urllib.request
import zipfile
from pathlib import Path

from PIL import Image

SETS = {
    # name: (cells, columns, rows)
    'ground': (['Asphalt031', 'Concrete034', 'Grass004', 'Ground054', 'Gravel023', 'Concrete046'], 3, 2),
    # near façades (Facades.jsx / materials.js): Plaster001 rendered wall (tinted per
    # building), Bricks105 yellow brick, Bricks066 stone blocks (ground floor),
    # Bricks090 red brick
    'facade': (['Plaster001', 'Bricks105', 'Bricks066', 'Bricks090'], 2, 2),
}


def fetch(dl, asset):
    z = dl / f'{asset}_1K-JPG.zip'
    if not z.exists():
        url = f'https://ambientcg.com/get?file={asset}_1K-JPG.zip'
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (map-data build)'})
        z.write_bytes(urllib.request.urlopen(req, timeout=120).read())
    zf = zipfile.ZipFile(z)
    get = lambda suffix: Image.open(io.BytesIO(zf.read(f'{asset}_1K-JPG_{suffix}.jpg'))).convert('RGB')
    return get('Color'), get('NormalGL')


def square(im):
    # 1024×512 (Concrete034: 110 × 55 cm) → stacked twice
    if im.height * 2 == im.width:
        sq = Image.new('RGB', (im.width, im.width))
        sq.paste(im, (0, 0))
        sq.paste(im, (0, im.height))
        return sq
    return im


def cell(im, size):
    """seamless texture → size×size cell: content (15/16) + wrapped border (1/32 each side)"""
    inner = size * 15 // 16
    pad = (size - inner) // 2
    t = im.resize((inner, inner), Image.LANCZOS)
    big = Image.new('RGB', (inner * 3, inner * 3))
    for i in range(3):
        for j in range(3):
            big.paste(t, (i * inner, j * inner))
    return big.crop((inner - pad, inner - pad, inner - pad + size, inner - pad + size))


def main():
    dl = Path(sys.argv[1])
    out = Path(sys.argv[2])
    dl.mkdir(parents=True, exist_ok=True)
    out.mkdir(parents=True, exist_ok=True)
    name = sys.argv[3] if len(sys.argv) > 3 else 'ground'
    cells, cols, rows = SETS[name]
    alb = Image.new('RGB', (1024 * cols, 1024 * rows))
    nrm = Image.new('RGB', (512 * cols, 512 * rows))
    for k, asset in enumerate(cells):
        c, n = fetch(dl, asset)
        x, y = k % cols, k // cols
        alb.paste(cell(square(c), 1024), (x * 1024, y * 1024))
        nrm.paste(cell(square(n), 512), (x * 512, y * 512))
    alb.save(out / f'{name}_albedo.png')
    nrm.save(out / f'{name}_normal.png')
    print(name, 'atlases written')


if __name__ == '__main__':
    main()
