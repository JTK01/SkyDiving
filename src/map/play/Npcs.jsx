import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { SPECIES, MISSION } from '../characters/npcRig'
import { plushMaterial } from '../characters/plush'
import { gltfLoader } from '../world/loaders'
import { ZONE_RADIUS, ZONE_LEAVE } from './zones'

/**
 * Animal NPCs of the mission zones (see zones.js): anthropomorphic, rigged
 * on the player's skeleton (public/models/characters/npcs.glb, built by
 * tools/map-data/build_npcs.mjs), playing idle / walk / react with blink and
 * smile expressions.
 *
 * A zone's NPCs exist only while the player is on foot inside it (landed in
 * it or walked in): they are created on entry and removed on leaving. The
 * glb is fetched on the first entry — outside the zones nothing of the NPCs
 * is loaded. Behaviour: idle → walk to a nearby free spot → idle …; walking
 * up to one (6 m) makes it turn, wave and smile ('!' bubble); the zone's
 * mission animal is then counted in state.found.
 */
const URL = `${import.meta.env.BASE_URL || '/'}models/characters/npcs.glb`
const NEAR = 25
const REACT_R = 6

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

let seed = 11
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)

export default function Npcs({ world, zones, state }) {
  const { camera, gl } = useThree()
  const root = useRef()
  const res = useMemo(() => ({ gltf: null, loading: null, active: new Map(), shadows: blobShadow(16), bubbleTex: bubbleTexture(), clock: 0 }), [])
  useEffect(() => {
    if (typeof window !== 'undefined' && window.__skydive)
      window.__skydive.npcs = Object.assign(res, {
        // ?debug captures: an extra NPC of any species, posed in place (no wandering)
        debugSpawn: async (id, x, z, heading = 0) => {
          if (!res.gltf) await new Promise((ok) => gltfLoader(gl).load(URL, (g) => ok((res.gltf = g))))
          const n = makeNpc(id, x, z, false)
          Object.assign(n, { zone: { x, z }, heading, timer: 1e9, cool: 1e9, bubbleSprite: new THREE.Sprite() })
          root.current.add(n.scene)
          const list = res.active.get('debug') || []
          list.push(n)
          res.active.set('debug', list)
          return true
        },
      })
    return () => {
      for (const z of res.active.keys()) despawn(z)
      res.shadows.geometry.dispose()
      res.shadows.material.map.dispose()
      res.shadows.material.dispose()
      res.bubbleTex.dispose()
    }
  }, [res]) // eslint-disable-line react-hooks/exhaustive-deps

  /** one NPC: a clone of the glb with only this species' two meshes */
  const makeNpc = (id, x, z, mission) => {
    const S = SPECIES[id]
    const scene = cloneSkinned(res.gltf.scene)
    const pal = S.palettes[Math.floor(rnd() * S.palettes.length)]
    const palette = { a: new THREE.Color(pal[0]), b: new THREE.Color(pal[1]), c: new THREE.Color(pal[2]), mask: S.props.reduce((m, p) => (rnd() < 0.65 ? m | (1 << (p - 1)) : m), 0) }
    const mat = plushMaterial({ palette })
    const keep = []
    scene.traverse((o) => {
      if (!o.isSkinnedMesh) return
      let n = o
      while (n && !/_lod\d/.test(n.name || '')) n = n.parent
      const m = n && /^(.+)_lod(\d)$/.exec(n.name)
      if (m && m[1] === id) {
        if (o.geometry.attributes.uv && !o.geometry.attributes.aPal) o.geometry.setAttribute('aPal', o.geometry.attributes.uv)
        o.material = mat
        o.frustumCulled = false
        o.userData.level = +m[2]
        keep.push(o)
      } else o.visible = false
    })
    // drop the other species' meshes from the clone
    scene.traverse((o) => {
      if (o.isSkinnedMesh && !keep.includes(o)) o.userData.drop = true
    })
    const drops = []
    scene.traverse((o) => o.userData.drop && drops.push(o))
    drops.forEach((o) => o.parent.remove(o))
    scene.scale.setScalar(S.scale)
    const mixer = new THREE.AnimationMixer(scene)
    const actions = {}
    for (const clip of res.gltf.animations) {
      const a = mixer.clipAction(clip)
      if (clip.name === 'react') {
        a.setLoop(THREE.LoopOnce)
        a.clampWhenFinished = true
      }
      actions[clip.name] = a
    }
    actions.idle.time = rnd() * 4
    actions.idle.play()
    return { id, mission, scene, mat, mixer, actions, clip: 'idle', meshes: keep, x, z, home: [x, z], heading: rnd() * Math.PI * 2, mode: 'idle', timer: 1 + rnd() * 3, cool: 0, bubble: 0, smile: 0, blinkAt: rnd() * 4, speed: 0.75 + rnd() * 0.3 }
  }

  const play = (n, name) => {
    if (n.clip === name) return
    const next = n.actions[name]
    next.reset().play()
    n.actions[n.clip].crossFadeTo(next, 0.25, false)
    n.clip = name
  }

  const freeSpot = (cx, cz, r) => {
    for (let q = 0; q < 20; q++) {
      const a = rnd() * Math.PI * 2
      const d = Math.sqrt(rnd()) * r
      const x = cx + Math.cos(a) * d
      const z = cz + Math.sin(a) * d
      if (!world.blocked(x, world.heightAt(x, z), z, 0.4, 1.4)) return [x, z]
    }
    return [cx, cz]
  }

  const spawn = (zone) => {
    const list = []
    const [mx, mz] = freeSpot(zone.x + 3, zone.z, 3)
    list.push(makeNpc(zone.mission, mx, mz, true))
    for (const id of zone.ambient) {
      const [x, z] = freeSpot(zone.x, zone.z, ZONE_RADIUS - 6)
      list.push(makeNpc(id, x, z, false))
    }
    for (const n of list) {
      n.zone = zone
      n.bubbleSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: res.bubbleTex, transparent: true }))
      n.bubbleSprite.scale.setScalar(0.45)
      n.bubbleSprite.visible = false
      root.current.add(n.scene, n.bubbleSprite)
    }
    res.active.set(zone.id, list)
  }
  function despawn(id) {
    for (const n of res.active.get(id) || []) {
      n.mixer.stopAllAction()
      n.scene.parent?.remove(n.scene)
      n.bubbleSprite.parent?.remove(n.bubbleSprite)
      n.bubbleSprite.material.dispose()
      n.mat.dispose()
      n.scene.traverse((o) => o.isSkinnedMesh && o.skeleton.dispose()) // geometries are shared with the glb
    }
    res.active.delete(id)
  }

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
        if (res.gltf) spawn(z)
        else if (!res.loading)
          res.loading = new Promise((ok) => gltfLoader(gl).load(URL, (g) => ok((res.gltf = g)))).finally(() => (res.loading = null))
      } else if (active && (!onFoot || d > ZONE_LEAVE)) despawn(z.id)
      z.inside = inside
    }
    s.zone = zones.find((z) => z.inside)?.name || null
    let si = 0
    const cam = camera.position
    for (const list of res.active.values())
      for (const n of list) {
        n.cool = Math.max(0, n.cool - dt)
        n.timer -= dt
        const pd = Math.hypot(s.x - n.x, s.z - n.z)
        if (onFoot && s.walk.mode !== 'look' && pd < REACT_R && n.cool <= 0 && n.mode !== 'react') {
          n.mode = 'react'
          n.timer = 1.6
          n.cool = 8
          n.heading = Math.atan2(s.x - n.x, s.z - n.z)
          n.bubble = 2.4
          play(n, 'react')
          if (n.mission) {
            s.found = s.found || new Set()
            s.found.add(n.id)
          }
        }
        if (n.mode === 'idle' && n.timer <= 0) {
          n.target = freeSpot(n.zone.x, n.zone.z, ZONE_RADIUS - 6)
          n.mode = 'walk'
          play(n, 'walk')
        } else if (n.mode === 'walk') {
          const dx = n.target[0] - n.x
          const dz = n.target[1] - n.z
          const d = Math.hypot(dx, dz)
          const want = Math.atan2(dx, dz)
          const dh = ((want - n.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI
          n.heading += THREE.MathUtils.clamp(dh, -2.5 * dt, 2.5 * dt)
          const step = Math.min(d, n.speed * dt)
          const nx = n.x + Math.sin(n.heading) * step
          const nz = n.z + Math.cos(n.heading) * step
          if (d < 0.3 || world.blocked(nx, world.heightAt(nx, nz), nz, 0.4, 1.4)) {
            n.mode = 'idle'
            n.timer = 2 + rnd() * 5
            play(n, 'idle')
          } else {
            n.x = nx
            n.z = nz
          }
        } else if (n.mode === 'react' && n.timer <= 0) {
          n.mode = 'idle'
          n.timer = 1.5 + rnd() * 3
          play(n, 'idle')
        }
        const y = world.heightAt(n.x, n.z)
        n.scene.position.set(n.x, y, n.z)
        n.scene.rotation.y = n.heading
        n.mixer.update(dt)
        // level of detail, face (blink, smile while greeting)
        const near = Math.hypot(cam.x - n.x, cam.y - y, cam.z - n.z) < NEAR
        for (const m of n.meshes) m.visible = (m.userData.level === 0) === near
        if (res.clock > n.blinkAt) {
          n.blinkAt = res.clock + 2.5 + rnd() * 3
          n.blinkT = res.clock
        }
        const bt = (res.clock - (n.blinkT ?? -9)) / 0.16
        n.smile += ((n.mode === 'react' ? 1 : 0) - n.smile) * Math.min(1, dt * 8)
        for (const m of n.meshes) {
          const dct = m.morphTargetDictionary
          if (!dct) continue
          m.morphTargetInfluences[dct.blink] = n.smile > 0.5 ? 0 : bt >= 0 && bt < 1 ? Math.sin(bt * Math.PI) : 0
          m.morphTargetInfluences[dct.smile] = n.smile
        }
        // bubble and contact shadow
        n.bubble = Math.max(0, n.bubble - dt)
        n.bubbleSprite.visible = n.bubble > 0
        if (n.bubbleSprite.visible) n.bubbleSprite.position.set(n.x, y + SPECIES[n.id].scale * 1.75 + 0.25 + 0.06 * Math.sin(res.clock * 6), n.z)
        res.shadows.setMatrixAt(si++, new THREE.Matrix4().compose(new THREE.Vector3(n.x, y + 0.07, n.z), new THREE.Quaternion(), new THREE.Vector3(0.7 * SPECIES[n.id].scale, 1, 0.7 * SPECIES[n.id].scale)))
      }
    res.shadows.count = si
    res.shadows.visible = si > 0
    res.shadows.instanceMatrix.needsUpdate = true
  })

  return (
    <group ref={root}>
      <primitive object={res.shadows} />
    </group>
  )
}

export { MISSION }
