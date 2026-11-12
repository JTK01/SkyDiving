import { create } from 'zustand'

/**
 * Which map world is on screen, and how:
 *   'preview'  — inside the map panel's preview frame (anchor element)
 *   'entering' — expanding from the preview frame to full screen while the
 *                camera flies to the drop point (same canvas, same cache)
 *   'play'     — the skydive (route /maps/:id)
 * mapId null → nothing shown; the world's GPU memory and tile cache are freed.
 */
export const useMapStage = create((set, get) => ({
  mapId: null,
  mode: null,
  anchor: null, // preview frame element
  fromRect: null, // preview frame rect when entering
  showPreview: (mapId, anchor) => set({ mapId, mode: 'preview', anchor, fromRect: null }),
  enter: (mapId) => {
    const a = get().anchor
    set({ mapId, mode: 'entering', fromRect: a ? a.getBoundingClientRect().toJSON() : null, anchor: null })
  },
  play: (mapId) => set({ mapId, mode: 'play', anchor: null }),
  hide: () => set({ mapId: null, mode: null, anchor: null, fromRect: null }),
}))
