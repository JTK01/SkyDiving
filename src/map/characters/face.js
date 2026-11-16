import { onSurface } from './builder.js'

/**
 * Face parts (dot eyes with highlights, brows, blush, smiling mouth) on an
 * ellipsoid head — the style of the reference image and of the first
 * (pre-rigging) avatar — tagged so morph targets can move them:
 *   blink  the eyes (and highlights) close to a thin line
 *   smile  the mouth widens and deepens, the eyes squint into happy arcs,
 *          the brows rise, the blush grows
 * Faces are near-model details except the eyes (far models keep the eyes).
 *
 * style: { eye, brow, mouth, blush, eyeY, eyeX, mouthY, browY, size }
 */
export function buildFace(b, HC, HR, bone, style = {}) {
  const s0 = style.size ?? 1
  const eyeX = style.eyeX ?? 0.33
  const eyeY = style.eyeY ?? 0.03
  const R = (d) => [HR[0] + d, HR[1], HR[2] + d]
  for (const s of [-1, 1]) {
    const k = s > 0 ? 'L' : 'R'
    b.ellipsoid([0.019 * s0, 0.028 * s0, 0.012 * s0], { pos: onSurface(HC, HR, [s * eyeX, eyeY, 1]), rot: [0, s * eyeX, 0], bone, color: style.eye ?? '#141214', tag: `eye${k}` }, 10, 8)
    b.ellipsoid([0.006 * s0, 0.008 * s0, 0.004 * s0], { pos: onSurface(HC, R(0.003), [s * (eyeX - 0.02), eyeY + 0.04, 1]), bone, color: '#ffffff', detail: true, tag: `hl${k}` }, 6, 4)
    b.box(0.045 * s0, 0.009 * s0, 0.01, { pos: onSurface(HC, R(0.002), [s * (eyeX + 0.01), style.browY ?? eyeY + 0.23, 1]), rot: [-0.25, s * eyeX, s * -0.12], bone, color: style.brow ?? '#2a2224', detail: true, tag: `brow${k}` })
    b.ellipsoid([0.032 * s0, 0.016 * s0, 0.006], { pos: onSurface(HC, R(0.001), [s * (eyeX + 0.19), eyeY - 0.23, 1]), rot: [0, s * 0.5, 0], bone, color: style.blush ?? '#f2a29a', detail: true, tag: `blush${k}` }, 10, 6)
  }
  b.torus(0.022 * s0, 0.004 * s0, { pos: onSurface(HC, R(0.002), [0, style.mouthY ?? -0.38, 1]), rot: [0.3, 0, Math.PI], bone, color: style.mouth ?? '#7a3a34', detail: true, tag: 'mouth' }, 10, 3, Math.PI)
}

/** morph target deltas for the tagged face parts; tags' vertex ranges start at `offset` */
export function faceMorphs(position, tags, offset, total) {
  const blink = new Float32Array(total * 3)
  const smile = new Float32Array(total * 3)
  const centre = (t) => {
    const c = [0, 0, 0]
    for (let v = 0; v < t.count; v++) for (let k = 0; k < 3; k++) c[k] += position[(offset + t.start + v) * 3 + k] / t.count
    return c
  }
  // scale about the part centre (sx, sy, sz) and move by d
  const apply = (out, t, sx, sy, sz, d = [0, 0, 0]) => {
    const c = centre(t)
    for (let v = 0; v < t.count; v++) {
      const i = (offset + t.start + v) * 3
      const p = [position[i], position[i + 1], position[i + 2]]
      out[i] += (p[0] - c[0]) * (sx - 1) + d[0]
      out[i + 1] += (p[1] - c[1]) * (sy - 1) + d[1]
      out[i + 2] += (p[2] - c[2]) * (sz - 1) + d[2]
    }
  }
  for (const t of tags) {
    if (t.tag.startsWith('eye')) {
      apply(blink, t, 1.05, 0.12, 1, [0, -0.004, 0])
      apply(smile, t, 1.1, 0.4, 1, [0, 0.004, 0])
    } else if (t.tag.startsWith('hl')) {
      apply(blink, t, 0.01, 0.01, 0.01)
      apply(smile, t, 0.01, 0.01, 0.01)
    } else if (t.tag.startsWith('brow')) {
      apply(smile, t, 1, 1, 1, [0, 0.01, 0])
      apply(blink, t, 1, 1, 1, [0, -0.003, 0])
    } else if (t.tag.startsWith('blush')) {
      apply(smile, t, 1.25, 1.2, 1)
    } else if (t.tag === 'mouth') {
      apply(smile, t, 1.45, 1.9, 1, [0, -0.004, 0.002])
    }
  }
  return { blink, smile }
}
