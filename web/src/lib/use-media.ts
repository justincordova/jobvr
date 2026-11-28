import { useSyncExternalStore } from 'react'

/**
 * Whether a media query matches, kept live. Where matchMedia is missing (tests,
 * old browsers) it reports `fallback`.
 */
export function useMedia(query: string, fallback: boolean) {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia?.(query)
      list?.addEventListener('change', notify)
      return () => list?.removeEventListener('change', notify)
    },
    () => window.matchMedia?.(query).matches ?? fallback,
    () => fallback,
  )
}

/** Tailwind's `sm`: from here rows have room for their own columns. */
export const useWide = () => useMedia('(min-width: 40rem)', true)
