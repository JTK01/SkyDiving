import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { SPECIES, MISSION, AMBIENT, CLIPS, buildAnimal, animalPose } from '../characters/animals'
import { skinMatrices } from '../characters/builder'
import { plushMaterial } from '../characters/plush'

/**
 * Animal NPCs in the mission area: the two squares beside the basilica
 * (Plaça de la Sagrada Família, west; Plaça de Gaudí, east).
 *  - the five mission animals (bull, Iberian lynx, rabbit, dragon, Catalan
 *    wildcat) stand near fixed spots; finding one (walking within 6 m)
 *    counts it in state.found
 *  - general animals (donkey, monk parakeet, pigeon, dog, gull, hedgehog)
 *    wander around the squares
 * Behaviour per animal: idle → walk to a nearby free spot → idle …; on
 * discovery a hop toward the player with a "!" bubble.
 *
 * Rendering: animation instancing. Each species' clips (idle, walk, react)
 * are sampled once into a pose texture (3 texels per bone matrix, one row
 * per frame); one InstancedMesh per species and level (near < 25 m with all
 * details, far beyond) skins every animal in the vertex shader. Per instance:
 * clip / start time, palette (3 colours) and the prop mask.
 */
const FPS = { idle: 12, walk: 16, react: 12 }
const NEAR = 25
const CULL = 350
const REACT_R = 6

// placement in the basilica frame (x toward Nativity, z toward Glory), metres
const SQUARES = { west: [-100, 0], east: [100, 0] }
const MISSION_SPOTS = { bull: ['west', -6, -12], lynx: ['west', 9, 11], dragon: ['east', -5, 14], rabbit: ['east', 2, -11], wildcat: ['east', 12, 4] }
const AMBIENT_COUNT = { donkey: 2, parakeet: 3, pigeon: 4, dog: 2, gull: 2, hedgehog: 2 }

let seed = 7
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)

function poseTexture(id, bones) {
  const rows = []
  const clips = {}
  for (const [clip, dur] of Object.entries(CLIPS)) {
    const frames = Math.round(dur * FPS[clip])
    clips[clip] = { row: rows.length, frames, fps: FPS[clip] * (clip === 'react' ? -1 : 1) }
    const pose = animalPose(id, clip)
    for (let f = 0; f < frames; f++) rows.push(skinMatrices(bones, pose((f / frames) * dur, dur)))
  }
  const w = bones.length * 3
  const data = new Float32Array(w * rows.length * 4)
  rows.forEach((mats, r) =>
    mats.forEach((m, b) => {
      const e = m.elements // column-major
      for (let k = 0; k < 3; k++) data.set([e[k], e[4 + k], e[8 + k], e[12 + k]], (r * w + b * 3 + k) * 4)
    }),
  )
  const tex = new THREE.DataTexture(data, w, rows.length, THREE.RGBAFormat, THREE.FloatType)
  tex.needsUpdate = true
  return { tex, clips }
}

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
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })
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

