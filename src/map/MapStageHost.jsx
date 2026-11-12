import { lazy, Suspense, useEffect } from 'react'
import { getMap } from '../data/maps'
import { useMapStage } from './useMapStage'
import { useRouter } from '../router/router'
import { useMapSelection } from '../scenes/MapSelect'

const MapStage = lazy(() => import('./MapStage'))

/**
 * App-level host of the map world, so the same canvas & cache survive the
 * move from the map panel (preview) to the map route (play).
 */
export default function MapStageHost() {
  const { mapId, mode, anchor, fromRect, play, hide } = useMapStage()
  const navigate = useRouter((s) => s.navigate)
  const route = useRouter((s) => s.route)
  // leaving the map route (exit button, browser back) ends play
  useEffect(() => {
    if ((mode === 'play' || mode === 'entering') && route.name !== 'map') hide()
  }, [mode, route.name, hide])
  const map = getMap(mapId)
  if (!map?.world) return null
  return (
    <Suspense fallback={null}>
      <MapStage
        key={map.id}
        map={map}
        mode={mode}
        anchor={anchor}
        fromRect={fromRect}
        onEntered={() => play(map.id)}
        onExit={() => {
          useMapSelection.getState().select(null) // back to the panel without reopening the preview
          hide()
          navigate('/')
        }}
      />
    </Suspense>
  )
}
