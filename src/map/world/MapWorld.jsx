import { useEffect, useState } from 'react'
import * as THREE from 'three'
import Atmosphere from './Atmosphere'
import Terrain from './Terrain'
import { MidBuildings, NearBuildings } from './Buildings'
import Features from './Features'
import Basilica from './Basilica'

/**
 * One map's world: atmosphere, streamed terrain, buildings, near-zone ground
 * detail and the landmark. Shared by the map preview (mode 'preview': far &
 * mid detail only) and the playable map (mode 'play': everything).
 */
export default function MapWorld({ map, data, manifest, mode, quality, onStats }) {
  const play = mode === 'play'
  const low = quality.tier === 'low'
  const [nearReady, setNearReady] = useState(false)
  // preview: terrain alone makes the first frame; then mid-zone boxes, then
  // the near-zone footprints (60 kB) so the city around the landmark is
  // complete. Roads & trees stay play-only.
  const [stage, setStage] = useState(play ? 2 : 0) // 0 terrain · 1 + mid · 2 + near
  const [drawn, setDrawn] = useState(false)
  useEffect(() => {
    if (play) setStage(2)
  }, [play])
  useEffect(() => {
    if (!drawn || stage >= 2) return
    const id = setTimeout(() => setStage((x) => x + 1), stage === 0 ? 100 : 700)
    return () => clearTimeout(id)
  }, [drawn, stage])
  const stats = (st) => {
    if (st.drawn > 0 && !drawn) setDrawn(true)
    onStats?.(st)
  }
  useEffect(() => {
    if (!play) return
    let live = true
    Promise.all([data.nearBuildings(), data.features()]).then(() => live && setNearReady(true))
    return () => {
      live = false
    }
  }, [play, data])

  const lm = map.world.landmark
  return (
    <>
      <Atmosphere shadows={play && !low} />
      <Terrain
        data={data}
        manifest={manifest}
        detail={play ? (low ? 1.25 : 1.7) : low ? 0.75 : 0.95}
        nearFade={0} // 25 cm orthophoto near the landmark: no procedural paving
        maxTiles={low ? 80 : 140}
        maxLevel={play ? 8 : 5} // L8 = 256 m tiles at 0.5 m/px; the preview stops at 4 m/px
        onStats={stats}
      />
      {stage >= 1 && <MidBuildings data={data} manifest={manifest} />}
      {stage >= 2 && <NearBuildings data={data} />}
      {play && <Features data={data} treeStride={low ? 3 : 1} />}
      <Basilica position={[lm.x, manifest.frame.groundY, lm.z]} rotation={[0, THREE.MathUtils.degToRad(lm.rotationDeg), 0]} />
    </>
  )
}
