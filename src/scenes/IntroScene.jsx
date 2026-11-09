import { useEffect, useLayoutEffect, useRef } from 'react'
import gsap from 'gsap'
import { useExperience, PHASES } from '../state/useExperience'
import { runConvergence } from './CloudTransition'

// keep in sync with .intro__title in global.css — GSAP animates the whole
// filter, so the soft lift has to be part of every keyframe
const TITLE_LIFT = 'drop-shadow(0 1px 0 rgba(255,255,255,0.35)) drop-shadow(0 10px 28px rgba(8,28,60,0.18))'

/**
 * Scene 01 — title + PRESS TO START.
 *  0.8s title fades in (letter-spacing settles, blur → sharp)
 *  1.8s title complete, button fades in
 * On click: button squeeze, title & button fade out, clouds converge.
 */
export default function IntroScene() {
  const phase = useExperience((s) => s.phase)
  const locked = useExperience((s) => s.locked)
  const root = useRef()
  const title = useRef()
  const sub = useRef()
  const button = useRef()
  const meta = useRef()
  const halo = useRef()

  useLayoutEffect(() => {
    gsap.set([title.current, sub.current, button.current, meta.current, halo.current], { autoAlpha: 0 })
  }, [])

  useEffect(() => {
    if (phase !== PHASES.INTRO) return
    const tl = gsap.timeline()
    tl.fromTo(halo.current, { autoAlpha: 0, scale: 0.9 }, { autoAlpha: 1, scale: 1, duration: 1.6, ease: 'sine.out' }, 0.6)
      .fromTo(
      title.current,
      { autoAlpha: 0, letterSpacing: '0.42em', filter: `blur(14px) ${TITLE_LIFT}`, y: 10 },
      { autoAlpha: 1, letterSpacing: window.innerWidth <= 720 ? '0.1em' : '0.16em', filter: `blur(0px) ${TITLE_LIFT}`, y: 0, duration: 1.0, ease: 'power3.out' },
      0.8,
    )
      .fromTo(sub.current, { autoAlpha: 0, y: 6 }, { autoAlpha: 1, y: 0, duration: 0.9, ease: 'power2.out' }, 1.3)
      .fromTo(
        button.current,
        { autoAlpha: 0, y: 12 },
        { autoAlpha: 1, y: 0, duration: 0.8, ease: 'power2.out' },
        1.8,
      )
      .fromTo(meta.current, { autoAlpha: 0 }, { autoAlpha: 1, duration: 1.2 }, 2.0)
    return () => tl.kill()
  }, [phase])

  useEffect(() => {
    if (phase !== PHASES.CONVERGING) return
    // The UI leaves *with* the clouds, not before them: the fades are long
    // ease-in curves that stay mostly opaque while the sky is still open and
    // finish as the hero cloud fills the frame during the flight (≈2.3–2.5 s;
    // see runConvergence). Fading out over bare sky left ~1 s of empty frames.
    const tl = gsap.timeline()
    tl.to(title.current, { autoAlpha: 0, y: -10, filter: `blur(10px) ${TITLE_LIFT}`, duration: 2.1, ease: 'power2.in' }, 0.4)
      .to(sub.current, { autoAlpha: 0, y: -8, filter: 'blur(8px)', duration: 2.0, ease: 'power2.in' }, 0.4)
      .to(button.current, { autoAlpha: 0, y: 6, duration: 1.9, ease: 'power2.in' }, 0.3)
      .to(meta.current, { autoAlpha: 0, duration: 1.4, ease: 'sine.inOut' }, 0.2)
      .to(halo.current, { autoAlpha: 0, duration: 2.2, ease: 'sine.in' }, 0.6)
    return () => tl.kill()
  }, [phase])

  const onStart = () => {
    if (locked || phase !== PHASES.INTRO) return
    gsap.fromTo(button.current, { scale: 1 }, { scale: 0.94, duration: 0.12, yoyo: true, repeat: 1, ease: 'power2.out' })
    runConvergence()
  }

  const visible = phase === PHASES.LOADING || phase === PHASES.INTRO || phase === PHASES.CONVERGING
  if (!visible) return null

  return (
    <section className="intro" ref={root} aria-label="SKY DIVE intro">
      <div className="intro__halo" ref={halo} aria-hidden />
      <div className="intro__center">
        <h1 className="intro__title" ref={title}>
          SKY DIVE
        </h1>
        <p className="intro__sub" ref={sub}>
          A METAVERSE ABOVE THE CLOUDS
        </p>
        <button
          ref={button}
          className="btn-start"
          onClick={onStart}
          disabled={locked || phase !== PHASES.INTRO}
          aria-busy={locked}
        >
          <span>PRESS TO START</span>
        </button>
      </div>
      <div className="intro__meta" ref={meta} aria-hidden>
        <span>ALT 4,000 M</span>
        <span className="intro__meta-line" />
        <span>FREEFALL READY</span>
      </div>
    </section>
  )
}
