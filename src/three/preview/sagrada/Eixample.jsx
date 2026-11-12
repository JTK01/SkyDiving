import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

/**
 * Procedural Eixample (Barcelona) around the Sagrada Família, seen from far
 * above: a grid of chamfered ("octagonal") blocks, each a ring of 7–9 storey
 * buildings around an inner courtyard, tree-lined streets, Avinguda Diagonal
 * cutting across the grid and the two parks flanking the church.
 *
 * Units are metres. The church block sits at the origin; the grid is axis
 * aligned (nave along z, transept along x).
 */
export const BLOCK = 113 // block side (m)
export const STREET = 20 // street width (m)
export const PITCH = BLOCK + STREET
const CHAMFER = 20 // corner cut (m)

// blocks that are not ordinary housing (grid coordinates)
const CHURCH = '0,0'
const PARKS = { '1,0': 'gaudi', '-1,0': 'sagrada' } // Plaça de Gaudí (pond), Plaça de la Sagrada Família

// Avinguda Diagonal: a 50 m wide avenue crossing the grid at 45°
const DIAGONAL = { a: 1, b: -1, c: -3.4 * PITCH, half: 32 } // a·x + b·z + c = 0

function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const diagDist = (x, z) => {
  const n = Math.hypot(DIAGONAL.a, DIAGONAL.b)
  return Math.abs(DIAGONAL.a * x + DIAGONAL.b * z + DIAGONAL.c) / n
}

// warm Mediterranean palette
const FACADES = ['#e6d6bd', '#dcc7a4', '#efe3cf', '#d2b48f', '#c9a27c', '#e8cfae', '#b9b0a2', '#d8c2a8']
const ROOFS = ['#b06a4a', '#c08a68', '#a59a8c', '#c9bba7', '#bfae96', '#9a8f84', '#d0c3ae', '#b57a58']
const COURTS = ['#7c8a5a', '#8d8b7c', '#6f7d4f', '#9a9283', '#a39684']

/** chamfered square outline, used for block pavements */
function blockShape(size, chamfer) {
  const h = size / 2
  const c = chamfer
  const s = new THREE.Shape()
  s.moveTo(-h + c, -h)
  s.lineTo(h - c, -h)
  s.lineTo(h, -h + c)
  s.lineTo(h, h - c)
  s.lineTo(h - c, h)
  s.lineTo(-h + c, h)
  s.lineTo(-h, h - c)
  s.lineTo(-h, -h + c)
  s.closePath()
  return s
}

/**
 * Generates the instance transforms / colours for the whole district.
 * radius: city radius in metres (quality-dependent).
 */
