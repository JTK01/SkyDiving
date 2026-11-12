import { useEffect, useRef } from 'react'
import Credits from './Credits'

/** skydive HUD: altitude above ground, fall speed, distance from the landmark */
export default function PlayHud({ map, manifest, state, ended, onRestart, onExit }) {
  const alt = useRef()
  const spd = useRef()
  const dist = useRef()
  useEffect(() => {
    let id
    const tick = () => {
      if (alt.current) {
        alt.current.textContent = Math.max(0, Math.round(state.y - manifest.frame.groundY)).toLocaleString('en-US')
        spd.current.textContent = Math.round(state.vy * 3.6)
        dist.current.textContent = Math.round(Math.hypot(state.x, state.z))
      }
      id = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(id)
  }, [state, manifest])

  return (
    <div className="play-hud">
      <header className="play-hud__top">
        <div>
          <span className="play-hud__eyebrow">DROP ZONE</span>
          <strong>{map.name}</strong>
        </div>
        <button type="button" className="play-hud__exit" onClick={onExit}>
          맵 선택
        </button>
      </header>
      <dl className="play-hud__stats">
        <div>
          <dt>ALTITUDE</dt>
          <dd>
            <span ref={alt} />
            <small> M AGL</small>
          </dd>
        </div>
        <div>
          <dt>FREEFALL</dt>
          <dd>
            <span ref={spd} />
            <small> KM/H</small>
          </dd>
        </div>
        <div>
          <dt>FROM LANDMARK</dt>
          <dd>
            <span ref={dist} />
            <small> / {map.world.drop.radius} M</small>
          </dd>
        </div>
      </dl>
      <p className="play-hud__hint">WASD / 방향키 이동 · 드래그로 시점</p>
      <footer className="play-hud__credits">
        <Credits manifest={manifest} />
      </footer>
      {ended && (
        <div className="play-hud__end" role="dialog" aria-label="낙하 종료">
          <div className="play-hud__end-card">
            <h2>낙하 종료</h2>
            <p>지상 {map.world.drop.endAltitude} m에 도달했습니다.</p>
            <button type="button" className="btn btn--primary" onClick={onRestart}>
              다시 낙하
            </button>
            <button type="button" className="btn btn--ghost" onClick={onExit}>
              맵 선택으로
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
