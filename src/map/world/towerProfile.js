/**
 * Radius of a basilica tower at height y above its base (−1 outside it).
 * Mirrors the lathe profile in basilicaGeometry.js (without the 5 % mouldings)
 * and is shared with the collision test so thin spires collide where drawn.
 */
export function towerRadius(c, y) {
  const t = y / c.H
  if (t < 0 || t > 1) return -1
  if (t < c.body) return c.r0 * (1 - c.taper * (t / c.body))
  const u = (t - c.body) / (1 - c.body)
  return Math.max(c.r0 * (1 - c.taper) * (1 - Math.pow(u, c.k)), 0.25)
}
