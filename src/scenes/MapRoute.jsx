import { useEffect } from 'react'
import { getMap, isPlayable } from '../data/maps'
import { useAuth } from '../auth/AuthController'
import { useMapAccess } from '../state/useMapAccess'
import { useRouter } from '../router/router'
import { useMapStage } from '../map/useMapStage'

/**
 * /maps/:id — destination of the "입장" button: the skydive on the map's
 * 3D world (MapStage, hosted by MapStageHost).
 *
 * Guards: requires a signed-in user (waits for session restore) and a
 * playable, unlocked map; otherwise it redirects to the world.
 */
export default function MapRoute({ id }) {
  const { user, ready } = useAuth()
  const navigate = useRouter((s) => s.navigate)
  const { loadFor, isLocked, userId } = useMapAccess()
  const map = getMap(id)

  useEffect(() => {
    if (user && userId !== user.id) loadFor(user.id)
  }, [user, userId, loadFor])

  const allowed = !!user && isPlayable(map) && userId === user.id && !isLocked(map.id)
  const decided = ready && (!user || userId === user.id)

  useEffect(() => {
    if (decided && !allowed) navigate('/', { replace: true })
  }, [decided, allowed, navigate])

  // show the map world in play mode (unless it is already flying in from
  // the preview — same canvas, same cache). MapStageHost renders it.
  useEffect(() => {
    if (!decided || !allowed || !map.world) return
    const st = useMapStage.getState()
    if (!(st.mapId === map.id && (st.mode === 'entering' || st.mode === 'play'))) st.play(map.id)
  }, [decided, allowed, map])

  if (!decided || !allowed) return <div className="map-route" aria-busy />
  if (map.world) return null // rendered by MapStageHost
  return (
    <section className="map-route" aria-label={map.name}>
      <div className="map-route__card">
        <span className="map-route__eyebrow">DROP ZONE</span>
        <h1>{map.name}</h1>
        <p className="map-route__note">이 맵은 아직 준비 중입니다.</p>
        <button type="button" className="btn btn--primary" onClick={() => navigate('/')}>
          맵 선택으로 돌아가기
        </button>
      </div>
    </section>
  )
}
