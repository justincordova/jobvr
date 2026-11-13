const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

// React Query notifies observers on a 0 ms timer, then React commits; two ticks covers both
const nextTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/**
 * Runs a cache update inside a view transition so named elements glide to
 * their new spots and removed ones fade out. Falls back to a plain update.
 */
export async function withViewTransition(update: () => void): Promise<void> {
  if (typeof document.startViewTransition !== 'function' || reducedMotion()) {
    update()
    return
  }
  const transition = document.startViewTransition(async () => {
    update()
    await nextTick()
    await nextTick()
  })
  await transition.updateCallbackDone.catch(() => {})
}

/** A valid `view-transition-name` for an arbitrary id. */
export const vtName = (prefix: string, id: string) =>
  `${prefix}-${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`
