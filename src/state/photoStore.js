/**
 * Photo image storage: the JPEG blobs of the collection photos live in
 * IndexedDB (a 1920 px photo is ~0.5 MB — localStorage holds ~5 MB in all),
 * keyed by photo id; the photo list itself (name, pose, time…) stays in
 * localStorage (useCollection). Every call resolves to null / false instead of
 * throwing when IndexedDB is unavailable (private mode, blocked storage).
 */
const DB = 'skydive.photos'
const STORE = 'images'
let opening = null

function open() {
  if (opening) return opening
  opening = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return opening
}

function run(mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve) => {
        if (!db) return resolve(null)
        try {
          const tx = db.transaction(STORE, mode)
          const req = fn(tx.objectStore(STORE))
          tx.oncomplete = () => resolve(req ? req.result ?? true : true)
          tx.onerror = tx.onabort = () => resolve(null)
        } catch {
          resolve(null)
        }
      }),
  )
}

export const putImage = (id, blob) => run('readwrite', (s) => s.put(blob, id)).then((r) => r !== null)
export const getImage = (id) => run('readonly', (s) => s.get(id))
export const deleteImage = (id) => run('readwrite', (s) => s.delete(id))

/** data URL (older photos kept in localStorage) → Blob */
export function dataUrlToBlob(url) {
  const [head, data] = url.split(',')
  const type = /data:([^;]+)/.exec(head)?.[1] || 'image/jpeg'
  const bin = atob(data)
  const u8 = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
  return new Blob([u8], { type })
}
