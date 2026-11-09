import { AuthError } from './AuthProvider'

/**
 * Local prototype provider — stores accounts in localStorage with SHA-256
 * password hashes. FOR DEVELOPMENT ONLY: swap for Supabase / Firebase in
 * production (see supabaseAuthProvider.js / firebaseAuthProvider.js).
 */
const USERS_KEY = 'skydive.users'
const SESSION_KEY = 'skydive.session'
const LATENCY = 650

export const DEMO_ACCOUNT = { email: 'demo@skydive.io', password: 'skydive123', username: 'demo_jumper' }

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

function read(key, fallback) {
  try {
    const v = localStorage.getItem(key)
    return v ? JSON.parse(v) : fallback
  } catch {
    return fallback
  }
}
function write(key, value) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable (private mode) — session lives in memory only */
  }
}

async function hash(text) {
  if (globalThis.crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`skydive:${text}`))
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
  }
  return `plain:${text}`
}

const memory = { users: null, session: null }
function users() {
  if (!memory.users) memory.users = read(USERS_KEY, [])
  return memory.users
}
const publicUser = (u) => ({ id: u.id, email: u.email, username: u.username })

async function ensureDemo() {
  const list = users()
  if (!list.some((u) => u.email === DEMO_ACCOUNT.email)) {
    list.push({
      id: 'demo',
      email: DEMO_ACCOUNT.email,
      username: DEMO_ACCOUNT.username,
      passwordHash: await hash(DEMO_ACCOUNT.password),
    })
    write(USERS_KEY, list)
  }
}

/** @type {import('./AuthProvider').AuthProvider} */
export const localAuthProvider = {
  name: 'local',

  async signIn({ email, password }) {
    await ensureDemo()
    await wait(LATENCY)
    const u = users().find((x) => x.email.toLowerCase() === email.trim().toLowerCase())
    if (!u || u.passwordHash !== (await hash(password))) {
      throw new AuthError('이메일 또는 비밀번호가 올바르지 않습니다.', 'auth/invalid-credentials')
    }
    memory.session = publicUser(u)
    write(SESSION_KEY, memory.session)
    return memory.session
  },

  async signUp({ email, username, password }) {
    await ensureDemo()
    await wait(LATENCY)
    const list = users()
    const e = email.trim().toLowerCase()
    if (list.some((x) => x.email.toLowerCase() === e)) {
      throw new AuthError('이미 가입된 이메일입니다.', 'auth/email-in-use')
    }
    if (list.some((x) => x.username.toLowerCase() === username.trim().toLowerCase())) {
      throw new AuthError('이미 사용 중인 사용자 이름입니다.', 'auth/username-in-use')
    }
    const u = {
      id: globalThis.crypto?.randomUUID?.() ?? String(Date.now()),
      email: e,
      username: username.trim(),
      passwordHash: await hash(password),
    }
    list.push(u)
    write(USERS_KEY, list)
    memory.session = publicUser(u)
    write(SESSION_KEY, memory.session)
    return memory.session
  },

  async signOut() {
    memory.session = null
    write(SESSION_KEY, null)
  },

  async getSession() {
    return memory.session ?? read(SESSION_KEY, null)
  },
}
