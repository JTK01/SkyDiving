import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { SPECIES, MISSION, rng, variant } from '../characters/critters'
import { loadCritters, mergeCritters, critterRows, writeCritter } from '../characters/critterAssets'
import { critterMaterial } from '../characters/critterMaterial'
import { ZONE_RADIUS, ZONE_LEAVE } from './missionZones'

/**
 * Animal NPCs of the mission zones (see missionZones.js): anthropomorphic
 * plush "critters" (characters/critters.js), 12–15 per zone — the zone's
 * mission animal, one or two lookalikes of it and a mix of the other
 * species, each with its own outfit, colours and props.
 *
 * A zone's NPCs exist only while the player is on foot inside it (landed in
 * it or walked in): created on entry, removed on leaving; critters.bin is
 * fetched on the first entry. All NPCs of a zone are one merged mesh per
 * level of detail (near < 25 m / far), animated in the vertex shader from a
 * small data texture — 4 draw calls per zone (2 levels + their ink lines).
 *
 * The mission animal hides: next to a tree or a wall, away from the zone
 * centre, in a small group of other animals, and keeps to its spot.
 * Walking up to one (6 m) makes it turn, wave and smile ('!' bubble); the
 * zone's mission animal is then counted in state.found.
 */
const NEAR = 25
const REACT_R = 6
const MAX_ROWS = 64

/** soft round contact shadow (shared by the NPCs and the player) */
export function blobShadow(count) {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  const gr = g.createRadialGradient(32, 32, 4, 32, 32, 31)
  gr.addColorStop(0, 'rgba(0,0,0,0.75)')
  gr.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = gr
  g.fillRect(0, 0, 64, 64)
  const tex = new THREE.CanvasTexture(c)
  const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
  const m = new THREE.InstancedMesh(geo, mat, count)
  m.frustumCulled = false
  m.renderOrder = 1
  return m
}

function bubbleTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  g.fillStyle = '#ffd34d'
  g.beginPath()
  g.arc(32, 32, 28, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#3a2a10'
  g.font = 'bold 44px sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText('!', 32, 35)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

const hashStr = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 2166136261)
const GENERAL = Object.keys(SPECIES).filter((id) => !SPECIES[id].mission)

/** which animals a zone holds: mission + lookalikes + the rest (some species twice, other looks) */
export function zoneCast(zone, rand) {
  const count = 12 + Math.floor(rand() * 4)
  const ids = [zone.mission]
  const look = GENERAL.filter((id) => SPECIES[id].lookalike === zone.mission)
  for (const id of look) ids.push(id)
  if (look.length && rand() < 0.6) ids.push(look[0])
  const pool = GENERAL.filter((id) => !look.includes(id))
  const used = new Map()
  while (ids.length < count) {
    const id = pool[Math.floor(rand() * pool.length)]
    if ((used.get(id) || 0) >= 2) continue
    used.set(id, (used.get(id) || 0) + 1)
    ids.push(id)
  }
  return ids
}

