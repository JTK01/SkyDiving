import { create } from 'zustand'

/**
 * Per-user map access.
 *
 *  firstPickId : the first playable map the user selected — it is theirs
 *  unlockedIds : maps the user may enter. Starts with the first pick only;
 *                the point-based unlock flow (later) will append to it.
 *
 * Before the first pick nothing is locked. After it, every other map shows
 * a lock icon. Stored in localStorage per user id (dev prototype; move to
 * the auth backend's user profile together with the points system).
 */
const key = (userId) => `skydive.mapAccess.${userId}`
const EMPTY = { firstPickId: null, unlockedIds: [] }

function load(userId) {
  try {
    const v = localStorage.getItem(key(userId))
    return v ? { ...EMPTY, ...JSON.parse(v) } : EMPTY
  } catch {
    return EMPTY
  }
}
function save(userId, state) {
  try {
    localStorage.setItem(key(userId), JSON.stringify(state))
  } catch {
    /* storage unavailable — keep it in memory */
  }
}

export const useMapAccess = create((set, get) => ({
  userId: null,
  ...EMPTY,

  /** switch to a user's access record (call when the signed-in user changes) */
  loadFor: (userId) => set({ userId, ...(userId ? load(userId) : EMPTY) }),

  /** record the first playable map the user picks */
  registerPick: (mapId) => {
    const s = get()
    if (s.firstPickId || !s.userId) return
    const next = { firstPickId: mapId, unlockedIds: [mapId] }
    save(s.userId, next)
    set(next)
  },

  /** lock state for one map (false for everything until the first pick) */
  isLocked: (mapId) => {
    const s = get()
    return s.firstPickId !== null && !s.unlockedIds.includes(mapId)
  },
}))
