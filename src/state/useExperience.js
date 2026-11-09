import { create } from 'zustand'

/**
 * Scene state machine.
 *
 *  loading ─► intro ─► converging ─► login ⇄ (signup view)
 *                                     │
 *                                     ▼
 *                               dissipating ─► world ─► reconverging ─► login
 */
export const PHASES = Object.freeze({
  LOADING: 'loading',
  INTRO: 'intro',
  CONVERGING: 'converging',
  LOGIN: 'login',
  DISSIPATING: 'dissipating',
  WORLD: 'world',
  RECONVERGING: 'reconverging',
})

export const useExperience = create((set) => ({
  phase: PHASES.LOADING,
  /** 'login' | 'signup' — which card is shown while phase === login */
  authView: 'login',
  /** true while the auth stage is mounted (prepared just before the reveal) */
  authMounted: false,
  /** global input lock — set while any cinematic timeline is running */
  locked: false,

  setPhase: (phase) => set({ phase }),
  setAuthView: (authView) => set({ authView }),
  setAuthMounted: (authMounted) => set({ authMounted }),
  setLocked: (locked) => set({ locked }),
}))