function buildCity({ radius, treeSpacing, treeRadius }) {
  const r = rng(1882) // year the first stone was laid
  const bodies = [] // { x, z, w, d, h, rot, color }
  const roofs = []
  const pavements = [] // { x, z, color }
  const courts = []
  const trees = [] // { x, z, s, color }
  const parks = [] // { x, z, kind }

  const n = Math.ceil(radius / PITCH)
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const cx = i * PITCH
      const cz = j * PITCH
      const dist = Math.hypot(cx, cz)
      if (dist > radius) continue
      const key = `${i},${j}`
      pavements.push({ x: cx, z: cz })
      if (key === CHURCH) continue
      if (PARKS[key]) {
        parks.push({ x: cx, z: cz, kind: PARKS[key] })
        continue
      }
      if (diagDist(cx, cz) < DIAGONAL.half) continue // block entirely on the avenue

      // building ring: 4 straight sides split into lots, 4 chamfer buildings
      const depth = 20 + r() * 6
      const baseH = 17 + r() * 8 // a block shares a cornice height
      const sideLen = BLOCK - 2 * CHAMFER
      for (let side = 0; side < 4; side++) {
        const rot = (side * Math.PI) / 2
        const cos = Math.cos(rot)
        const sin = Math.sin(rot)
        let u = -sideLen / 2
        while (u < sideLen / 2 - 4) {
          const w = Math.min(10 + r() * 16, sideLen / 2 - u)
          const h = baseH + (r() - 0.5) * 7
          // local: along the side (u), inward from the edge (v)
          const lu = u + w / 2
          const lv = BLOCK / 2 - depth / 2
          const bx = cx + lu * cos - lv * sin
          const bz = cz + lu * sin + lv * cos
          u += w
          // the Diagonal cuts blocks into wedges, like the real avenue
          if (diagDist(bx, bz) < DIAGONAL.half + 8) continue
          bodies.push({
            x: bx,
            z: bz,
            w: w - 0.6,
            d: depth,
            h,
            rot: -rot,
            color: FACADES[Math.floor(r() * FACADES.length)],
            roof: ROOFS[Math.floor(r() * ROOFS.length)],
          })
        }
        // chamfer corner building
        const ca = rot + Math.PI / 4
        const cd = (BLOCK / 2 - CHAMFER * 0.35) * Math.SQRT2 * 0.72
        const kx = cx + Math.cos(ca) * cd
        const kz = cz + Math.sin(ca) * cd
        if (diagDist(kx, kz) < DIAGONAL.half + 8) continue
        bodies.push({
          x: kx,
          z: kz,
          w: CHAMFER * 1.5,
          d: depth,
          h: baseH + 2 + r() * 4,
          rot: -ca + Math.PI / 2,
          color: FACADES[Math.floor(r() * FACADES.length)],
          roof: ROOFS[Math.floor(r() * ROOFS.length)],
        })
      }
      // courtyard: gardens or low roofs
      if (diagDist(cx, cz) > DIAGONAL.half + 30) courts.push({ x: cx, z: cz, color: COURTS[Math.floor(r() * COURTS.length)], h: 2 + r() * 5 })
    }
  }

  // roof slabs: a thin, slightly inset cap with the roof colour
  for (const b of bodies) roofs.push({ ...b, w: b.w - 1.2, d: b.d - 1.2, y: b.h, h: 1.4 })

  // street trees (plane trees) along both kerbs of every street
  const tr = treeRadius
  const kerb = BLOCK / 2 + 3
  for (let line = -Math.ceil(tr / PITCH); line <= Math.ceil(tr / PITCH); line++) {
    for (const off of [-kerb, kerb]) {
      const pos = line * PITCH + off
      for (let t = -tr; t <= tr; t += treeSpacing) {
        // skip intersections
        const local = ((t % PITCH) + PITCH * 1.5) % PITCH - PITCH / 2
        if (Math.abs(local) > BLOCK / 2 - 6) continue
        for (const [x, z] of [
          [t, pos],
          [pos, t],
        ]) {
          if (Math.hypot(x, z) > tr) continue
          if (Math.abs(x) < PITCH * 0.6 && Math.abs(z) < PITCH * 0.6) continue // around the church
          trees.push({ x: x + (r() - 0.5) * 2, z: z + (r() - 0.5) * 2, s: 3.2 + r() * 1.6 })
        }
      }
    }
  }
  // Diagonal avenue trees (double rows). Centreline: x − z + c = 0,
  // direction (1, 1)/√2, normal (1, −1)/√2.
  const k = Math.SQRT1_2
  for (let t = -tr * 1.4; t <= tr * 1.4; t += treeSpacing) {
    const bx = -DIAGONAL.c / 2 + t * k
    const bz = DIAGONAL.c / 2 + t * k
    for (const o of [-14, -6, 6, 14]) {
      const x = bx + o * k
      const z = bz - o * k
      if (Math.hypot(x, z) < tr) trees.push({ x, z, s: 3.4 + r() * 1.4 })
    }
  }
  // parks: dense tree cover, a pond in Plaça de Gaudí
  for (const p of parks) {
    for (let k = 0; k < 150; k++) {
      const x = (r() - 0.5) * (BLOCK - 14)
      const z = (r() - 0.5) * (BLOCK - 14)
      if (p.kind === 'gaudi' && (x / 34) ** 2 + ((z - 4) / 22) ** 2 < 1) continue // pond
      if (Math.abs(x) + Math.abs(z) > BLOCK * 0.75) continue // chamfers
      trees.push({ x: p.x + x, z: p.z + z, s: 4 + r() * 3 })
    }
  }
  return { bodies, roofs, pavements, courts, trees, parks }
}