export default function Npcs({ world, zones, state, data }) {
  const { camera } = useThree()
  const root = useRef()
  const res = useMemo(() => ({ assets: null, loading: null, active: new Map(), shadows: blobShadow(MAX_ROWS), bubbleTex: bubbleTexture(), clock: 0, trees: null }), [])

  useEffect(() => {
    let live = true
    data?.features().then((f) => live && (res.trees = f.trees))
    return () => {
      live = false
    }
  }, [data, res])

  const free = (x, z) => !world.blocked(x, world.heightAt(x, z), z, 0.45, 1.6)

  /** a spot near cover: beside a tree trunk or a wall, away from the zone centre */
  const hidingSpot = (zone, rand) => {
    const R = ZONE_RADIUS - 4
    const cands = []
    const t = res.trees
    if (t)
      for (let k = 0; k < t.length; k += 4) {
        const d = Math.hypot(t[k] - zone.x, t[k + 1] - zone.z)
        if (d > R * 0.45 && d < R) cands.push([t[k], t[k + 1], 1.3])
      }
    for (let q = 0; q < 160; q++) {
      const a = rand() * Math.PI * 2
      const d = R * (0.45 + 0.55 * Math.sqrt(rand()))
      const x = zone.x + Math.cos(a) * d
      const z = zone.z + Math.sin(a) * d
      if (!free(x, z)) continue
      // a wall within 2.5 m in some direction
      for (let b = 0; b < 8; b++) {
        const bx = x + Math.cos((b / 8) * Math.PI * 2) * 2.2
        const bz = z + Math.sin((b / 8) * Math.PI * 2) * 2.2
        if (!free(bx, bz)) {
          cands.push([x, z, 0])
          break
        }
      }
    }
    for (let q = 0; q < 40 && cands.length; q++) {
      const [cx, cz, off] = cands[Math.floor(rand() * cands.length)]
      const a = rand() * Math.PI * 2
      const x = cx + Math.cos(a) * off
      const z = cz + Math.sin(a) * off
      if (free(x, z)) return [x, z]
    }
    return null
  }

  const spotNear = (cx, cz, r0, r1, taken, rand, zone) => {
    for (let q = 0; q < 40; q++) {
      const a = rand() * Math.PI * 2
      const d = r0 + (r1 - r0) * Math.sqrt(rand())
      const x = cx + Math.cos(a) * d
      const z = cz + Math.sin(a) * d
      if (Math.hypot(x - zone.x, z - zone.z) > ZONE_RADIUS - 3) continue
      if (!free(x, z)) continue
      if (taken.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 1.9)) continue
      return [x, z]
    }
    return null
  }

  const makeNpc = (id, x, z, seed, rand, extra = {}) => ({
    id,
    look: variant(id, rand),
    seed,
    x,
    z,
    y: world.heightAt(x, z),
    heading: rand() * Math.PI * 2,
    home: [x, z],
    mode: 'idle',
    timer: 1 + rand() * 4,
    speed: 0.7 + rand() * 0.3,
    phase: rand() * 6,
    walk: 0,
    wave: 0,
    hop: 0,
    blink: 0,
    blinkAt: rand() * 4,
    smile: 0,
    headYaw: 0,
    headPitch: 0,
    lod: 1,
    cool: 0,
    bubble: 0,
    ...extra,
  })

  /** build the GPU side of a set of NPCs */
  const mount = (key, npcs, zone) => {
    const tex = critterRows(res.assets, npcs)
    const ids = npcs.map((n) => n.id)
    const geos = [mergeCritters(res.assets, ids, 0), mergeCritters(res.assets, ids, 1)]
    const mats = []
    const meshes = []
    for (const lod of [0, 1])
      for (const outline of [false, true]) {
        const m = critterMaterial(tex, { lod, outline })
        const mesh = new THREE.Mesh(geos[lod], m)
        mesh.frustumCulled = false
        mats.push(m)
        meshes.push(mesh)
        root.current.add(mesh)
      }
    for (const n of npcs) {
      n.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: res.bubbleTex, transparent: true }))
      n.sprite.scale.setScalar(0.45)
      n.sprite.visible = false
      root.current.add(n.sprite)
    }
    res.active.set(key, { zone, npcs, tex, geos, mats, meshes })
  }

  const spawn = (zone) => {
    const rand = rng(hashStr(zone.id))
    const ids = zoneCast(zone, rand)
    const taken = []
    const npcs = []
    // the mission animal: hidden by cover, inside a small group
    const hide = hidingSpot(zone, rand) || spotNear(zone.x, zone.z, ZONE_RADIUS * 0.5, ZONE_RADIUS - 4, taken, rand, zone) || [zone.x + 6, zone.z]
    taken.push(hide)
    npcs.push(makeNpc(ids[0], hide[0], hide[1], rand() * 50, rand, { mission: true, stay: 1.5 }))
    const groupN = 2 + Math.floor(rand() * 2)
    for (let k = 1; k < ids.length; k++) {
      const s = k <= groupN ? spotNear(hide[0], hide[1], 1.8, 4, taken, rand, zone) : spotNear(zone.x, zone.z, 0, ZONE_RADIUS - 4, taken, rand, zone)
      if (!s) continue
      taken.push(s)
      npcs.push(makeNpc(ids[k], s[0], s[1], rand() * 50, rand, k <= groupN ? { stay: 3 } : {}))
    }
    // group members face each other a little
    for (let k = 1; k <= groupN && k < npcs.length; k++) npcs[k].heading = Math.atan2(hide[0] - npcs[k].x, hide[1] - npcs[k].z) + (rand() - 0.5)
    mount(zone.id, npcs, zone)
  }

  function despawn(key) {
    const g = res.active.get(key)
    if (!g) return
    g.meshes.forEach((m) => m.parent?.remove(m))
    g.mats.forEach((m) => m.dispose())
    g.geos.forEach((x) => x.dispose())
    g.tex.dispose()
    for (const n of g.npcs) {
      n.sprite.parent?.remove(n.sprite)
      n.sprite.material.dispose()
    }
    res.active.delete(key)
  }

  useEffect(() => {
    if (typeof window !== 'undefined' && window.__skydive)
      window.__skydive.npcs = Object.assign(res, {
        // ?debug captures: a posed set of NPCs [{ id, x, z, heading, seed, wave, smile }]
        debugSpawn: async (list, key = 'debug') => {
          if (!res.assets) res.assets = await loadCritters()
          despawn(key)
          const npcs = list.map((o, k) => {
            const rand = rng(o.seed ?? k + 1)
            return makeNpc(o.id, o.x, o.z, k * 7.3, rand, { heading: o.heading ?? 0, mode: 'pose', timer: 1e9, wave: o.wave || 0, smile: o.smile || 0, pose: true })
          })
          mount(key, npcs, { x: list[0]?.x ?? 0, z: list[0]?.z ?? 0, debug: true })
          return npcs.length
        },
        despawn,
      })
    return () => {
      for (const k of [...res.active.keys()]) despawn(k)
      res.shadows.geometry.dispose()
      res.shadows.material.map.dispose()
      res.shadows.material.dispose()
      res.bubbleTex.dispose()
    }
  }, [res]) // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1)
    res.clock += dt
    const s = state
    const onFoot = !!s.walk
    // zone presence: inside on foot → spawn; left (or back in the air) → remove
    for (const z of zones) {
      const d = Math.hypot(s.x - z.x, s.z - z.z)
      const inside = onFoot && d < ZONE_RADIUS
      const active = res.active.has(z.id)
      if (inside && !active) {
        if (res.assets) spawn(z)
        else if (!res.loading)
          res.loading = loadCritters()
            .then((a) => (res.assets = a))
            .finally(() => (res.loading = null))
      } else if (active && (!onFoot || d > ZONE_LEAVE)) despawn(z.id)
      z.inside = inside
    }
    s.zone = zones.find((z) => z.inside)?.name || null
    let si = 0
    const cam = camera.position
    for (const g of res.active.values()) {
      for (let i = 0; i < g.npcs.length; i++) {
        const n = g.npcs[i]
        const S = SPECIES[n.id]
        if (!n.pose) behave(n, g.zone, dt, s, onFoot)
        n.y = world.heightAt(n.x, n.z)
        // walk cycle: stride ≈ 0.55 × height
        n.walk += ((n.mode === 'walk' ? 1 : 0) - n.walk) * Math.min(1, dt * 5)
        n.phase += dt * n.walk * ((n.speed / (S.size * 1.75 * 0.55)) * Math.PI * 2)
        // greeting: wave + small hop + smile; head follows the player nearby
        const react = n.mode === 'react'
        if (!n.pose) {
          n.wave += ((react ? 1 : 0) - n.wave) * Math.min(1, dt * 6)
          n.smile += ((react ? 1 : 0) - n.smile) * Math.min(1, dt * 6)
          n.hop = react && n.timer > 1.0 ? Math.max(0, Math.sin((1.6 - n.timer) * Math.PI * 1.6)) * 0.09 : 0
          const pd = Math.hypot(s.x - n.x, s.z - n.z)
          let yaw = 0
          if (onFoot && pd < 7) {
            yaw = THREE.MathUtils.euclideanModulo(Math.atan2(s.x - n.x, s.z - n.z) - n.heading + Math.PI, Math.PI * 2) - Math.PI
            yaw = Math.abs(yaw) < 1.6 ? THREE.MathUtils.clamp(yaw, -0.9, 0.9) : 0
          }
          n.headYaw += (yaw - n.headYaw) * Math.min(1, dt * 4)
        }
        if (res.clock > n.blinkAt) {
          n.blinkAt = res.clock + 2.2 + Math.random() * 3
          n.blinkT = res.clock
        }
        const bt = (res.clock - (n.blinkT ?? -9)) / 0.15
        n.blink = bt >= 0 && bt < 1 ? 1 : 0
        n.lod = Math.hypot(cam.x - n.x, cam.y - n.y, cam.z - n.z) < NEAR ? 0 : 1
        writeCritter(g.tex, i, n)
        // bubble and contact shadow
        n.bubble = Math.max(0, n.bubble - dt)
        n.sprite.visible = n.bubble > 0
        const h = S.size * 1.75 * n.look.jitter
        if (n.sprite.visible) n.sprite.position.set(n.x, n.y + h + 0.35 + 0.06 * Math.sin(res.clock * 6), n.z)
        if (si < MAX_ROWS) res.shadows.setMatrixAt(si++, new THREE.Matrix4().compose(new THREE.Vector3(n.x, n.y + 0.07, n.z), new THREE.Quaternion(), new THREE.Vector3(h * 0.42, 1, h * 0.42)))
      }
      g.tex.needsUpdate = true
      for (const m of g.mats) m.uniforms.uTime.value = res.clock
    }
    res.shadows.count = si
    res.shadows.visible = si > 0
    res.shadows.instanceMatrix.needsUpdate = true
  })

  function behave(n, zone, dt, s, onFoot) {
    n.cool = Math.max(0, n.cool - dt)
    n.timer -= dt
    const pd = Math.hypot(s.x - n.x, s.z - n.z)
    if (onFoot && s.walk.mode !== 'look' && pd < REACT_R && n.cool <= 0 && n.mode !== 'react') {
      n.mode = 'react'
      n.timer = 1.6
      n.cool = 8
      n.heading = Math.atan2(s.x - n.x, s.z - n.z)
      n.bubble = 2.4
      if (n.mission) {
        s.found = s.found || new Set()
        s.found.add(n.id)
      }
    }
    if (n.mode === 'idle' && n.timer <= 0) {
      // wander: anywhere in the zone, or close to home for the hiding ones
      const r = n.stay ?? ZONE_RADIUS - 5
      const cx = n.stay ? n.home[0] : zone.x
      const cz = n.stay ? n.home[1] : zone.z
      for (let q = 0; q < 12; q++) {
        const a = Math.random() * Math.PI * 2
        const d = Math.sqrt(Math.random()) * r
        const x = cx + Math.cos(a) * d
        const z = cz + Math.sin(a) * d
        if (!world.blocked(x, world.heightAt(x, z), z, 0.45, 1.6)) {
          n.target = [x, z]
          n.mode = 'walk'
          break
        }
      }
      if (n.mode !== 'walk') n.timer = 2
    } else if (n.mode === 'walk') {
      const dx = n.target[0] - n.x
      const dz = n.target[1] - n.z
      const d = Math.hypot(dx, dz)
      const want = Math.atan2(dx, dz)
      const dh = THREE.MathUtils.euclideanModulo(want - n.heading + Math.PI, Math.PI * 2) - Math.PI
      n.heading += THREE.MathUtils.clamp(dh, -2.5 * dt, 2.5 * dt)
      const step = Math.min(d, n.speed * dt * (Math.abs(dh) > 1 ? 0.3 : 1))
      const nx = n.x + Math.sin(n.heading) * step
      const nz = n.z + Math.cos(n.heading) * step
      if (d < 0.3 || world.blocked(nx, world.heightAt(nx, nz), nz, 0.45, 1.6)) {
        n.mode = 'idle'
        n.timer = 3 + Math.random() * 6
      } else {
        n.x = nx
        n.z = nz
      }
    } else if (n.mode === 'react' && n.timer <= 0) {
      n.mode = 'idle'
      n.timer = 1.5 + Math.random() * 3
    }
  }

  return (
    <group ref={root}>
      <primitive object={res.shadows} />
    </group>
  )
}

export { MISSION }
