import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { localAuthProvider } from './providers/localAuthProvider'

/**
 * AuthController — the only place the UI gets auth from.
 *
 * The UI calls signIn / signUp / signOut and never knows which backend is in
 * use. Swap backends with VITE_AUTH_PROVIDER (see .env.example); add a new
 * backend by registering a factory in PROVIDERS.
 */
const PROVIDERS = {
  local: async () => localAuthProvider,
  // supabase: () => import('./providers/supabaseAuthProvider').then((m) => m.createSupabaseAuthProvider()),
  // firebase: () => import('./providers/firebaseAuthProvider').then((m) => m.createFirebaseAuthProvider()),
}

const AuthContext = createContext(null)

export function AuthController({ children }) {
  const providerRef = useRef(null)
  const [user, setUser] = useState(null)
  const [status, setStatus] = useState('idle') // idle | pending | error
  // true once the stored session (if any) has been restored
  const [ready, setReady] = useState(false)

  const provider = useCallback(async () => {
    if (!providerRef.current) {
      const key = import.meta.env.VITE_AUTH_PROVIDER || 'local'
      const factory = PROVIDERS[key] ?? PROVIDERS.local
      providerRef.current = await factory()
    }
    return providerRef.current
  }, [])

  useEffect(() => {
    provider()
      .then((p) => p.getSession())
      .then((u) => u && setUser(u))
      .catch(() => {})
      .finally(() => setReady(true))
  }, [provider])

  const run = useCallback(
    async (method, payload) => {
      setStatus('pending')
      try {
        const p = await provider()
        const u = await p[method](payload)
        setUser(u)
        setStatus('idle')
        return u
      } catch (e) {
        setStatus('error')
        throw e
      }
    },
    [provider],
  )

  const value = useMemo(
    () => ({
      user,
      status,
      ready,
      signIn: (c) => run('signIn', c),
      signUp: (c) => run('signUp', c),
      signOut: async () => {
        const p = await provider()
        await p.signOut()
        setUser(null)
      },
    }),
    [user, status, ready, run, provider],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthController>')
  return ctx
}
