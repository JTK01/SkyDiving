import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { SPECIES, MISSION } from '../characters/critters'
import { MISSION_INFO, HINTS } from '../characters/critterInfo'
import { useCollection } from '../../state/useCollection'

/**
 * Talking to the animals (on foot, within 2 m — state.interact from Npcs):
 *   'E 상호작용' prompt → E opens the menu (1 대화하기 · 2 정체 확인하기 ·
 *   3 함께 사진 찍기, Esc closes). While a panel is open the player and the
 *   animal stay put (state.ui).
 *   정체 확인하기: the zone's mission animal → '발견!', why it stands for
 *   Spain / Barcelona with sources, saved in the collection; any other animal
 *   → '이 친구는 아니에요' with its name and a hint toward the mission animal.
 *   함께 사진 찍기: pose (화이팅 / 어깨동무 / 점프) → Npcs poses both and
 *   frames them with the basilica → the photo is saved in the collection with
 *   the animal's name, the pose and the time.
 */
const POSES = [
  ['fighting', '화이팅'],
  ['hug', '어깨동무'],
  ['jump', '점프'],
]
const subj = (name) => {
  // 이/가 by the last syllable's final consonant
  const c = name.charCodeAt(name.length - 1) - 0xac00
  return c >= 0 && c <= 11171 && c % 28 ? `${name}이에요` : `${name}예요`
}

