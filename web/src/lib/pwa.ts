import { toast } from '@/components/toast'

const CHECK_EVERY_MS = 60 * 60_000

/**
 * New deploys reach the installed app the next time it comes to the front:
 * the service worker is checked then (and hourly), and a waiting version is
 * offered as "Reload" rather than applied mid-edit (unsaved Settings).
 * Unanswered, it applies on the next cold launch. The generated worker (prompt
 * mode) activates on a SKIP_WAITING message.
 */
export function setupPwaUpdates() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return
    reloading = true
    window.location.reload()
  })

  const offer = (worker: ServiceWorker) =>
    toast('A new version of jobvr is ready', {
      tone: 'info',
      duration: 60_000,
      action: { label: 'Reload', onClick: () => worker.postMessage({ type: 'SKIP_WAITING' }) },
    })

  void navigator.serviceWorker
    .register('/sw.js', { scope: '/' })
    .then((registration) => {
      const watch = (worker: ServiceWorker | null) => {
        worker?.addEventListener('statechange', () => {
          // "installed" with a controller: a new version waiting behind the running one
          if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker)
        })
      }
      if (registration.waiting && navigator.serviceWorker.controller) offer(registration.waiting)
      registration.addEventListener('updatefound', () => watch(registration.installing))
      const check = () => {
        if (registration.waiting) offer(registration.waiting)
        else if (navigator.onLine) registration.update().catch(() => {})
      }
      setInterval(check, CHECK_EVERY_MS)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
      })
    })
    .catch(() => {})
}
