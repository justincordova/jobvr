import { ArrowDown, ArrowUp } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { cn } from '@/lib/cn'

/** Pages shorter than the screen plus this get no button. */
const MIN_EXTRA = 400

const still = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * One small pill at a time: "Bottom" at the bottom while you're in the top half
 * of a long page, "Top" under the header once you're past the middle.
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

  const go = (to: 'top' | 'bottom') =>
    window.scrollTo({
      top: to === 'top' ? 0 : document.documentElement.scrollHeight,
      behavior: still() ? 'auto' : 'smooth',
    })

  return (
    <>
      <Pill edge="top" show={state === 'up'} onClick={() => go('top')} label="Back to top">
        <ArrowUp className="size-3" /> Top
      </Pill>
      <Pill
        edge="bottom"
        show={state === 'down'}
        onClick={() => go('bottom')}
        label="Jump to bottom"
      >
        <ArrowDown className="size-3" /> Bottom
      </Pill>
    </>
  )
}

/** Sits at the edge it goes to: under the header for Top, at the bottom for Bottom. */
function Pill({
  edge,
  show,
  onClick,
  label,
  children,
}: {
  edge: 'top' | 'bottom'
  show: boolean
  onClick: () => void
  label: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      inert={!show}
      aria-label={label}
      className={cn(
        'fixed left-1/2 z-30 flex h-7 -translate-x-1/2 items-center gap-1 rounded-full border border-line bg-panel/80 px-2.5 font-mono text-[0.68rem] text-faint shadow-md shadow-black/30 backdrop-blur-md transition-[opacity,translate,bottom,color,border-color] duration-300 ease-(--ease-out) hover:border-line-strong hover:text-paper active:scale-95 pointer-coarse:h-9 pointer-coarse:px-3.5',
        edge === 'top'
          ? 'top-[calc(4.25rem+env(safe-area-inset-top))]'
          : 'bottom-[calc(1rem+env(safe-area-inset-bottom))] in-data-savebar:bottom-[calc(5.5rem+env(safe-area-inset-bottom))]',
        show
          ? 'translate-y-0 opacity-100'
          : cn(
              'pointer-events-none opacity-0',
              edge === 'top' ? '-translate-y-3' : 'translate-y-3',
            ),
      )}
    >
      {children}
    </button>
  )
}
