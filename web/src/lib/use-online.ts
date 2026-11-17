import { useSyncExternalStore } from 'react'

/**
 * Offline when the browser says so, or when the last API read came from the
 * service worker's cache (marked X-Jobvr-Offline): Wi-Fi can be up while
 * Tailscale or the PC is down.
 */
let servedFromCache = false
const listeners = new Set<() => void>()

/** Called by `unwrap` for every API response. */
export function noteResponse(fromCache: boolean) {
  if (fromCache === servedFromCache) return
  servedFromCache = fromCache
  for (const l of listeners) l()
}

const subscribe = (onChange: () => void) => {
  listeners.add(onChange)
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

export const useOnline = () =>
  useSyncExternalStore(
    subscribe,
    () => navigator.onLine && !servedFromCache,
    () => true,
  )
