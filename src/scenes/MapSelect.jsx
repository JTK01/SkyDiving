import { lazy, Suspense, useEffect, useState } from 'react'
import { create } from 'zustand'
import { MAPS, getMap, isPlayable } from '../data/maps'
import { useMapAccess } from '../state/useMapAccess'
import { useAuth } from '../auth/AuthController'
import { useRouter, mapPath } from '../router/router'

// the WebGL preview is its own chunk, loaded when a map is first previewed
const MapPreviewCanvas = lazy(() => import('../three/preview/MapPreviewCanvas'))

/** UI selection (kept outside the component so it survives a route change) */
export const useMapSelection = create((set) => ({
  selectedId: null,
  select: (selectedId) => set({ selectedId }),
}))

function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden focusable="false">
      <path
        d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2h.5A1 1 0 0 1 13 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h.5Zm1.5 0h4V5a2 2 0 1 0-4 0v2Z"
        fill="currentColor"
      />
    </svg>
  )
}

function Thumb({ map }) {
  if (map.thumbnail) return <img className="map-card__thumb" src={map.thumbnail} alt="" loading="lazy" />
  return (
    <span className="map-card__thumb map-card__thumb--empty" aria-hidden>
      <svg viewBox="0 0 48 24" width="34">
        <path d="M14 18a6 6 0 0 1 1-11.9A8 8 0 0 1 30.5 7 5.5 5.5 0 1 1 34 18Z" fill="currentColor" />
      </svg>
    </span>
  )
}

function MapCard({ map, selected, locked, mine, onSelect, disabled }) {
  const soon = !isPlayable(map)
  return (
    <li>
      <button
        type="button"
        className={`map-card${selected ? ' is-selected' : ''}${soon ? ' is-soon' : ''}`}
        onClick={() => onSelect(map)}
        aria-pressed={selected}
        disabled={disabled}
      >
        <span className="map-card__media">
          <Thumb map={map} />
          {mine && <span className="map-chip map-chip--mine">MY</span>}
        </span>
        <span className="map-card__text">
          <span className="map-card__name">{map.name}</span>
          <span className="map-card__sub">{soon ? 'COMING SOON' : `${map.nameEn} · ${map.location}`}</span>
        </span>
        <span className="map-card__badges">
          {locked && (
            <span className="map-card__lock" title="잠김" aria-label="잠김">
              <LockIcon />
            </span>
          )}
        </span>
      </button>
    </li>
  )
}

function Preview({ map, locked, onClose }) {
  const navigate = useRouter((s) => s.navigate)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => setLoaded(false), [map.id])
  const playable = isPlayable(map) && map.preview
  const canEnter = playable && !locked

  return (
    <section className="map-preview" aria-label={`${map.name} 미리보기`}>
      <header className="map-preview__head">
        <div>
          <h2>{map.name}</h2>
          <p>{playable ? `${map.nameEn} · ${map.location}` : '새로운 낙하 지점을 준비하고 있어요'}</p>
        </div>
        <button type="button" className="map-preview__close" onClick={onClose} aria-label="미리보기 닫기">
          ×
        </button>
      </header>

      <div className="map-preview__view">
        {playable ? (
          <>
            <Suspense fallback={null}>
              <MapPreviewCanvas sceneKey={map.preview.scene} onReady={() => setLoaded(true)} />
            </Suspense>
            {!loaded && <div className="map-preview__loading">LOADING VIEW…</div>}
          </>
        ) : (
          <div className="map-preview__soon">
            <span>COMING SOON</span>
            <p>준비 중인 맵입니다</p>
          </div>
        )}
      </div>

      <footer className="map-preview__foot">
        <span className="map-preview__note">
          {!playable ? '준비 중' : locked ? '잠긴 맵 · 포인트로 해금 예정' : '원거리 전경 미리보기'}
        </span>
        <button type="button" className="map-preview__enter" disabled={!canEnter} onClick={() => navigate(mapPath(map.id))}>
          {locked && playable ? (
            <>
              <LockIcon /> 잠김
            </>
          ) : (
            '입장'
          )}
        </button>
      </footer>
    </section>
  )
}

/**
 * Map selection for the post-login world: a translucent panel fixed to the
 * left listing every map from data/maps.js, and a long-range preview of the
 * selected map beside it with an "입장" (enter) button.
 */
export default function MapSelect({ disabled }) {
  const { user } = useAuth()
  const { loadFor, registerPick, firstPickId, unlockedIds } = useMapAccess()
  const { selectedId, select } = useMapSelection()
  const selected = getMap(selectedId)

  useEffect(() => {
    loadFor(user?.id ?? null)
  }, [user?.id, loadFor])

  // Esc closes the preview
  useEffect(() => {
    if (!selected) return
    const onKey = (e) => e.key === 'Escape' && select(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, select])

  const lockedOf = (id) => firstPickId !== null && !unlockedIds.includes(id)
  const onSelect = (map) => {
    if (isPlayable(map)) registerPick(map.id) // the first playable pick becomes the user's map
    select(map.id === selectedId ? null : map.id)
  }

  return (
    <>
      <nav className="map-panel" aria-label="맵 선택" data-hud>
        <div className="map-panel__head">
          <span className="map-panel__eyebrow">DROP ZONES</span>
          <h2>맵 선택</h2>
        </div>
        <ul className="map-panel__list">
          {MAPS.map((m) => (
            <MapCard
              key={m.id}
              map={m}
              selected={m.id === selectedId}
              locked={lockedOf(m.id)}
              mine={m.id === firstPickId}
              onSelect={onSelect}
              disabled={disabled}
            />
          ))}
        </ul>
      </nav>
      {selected && <Preview map={selected} locked={lockedOf(selected.id)} onClose={() => select(null)} />}
    </>
  )
}
