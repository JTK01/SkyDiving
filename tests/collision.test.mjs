// node --test tests/  — collision of the free fall against terrain, buildings and the basilica
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import * as THREE from 'three'
import { CollisionWorld, BODY_RADIUS, colliderDist } from '../src/map/play/collision.js'
import { buildBasilica } from '../src/map/world/basilicaGeometry.js'

const R = BODY_RADIUS
const { colliders } = JSON.parse(fs.readFileSync(new URL('../public/models/sagrada-familia/colliders.json', import.meta.url)))
const GROUND = 32.75
const ROT = (44.25 * Math.PI) / 180

// flat terrain at GROUND, one level of 256 m tiles around the origin
function flatTerrain(h = GROUND) {
  const n = 5
  const tiles = new Map()
  for (let i = 125; i <= 130; i++) for (let j = 125; j <= 130; j++) tiles.set(`${i}_${j}`, new Float32Array(n * n).fill(h))
  return { half: 32768, n, levels: [{ L: 8, size: 256, tiles }] }
}
const building = { ring: new Float32Array([200, 200, 230, 200, 230, 240, 200, 240]), baseY: GROUND, height: 24 }
const world = new CollisionWorld({ terrain: flatTerrain(), buildings: [building], basilica: { x: 0, y: GROUND, z: 0, rotationY: ROT, colliders } })

/** simulate the drop like DropController (terminal 55 m/s, 50 ms frames) */
function fall(x, z, y = GROUND + 1200) {
  let vy = 0
  let p = { x, y, z }
  for (let f = 0; f < 4000; f++) {
    const dt = 0.05
    vy += 9.81 * (1 - (vy / 55) ** 2) * dt
    const q = { x, y: p.y - vy * dt, z }
    const hit = world.sweep(p, q)
    if (hit) return { ...hit, vy }
    p = q
  }
  return null
}
const toWorld = (mx, mz) => [Math.cos(ROT) * mx + Math.sin(ROT) * mz, -Math.sin(ROT) * mx + Math.cos(ROT) * mz]

test('flat ground: contact at ground + body radius', () => {
  const hit = fall(-300, 50)
  assert.equal(hit.kind, 'ground')
  assert.ok(Math.abs(hit.y - (GROUND + R)) < 0.02, `y ${hit.y}`)
})

test('terrain triangulation matches the rendered tile diagonal', () => {
  const n = 3
  const h = new Float32Array([0, 0, 0, 0, 10, 0, 0, 0, 0]) // peak in the middle
  const w = new CollisionWorld({ terrain: { half: 32768, n, levels: [{ L: 8, size: 256, tiles: new Map([['128_128', h]]) }] } })
  assert.equal(w.heightAt(128, 128), 10)
  assert.equal(w.heightAt(64, 64), 0) // on the diagonal (128,0)–(0,128) of cell 0, both at 0
  assert.equal(w.heightAt(32, 32), 0) // first triangle: (0,0) (128,0) (0,128)
  assert.equal(w.heightAt(96, 96), 5) // second triangle (bilinear would give 5.625)
})

test('building roof: contact on the roof, not the ground', () => {
  const hit = fall(215, 220)
  assert.equal(hit.kind, 'building')
  assert.equal(hit.part, 'roof')
  assert.ok(Math.abs(hit.y - (GROUND + 24 + R)) < 0.02, `y ${hit.y}`)
})

test('building wall: steering into it from the side', () => {
  const hit = world.sweep({ x: 190, y: GROUND + 10, z: 220 }, { x: 205, y: GROUND + 10, z: 220 })
  assert.equal(hit.kind, 'building')
  assert.equal(hit.part, 'wall')
  assert.ok(Math.abs(hit.x - (200 - R)) < 0.02, `x ${hit.x}`)
})

const towers = colliders.filter((c) => c.type === 'tower')
const tallest = towers.reduce((a, b) => (a.y0 + a.H > b.y0 + b.H ? a : b))

test('spire tip: falling straight onto the tallest tower stops at its tip', () => {
  // nothing above the tower axis but the tower itself and its finial/cross
  const [x, z] = toWorld(tallest.x, tallest.z)
  const hit = fall(x, z)
  assert.equal(hit.kind, 'basilica')
  assert.equal(hit.part, 'tower', 'the cross on the spire counts as the spire')
  const top = Math.max(...colliders.filter((c) => Math.hypot(c.x - tallest.x, c.z - tallest.z) < 1).map((c) => (c.y ?? c.y0) + (c.H ?? c.h ?? c.hy ?? c.r)))
  assert.ok(hit.y > GROUND + tallest.y0 + tallest.H - 1, `stopped at ${hit.y - GROUND} m, tower top ${tallest.y0 + tallest.H}, stack top ${top}`)
  assert.ok(hit.vy > 50, 'still at terminal speed')
})

