import { useState } from 'react'
import * as THREE from 'three'
import Atmosphere from './Atmosphere'
import Terrain from './Terrain'
import { MidBuildings, NearBuildings, useAtlas } from './Buildings'
import Features from './Features'
import Basilica from './Basilica'
import { PostFX, AutoResolution } from './Rendering'
import { preset } from '../quality'

/**
 * One map's world: atmosphere & lighting, streamed terrain, buildings, trees
 * and the landmark, plus post-processing and resolution control. Shared by
 * the map preview (mode 'preview': far & mid detail, no shadows) and the
 * playable map (mode 'play': everything the quality preset allows).
 */
export default function MapWorld({ map, data, manifest, mode, quality, onStats }) {
  const play = mode === 'play'
  const Q = preset(quality)
  const atlas = useAtlas()
  const [shadowVersion, setShadowVersion] = useState(0)
  const bump = () => setShadowVersion((v) => v + 1)
  // preview: terrain alone makes the first frame; then mid-zone boxes, then
  // the near-zone footprints so the city around the landmark is complete
  const [stage, setStage] = useState(play ? 2 : 0) // 0 terrain · 1 + mid · 2 + near
  const [drawn, setDrawn] = useState(false)
  if (play && stage < 2) setStage(2)
  const stats = (st) => {
    if (st.drawn > 0 && !drawn) {
      setDrawn(true)
      if (!play) setTimeout(() => setStage(1), 100)
      if (!play) setTimeout(() => setStage(2), 800)
    }
    onStats?.(st)
  }
  const lm = map.world.landmark
  const groundY = manifest.frame.groundY
  return (
    <>
      <Atmosphere shadowSize={play ? Q.shadows : 0} center={[lm.x, groundY, lm.z]} shadowVersion={shadowVersion} />
      <Terrain
        data={data}
        manifest={manifest}
        detail={play ? Q.terrainDetail : Q.terrainDetail * 0.6}
        maxTiles={Q.maxTiles}
        maxLevel={play ? 8 : 5} // L8 = 256 m tiles at 0.5 m/px; the preview stops at 4 m/px
        anisotropy={Q.anisotropy}
        onStats={stats}
      />
      {stage >= 1 && <MidBuildings data={data} manifest={manifest} atlas={atlas} maxDistance={play ? Q.midDistance : 2700} />}
      {stage >= 2 && <NearBuildings data={data} atlas={atlas} onLoaded={bump} onLevel={bump} />}
      {play && <Features data={data} treeStride={Q.treeStride} treeDistance={Q.treeDistance} onLoaded={bump} onLevel={bump} />}
      <Basilica position={[lm.x, groundY, lm.z]} rotation={[0, THREE.MathUtils.degToRad(lm.rotationDeg), 0]} onLoaded={bump} onLevel={bump} />
      {Q.bloom && <PostFX samples={Q.msaa} />}
      <AutoResolution quality={quality} />
    </>
  )
}
