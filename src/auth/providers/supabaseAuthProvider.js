/**
 * Supabase adapter (not bundled by default).
 *
 *   npm i @supabase/supabase-js
 *   VITE_AUTH_PROVIDER=supabase, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY in .env
 *
 * then register it in AuthController.jsx → PROVIDERS.
 */
import { AuthError } from './AuthProvider'

export async function createSupabaseAuthProvider() {
  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)

  const toUser = (u) =>
    u && { id: u.id, email: u.email, username: u.user_metadata?.username ?? u.email.split('@')[0] }

  return {
    name: 'supabase',
    async signIn({ email, password }) {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw new AuthError(error.message, error.code)
      return toUser(data.user)
    },
    async signUp({ email, username, password }) {
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { username } } })
      if (error) throw new AuthError(error.message, error.code)
      return toUser(data.user)
    },
    async signOut() {
      await supabase.auth.signOut()
    },
    async getSession() {
      const { data } = await supabase.auth.getSession()
      return toUser(data.session?.user ?? null)
    },
  }
}