export function InteractPrompt({ state, open }) {
  const ref = useRef()
  useEffect(() => {
    let id
    const tick = () => {
      if (ref.current) ref.current.hidden = open || !state.interact || !state.walk
      id = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(id)
  }, [state, open])
  return (
    <p className="play-hud__interact" ref={ref} hidden>
      <kbd>E</kbd> 상호작용
    </p>
  )
}

export default function Interact({ state, panel, setPanel }) {
  const { addFound, addPhoto, found } = useCollection()
  const [busy, setBusy] = useState(false)
  const target = useRef(null)

  const close = () => {
    if (target.current) {
      state.npcApi?.endPhoto(target.current)
      state.npcApi?.hold(target.current, false)
    }
    target.current = null
    state.ui = null
    setPanel(null)
  }

  const act = async (what, pose) => {
    const t = target.current
    const api = state.npcApi
    if (!t || !api) return
    if (what === 'talk') setPanel({ kind: 'talk', line: api.talk(t) })
    if (what === 'identify') {
      const r = api.identify(t)
      if (!r) return
      const S = SPECIES[r.id]
      if (r.mission) {
        const isNew = addFound(r.id, S.name, r.zone)
        state.found = state.found || new Set()
        state.found.add(r.id)
        setPanel({ kind: 'found', id: r.id, isNew })
      } else {
        const hints = HINTS[r.zoneMission]
        setPanel({ kind: 'wrong', id: r.id, hint: hints[Math.floor(Math.random() * hints.length)] })
      }
    }
    if (what === 'photoPick') setPanel({ kind: 'photoPick' })
    if (what === 'photo') {
      setBusy(true)
      setPanel({ kind: 'shooting', pose })
      const shot = await api.photo(t, pose)
      setBusy(false)
      if (!shot) return close()
      const S = SPECIES[t.id]
      const poseName = POSES.find((p) => p[0] === pose)[1]
      const saved = addPhoto({ species: t.id, name: S.name, pose, poseName, zone: state.zone, blob: shot.blob, w: shot.w, h: shot.h })
      setPanel({ kind: 'photo', photo: saved })
    }
  }

  useEffect(() => {
    const kd = (e) => {
      if (e.repeat) return
      if (!panel && e.code === 'KeyE' && state.interact && state.walk) {
        target.current = { ...state.interact }
        state.ui = 'menu'
        state.npcApi?.hold(target.current, true)
        setPanel({ kind: 'menu' })
        e.preventDefault()
        return
      }
      if (!panel) return
      if (e.code === 'Escape') close()
      if (panel.kind === 'menu') {
        if (e.code === 'Digit1') act('talk')
        if (e.code === 'Digit2') act('identify')
        if (e.code === 'Digit3') act('photoPick')
      } else if (panel.kind === 'photoPick') {
        const k = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code)
        if (k >= 0) act('photo', POSES[k][0])
      }
    }
    window.addEventListener('keydown', kd)
    return () => window.removeEventListener('keydown', kd)
  })

  if (!panel || panel.kind === 'collection') return null
  const id = target.current?.id
  const back = () => {
    state.npcApi?.endPhoto(target.current)
    setPanel({ kind: 'menu' })
  }
  return (
    <div className={`interact interact--${panel.kind}`} role="dialog" aria-label="동물과 상호작용">
      {panel.kind === 'menu' && (
        <>
          <h3>이 친구와 무엇을 할까요?</h3>
          <div className="interact__choices">
            <button type="button" onClick={() => act('talk')}>
              <kbd>1</kbd> 대화하기
            </button>
            <button type="button" onClick={() => act('identify')}>
              <kbd>2</kbd> 정체 확인하기
            </button>
            <button type="button" onClick={() => act('photoPick')}>
              <kbd>3</kbd> 함께 사진 찍기
            </button>
          </div>
        </>
      )}
      {panel.kind === 'talk' && (
        <>
          <p className="interact__line">“{panel.line}”</p>
          <div className="interact__row">
            <button type="button" onClick={() => act('talk')}>다른 이야기</button>
            <button type="button" onClick={back}>뒤로</button>
          </div>
        </>
      )}
      {panel.kind === 'found' && (
        <>
          <p className="interact__burst" aria-live="polite">
            발견!
          </p>
          <h3>{SPECIES[panel.id].name}</h3>
          {MISSION_INFO[panel.id].text.map((t, k) => (
            <p key={k} className="interact__text">
              {t}
            </p>
          ))}
          <p className="interact__sources">
            출처:{' '}
            {MISSION_INFO[panel.id].sources.map(([label, url], k) => (
              <span key={url}>
                {k > 0 && ' · '}
                <a href={url} target="_blank" rel="noreferrer">
                  {label}
                </a>
              </span>
            ))}
          </p>
          <p className="interact__saved">
            {panel.isNew ? '컬렉션에 등록했어요' : '이미 컬렉션에 있어요'} · {Object.keys(found).length} / {MISSION.length}
          </p>
          <div className="interact__row">
            <button type="button" onClick={back}>뒤로</button>
            <button type="button" onClick={close}>닫기</button>
          </div>
        </>
      )}
      {panel.kind === 'wrong' && (
        <>
          <h3>이 친구는 아니에요</h3>
          <p className="interact__text">이 친구는 {subj(SPECIES[panel.id].name)}.</p>
          <p className="interact__hint">힌트: {panel.hint}</p>
          <div className="interact__row">
            <button type="button" onClick={back}>뒤로</button>
            <button type="button" onClick={close}>닫기</button>
          </div>
        </>
      )}
      {panel.kind === 'photoPick' && (
        <>
          <h3>어떤 포즈로 찍을까요?</h3>
          <div className="interact__choices">
            {POSES.map(([p, label], k) => (
              <button key={p} type="button" onClick={() => act('photo', p)}>
                <kbd>{k + 1}</kbd> {label}
              </button>
            ))}
          </div>
          <div className="interact__row">
            <button type="button" onClick={back}>뒤로</button>
          </div>
        </>
      )}
      {panel.kind === 'shooting' && <p className="interact__line">{busy ? '찰칵! 사진을 찍는 중…' : ''}</p>}
      {panel.kind === 'photo' && panel.photo && (
        <>
          <img className="interact__photo" src={panel.photo.image} alt={`${panel.photo.name}와 ${panel.photo.poseName}`} />
          <p className="interact__saved">
            {panel.photo.name} · {panel.photo.poseName} · {new Date(panel.photo.at).toLocaleString('ko-KR')} — 컬렉션에 저장했어요
          </p>
          <div className="interact__row">
            <button type="button" onClick={back}>뒤로</button>
            <button type="button" onClick={close}>닫기</button>
          </div>
        </>
      )}
      {id && panel.kind === 'menu' && <p className="interact__esc">Esc 닫기</p>}
    </div>
  )
}

