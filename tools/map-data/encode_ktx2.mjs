/**
 * PNG/JPEG → KTX2 (Basis Universal) for every file listed on stdin or in args.
 *   node encode_ktx2.mjs [--uastc] [--linear] [--normal] [--q=128] in.png:out.ktx2 …
 * ETC1S (small, colour) by default; --uastc for detail/normal maps.
 */
import fs from 'node:fs'
import path from 'node:path'
import { PNG } from 'pngjs'
import { encodeToKTX2 } from 'ktx2-encoder'

const args = process.argv.slice(2)
const flag = (f) => args.includes(f)
const q = +(args.find((a) => a.startsWith('--q='))?.slice(4) ?? 128)
let jobs = args.filter((a) => !a.startsWith('--'))
if (!jobs.length) jobs = fs.readFileSync(0, 'utf8').split('\n').filter(Boolean)

const imageDecoder = async (buf) => {
  const png = PNG.sync.read(Buffer.from(buf))
  return { data: new Uint8Array(png.data), width: png.width, height: png.height }
}

let inBytes = 0
let outBytes = 0
for (const job of jobs) {
  const [src, dst] = job.split(':')
  const input = new Uint8Array(fs.readFileSync(src))
  const out = await encodeToKTX2(input, {
    imageDecoder,
    isUASTC: flag('--uastc'),
    needSupercompression: flag('--uastc'),
    generateMipmap: true,
    isSetKTX2SRGBTransferFunc: !flag('--linear') && !flag('--normal'),
    isNormalMap: flag('--normal'),
    qualityLevel: q,
    compressionLevel: 2,
    isPerceptual: !flag('--linear') && !flag('--normal'),
  })
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.writeFileSync(dst, out)
  inBytes += input.length
  outBytes += out.length
}
console.error(`ktx2: ${jobs.length} files, ${(inBytes / 1024) | 0} kB png → ${(outBytes / 1024) | 0} kB ktx2`)
