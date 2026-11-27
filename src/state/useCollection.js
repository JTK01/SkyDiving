import { create } from 'zustand'
import { putImage, getImage, deleteImage, dataUrlToBlob } from './photoStore'

/**
 * Per-user collection (same storage pattern as useMapAccess: localStorage per
 * user id — dev prototype, to move to the auth backend with the profile).
 *
 *  found  : { [speciesId]: { name, zone, at } } — mission animals identified
 *           with 정체 확인하기 (nothing is added by just walking up to one)
 *  photos : [{ id, species, name, pose, poseName, zone, at, w, h, image }] —
 *           photos taken with an animal (함께 사진 찍기). The JPEG (1920 px
 *           wide) is kept in IndexedDB (photoStore.js); `image` is its object
 *           URL in memory (null while loading). Older photos saved as 640 px
 *           data URLs in localStorage are moved to IndexedDB on load.
 *           The newest MAX_PHOTOS are kept.
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
  // object URLs are per session: only data URLs (photos not in IndexedDB) are stored
  const photos = s.photos.map(({ image, ...m }) => (image && image.startsWith('data:') ? { ...m, image } : m))
  try {
    localStorage.setItem(key(userId), JSON.stringify({ found: s.found, photos }))
    return true
  } catch {
    return false // quota / storage unavailable — kept in memory for this session
  }
}
const revoke = (p) => p.image && p.image.startsWith('blob:') && URL.revokeObjectURL(p.image)

export const useCollection = create((set, get) => ({
  userId: null,
  ...EMPTY,
  loadFor: (userId) => {
    get().photos.forEach(revoke)
    const data = load(userId)
    set({ userId, found: data.found, photos: data.photos.map((p) => ({ ...p, image: p.image || null })) })
    // images from IndexedDB; old data-URL photos are moved there
    data.photos.forEach(async (p) => {
      let image = null
      const legacy = p.image && p.image.startsWith('data:')
      if (legacy) {
        const blob = dataUrlToBlob(p.image)
        if (!(await putImage(p.id, blob))) return
        image = URL.createObjectURL(blob)
      } else {
        const blob = await getImage(p.id)
        if (!blob) return
        image = URL.createObjectURL(blob)
      }
      if (get().userId !== userId) return URL.revokeObjectURL(image)
      set({ photos: get().photos.map((q) => (q.id === p.id ? { ...q, image } : q)) })
      if (legacy) save(userId, get()) // moved to IndexedDB: the data URL leaves localStorage
    })
  },
  addFound: (species, name, zone) => {
    const s = get()
    if (s.found[species]) return false
    const found = { ...s.found, [species]: { name, zone, at: new Date().toISOString() } }
    set({ found })
    save(s.userId, { ...get() })
    return true
  },
  /** photo: { species, name, pose, poseName, zone, blob, w, h } → the stored photo */
  addPhoto: ({ blob, ...photo }) => {
    const s = get()
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    const entry = { id, at: new Date().toISOString(), ...photo, image: URL.createObjectURL(blob) }
    const all = [entry, ...s.photos]
    const photos = all.slice(0, MAX_PHOTOS)
    all.slice(MAX_PHOTOS).forEach((p) => {
      revoke(p)
      deleteImage(p.id)
    })
    set({ photos })
    putImage(id, blob).then((ok) => {
      if (ok) return save(get().userId, get())
      // no IndexedDB: keep it as a (smaller) data URL in localStorage if it fits
      const r = new FileReader()
      r.onload = () => {
        const st = get()
        const next = { ...st, photos: st.photos.map((p) => (p.id === id ? { ...p, image: r.result } : p)) }
        if (save(st.userId, next)) {
          revoke(entry)
          set({ photos: next.photos })
        }
      }
      r.readAsDataURL(blob)
    })
    save(s.userId, get())
    return entry
  },
}))
