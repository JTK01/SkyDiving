import { useEffect, useRef } from 'react'
import Credits from './Credits'
import { useQuality, PRESETS } from '../quality'

/** 저/중/고 quality switch (auto-picked at first, the choice is remembered) */
function QualityMenu() {
  const { name, source, choose } = useQuality()
  return (
    <div className="play-hud__quality" role="group" aria-label="그래픽 품질">
      <span>품질</span>
      {Object.entries(PRESETS).map(([k, p]) => (
        <button key={k} type="button" className={k === name ? 'is-on' : ''} aria-pressed={k === name} onClick={() => choose(k)}>
          {p.label}
        </button>
      ))}
      {source === 'auto' && <small>자동</small>}
    </div>
  )
}

/** ?debug: live frame statistics (fps, frame time, resolution, draw calls) */
function FrameStats() {
  const q = useQuality()
  return (
    <pre className="play-hud__stats-debug">
      {`${q.fps} fps · avg ${q.frameMs} ms · worst ${q.worstMs} ms\nres ×${q.scale} · ${q.name}\ndraws ${q.calls} · tris ${(q.triangles / 1000) | 0}k\ngeo ${q.geometries} · tex ${q.textures}`}
    </pre>
  )
}
const DEBUG = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug')

/** what the jumper touched (state.contact from DropController) */
function contactText(c) {
  if (!c) return '낙하가 끝났습니다.'
  if (c.kind === 'ground') return '지면에 닿았습니다.'
  if (c.kind === 'building') return c.part === 'roof' ? '건물 옥상에 닿았습니다.' : '건물 벽에 부딪혔습니다.'
  return c.part === 'tower' ? '사그라다 파밀리아 첨탑에 닿았습니다.' : '사그라다 파밀리아 성당에 닿았습니다.'
}

/** skydive HUD: altitude above ground, fall speed, distance from the landmark */
export default function PlayHud({ map, manifest, state, ended, onRestart, onExit }) {
  const alt = useRef()
  const spd = useRef()
  const dist = useRef()
  useEffect(() => {
    let id
    const tick = () => {
      if (alt.current) {
        alt.current.textContent = Math.max(0, Math.round(state.agl)).toLocaleString('en-US')
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
        <div className="play-hud__actions">
          <QualityMenu />
          <button type="button" className="play-hud__exit" onClick={onExit}>
            맵 선택
          </button>
        </div>
      </header>
      {DEBUG && <FrameStats />}
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
            <p>{contactText(state.contact)}</p>
            {state.contact && (
              <p className="play-hud__end-meta">
                접촉 속도 {Math.round(state.contact.speed * 3.6)} km/h · 지면에서 {Math.round(state.contact.height)} m
              </p>
            )}
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
