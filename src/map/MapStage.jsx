import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { usePerformanceTier } from '../hooks/usePerformanceTier'
import { getMapData } from './data/MapData'
import MapWorld from './world/MapWorld'
import DropController, { createDropState } from './play/DropController'
import PlayHud from './play/PlayHud'

/**
 * Hosts one map's WebGL world. mode 'play' = the skydive; the preview mode
 * reuses the same world (see MapPreview).
 *
 * Essential data is preloaded before the world is shown: manifest, coarse
 * terrain (L0–L2), mid-zone buildings and — for play — near buildings and
 * near features. Finer terrain streams in afterwards by camera position.
 */
export function useEssentials(map, mode) {
  const data = useMemo(() => getMapData(map.world.tiles), [map.world.tiles])
  const [manifest, setManifest] = useState(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let live = true
    setReady(false)
    data.manifest().then(async (m) => {
      if (!live) return
      setManifest(m)
      const coarse = m.terrain.levels.filter((l) => l.level <= 2).flatMap((l) => l.tiles.map(([i, j]) => data.terrainTile(l.level, i, j)))
      const mid = m.buildings.mid.tiles.map((t) => data.midTile(t.file))
      const near = mode === 'play' ? [data.nearBuildings(), data.features()] : []
      await Promise.all([...coarse, ...mid, ...near])
      if (live) setReady(true)
    })
    return () => {
      live = false
    }
  }, [data, mode])
  return { data, manifest, ready }
}

export default function MapStage({ map, onExit }) {
  const quality = usePerformanceTier()
  const { data, manifest, ready } = useEssentials(map, 'play')
  const drop = map.world.drop
  const state = useMemo(() => manifest && createDropState(drop, manifest.frame.groundY, map.world.landmark.rotationDeg), [manifest, drop, map])
  if (state && typeof window !== 'undefined' && window.__skydive) window.__skydive.drop = { state, data }
  const [ended, setEnded] = useState(false)
  const [run, setRun] = useState(0)
  const restart = () => {
    Object.assign(state, createDropState(drop, manifest.frame.groundY, map.world.landmark.rotationDeg))
    setEnded(false)
    setRun((r) => r + 1)
  }
  const wrap = useRef()

  return (
    <div className="map-stage" ref={wrap}>
      {manifest && (
        <Canvas
          className="map-stage__canvas"
          flat
          shadows={quality.tier !== 'low'}
          dpr={quality.tier === 'low' ? [0.75, 1] : [1, 1.5]}
          gl={{ logarithmicDepthBuffer: true, antialias: quality.tier !== 'low', powerPreference: 'high-performance' }}
          camera={{ fov: 70, near: 1, far: 120000, position: [0, manifest.frame.groundY + drop.altitude, 0] }}
          style={{ opacity: ready ? 1 : 0 }}
        >
          <MapWorld map={map} data={data} manifest={manifest} mode="play" quality={quality} />
          <DropController key={run} drop={drop} groundY={manifest.frame.groundY} state={state} enabled={ready} onEnd={() => setEnded(true)} />
        </Canvas>
      )}
      {!ready && <div className="map-stage__loading">LOADING DROP ZONE…</div>}
      {ready && <PlayHud map={map} manifest={manifest} state={state} ended={ended} onRestart={restart} onExit={onExit} />}
    </div>
  )
}
