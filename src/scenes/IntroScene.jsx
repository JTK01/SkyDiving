import { useEffect, useLayoutEffect, useRef } from 'react'
import gsap from 'gsap'
import { useExperience, PHASES } from '../state/useExperience'
import { runConvergence } from './CloudTransition'

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

  useLayoutEffect(() => {
    gsap.set([title.current, sub.current, button.current, meta.current], { autoAlpha: 0 })
  }, [])

  useEffect(() => {
    if (phase !== PHASES.INTRO) return
    const tl = gsap.timeline()
    tl.fromTo(
      title.current,
      { autoAlpha: 0, letterSpacing: '0.62em', filter: 'blur(16px)', y: 10 },
      { autoAlpha: 1, letterSpacing: window.innerWidth <= 720 ? '0.22em' : '0.3em', filter: 'blur(0px)', y: 0, duration: 1.0, ease: 'power3.out' },
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
    const tl = gsap.timeline()
    tl.to([title.current, sub.current], { autoAlpha: 0, y: -8, filter: 'blur(8px)', duration: 0.9, ease: 'power2.in' }, 0.05)
      .to(button.current, { autoAlpha: 0, y: 6, duration: 0.6, ease: 'power2.in' }, 0.12)
      .to(meta.current, { autoAlpha: 0, duration: 0.6 }, 0)
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
