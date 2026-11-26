import { create } from 'zustand'

/**
 * Per-user collection (same storage pattern as useMapAccess: localStorage per
 * user id — dev prototype, to move to the auth backend with the profile).
 *
 *  found  : { [speciesId]: { name, zone, at } } — mission animals identified
 *           with 정체 확인하기 (nothing is added by just walking up to one)
 *  photos : [{ id, species, name, pose, poseName, zone, at, image }] — photos
 *           taken with an animal (함께 사진 찍기); image is a JPEG data URL
 *           (640 px wide). The newest MAX_PHOTOS are kept.
 */
const key = (userId) => `skydive.collection.${userId || 'guest'}`
const EMPTY = { found: {}, photos: [] }
const MAX_PHOTOS = 24

function load(userId) {
  try {
    const v = localStorage.getItem(key(userId))
    return v ? { ...EMPTY, ...JSON.parse(v) } : EMPTY
  } catch {
    return EMPTY
  }
}
function save(userId, s) {
  try {
    localStorage.setItem(key(userId), JSON.stringify({ found: s.found, photos: s.photos }))
    return true
  } catch {
    return false // quota / storage unavailable — kept in memory for this session
  }
}

export const useCollection = create((set, get) => ({
  userId: null,
  ...EMPTY,
  loadFor: (userId) => set({ userId, ...load(userId) }),
  addFound: (species, name, zone) => {
    const s = get()
    if (s.found[species]) return false
    const found = { ...s.found, [species]: { name, zone, at: new Date().toISOString() } }
    set({ found })
    save(s.userId, { ...get() })
    return true
  },
  addPhoto: (photo) => {
    const s = get()
    let photos = [{ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: new Date().toISOString(), ...photo }, ...s.photos].slice(0, MAX_PHOTOS)
    set({ photos })
    // too big for the storage: drop the oldest until it fits
    while (!save(s.userId, { ...get(), photos }) && photos.length > 1) {
      photos = photos.slice(0, -1)
      set({ photos })
    }
    return photos[0]
  },
}))