/**
 * one photo large in the middle of the screen with the animal, the pose and the
 * time. Zoom with the wheel / a pinch / + − (around the cursor or the pinch
 * centre), drag to move, 화면 맞춤 (fit, 0) · 원본 크기 (1 image px = 1 CSS px, 1)
 * — double click / tap toggles the two; ←/→ (or the buttons) for the previous /
 * next photo; Esc or a click outside the photo closes it (and only it — the
 * collection stays open)
 */
const ZMAX = 8
function PhotoViewer({ photos, index, setIndex }) {
  const p = photos[index]
  const n = photos.length
  const stage = useRef(null)
  const img = useRef(null)
  const [nat, setNat] = useState(null) // natural size of the loaded image
  const [view, setView] = useState({ s: 1, x: 0, y: 0, fit: true })
  const ptrs = useRef(new Map())
  const gesture = useRef(null)
  const tap = useRef({ t: 0, touch: false })

  const fitScale = () => {
    const r = stage.current?.getBoundingClientRect()
    if (!r || !nat) return 1
    return Math.min(r.width / nat.w, r.height / nat.h)
  }
  const minScale = () => Math.min(fitScale(), 1) * 0.5
  /** keep the photo over the stage: it cannot be dragged fully out of view */
  const clampPan = (s, x, y) => {
    const r = stage.current?.getBoundingClientRect()
    if (!r || !nat) return { x, y }
    const mx = Math.max(0, (nat.w * s - r.width) / 2) + r.width * 0.25
    const my = Math.max(0, (nat.h * s - r.height) / 2) + r.height * 0.25
    return { x: Math.max(-mx, Math.min(mx, x)), y: Math.max(-my, Math.min(my, y)) }
  }
  /** zoom to scale s keeping the stage point (cx, cy) (relative to the centre) fixed */
  const zoomTo = (s, cx = 0, cy = 0) =>
    setView((v) => {
      const ns = Math.max(minScale(), Math.min(ZMAX, s))
      const k = ns / v.s
      return { s: ns, ...clampPan(ns, cx - (cx - v.x) * k, cy - (cy - v.y) * k), fit: false }
    })
  const fit = () => setView({ s: fitScale(), x: 0, y: 0, fit: true })
  const actual = () => setView((v) => ({ s: 1, ...clampPan(1, v.x / v.s, v.y / v.s), fit: false }))
  const rel = (e) => {
    const r = stage.current.getBoundingClientRect()
    return [e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2]
  }

  // a new photo: fit once it is loaded; refit on window resize while fitted
  useEffect(() => setNat(null), [index])
  useEffect(() => {
    if (nat) fit()
  }, [nat]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const r = () => view.fit && fit()
    window.addEventListener('resize', r)
    return () => window.removeEventListener('resize', r)
  })
  // the wheel needs a non-passive listener to keep the page from scrolling
  useEffect(() => {
    const el = stage.current
    if (!el) return
    const wh = (e) => {
      e.preventDefault()
      const [cx, cy] = rel(e)
      setView((v) => {
        const ns = Math.max(minScale(), Math.min(ZMAX, v.s * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))))
        const k = ns / v.s
        return { s: ns, ...clampPan(ns, cx - (cx - v.x) * k, cy - (cy - v.y) * k), fit: false }
      })
    }
    el.addEventListener('wheel', wh, { passive: false })
    return () => el.removeEventListener('wheel', wh)
  })
  useEffect(() => {
    const kd = (e) => {
      if (e.code === 'Escape') setIndex(null)
      else if (e.code === 'ArrowLeft') setIndex((index - 1 + n) % n)
      else if (e.code === 'ArrowRight') setIndex((index + 1) % n)
      else if (e.key === '+' || e.key === '=') zoomTo(view.s * 1.25)
      else if (e.key === '-' || e.key === '_') zoomTo(view.s / 1.25)
      else if (e.key === '0') fit()
      else if (e.key === '1') actual()
      else return
      e.preventDefault()
      e.stopPropagation() // not the panel's own Esc
    }
    window.addEventListener('keydown', kd, true)
    return () => window.removeEventListener('keydown', kd, true)
  })

  // drag (one pointer) and pinch (two)
  const down = (e) => {
    if (e.button !== undefined && e.button !== 0) return
    try {
      stage.current.setPointerCapture(e.pointerId)
    } catch {
      /* not an active pointer (synthetic event) */
    }
    ptrs.current.set(e.pointerId, rel(e))
    const pts = [...ptrs.current.values()]
    gesture.current =
      pts.length === 1
        ? { kind: 'drag', start: pts[0], view: { ...view }, moved: false }
        : { kind: 'pinch', d: Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]) || 1, mid: [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2], view: { ...view }, moved: true }
  }
  const move = (e) => {
    if (!ptrs.current.has(e.pointerId)) return
    ptrs.current.set(e.pointerId, rel(e))
    const g = gesture.current
    const pts = [...ptrs.current.values()]
    if (!g) return
    if (g.kind === 'drag' && pts.length === 1) {
      const dx = pts[0][0] - g.start[0]
      const dy = pts[0][1] - g.start[1]
      if (Math.hypot(dx, dy) > 4) g.moved = true
      setView({ s: g.view.s, ...clampPan(g.view.s, g.view.x + dx, g.view.y + dy), fit: false })
    } else if (g.kind === 'pinch' && pts.length >= 2) {
      const d = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1])
      const mid = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2]
      const v0 = g.view
      const ns = Math.max(minScale(), Math.min(ZMAX, v0.s * (d / g.d)))
      const k = ns / v0.s
      // the image point under the first midpoint follows the midpoint
      setView({ s: ns, ...clampPan(ns, mid[0] - (g.mid[0] - v0.x) * k, mid[1] - (g.mid[1] - v0.y) * k), fit: false })
    }
  }
  const up = (e) => {
    ptrs.current.delete(e.pointerId)
    const g = gesture.current
    tap.current.moved = !!g?.moved
    const pts = [...ptrs.current.values()]
    // pinch → drag with the remaining finger
    gesture.current = pts.length === 1 ? { kind: 'drag', start: pts[0], view: { ...view }, moved: true } : pts.length ? g : null
    tap.current.touch = e.pointerType === 'touch'
    if (!pts.length && g && !g.moved && tap.current.touch) {
      // a tap: double tap toggles fit / actual size
      const now = performance.now()
      if (now - tap.current.t < 300) (view.fit ? actual : fit)()
      tap.current.t = now
    }
  }

  if (!p) return null
  const pct = Math.round(view.s * 100)
  // portal: the collection panel is transformed, which would trap position: fixed inside it
  return createPortal(
    <div className="photo-viewer" role="dialog" aria-modal="true" aria-label="사진 보기" onClick={() => setIndex(null)}>
      <figure onClick={(e) => e.stopPropagation()}>
        <div
          className={`photo-viewer__stage${view.s > fitScale() + 1e-3 ? ' is-zoomed' : ''}`}
          ref={stage}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onClick={(e) => {
            // a click on the dark area around the photo (not after a drag) closes, like outside the frame
            if (tap.current.moved || !img.current || e.target !== stage.current) return
            const b = img.current.getBoundingClientRect()
            if (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom) setIndex(null)
          }}
          onDoubleClick={(e) => !tap.current.touch && (view.fit ? zoomTo(1, ...rel(e)) : fit())}
        >
          {p.image ? (
            <img
              key={p.id}
              ref={img}
              src={p.image}
              alt={`${p.name} ${p.poseName}`}
              draggable={false}
              onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              style={nat ? { width: nat.w, height: nat.h, transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.s})` } : { visibility: 'hidden' }}
            />
          ) : (
            <p className="photo-viewer__loading">사진을 불러오는 중…</p>
          )}
          {n > 1 && (
            <>
              <button type="button" className="photo-viewer__nav photo-viewer__nav--prev" aria-label="이전 사진" onPointerDown={(e) => e.stopPropagation()} onClick={() => setIndex((index - 1 + n) % n)}>
                ‹
              </button>
              <button type="button" className="photo-viewer__nav photo-viewer__nav--next" aria-label="다음 사진" onPointerDown={(e) => e.stopPropagation()} onClick={() => setIndex((index + 1) % n)}>
                ›
              </button>
            </>
          )}
          <button type="button" className="photo-viewer__close" aria-label="닫기" onPointerDown={(e) => e.stopPropagation()} onClick={() => setIndex(null)}>
            ×
          </button>
        </div>
        <div className="photo-viewer__bar">
          <div className="photo-viewer__zoom" role="group" aria-label="확대·축소">
            <button type="button" onClick={fit} aria-pressed={view.fit} title="화면 맞춤 (0)">
              화면 맞춤
            </button>
            <button type="button" onClick={actual} aria-pressed={!view.fit && Math.abs(view.s - 1) < 1e-3} title="원본 크기 (1)">
              원본 크기
            </button>
            <button type="button" className="photo-viewer__step" aria-label="축소" onClick={() => zoomTo(view.s / 1.25)}>
              −
            </button>
            <output className="photo-viewer__pct" aria-live="polite">
              {pct}%
            </output>
            <button type="button" className="photo-viewer__step" aria-label="확대" onClick={() => zoomTo(view.s * 1.25)}>
              +
            </button>
          </div>
          <figcaption>
            <strong>{p.name}</strong> · {p.poseName}
            <br />
            <small>
              {new Date(p.at).toLocaleString('ko-KR')}
              {p.zone ? ` · ${p.zone}` : ''}
              {nat ? ` · ${nat.w}×${nat.h}` : ''}
            </small>
          </figcaption>
          <span className="photo-viewer__count">
            {index + 1} / {n}
          </span>
        </div>
      </figure>
    </div>,
    document.body,
  )
}

/** the collection: identified mission animals and the photos (a photo opens large) */
export function CollectionPanel({ onClose }) {
  const { found, photos } = useCollection()
  const [view, setView] = useState(null)
  return (
    <div className="interact interact--collection" role="dialog" aria-label="컬렉션">
      <h3>
        컬렉션 · 발견한 동물 {Object.keys(found).length} / {MISSION.length}
      </h3>
      <ul className="collection__found">
        {MISSION.map((m) => (
          <li key={m} className={found[m] ? 'is-found' : ''}>
            {found[m] ? SPECIES[m].name : '???'}
            {found[m] && <small>{new Date(found[m].at).toLocaleDateString('ko-KR')}</small>}
          </li>
        ))}
      </ul>
      <div className="collection__photos">
        {photos.length === 0 && <p className="interact__text">아직 사진이 없어요. 동물 곁에서 E → 함께 사진 찍기.</p>}
        {photos.map((p, k) => (
          <figure key={p.id}>
            <button type="button" className="collection__open" onClick={() => setView(k)} aria-label={`${p.name} ${p.poseName} 사진 크게 보기`}>
              {p.image ? <img src={p.image} alt={`${p.name} ${p.poseName}`} /> : <span className="collection__loading" aria-hidden="true" />}
            </button>
            <figcaption>
              {p.name} · {p.poseName}
              <br />
              <small>{new Date(p.at).toLocaleString('ko-KR')}</small>
            </figcaption>
          </figure>
        ))}
      </div>
      <div className="interact__row">
        <button type="button" onClick={onClose}>닫기</button>
      </div>
      {view !== null && <PhotoViewer photos={photos} index={view} setIndex={setView} />}
    </div>
  )
}
