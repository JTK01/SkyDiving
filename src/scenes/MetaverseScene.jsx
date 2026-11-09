import { useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { useExperience, PHASES } from '../state/useExperience'
import { useAuth } from '../auth/AuthController'
import { runReconvergence } from './CloudTransition'
import { AVATAR_SLOTS } from '../three/WorldProps'

/**
 * SKY DIVE METAVERSE — main world HUD (the 3D world itself lives in
 * three/WorldProps + the shared sky/cloud systems).
 */
export default function MetaverseScene() {
  const phase = useExperience((s) => s.phase)
  const locked = useExperience((s) => s.locked)
  const { user, signOut } = useAuth()
  const root = useRef()
  const [telemetry, setTelemetry] = useState({ alt: 4000, speed: 198 })

  const visible = phase === PHASES.WORLD || phase === PHASES.RECONVERGING

  useEffect(() => {
    if (phase !== PHASES.WORLD) return
    const el = root.current
    const tl = gsap.timeline()
    tl.fromTo(el, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.8, ease: 'sine.out' }).fromTo(
      el.querySelectorAll('[data-hud]'),
      { autoAlpha: 0, y: 10 },
      { autoAlpha: 1, y: 0, duration: 0.7, stagger: 0.08, ease: 'power2.out' },
      0.1,
    )
    const id = setInterval(() => {
      setTelemetry((t) => ({
        alt: Math.round(3990 + Math.sin(Date.now() / 4000) * 12),
        speed: Math.round(196 + Math.sin(Date.now() / 1700) * 4 + Math.random() * 2),
      }))
    }, 250)
    return () => {
      tl.kill()
      clearInterval(id)
    }
  }, [phase])

  useEffect(() => {
    // fade together with the clouds rolling back in (runReconvergence 0.4–1.6 s)
    if (phase === PHASES.RECONVERGING) gsap.to(root.current, { autoAlpha: 0, duration: 1.2, delay: 0.4, ease: 'sine.inOut' })
  }, [phase])

  const onSignOut = async () => {
    if (locked) return
    const tl = runReconvergence()
    if (tl) await signOut()
  }

  if (!visible) return null
  return (
    <section className="hud" ref={root} aria-label="SKY DIVE Metaverse">
      <header className="hud__top">
        <div className="hud__brand" data-hud>
          <strong>SKY DIVE</strong>
          <span>METAVERSE</span>
        </div>
        <div className="hud__user" data-hud>
          <span className="hud__dot" />
          <span className="hud__name">{user?.username ?? 'Jumper'}</span>
          <button className="hud__signout" onClick={onSignOut} disabled={locked}>
            SIGN OUT
          </button>
        </div>
      </header>

      <footer className="hud__bottom">
        <dl className="hud__telemetry" data-hud>
          <div>
            <dt>ALTITUDE</dt>
            <dd>
              {telemetry.alt.toLocaleString('en-US')}
              <small> M</small>
            </dd>
          </div>
          <div>
            <dt>FREEFALL</dt>
            <dd>
              {telemetry.speed}
              <small> KM/H</small>
            </dd>
          </div>
        </dl>

        <p className="hud__hint" data-hud>
          MOVE TO LOOK AROUND
        </p>

        <div className="hud__squad" data-hud>
          <span className="hud__label">FORMATION</span>
          <div className="hud__slots" aria-label={`1 of ${AVATAR_SLOTS.length + 1} jumpers`}>
            <i className="is-you" />
            {AVATAR_SLOTS.map((_, i) => (
              <i key={i} />
            ))}
          </div>
          <span className="hud__soon">MULTIPLAYER · COMING SOON</span>
        </div>
      </footer>
    </section>
  )
}
