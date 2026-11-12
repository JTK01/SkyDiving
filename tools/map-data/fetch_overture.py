"""
Extract Overture Maps features around a point, reading only the parquet row
groups whose bbox statistics intersect the area (no full-file downloads).

usage: python fetch_overture.py <theme> <type> <radius_m> <out.parquet>
env:   OVERTURE_RELEASE (default: latest), CENTER="lat,lon"
Needs: pyarrow. Network: overturemaps-us-west-2.s3.amazonaws.com
"""
import math, os, re, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
import pyarrow as pa, pyarrow.fs as fs, pyarrow.parquet as pq, pyarrow.compute as pc

BUCKET = 'overturemaps-us-west-2'
LAT, LON = map(float, os.environ.get('CENTER', '41.4036,2.1744').split(','))


def list_keys(prefix):
    keys, token = [], None
    while True:
        url = f'https://{BUCKET}.s3.amazonaws.com/?list-type=2&prefix={prefix}' + (f'&continuation-token={urllib.parse.quote(token)}' if token else '')
        xml = urllib.request.urlopen(url, timeout=60).read().decode()
        keys += re.findall(r'<Key>([^<]+\.parquet)</Key>', xml)
        m = re.search(r'<NextContinuationToken>([^<]+)</NextContinuationToken>', xml)
        if not m:
            return keys
        token = m.group(1)


def latest_release():
    xml = urllib.request.urlopen(f'https://{BUCKET}.s3.amazonaws.com/?list-type=2&prefix=release/&delimiter=/', timeout=60).read().decode()
    return sorted(re.findall(r'<Prefix>release/([^<]+)/</Prefix>', xml))[-1]


def main():
    import urllib.parse  # noqa: F401  (used in list_keys)
    theme, typ, radius, out = sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4]
    rel = os.environ.get('OVERTURE_RELEASE') or latest_release()
    dlat = radius / 111_195
    dlon = radius / (111_320 * math.cos(math.radians(LAT)))
    box = (LON - dlon, LAT - dlat, LON + dlon, LAT + dlat)
    s3 = fs.S3FileSystem(anonymous=True, region='us-west-2', proxy_options=os.environ.get('HTTPS_PROXY'))
    keys = list_keys(f'release/{rel}/theme={theme}/type={typ}/')
    print(f'release {rel}: {len(keys)} files, bbox {box}', file=sys.stderr)

    def hits(key):
        md = pq.ParquetFile(f'{BUCKET}/{key}', filesystem=s3).metadata
        names = [md.row_group(0).column(i).path_in_schema for i in range(md.row_group(0).num_columns)]
        ix = {n: names.index(f'bbox.{n}') for n in ('xmin', 'xmax', 'ymin', 'ymax')}
        sel = []
        for r in range(md.num_row_groups):
            rg = md.row_group(r)
            st = {n: rg.column(i).statistics for n, i in ix.items()}
            if any(s is None for s in st.values()):
                continue
            if st['xmin'].min > box[2] or st['xmax'].max < box[0] or st['ymin'].min > box[3] or st['ymax'].max < box[1]:
                continue
            sel.append(r)
        return key, sel

    with ThreadPoolExecutor(16) as ex:
        found = [(k, s) for k, s in ex.map(hits, keys) if s]
    print(f'{sum(len(s) for _, s in found)} row groups in {len(found)} files', file=sys.stderr)
    tables = []
    for key, rgs in found:
        t = pq.ParquetFile(f'{BUCKET}/{key}', filesystem=s3).read_row_groups(rgs)
        b = t.column('bbox')
        m = pc.and_(
            pc.and_(pc.less_equal(pc.struct_field(b, 'xmin'), box[2]), pc.greater_equal(pc.struct_field(b, 'xmax'), box[0])),
            pc.and_(pc.less_equal(pc.struct_field(b, 'ymin'), box[3]), pc.greater_equal(pc.struct_field(b, 'ymax'), box[1])),
        )
        tables.append(t.filter(m))
    t = pa.concat_tables(tables, promote_options='permissive')
    pq.write_table(t, out)
    print(f'{t.num_rows} features -> {out} ({os.path.getsize(out) // 1024} kB), release {rel}', file=sys.stderr)


if __name__ == '__main__':
    main()
