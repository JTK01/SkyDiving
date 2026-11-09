import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { useExperience, PHASES } from '../state/useExperience'
import { runDissipation } from './CloudTransition'
import LoginScene from './LoginScene'
import SignupScene from './SignupScene'

/**
 * Hosts the login & signup cards on top of the cloud interior.
 * - Scene 03 reveal: card blur→sharp at 0.3s, fields staggered to 1.5s
 * - Scene 04 switch: 0.8s cross-fade, background untouched, no reload
 * - Success: cards fade out while the clouds start to part (Scene 05)
 */
export default function AuthStage() {
  const phase = useExperience((s) => s.phase)
  const authView = useExperience((s) => s.authView)
  const setAuthView = useExperience((s) => s.setAuthView)
  const locked = useExperience((s) => s.locked)
  const setLocked = useExperience((s) => s.setLocked)

  const stage = useRef()
  const loginRef = useRef()
  const signupRef = useRef()
  const [view, setView] = useState('login')
  const [revealed, setRevealed] = useState(false)

  const cardOf = (v) => (v === 'login' ? loginRef.current : signupRef.current)
  const parts = (card) => [...card.querySelectorAll('[data-reveal]')]

  useLayoutEffect(() => {
    gsap.set([loginRef.current, signupRef.current], { autoAlpha: 0 })
  }, [])

  // ---- Scene 03: login reveal -------------------------------------------
  useEffect(() => {
    if (phase !== PHASES.LOGIN || revealed) return
    const card = loginRef.current
    const items = parts(card)
    const head = card.querySelector('[data-head]')
    setView('login')
    const tl = gsap.timeline()
    tl.set(stage.current, { autoAlpha: 1, filter: 'blur(0px)', scale: 1 })
      .set(items, { autoAlpha: 0, y: 12 })
      .fromTo(
        card,
        { autoAlpha: 0, filter: 'blur(18px)', y: 18, scale: 0.97 },
        { autoAlpha: 1, filter: 'blur(0px)', y: 0, scale: 1, duration: 0.8, ease: 'power3.out' },
        0.3,
      )
      .fromTo(head, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.6, ease: 'power2.out' }, 0.4)
    // email 0.6 · password 0.8 · login 1.0 · create account 1.2
    items.forEach((el, i) => {
      tl.to(el, { autoAlpha: 1, y: 0, duration: 0.45, ease: 'power2.out' }, 0.6 + i * 0.2)
    })
    tl.call(() => {
      setRevealed(true)
      setLocked(false)
    }, null, 1.5)
    return () => tl.kill()
  }, [phase, revealed, setLocked])

  // ---- Scene 04: login ⇄ signup (0.8s) -----------------------------------
  useEffect(() => {
    if (!revealed || authView === view) return
    const from = cardOf(view)
    const to = cardOf(authView)
    const items = parts(to)
    setLocked(true)
    const tl = gsap.timeline({
      onComplete: () => {
        setView(authView)
        setLocked(false)
      },
    })
    tl.to(from, { autoAlpha: 0, y: -10, filter: 'blur(10px)', duration: 0.35, ease: 'power2.in' }, 0)
      .fromTo(
        to,
        { autoAlpha: 0, y: 14, filter: 'blur(12px)' },
        { autoAlpha: 1, y: 0, filter: 'blur(0px)', duration: 0.45, ease: 'power2.out' },
        0.35,
      )
      .fromTo(items, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.3, stagger: 0.04, ease: 'power2.out' }, 0.4)
    return () => tl.kill()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authView, revealed])

  // ---- Scene 05 trigger --------------------------------------------------
  const onSuccess = () => {
    setLocked(true)
    gsap.to(stage.current, { autoAlpha: 0, filter: 'blur(10px)', scale: 0.985, duration: 0.6, ease: 'power2.in' })
    runDissipation()
  }

  const busy = locked || phase !== PHASES.LOGIN || !revealed
  return (
    <section className="auth-stage" ref={stage} aria-label="Account">
      <div className="auth-stage__grid">
        <LoginScene
          ref={loginRef}
          active={view === 'login' && authView === 'login'}
          disabled={busy}
          onSuccess={onSuccess}
          onCreateAccount={() => !busy && setAuthView('signup')}
        />
        <SignupScene
          ref={signupRef}
          active={view === 'signup' && authView === 'signup'}
          disabled={busy}
          onSuccess={onSuccess}
          onBack={() => !busy && setAuthView('login')}
        />
      </div>
    </section>
  )
}
