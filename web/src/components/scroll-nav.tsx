import { ArrowDown, ArrowUp } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'

/** Pages shorter than the screen plus this get no button. */
const MIN_EXTRA = 400

const still = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * One small pill, bottom center: "Bottom" while you're in the top half of a
 * long page, "Top" once you're past the middle.
 */
export function ScrollNav() {
  const [state, setState] = useState<'none' | 'down' | 'up'>('none')

  useEffect(() => {
    let frame = 0
    const measure = () => {
      frame = 0
      const extra = document.documentElement.scrollHeight - window.innerHeight
      const next = extra < MIN_EXTRA ? 'none' : window.scrollY > extra / 2 ? 'up' : 'down'
      setState(next)
    }
    const onChange = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    measure()
    window.addEventListener('scroll', onChange, { passive: true })
    window.addEventListener('resize', onChange)
    // Lists that grow or shrink (filters, Show more) change the page's length
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onChange)
    observer?.observe(document.body)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onChange)
      window.removeEventListener('resize', onChange)
      observer?.disconnect()
    }
  }, [])

  const up = state === 'up'
  const go = () =>
    window.scrollTo({
      top: up ? 0 : document.documentElement.scrollHeight,
      behavior: still() ? 'auto' : 'smooth',
    })

  return (
    <button
      type="button"
      onClick={go}
      inert={state === 'none'}
      aria-label={up ? 'Back to top' : 'Jump to bottom'}
      className={cn(
        'fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 z-30 flex h-7 -translate-x-1/2 items-center gap-1 rounded-full border border-line bg-panel/80 px-2.5 font-mono text-[0.68rem] text-faint shadow-md shadow-black/30 backdrop-blur-md transition-[opacity,translate,bottom,color,border-color] duration-300 ease-(--ease-out) hover:border-line-strong hover:text-paper active:scale-95 in-data-savebar:bottom-[calc(5.5rem+env(safe-area-inset-bottom))] pointer-coarse:h-9 pointer-coarse:px-3.5',
        state === 'none' ? 'pointer-events-none translate-y-3 opacity-0' : 'opacity-100',
      )}
    >
      {/* key: the label fades in fresh when it flips */}
      <span key={state} className="flex animate-fade-in items-center gap-1">
        {up ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
        {up ? 'Top' : 'Bottom'}
      </span>
    </button>
  )
}
