import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useQuality, preset } from './quality'
import { getMapData, releaseMapData } from './data/MapData'
import MapWorld from './world/MapWorld'
import DropController, { createDropState } from './play/DropController'
import { loadCollisionWorld } from './play/collision'
import { BASILICA_COLLIDERS_URL } from './world/Basilica'
import PlayHud from './play/PlayHud'

/**
 * One map's world on screen — the long-range preview, the entry transition
 * and the skydive all use this single canvas and data cache.
 *
 * Preview shows its first frame from the coarsest terrain only, then streams
 * finer terrain (up to L4), mid-zone and near-zone buildings; the capture
 * image of the same viewpoint is shown until that first frame.
 * Unmounting (panel closed, another map) disposes the WebGL context and
 * releases the tile cache.
 */
export function useEssentials(data, mode) {
  const [manifest, setManifest] = useState(null)
  const [ready, setReady] = useState({ preview: false, play: false })
  useEffect(() => {
    let live = true
    data.manifest().then(async (m) => {
      if (!live) return
      setManifest(m)
      // first frame: the two coarsest terrain levels only (≈100 kB); finer
      // terrain, mid-zone and near-zone buildings stream in afterwards
      const coarse = m.terrain.levels.filter((l) => l.level <= 1).flatMap((l) => l.tiles.map(([i, j]) => data.terrainTile(l.level, i, j)))
      await Promise.all(coarse)
      if (live) setReady((r) => ({ ...r, preview: true }))
    })
    return () => {
      live = false
    }
  }, [data])
  useEffect(() => {
    if (mode === 'preview') return
    let live = true
    Promise.all([data.manifest(), data.nearBuildings(), data.features()]).then(() => live && setReady((r) => ({ ...r, play: true })))
    return () => {
      live = false
    }
  }, [data, mode])
  return { manifest, ready }
}

/** orbit pose at time t (s) */
function orbitPose(orbit, groundY, t, out) {
  const a = THREE.MathUtils.degToRad(orbit.startDeg) + (t / orbit.period) * Math.PI * 2
  out.position.set(Math.sin(a) * orbit.radius, groundY + orbit.altitude, Math.cos(a) * orbit.radius)
  out.lookAt(0, groundY + orbit.lookAt, 0)
  return out
}

/** preview: slow orbit around the landmark (no user control) */
function PreviewOrbit({ orbit, groundY, clock }) {
  const camera = useThree((s) => s.camera)
  useFrame((_, dt) => {
    if (!window.__skydive?.orbitFrozen) clock.t += dt // ?debug: frozen for the capture image
    orbitPose(orbit, groundY, clock.t, camera)
    if (camera.fov !== orbit.fov) {
      camera.fov = orbit.fov
      camera.updateProjectionMatrix()
    }
  })
  return null
}

/** entering: fly from the current (orbit) pose to the drop start pose */
function EnterFlight({ to, fov, duration = 2.6, onDone }) {
  const camera = useThree((s) => s.camera)
  const st = useRef(null)
  useFrame(() => {
    // wall-clock time: the flight takes `duration` s even on slow frames
    if (!st.current) st.current = { start: performance.now(), p0: camera.position.clone(), q0: camera.quaternion.clone(), f0: camera.fov }
    const s = st.current
    s.t = Math.min(duration, (performance.now() - s.start) / 1000)
    const k = s.t / duration
    const e = k * k * (3 - 2 * k)
    // rise a little mid-way so the path arcs over the city
    camera.position.lerpVectors(s.p0, to.position, e)
    camera.position.y += Math.sin(Math.PI * e) * 250
    camera.quaternion.slerpQuaternions(s.q0, to.quaternion, e)
    camera.fov = s.f0 + (fov - s.f0) * e
    camera.updateProjectionMatrix()
    if (s.t >= duration && !s.done) {
      s.done = true
      onDone()
    }
  })
  return null
}

/** turn the shadow map on/off when the preset changes (materials recompile) */
function ShadowSwitch({ enabled }) {
  const { gl, scene } = useThree()
  useEffect(() => {
    if (gl.shadowMap.enabled === enabled) return
    gl.shadowMap.enabled = enabled
    scene.traverse((o) => {
      if (o.material) [].concat(o.material).forEach((m) => (m.needsUpdate = true))
    })
  }, [gl, scene, enabled])
  return null
}

function dropPose(state) {
  const o = new THREE.Object3D()
  o.rotation.order = 'YXZ'
  o.position.set(state.x, state.y, state.z)
  o.rotation.set(state.pitch, state.yaw, 0)
  o.updateMatrixWorld()
  return o
}

