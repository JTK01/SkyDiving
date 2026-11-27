import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { SPECIES, MISSION, rng, variant } from '../characters/critters'
import { loadCritters, mergeCritters, critterRows, writeCritter } from '../characters/critterAssets'
import { critterMaterial } from '../characters/critterMaterial'
import { ZONE_RADIUS, ZONE_LEAVE } from './missionZones'
import { LINES } from '../characters/critterInfo'

/**
 * Animal NPCs of the mission zones (see missionZones.js): anthropomorphic
 * plush "critters" (characters/critters.js), 12–15 per zone — the zone's
 * mission animal, one or two lookalikes of it and a mix of the other
 * species, each with its own outfit, colours and props.
 *
 * A zone's NPCs exist only while the player is on foot inside it (landed in
 * it or walked in): created on entry, removed on leaving; critters.bin is
 * fetched on the first entry. All NPCs of a zone (bodies + clothes) are one merged mesh per
 * level of detail (near < 25 m / far), animated in the vertex shader from a
 * small data texture — 4 draw calls per zone (2 levels + their ink lines).
 *
 * The mission animal hides: next to a tree or a wall, away from the zone
 * centre, in a small group of other animals, and keeps to its spot.
 * Walking up to one (6 m) makes it turn, wave and smile ('!' bubble).
 *
 * Interaction: within INTERACT_R of an animal (on foot) state.interact names
 * it; the HUD opens the E menu and calls state.npcApi: talk (a random line),
 * identify (mission animal of the zone? — the only way to collect it) and
 * photo (player and animal side by side at the zone's photo spot — the spot of
 * the zone with the clearest ray-checked view of the basilica — facing a camera placed so
 * both and the basilica are in frame; poses vsign / hug / jump; returns a
 * JPEG; both go back to where they were afterwards).
 */
const NEAR = 25
const REACT_R = 6
const INTERACT_R = 2
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

