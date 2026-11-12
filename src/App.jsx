import { useCallback, useRef } from 'react'
import gsap from 'gsap'
import Experience from './three/Experience'
import IntroScene from './scenes/IntroScene'
import AuthStage from './scenes/AuthStage'
import MetaverseScene from './scenes/MetaverseScene'
import MapRoute from './scenes/MapRoute'
import { useRouter } from './router/router'
import { runIntro, getActiveTimeline } from './scenes/CloudTransition'
import { cine } from './state/cinematic'

// `?debug` exposes the director so a timeline can be paused & scrubbed
if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug')) {
  window.__skydive = { gsap, cine, getActiveTimeline }
}
import { useExperience } from './state/useExperience'
import { AuthController } from './auth/AuthController'

export default function App() {
  const authMounted = useExperience((s) => s.authMounted)
  const route = useRouter((s) => s.route)
  const onMap = route.name === 'map'
  const veil = useRef()
  const started = useRef(false)

  const onReady = useCallback(() => {
    if (started.current) return
    started.current = true
    gsap.to(veil.current, { autoAlpha: 0, duration: 1.2, ease: 'sine.out' })
    runIntro()
  }, [])

  return (
    <AuthController>
      <main className="app">
        {/* paused (no frames rendered) while a map route covers the screen */}
        <Experience onReady={onReady} paused={onMap} />
        <div className="vignette" aria-hidden />
        <div className="grain" aria-hidden />
        <IntroScene />
        {authMounted && <AuthStage />}
        {!onMap && <MetaverseScene />}
        {onMap && <MapRoute id={route.params.id} />}
        <div className="veil" ref={veil} aria-hidden>
          <span>SKY DIVE</span>
        </div>
      </main>
    </AuthController>
  )
}
