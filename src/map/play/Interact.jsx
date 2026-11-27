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
      const image = await api.photo(t, pose)
      setBusy(false)
      if (!image) return close()
      const S = SPECIES[t.id]
      const poseName = POSES.find((p) => p[0] === pose)[1]
      const saved = addPhoto({ species: t.id, name: S.name, pose, poseName, zone: state.zone, image })
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
 * time; ←/→ (or the buttons) for the previous / next photo; Esc or a click
 * outside the photo closes it (and only it — the collection stays open)
 */
function PhotoViewer({ photos, index, setIndex }) {
  const p = photos[index]
  const n = photos.length
  useEffect(() => {
    const kd = (e) => {
      if (e.code === 'Escape') setIndex(null)
      else if (e.code === 'ArrowLeft') setIndex((index - 1 + n) % n)
      else if (e.code === 'ArrowRight') setIndex((index + 1) % n)
      else return
      e.preventDefault()
      e.stopPropagation() // not the panel's own Esc
    }
    window.addEventListener('keydown', kd, true)
    return () => window.removeEventListener('keydown', kd, true)
  }, [index, n, setIndex])
  if (!p) return null
  // portal: the collection panel is transformed, which would trap position: fixed inside it
  return createPortal(
    <div className="photo-viewer" role="dialog" aria-modal="true" aria-label="사진 보기" onClick={() => setIndex(null)}>
      <figure onClick={(e) => e.stopPropagation()}>
        <img src={p.image} alt={`${p.name} ${p.poseName}`} />
        <figcaption>
          <strong>{p.name}</strong> · {p.poseName}
          <br />
          <small>
            {new Date(p.at).toLocaleString('ko-KR')}
            {p.zone ? ` · ${p.zone}` : ''}
          </small>
          <span className="photo-viewer__count">
            {index + 1} / {n}
          </span>
        </figcaption>
        {n > 1 && (
          <>
            <button type="button" className="photo-viewer__nav photo-viewer__nav--prev" aria-label="이전 사진" onClick={() => setIndex((index - 1 + n) % n)}>
              ‹
            </button>
            <button type="button" className="photo-viewer__nav photo-viewer__nav--next" aria-label="다음 사진" onClick={() => setIndex((index + 1) % n)}>
              ›
            </button>
          </>
        )}
        <button type="button" className="photo-viewer__close" aria-label="닫기" onClick={() => setIndex(null)}>
          ×
        </button>
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
              <img src={p.image} alt={`${p.name} ${p.poseName}`} />
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
