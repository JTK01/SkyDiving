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
        nearFade={play && nearReady ? 1 : 0}
        maxTiles={low ? 80 : 140}
        onStats={onStats}
      />
      <MidBuildings data={data} manifest={manifest} />
      {play && <NearBuildings data={data} />}
      {play && <Features data={data} treeStride={low ? 3 : 1} />}
      <Basilica position={[lm.x, manifest.frame.groundY, lm.z]} rotation={[0, THREE.MathUtils.degToRad(lm.rotationDeg), 0]} />
    </>
  )
}
