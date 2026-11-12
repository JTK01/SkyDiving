import { create } from 'zustand'

/**
 * Minimal History-API router (the app had no router; this avoids pulling in
 * a dependency for two routes). Query strings (?debug, ?tier) are kept.
 *
 *   /               → { name: 'home' }
 *   /maps/:id       → { name: 'map', params: { id } }
 *
 * Dev/preview servers fall back to index.html for unknown paths; a static
 * host needs the same SPA fallback rule.
 */
export function parseRoute(pathname) {
  const m = pathname.match(/^\/maps\/([\w-]+)\/?$/)
  if (m) return { name: 'map', params: { id: m[1] } }
  return { name: 'home', params: {} }
}

export const mapPath = (id) => `/maps/${id}`

export const useRouter = create((set) => ({
  route: parseRoute(window.location.pathname),
  navigate: (path, { replace = false } = {}) => {
    const url = path + window.location.search
    window.history[replace ? 'replaceState' : 'pushState']({}, '', url)
    set({ route: parseRoute(path) })
  },
}))

window.addEventListener('popstate', () => {
  useRouter.setState({ route: parseRoute(window.location.pathname) })
})