/** facade window grid, added to MeshStandardMaterial (fades out with distance) */
function windowShader(shader) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
    .replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
       vec4 wp = vec4(transformed, 1.0);
       #ifdef USE_INSTANCING
         wp = instanceMatrix * wp;
       #endif
       wp = modelMatrix * wp;
       vWPos = wp.xyz;
       vWNrm = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);`,
    )
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
       if (abs(vWNrm.y) < 0.5) {
         vec3 tang = normalize(cross(vec3(0.0, 1.0, 0.0), vWNrm));
         float u = dot(vWPos, tang) / 3.4;           // window bays
         float v = (vWPos.y - 1.0) / 3.1;            // storeys
         float fw = max(fwidth(u), fwidth(v));
         float win = step(0.3, fract(u)) * step(0.35, fract(v)) * step(1.0, vWPos.y - 3.0);
         float fade = 1.0 - smoothstep(0.25, 0.7, fw); // no shimmer far away
         diffuseColor.rgb *= 1.0 - win * 0.32 * fade - (1.0 - fade) * 0.1;
         diffuseColor.rgb *= mix(0.78, 1.0, smoothstep(0.0, 12.0, vWPos.y)); // street-level shade
       }`,
    )
}

/**
 * Ground beyond the modelled blocks: the same chamfered grid painted flat
 * (roof colours hashed per block, courtyards darker). From 1 km+ away and
 * under the haze it reads as the city continuing to the horizon.
 */