test('thin spire: grazing a tower 0.6 m off its axis still touches near the tip', () => {
  for (const c of towers) {
    const [x, z] = toWorld(c.x + 0.6, c.z)
    const hit = world.sweep({ x, y: GROUND + c.y0 + c.H + 30, z }, { x, y: GROUND + c.y0 + c.H - 20, z })
    assert.ok(hit && hit.kind === 'basilica', `tower at ${c.x},${c.z} missed`)
  }
})

test('spire profile: off-axis contact height follows the drawn radius', () => {
  const c = tallest
  for (const off of [1, 2, 3]) {
    // expected: highest y where towerRadius(y) + R >= off (direct profile scan)
    let expected = null
    for (let y = c.H; y >= 0; y -= 0.01) {
      if (colliderDist({ ...c, y0: 0 }, c.x + off, y, c.z) <= R) {
        expected = y
        break
      }
    }
    const [x, z] = toWorld(c.x + off, c.z)
    const w = new CollisionWorld({ terrain: flatTerrain(), basilica: { x: 0, y: GROUND, z: 0, rotationY: ROT, colliders: [c] } })
    const hit = w.sweep({ x, y: GROUND + c.H + 20, z }, { x, y: GROUND + 1, z })
    assert.ok(Math.abs(hit.y - GROUND - c.y0 - expected) < 0.05, `off ${off}: ${hit.y - GROUND} vs ${expected}`)
  }
})

test('no tunnelling at 4× terminal speed (one 11 m step per frame)', () => {
  const [x, z] = toWorld(tallest.x, tallest.z)
  const top = GROUND + tallest.y0 + tallest.H
  const hit = world.sweep({ x, y: top + 5, z }, { x, y: top - 6, z })
  assert.ok(hit && hit.y > top - 1)
})

test('colliders agree with the drawn basilica (vertical rays)', () => {
  // first contact of a point (no body radius) dropped from above vs the
  // drawn triangles: distance from the contact point to the nearest drawn
  // surface (vertical differences mislead on walls: a 5 cm horizontal
  // offset can be metres vertically)
  const { stone, mosaic } = buildBasilica()
  const meshes = [stone, mosaic].map((g) => new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })))
  const tris = []
  for (const m of meshes) {
    const p = m.geometry.attributes.position
    for (let k = 0; k < p.count; k += 3) {
      const t = new THREE.Triangle(new THREE.Vector3().fromBufferAttribute(p, k), new THREE.Vector3().fromBufferAttribute(p, k + 1), new THREE.Vector3().fromBufferAttribute(p, k + 2))
      tris.push({ t, box: new THREE.Box3().setFromPoints([t.a, t.b, t.c]) })
    }
  }
  const nearest = (q) => {
    let d = Infinity
    const c = new THREE.Vector3()
    for (const { t, box } of tris) {
      if (box.distanceToPoint(q) >= d) continue
      t.closestPointToPoint(q, c)
      d = Math.min(d, c.distanceTo(q))
    }
    return d
  }
  const ray = new THREE.Raycaster()
  const pw = new CollisionWorld({ terrain: flatTerrain(-100), basilica: { x: 0, y: 0, z: 0, rotationY: 0, colliders }, radius: 0.001 })
  const errs = []
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  let missed = 0
  for (let k = 0; k < 400; k++) {
    const x = (rnd() - 0.5) * 120
    const z = (rnd() - 0.5) * 130
    ray.set(new THREE.Vector3(x, 400, z), new THREE.Vector3(0, -1, 0))
    const hits = ray.intersectObjects(meshes)
    const hit = pw.sweep({ x, y: 400, z }, { x, y: 0, z })
    const drawn = hits.length && hits[0].point.y > 0.5
    if (!drawn && !hit) continue
    if (drawn && !hit) {
      missed++
      continue
    }
    errs.push(drawn ? nearest(new THREE.Vector3(hit.x, hit.y, hit.z)) : hit.y) // a hit over empty ground: its height
  }
  errs.sort((a, b) => a - b)
  const n = errs.length
  const within = errs.filter((e) => e < 0.5).length / n
  console.log(`  basilica: ${n} rays, ${(within * 100).toFixed(1)} % of contacts within 0.5 m of the drawn surface, median ${errs[n >> 1].toFixed(2)} m, p95 ${errs[Math.floor(n * 0.95)].toFixed(2)} m, ${missed} drawn columns with no collider`)
  assert.ok(within > 0.9, `${within}`)
  assert.ok(missed / n < 0.02, `${missed} misses`)
})
