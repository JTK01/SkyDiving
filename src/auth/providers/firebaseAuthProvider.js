/**
 * Firebase adapter (not bundled by default).
 *
 *   npm i firebase
 *   VITE_AUTH_PROVIDER=firebase + VITE_FIREBASE_* in .env
 *
 * then register it in AuthController.jsx → PROVIDERS.
 */
import { AuthError } from './AuthProvider'

export async function createFirebaseAuthProvider() {
  const { initializeApp } = await import('firebase/app')
  const fb = await import('firebase/auth')
  const app = initializeApp({
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  })
  const auth = fb.getAuth(app)
  const toUser = (u) => u && { id: u.uid, email: u.email, username: u.displayName ?? u.email.split('@')[0] }
  const wrap = async (fn) => {
    try {
      return await fn()
    } catch (e) {
      throw new AuthError(e.message, e.code)
    }
  }

  return {
    name: 'firebase',
    signIn: ({ email, password }) =>
      wrap(async () => toUser((await fb.signInWithEmailAndPassword(auth, email, password)).user)),
    signUp: ({ email, username, password }) =>
      wrap(async () => {
        const { user } = await fb.createUserWithEmailAndPassword(auth, email, password)
        await fb.updateProfile(user, { displayName: username })
        return toUser(user)
      }),
    signOut: () => fb.signOut(auth),
    getSession: async () => toUser(auth.currentUser),
  }
}