export default function Npcs({ world, landmark, state }) {
  const camera = useThree((s) => s.camera)
  const res = useMemo(() => {
    seed = 7
    const rot = (landmark.rotationDeg * Math.PI) / 180
    const c = Math.cos(rot)
    const s = Math.sin(rot)
    const toWorld = (mx, mz) => [landmark.x + c * mx + s * mz, landmark.z - s * mx + c * mz]
    const free = (x, z) => {
      for (let k = 0; k < 40; k++) {
        const a = k * 2.39996
        const d = k ? 0.8 * Math.sqrt(k) : 0
        const px = x + Math.cos(a) * d
        const pz = z + Math.sin(a) * d
        if (!world.blocked(px, world.heightAt(px, pz), pz, 0.5, 1)) return [px, pz]
      }
      return [x, z]
    }
    // animals
    const npcs = []
    for (const id of MISSION) {
      const [sq, dx, dz] = MISSION_SPOTS[id]
      const [hx, hz] = free(...toWorld(SQUARES[sq][0] + dx, SQUARES[sq][1] + dz))
      npcs.push({ id, home: [hx, hz], roam: 4, mission: true })
    }
    for (const id of AMBIENT)
      for (let k = 0; k < AMBIENT_COUNT[id]; k++) {
        const sq = k % 2 ? 'east' : 'west'
        const [hx, hz] = free(...toWorld(SQUARES[sq][0] + (rnd() - 0.5) * 36, SQUARES[sq][1] + (rnd() - 0.5) * 36))
        npcs.push({ id, home: [hx, hz], roam: 10, mission: false })
      }
    for (const n of npcs) {
      const S = SPECIES[n.id]
      n.x = n.home[0]
      n.z = n.home[1]
      n.heading = rnd() * Math.PI * 2
      n.mode = 'idle'
      n.timer = 1 + rnd() * 4
      n.cool = 0
      n.scale = S.scale * (0.92 + rnd() * 0.16)
      n.speed = S.body === 'bird' ? 0.5 : S.body === 'hop' ? 1.1 : 0.5 + S.scale * 0.35
      n.palette = S.palettes[Math.floor(rnd() * S.palettes.length)].map((h) => new THREE.Color(h))
      n.props = S.props.reduce((m, p) => (rnd() < 0.6 ? m | (1 << (p - 1)) : m), 0)
      n.phase = rnd() * 10
    }
    // per species: geometry (2 levels), pose texture, material, instanced meshes
    const groups = {}
    for (const id of [...MISSION, ...AMBIENT]) {
      const list = npcs.filter((n) => n.id === id)
      const lv = [buildAnimal(id, 0), buildAnimal(id, 1)]
      const { tex, clips } = poseTexture(id, lv[0].bones)
      const mat = plushMaterial({ instanced: true, poses: tex })
      const N = list.length
      const attr = {
        aClip: new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4),
        aColA: new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3),
        aColB: new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3),
        aColC: new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3),
        aPropMask: new THREE.InstancedBufferAttribute(new Float32Array(N), 1),
      }
      list.forEach((n, i) => {
        n.palette[0].toArray(attr.aColA.array, i * 3)
        n.palette[1].toArray(attr.aColB.array, i * 3)
        n.palette[2].toArray(attr.aColC.array, i * 3)
        attr.aPropMask.array[i] = n.props
        n.group = id
        n.index = i
      })
      const meshes = lv.map((l) => {
        for (const [k, a] of Object.entries(attr)) l.geometry.setAttribute(k, a)
        const m = new THREE.InstancedMesh(l.geometry, mat, N)
        m.frustumCulled = false
        m.receiveShadow = true
        return m
      })
      groups[id] = { list, meshes, mat, tex, clips, attr, tris: lv.map((l) => l.geometry.attributes.position.count / 3) }
    }
    // "!" bubbles
    const bubbleTex = bubbleTexture()
    const bubbles = npcs.map(() => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: bubbleTex, depthTest: false, transparent: true }))
      sp.scale.setScalar(0.45)
      sp.visible = false
      sp.renderOrder = 10
      return sp
    })
    const shadows = blobShadow(npcs.length)
    return { npcs, groups, bubbles, bubbleTex, shadows, clock: 0 }
  }, [world, landmark])

  useEffect(() => {
    if (typeof window !== 'undefined' && window.__skydive) window.__skydive.npcs = Object.assign(res, { setClip: (n, c) => setClip(n, c, res.clock) })
    return () => {
      for (const g of Object.values(res.groups)) {
        g.meshes.forEach((m) => m.geometry.dispose())
        g.mat.dispose()
        g.tex.dispose()
      }
      res.bubbles.forEach((b) => b.material.dispose())
      res.shadows.geometry.dispose()
      res.shadows.material.map.dispose()
      res.shadows.material.dispose()
      res.bubbleTex.dispose()
    }
  }, [res])

  const setClip = (n, clip, t) => {
    const g = res.groups[n.group]
    const c = g.clips[clip]
    // loops start with a per-animal phase so neighbours are not in step
    g.attr.aClip.array.set([c.row, c.frames, clip === 'react' ? t : t - n.phase, c.fps], n.index * 4)
    g.attr.aClip.needsUpdate = true
    n.clip = clip
  }

  const o = useMemo(() => new THREE.Object3D(), [])
  const zero = useMemo(() => new THREE.Matrix4().makeScale(0, 0, 0), [])
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1)
    res.clock += dt
    const t = res.clock
    for (const g of Object.values(res.groups)) if (g.mat.userData.shader) g.mat.userData.shader.uniforms.uTime.value = t
    const cam = camera.position
    // from high up (> 200 m) or far away the animals are below a pixel: skip them
    const far = Math.hypot(cam.x - res.npcs[0].home[0], cam.z - res.npcs[0].home[1]) > CULL || cam.y - world.heightAt(cam.x, cam.z) > 200
    for (const g of Object.values(res.groups)) g.meshes.forEach((m) => (m.visible = !far))
    res.shadows.visible = !far
    if (far) return
    const onFoot = !!state.walk && state.walk.mode !== 'look'
    res.npcs.forEach((n, k) => {
      if (!n.clip) setClip(n, 'idle', t)
      n.cool = Math.max(0, n.cool - dt)
      const pd = Math.hypot(state.x - n.x, state.z - n.z)
      // discovery: the player walks up to it
      if (onFoot && pd < REACT_R && n.cool <= 0 && n.mode !== 'react') {
        n.mode = 'react'
        n.timer = CLIPS.react
        n.cool = 8
        n.heading = Math.atan2(state.x - n.x, state.z - n.z)
        n.bubble = 2.4
        setClip(n, 'react', t)
        if (n.mission) {
          state.found = state.found || new Set()
          state.found.add(n.id)
        }
      }
      n.timer -= dt
      if (n.mode === 'idle' && n.timer <= 0) {
        // walk to a free spot near home
        for (let q = 0; q < 6; q++) {
          const a = rnd() * Math.PI * 2
          const r = Math.sqrt(rnd()) * n.roam
          const tx = n.home[0] + Math.cos(a) * r
          const tz = n.home[1] + Math.sin(a) * r
          if (!world.blocked(tx, world.heightAt(tx, tz), tz, 0.4, 0.8)) {
            n.target = [tx, tz]
            n.mode = 'walk'
            setClip(n, 'walk', t)
            break
          }
        }
        if (n.mode === 'idle') n.timer = 2
      } else if (n.mode === 'walk') {
        const dx = n.target[0] - n.x
        const dz = n.target[1] - n.z
        const d = Math.hypot(dx, dz)
        const want = Math.atan2(dx, dz)
        let dh = ((want - n.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI
        n.heading += THREE.MathUtils.clamp(dh, -2.5 * dt, 2.5 * dt)
        const step = Math.min(d, n.speed * dt)
        const nx = n.x + Math.sin(n.heading) * step
        const nz = n.z + Math.cos(n.heading) * step
        if (d < 0.3 || world.blocked(nx, world.heightAt(nx, nz), nz, 0.4, 0.8)) {
          n.mode = 'idle'
          n.timer = 2 + rnd() * 5
          setClip(n, 'idle', t)
        } else {
          n.x = nx
          n.z = nz
        }
      } else if (n.mode === 'react' && n.timer <= 0) {
        n.mode = 'idle'
        n.timer = 1.5 + rnd() * 3
        setClip(n, 'idle', t)
      }
      // instance transforms in both levels (the other level gets a zero matrix)
      const y = world.heightAt(n.x, n.z)
      o.position.set(n.x, y, n.z)
      o.rotation.set(0, n.heading, 0)
      o.scale.setScalar(n.scale)
      o.updateMatrix()
      const near = Math.hypot(cam.x - n.x, cam.y - y, cam.z - n.z) < NEAR
      const g = res.groups[n.group]
      g.meshes[0].setMatrixAt(n.index, near ? o.matrix : zero)
      g.meshes[1].setMatrixAt(n.index, near ? zero : o.matrix)
      // contact shadow (lifted while hopping is not tracked: it stays on the ground)
      o.position.y = y + 0.07 // above the terrain mesh (log depth: no polygon offset)
      o.rotation.set(0, n.heading, 0)
      const sb = SPECIES[n.id].body === 'bird' ? 0.45 : 0.75
      o.scale.set(n.scale * sb, 1, n.scale * sb * 1.25)
      o.updateMatrix()
      res.shadows.setMatrixAt(k, o.matrix)
      // bubble
      const b = res.bubbles[k]
      n.bubble = Math.max(0, (n.bubble || 0) - dt)
      b.visible = n.bubble > 0
      if (b.visible) b.position.set(n.x, y + n.scale * 1.15 + 0.25 + 0.06 * Math.sin(t * 6), n.z)
    })
    for (const g of Object.values(res.groups)) g.meshes.forEach((m) => (m.instanceMatrix.needsUpdate = true))
    res.shadows.instanceMatrix.needsUpdate = true
  })

  return (
    <>
      {Object.values(res.groups).flatMap((g) => g.meshes.map((m, i) => <primitive key={`${g.list[0].id}${i}`} object={m} />))}
      <primitive object={res.shadows} />
      {res.bubbles.map((b, i) => (
        <primitive key={`b${i}`} object={b} />
      ))}
    </>
  )
}
