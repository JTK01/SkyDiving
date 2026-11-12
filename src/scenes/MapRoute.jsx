import { useEffect } from 'react'
import { getMap, isPlayable } from '../data/maps'
import { useAuth } from '../auth/AuthController'
import { useMapAccess } from '../state/useMapAccess'
import { useRouter } from '../router/router'

/**
 * /maps/:id — destination of the "입장" button. The map itself (drop,
 * multiplayer) is the next milestone; for now this screen confirms the
 * route and leads back to the world.
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

  if (!decided || !allowed) return <div className="map-route" aria-busy />
  return (
    <section className="map-route" aria-label={map.name}>
      <div className="map-route__card">
        <span className="map-route__eyebrow">DROP ZONE</span>
        <h1>{map.name}</h1>
        <p className="map-route__sub">
          {map.nameEn} · {map.location}
        </p>
        <p className="map-route__note">맵 입장이 연결되었습니다. 낙하 콘텐츠는 다음 단계에서 구현됩니다.</p>
        <button type="button" className="btn btn--primary" onClick={() => navigate('/')}>
          맵 선택으로 돌아가기
        </button>
      </div>
    </section>
  )
}