function farCityShader(shader) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vGround;')
    .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGround = (modelMatrix * vec4(transformed, 1.0)).xz;')
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vGround;')
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
       {
         vec2 g = vGround / ${PITCH.toFixed(1)} + 0.5;
         vec2 cell = floor(g);
         vec2 l = (fract(g) - 0.5) * ${PITCH.toFixed(1)};
         vec2 a = abs(l);
         float hb = ${(BLOCK / 2).toFixed(1)};
         float inBlock = step(a.x, hb) * step(a.y, hb) * step(a.x + a.y, hb * 2.0 - ${CHAMFER.toFixed(1)});
         float court = step(a.x, hb - 26.0) * step(a.y, hb - 26.0);
         float h = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
         vec2 sub = floor(l / 12.0);
         float h2 = fract(sin(dot(sub + cell * 7.0, vec2(39.3, 11.7))) * 24634.63);
         vec3 roof = mix(vec3(0.69, 0.47, 0.36), vec3(0.8, 0.74, 0.65), h2);
         roof = mix(roof, vec3(0.62, 0.58, 0.54), step(0.8, h));
         vec3 courtCol = mix(vec3(0.45, 0.5, 0.33), vec3(0.55, 0.52, 0.47), h);
         vec3 blockCol = mix(roof, courtCol, court) * 0.86;
         // façades in shade along the block edges, darker courtyard rims
         float edge = max(a.x, a.y);
         blockCol *= mix(1.0, 0.62, smoothstep(hb - 5.0, hb - 1.0, edge));
         blockCol *= mix(1.0, 0.7, (1.0 - court) * step(max(a.x, a.y), hb - 20.0));
         // (inside the modelled radius the block pavements cover this)
         diffuseColor.rgb = mix(diffuseColor.rgb, blockCol, inBlock);
       }`,
    )
}

function Instanced({ items, geometry, material, apply, castShadow, receiveShadow }) {
  const ref = useRef()
  useLayoutEffect(() => {
    const m = ref.current
    const o = new THREE.Object3D()
    const c = new THREE.Color()
    items.forEach((it, i) => {
      apply(o, c, it)
      o.updateMatrix()
      m.setMatrixAt(i, o.matrix)
      m.setColorAt(i, c)
    })
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    m.computeBoundingSphere()
  }, [items, apply])
  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, items.length]}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
    />
  )
}

export default function Eixample({ quality }) {
  const low = quality.tier === 'low'
  const city = useMemo(
    () =>
      buildCity({
        radius: low ? 1250 : 1600,
        treeRadius: low ? 520 : 900,
        treeSpacing: low ? 15 : 10,
      }),
    [low],
  )

  const res = useMemo(() => {
    const box = new THREE.BoxGeometry(1, 1, 1)
    box.translate(0, 0.5, 0)
    const body = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 })
    body.onBeforeCompile = windowShader
    const flat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 })
    const pave = new THREE.ExtrudeGeometry(blockShape(BLOCK, CHAMFER), { depth: 0.4, bevelEnabled: false })
    pave.rotateX(-Math.PI / 2)
    const tree = new THREE.IcosahedronGeometry(1, 0)
    tree.scale(1, 0.85, 1)
    const treeMat = new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true })
    const ground = new THREE.MeshStandardMaterial({ color: '#77716a', roughness: 1 })
    ground.onBeforeCompile = farCityShader
    return { box, body, flat, pave, tree, treeMat, ground }
  }, [])

  const apply = useMemo(
    () => ({
      body: (o, c, b) => {
        o.position.set(b.x, 0, b.z)
        o.rotation.set(0, b.rot, 0)
        o.scale.set(b.w, b.h, b.d)
        c.set(b.color)
      },
      roof: (o, c, b) => {
        o.position.set(b.x, b.y, b.z)
        o.rotation.set(0, b.rot, 0)
        o.scale.set(b.w, b.h, b.d)
        c.set(b.roof)
      },
      pave: (o, c, p) => {
        o.position.set(p.x, 0, p.z)
        o.rotation.set(0, 0, 0)
        o.scale.set(1, 1, 1)
        c.set('#cbbfae')
      },
      court: (o, c, p) => {
        o.position.set(p.x, 0, p.z)
        o.rotation.set(0, 0, 0)
        o.scale.set(BLOCK - 52, p.h, BLOCK - 52)
        c.set(p.color)
      },
      tree: (o, c, t) => {
        o.position.set(t.x, t.s * 1.6, t.z)
        o.rotation.set(0, t.x * 0.13, 0)
        o.scale.setScalar(t.s)
        c.setHSL(0.24 + ((t.x * 7.1 + t.z * 3.3) % 1) * 0.05, 0.38, 0.27 + ((t.x + t.z) % 1) * 0.06)
      },
    }),
    [],
  )

  return (
    <group>
      {/* asphalt + the far city as a flat block pattern beyond the 3D blocks */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, -0.05, 0]} material={res.ground}>
        <planeGeometry args={[16000, 16000]} />
      </mesh>
      {/* Diagonal avenue: lighter boulevard surface */}
      <group position={[-DIAGONAL.c / 2, 0.5, DIAGONAL.c / 2]} rotation={[0, Math.PI / 4, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[60, 4200]} />
          <meshStandardMaterial color="#8a837a" roughness={1} />
        </mesh>
      </group>
      <Instanced items={city.pavements} geometry={res.pave} material={res.flat} apply={apply.pave} receiveShadow />
      <Instanced items={city.courts} geometry={res.box} material={res.flat} apply={apply.court} receiveShadow />
      <Instanced items={city.bodies} geometry={res.box} material={res.body} apply={apply.body} castShadow receiveShadow />
      <Instanced items={city.roofs} geometry={res.box} material={res.flat} apply={apply.roof} receiveShadow />
      <Instanced items={city.trees} geometry={res.tree} material={res.treeMat} apply={apply.tree} castShadow />
      {city.parks.map((p) => (
        <group key={p.kind} position={[p.x, 0.45, p.z]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[BLOCK - 8, BLOCK - 8]} />
            <meshStandardMaterial color="#6d7a45" roughness={1} />
          </mesh>
          {p.kind === 'gaudi' && (
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.1, 4]} scale={[34, 22, 1]}>
              <circleGeometry args={[1, 40]} />
              <meshStandardMaterial color="#4f7f8c" roughness={0.25} metalness={0.1} />
            </mesh>
          )}
        </group>
      ))}
    </group>
  )
}