export default function Npcs({ world, zones, state, data, landmark }) {
  const { camera, gl, scene } = useThree()
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
    const geos = [mergeCritters(res.assets, npcs, 0), mergeCritters(res.assets, npcs, 1)]
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
            return makeNpc(o.id, o.x, o.z, k * 7.3, rand, { heading: o.heading ?? 0, mode: o.walk ? 'walk' : 'pose', timer: 1e9, wave: o.wave || 0, smile: o.smile || 0, pose: true, armPose: o.armPose || null, hop: o.hop || 0 })
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

  // ---- interaction API (used by the HUD) ----------------------------------------
  const find = (ref) => ref && res.active.get(ref.key)?.npcs[ref.i]
  useEffect(() => {
    state.npcApi = {
      /** freeze the animal and face the player while the menu is open */
      hold: (ref, on) => {
        const n = find(ref)
        if (!n) return
        n.held = on
        if (on) {
          n.mode = 'idle'
          n.heading = Math.atan2(state.x - n.x, state.z - n.z)
        }
      },
      talk: (ref) => {
        const n = find(ref)
        if (!n) return null
        n.talkT = 2.2
        const lines = LINES[n.id]
        let k = Math.floor(Math.random() * lines.length)
        if (k === n.lastLine) k = (k + 1) % lines.length
        n.lastLine = k
        return lines[k]
      },
      identify: (ref) => {
        const n = find(ref)
        if (!n) return null
        const g = res.active.get(ref.key)
        n.smile = 1
        return { id: n.id, mission: !!n.mission, zoneMission: g.zone.mission, zone: g.zone.name }
      },
      /** pose both for a photo; resolves with a JPEG data URL once the frame is drawn */
      photo: (ref, pose) => {
        const n = find(ref)
        if (!n) return Promise.resolve(null)
        const g = res.active.get(ref.key)
        // the zone's photo spot (missionZones: the clearest view of the basilica inside the zone)
        if (!n.prePhoto) n.prePhoto = { x: n.x, z: n.z, heading: n.heading }
        if (!state.prePhoto) state.prePhoto = { x: state.x, z: state.z, feet: state.walk.feet, face: state.face }
        if (!g.zone.debug) {
          n.x = g.zone.photo[0]
          n.z = g.zone.photo[1]
          n.y = world.heightAt(n.x, n.z)
        }
        setupPhoto(n, pose)
        return new Promise((resolve) => (res.shot = { t: 1.1, resolve, zone: g.zone }))
      },
      endPhoto: (ref) => {
        const n = find(ref)
        if (n) {
          Object.assign(n, { armPose: null, photoHop: 0, smile: 0 })
          // back to where they were
          if (n.prePhoto) Object.assign(n, n.prePhoto, { prePhoto: null })
        }
        if (state.prePhoto && state.walk) {
          const p = state.prePhoto
          Object.assign(state, { x: p.x, z: p.z, face: p.face })
          state.walk.feet = p.feet
        }
        Object.assign(state, { photoCam: null, photoPose: null, photoLift: 0, prePhoto: null })
      },
    }
    return () => {
      state.npcApi = null
    }
  }, [state, res]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * photo set-up: the animal faces away from the basilica (toward the camera), the
   * player stands at its right (the animal at the player's left), the camera
   * backs off from the pair on the far side of the basilica, tilted and zoomed
   * so the feet and the top of the central tower (≈ 170 m) are both in frame.
   */
  function setupPhoto(n, pose) {
    const B = landmark || { x: 0, z: 0 }
    let bx = B.x - n.x
    let bz = B.z - n.z
    const bl = Math.hypot(bx, bz) || 1
    bx /= bl
    bz /= bl
    // nearby spot (≤ 6 m) and view swing (≤ ±15°) with no trunk between the camera and the
    // pair or right behind them, and few trees in the wedge toward the basilica
    {
      let best = null
      const t = res.trees
      const spots = [[0, 0]]
      for (const r of [2.5, 4.5, 6]) for (let k = 0; k < 8; k++) spots.push([Math.cos((k / 8) * Math.PI * 2) * r, Math.sin((k / 8) * Math.PI * 2) * r])
      for (const [ox, oz] of n.prePhoto && !n.debugSpot ? spots : [[0, 0]]) {
        const sx = n.x + ox
        const sz = n.z + oz
        if (world.blocked(sx, world.heightAt(sx, sz), sz, 0.9, 1.6)) continue
        for (const th of [0, 0.12, -0.12, 0.25, -0.25]) {
          const ux = bx * Math.cos(th) - bz * Math.sin(th)
          const uz = bx * Math.sin(th) + bz * Math.cos(th)
          const cx = sx - ux * 6.5
          const cz = sz - uz * 6.5
          if (world.blocked(cx, world.heightAt(cx, cz), cz, 0.3, 1.6)) continue
          let cost = Math.abs(th) * 0.8 + Math.hypot(ox, oz) * 0.05
          if (t)
            for (let k = 0; k < t.length; k += 4) {
              const tx = t[k] - cx
              const tz = t[k + 1] - cz
              const along = tx * ux + tz * uz
              if (along < 0.3 || along > 45) continue
              const side = Math.abs(-tx * uz + tz * ux)
              if (along < 8 && side < 1.3) cost += 10 // a trunk in front of / right behind the pair
              else if (side < along * 0.55 + 0.6) cost += 1 / (1 + along / 8)
            }
          if (!best || cost < best.cost) best = { cost, ux, uz, sx, sz }
        }
      }
      if (best) {
        bx = best.ux
        bz = best.uz
        n.x = best.sx
        n.z = best.sz
        n.y = world.heightAt(n.x, n.z)
      }
    }
    const heading = Math.atan2(-bx, -bz) // facing the camera
    const left = [Math.cos(heading), -Math.sin(heading)]
    let px = n.x - left[0] * 0.95
    let pz = n.z - left[1] * 0.95
    if (world.blocked(px, world.heightAt(px, pz), pz, 0.3, 1.6)) {
      px = n.x + left[0] * 0.95
      pz = n.z + left[1] * 0.95
    }
    n.heading = heading
    n.mode = 'pose'
    n.held = true
    n.smile = 1
    n.armPose = pose === 'vsign' ? [1, 0, 0, 0] : pose === 'hug' ? [0, 0, 0, 1] : [1, 1, 0, 0]
    n.photoHop = pose === 'jump' ? 0.3 : 0
    const feet = world.heightAt(px, pz)
    Object.assign(state, { x: px, z: pz, face: heading, photoPose: pose, photoLift: pose === 'jump' ? 0.35 : 0 })
    state.walk.feet = feet
    // camera: on the far side of the pair from the basilica
    const mx = (px + n.x) / 2
    const mz = (pz + n.z) / 2
    const gy = (feet + n.y) / 2
    const topY = world.heightAt(B.x, B.z) + 172
    let d = 5.5
    let fov = 60
    let pitch = 0
    for (; d <= 12; d += 0.5) {
      const cx = mx - bx * d
      const cz = mz - bz * d
      if (world.blocked(cx, world.heightAt(cx, cz), cz, 0.3, 1.6)) break
      const camY = gy + 1.15
      const a0 = Math.atan2(gy - 0.15 - camY, d) // below the feet
      const far = Math.hypot(B.x - cx, B.z - cz)
      const a1 = Math.atan2(topY - camY, far) + 0.04 // above the central tower
      fov = THREE.MathUtils.radToDeg(a1 - a0) * 1.08
      pitch = (a0 + a1) / 2
      if (fov <= 72) break
    }
    d = Math.min(d, 12)
    const cx = mx - bx * d
    const cz = mz - bz * d
    const camY = gy + 1.15
    // no photobombs: the other animals step out of the view corridor and away from the pair
    for (const g of res.active.values())
      for (const o of g.npcs) {
        if (o === n) continue
        const ox = o.x - cx
        const oz = o.z - cz
        const along = ox * bx + oz * bz
        const side = -ox * bz + oz * bx
        const nearPair = Math.hypot(o.x - mx, o.z - mz) < 2.2
        if ((along > -1 && along < d + 1.5 && Math.abs(side) < 2.2) || nearPair) {
          const sgn = side >= 0 ? 1 : -1
          for (const push of [3.2, 4.5, 6]) {
            const nx = o.x + -bz * sgn * push
            const nz = o.z + bx * sgn * push
            if (!world.blocked(nx, world.heightAt(nx, nz), nz, 0.45, 1.6)) {
              Object.assign(o, { x: nx, z: nz, mode: 'idle', timer: 6 + Math.random() * 4 })
              break
            }
          }
        }
      }
    state.photoCam = {
      pos: [cx, camY, cz],
      look: [cx + bx * 10, camY + Math.tan(pitch) * 10, cz + bz * 10],
      fov: THREE.MathUtils.clamp(fov, 45, 78),
    }
  }

  /** the photo: the next frame drawn with the photo camera, 640 px wide JPEG */
  function capture() {
    gl.render(scene, camera)
    const src = gl.domElement
    const c = document.createElement('canvas')
    c.width = 640
    c.height = Math.round((640 * src.height) / src.width)
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', 0.86)
  }

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1)
    res.clock += dt
    const s = state
    const onFoot = !!s.walk
    if (res.shot) {
      res.shot.t -= dt
      if (res.shot.t <= 0 && s.photoCam) {
        const { resolve } = res.shot
        res.shot = null
        resolve(capture())
      }
    }
    // nearest animal within reach → state.interact (kept while a menu is open)
    if (!s.ui) {
      let best = null
      // the one in front of the player counts more than the nearest one behind
      const fx = Math.sin(s.face ?? 0)
      const fz = Math.cos(s.face ?? 0)
      if (onFoot)
        for (const [key, g] of res.active)
          g.npcs.forEach((n, i) => {
            const d = Math.hypot(s.x - n.x, s.z - n.z)
            if (d > INTERACT_R + 0.3) return
            const score = d - 0.9 * (((n.x - s.x) * fx + (n.z - s.z) * fz) / (d || 1))
            if (!best || score < best.score) best = { key, i, id: n.id, d, score }
          })
      s.interact = best
    }
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
        if (!n.pose && !n.held) behave(n, g.zone, dt, s, onFoot)
        n.y = world.heightAt(n.x, n.z)
        // walk cycle: stride ≈ 0.55 × height
        n.walk += ((n.mode === 'walk' ? 1 : 0) - n.walk) * Math.min(1, dt * 5)
        n.phase += dt * n.walk * ((n.speed / (S.size * 1.75 * 0.55)) * Math.PI * 2)
        // greeting: wave + small hop + smile; head follows the player nearby
        const react = n.mode === 'react'
        n.talkT = Math.max(0, (n.talkT || 0) - dt)
        n.talk = n.talkT > 0 ? 0.5 + 0.5 * Math.sin(n.talkT * 14) : 0
        if (n.held) {
          // talking / posing: smile, a little bounce while speaking
          n.hop = (n.photoHop || 0) + (n.talkT > 0 ? Math.abs(Math.sin(n.talkT * 9)) * 0.025 : 0)
          n.wave += (0 - n.wave) * Math.min(1, dt * 6)
          n.headYaw += (0 - n.headYaw) * Math.min(1, dt * 4)
          n.smile += (1 - n.smile) * Math.min(1, dt * 5)
        } else if (!n.pose) {
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
