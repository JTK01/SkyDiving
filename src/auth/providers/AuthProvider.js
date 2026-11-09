/**
 * Auth provider contract. The UI only talks to AuthController, which talks to
 * one of these. To move to a real backend, implement the same four methods.
 *
 * @typedef {{ id: string, email: string, username: string }} AuthUser
 *
 * @typedef {Object} AuthProvider
 * @property {string} name
 * @property {(c: {email: string, password: string}) => Promise<AuthUser>} signIn
 * @property {(c: {email: string, username: string, password: string}) => Promise<AuthUser>} signUp
 * @property {() => Promise<void>} signOut
 * @property {() => Promise<AuthUser | null>} getSession
 */

export class AuthError extends Error {
  constructor(message, code = 'auth/error') {
    super(message)
    this.code = code
  }
}
