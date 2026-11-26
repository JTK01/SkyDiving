import { useEffect, useRef, useState } from 'react'
import Credits from './Credits'
import { WALK } from './DropController'
import { MISSION, SPECIES } from '../characters/critters'
import { useQuality, PRESETS, BENCH } from '../quality'
import Interact, { InteractPrompt, CollectionPanel } from './Interact'
import { useCollection } from '../../state/useCollection'

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

/** wind sway of the camera while falling: off by default, remembered */
function SwayToggle() {
  const { sway, setSway } = useQuality()
  return (
    <button type="button" className="play-hud__toggle" aria-pressed={sway} title="낙하 중 카메라의 미세한 바람 흔들림" onClick={() => setSway(!sway)}>
      바람 흔들림 {sway ? '켬' : '끔'}
    </button>
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

/** frame-time summary of the drop (?bench or ?debug) */
function BenchResult({ b }) {
  return (
    <dl className="play-hud__bench">
      <div>
        <dt>평균</dt>
        <dd>{b.avgFps} fps</dd>
      </div>
      <div>
        <dt>1% low</dt>
        <dd>{b.low1Fps} fps</dd>
      </div>
      <div>
        <dt>최저</dt>
        <dd>{b.minFps} fps</dd>
      </div>
      <div>
        <dt>30 fps 미만</dt>
        <dd>{b.over33ms} %</dd>
      </div>
      <p>
        {b.frames} 프레임 · {b.seconds} s (첫 1 s 제외, 최악 {b.warmupWorstMs} ms) · {b.preset} · {b.buffer}
        <br />
        {b.gpu}
      </p>
    </dl>
  )
}

/** controls hint: free fall, on foot (ground / roof), or look-only on the basilica */
function hintText(walk, state) {
  if (!walk && state?.canopy) return 'A/D 선회 · W 가속 · S 브레이크 · 드래그로 시점 · V 1·3인칭'
  if (!walk) return 'WASD / 방향키 이동 · SPACE 낙하산 · 드래그로 시점 · V 1·3인칭'
  if (walk.mode === 'look') return '성당 위에서는 둘러보기만 할 수 있어요 · 드래그로 시점'
  if (walk.mode === 'roof') return 'WASD 걷기 · Shift 달리기 · P 사진 포즈 · V 1·3인칭 (이 지붕 위에서만)'
  return `WASD 걷기 · Shift 달리기 · 동물 곁에서 E · P 사진 포즈 · V 1·3인칭 (착지 지점 반경 ${WALK.radius} m)`
}

/** what the jumper touched (state.contact from DropController) */
function contactText(c) {
  if (!c) return '낙하가 끝났습니다.'
  if (c.soft) return c.kind === 'ground' ? '낙하산으로 착지했습니다.' : c.kind === 'building' ? '낙하산으로 건물 옥상에 착지했습니다.' : '낙하산으로 성당 위에 내려앉았습니다.'
  if (c.kind === 'ground') return '지면에 닿았습니다.'
  if (c.kind === 'building') return c.part === 'roof' ? '건물 옥상에 닿았습니다.' : '건물 벽에 부딪혔습니다.'
  return c.part === 'tower' ? '사그라다 파밀리아 첨탑에 닿았습니다.' : '사그라다 파밀리아 성당에 닿았습니다.'
}

/** skydive HUD: altitude above ground, fall speed, distance from the landmark */
export default function PlayHud({ map, manifest, state, ended, onRestart, onExit }) {
  const alt = useRef()
  const spd = useRef()
  const dist = useRef()
  const hint = useRef()
  const found = useRef()
  const [panel, setPanel] = useState(null)
  const collected = useCollection((c) => c.found)
  const foundIds = useRef([])
  foundIds.current = Object.keys(collected)
  useEffect(() => {
    let id
    const tick = () => {
      if (alt.current) {
        alt.current.textContent = Math.max(0, Math.round(state.agl)).toLocaleString('en-US')
        spd.current.textContent = Math.round(state.vy * 3.6)
        dist.current.textContent = Math.round(Math.hypot(state.x, state.z))
        const h = hintText(state.ended ? state.walk : null, state)
        if (hint.current && hint.current.textContent !== h) hint.current.textContent = h
        if (found.current) {
          // the collection (identified with 정체 확인하기) is the count
          const f = foundIds.current
          const txt = (state.zone ? `${state.zone} · ` : '') + `발견한 동물 ${f.length} / ${MISSION.length}` + (f.length ? ` · ${f.map((id) => SPECIES[id].name).join(', ')}` : '')
          if (found.current.textContent !== txt) found.current.textContent = txt
          found.current.hidden = !state.walk
        }
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
          <button type="button" className="play-hud__toggle" onClick={() => setPanel(panel?.kind === 'collection' ? null : { kind: 'collection' })}>
            컬렉션 {Object.keys(collected).length}/{MISSION.length}
          </button>
          <QualityMenu />
          <SwayToggle />
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
      <p className="play-hud__found" ref={found} hidden />
      <InteractPrompt state={state} open={!!panel} />
      <Interact state={state} panel={panel} setPanel={setPanel} />
      {panel?.kind === 'collection' && <CollectionPanel onClose={() => setPanel(null)} />}
      <p className="play-hud__hint" ref={hint}>{hintText(ended ? state.walk : null, state)}</p>
      <footer className="play-hud__credits">
        <Credits manifest={manifest} />
      </footer>
      {ended && !panel && (
        // not modal: the jumper walks / looks around while it stays on screen
        <div className="play-hud__end" role="status" aria-label="착지">
          <div className="play-hud__end-card">
            <div className="play-hud__end-text">
              <h2>착지</h2>
              <p>{contactText(state.contact)}</p>
              {state.contact && (
                <p className="play-hud__end-meta">
                  접촉 속도 {Math.round(state.contact.speed * 3.6)} km/h · 지면에서 {Math.round(state.contact.height)} m
                </p>
              )}
            </div>
            {(BENCH || DEBUG) && state.bench && <BenchResult b={state.bench} />}
            <div className="play-hud__end-actions">
              <button type="button" className="btn btn--primary" onClick={onRestart}>
                다시 낙하
              </button>
              <button type="button" className="btn btn--ghost" onClick={onExit}>
                맵 선택으로
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