function useStageRect(mode, anchor, fromRect) {
  const [rect, setRect] = useState(() => (mode === 'entering' ? fromRect : anchor?.getBoundingClientRect().toJSON()) || null)
  useLayoutEffect(() => {
    if (mode !== 'preview' || !anchor) return
    const update = () => setRect(anchor.getBoundingClientRect().toJSON())
    update()
    const ro = new ResizeObserver(update)
    ro.observe(anchor)
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [mode, anchor])
  useEffect(() => {
    if (mode === 'entering') {
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setRect(null))) // → full screen (CSS transition)
      return () => cancelAnimationFrame(id)
    }
    if (mode === 'play') setRect(null)
  }, [mode])
  return rect
}

export default function MapStage({ map, mode, anchor, fromRect, onEntered, onExit }) {
  const quality = useQuality((q) => q.name)
  const resolveQuality = useQuality((q) => q.resolve)
  const dpr = useQuality((q) => q.dpr) ?? 1
  const data = useMemo(() => getMapData(map.world.tiles), [map.world.tiles])
  useEffect(() => () => releaseMapData(map.world.tiles), [map.world.tiles]) // free the cache when the stage goes away
  const { manifest, ready } = useEssentials(data, mode)
  const drop = map.world.drop
  const orbit = map.preview.orbit
  const clock = useRef({ t: 0 }).current
  const state = useMemo(() => manifest && createDropState(drop, manifest.frame.groundY, map.world.landmark.rotationDeg), [manifest, drop, map])
  const [world, setWorld] = useState(null)
  useEffect(() => {
    if (mode !== 'play' || !ready.play || !manifest) return
    let live = true
    loadCollisionWorld(data, manifest, { landmark: map.world.landmark, radius: drop.radius, collidersUrl: BASILICA_COLLIDERS_URL }).then((w) => live && setWorld(w))
    return () => {
      live = false
    }
  }, [mode, ready.play, manifest, data, map, drop])
  if (state && typeof window !== 'undefined' && window.__skydive) window.__skydive.drop = { state, data, world }
  const [ended, setEnded] = useState(false)
  const [run, setRun] = useState(0)
  const [firstFrame, setFirstFrame] = useState(false)
  const rect = useStageRect(mode, anchor, fromRect)
  const playing = mode === 'play'
  const shown = ready.preview // the world is visible once coarse data is in; play waits for near data below

  const restart = () => {
    Object.assign(state, createDropState(drop, manifest.frame.groundY, map.world.landmark.rotationDeg))
    setEnded(false)
    setRun((r) => r + 1)
  }

  const style = rect
    ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height, borderRadius: 14 }
    : { left: 0, top: 0, width: '100%', height: '100%', borderRadius: 0 }

  return (
    <div className={`map-stage map-stage--${mode}`} style={style}>
      {map.preview.capture && mode !== 'play' && <img className="map-stage__capture" src={map.preview.capture} alt="" />}
      {manifest && (
        <Canvas
          className="map-stage__canvas"
          shadows={{ type: THREE.PCFSoftShadowMap }}
          dpr={dpr}
          gl={{ logarithmicDepthBuffer: true, antialias: false, powerPreference: 'high-performance', stencil: false }}
          camera={{ fov: orbit.fov, near: 0.25, far: 120000, position: [0, manifest.frame.groundY + orbit.altitude, orbit.radius] }}
          style={{ opacity: shown && firstFrame ? 1 : 0, pointerEvents: playing ? 'auto' : 'none' }}
          onCreated={({ camera, scene, gl }) => {
            gl.toneMapping = THREE.NeutralToneMapping
            gl.toneMappingExposure = 0.95
            resolveQuality(gl.domElement)
            if (mode !== 'preview') orbitPose(orbit, manifest.frame.groundY, 0, camera)
            if (window.__skydive) Object.assign(window.__skydive, { mapCamera: camera, mapScene: scene, mapGL: gl })
          }}
        >
          {ready.preview && quality && (
            <MapWorld map={map} data={data} manifest={manifest} mode={mode === 'preview' ? 'preview' : 'play'} quality={quality} onStats={(st) => !firstFrame && st.drawn > 0 && setFirstFrame(true)} />
          )}
          {mode === 'preview' && <PreviewOrbit orbit={orbit} groundY={manifest.frame.groundY} clock={clock} />}
          {mode === 'entering' && ready.preview && <EnterFlight to={dropPose(state)} fov={70} onDone={onEntered} />}
          <ShadowSwitch enabled={playing && preset(quality).shadows > 0} />
          {playing && <DropController key={run} drop={drop} world={world} state={state} enabled={ready.play && !!world} onEnd={() => setEnded(true)} />}
        </Canvas>
      )}
      {playing && !(ready.play && world) && <div className="map-stage__loading">LOADING DROP ZONE…</div>}
      {playing && ready.play && world && <PlayHud map={map} manifest={manifest} state={state} ended={ended} onRestart={restart} onExit={onExit} />}
    </div>
  )
}
