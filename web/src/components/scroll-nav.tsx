import { ArrowDown, ArrowUp } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { cn } from '@/lib/cn'

/** How far from either end before its button shows. */
const EDGE = 320

const still = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * "Top" and "Bottom" jumps in one pill, bottom center (like the "back to top"
 * pills on X or GitHub). Each half shows only when it would go somewhere, so
 * short pages never get it.
 */
export function ScrollNav() {
  const [room, setRoom] = useState({ up: false, down: false })

  useEffect(() => {
    let frame = 0
    const measure = () => {
      frame = 0
      const top = window.scrollY
      const left = document.documentElement.scrollHeight - window.innerHeight - top
      setRoom((was) => {
        const up = top > EDGE
        const down = left > EDGE && top > EDGE / 2
        return was.up === up && was.down === down ? was : { up, down }
      })
    }
    const onChange = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    measure()
    window.addEventListener('scroll', onChange, { passive: true })
    window.addEventListener('resize', onChange)
    // Lists that grow or shrink (filters, Show more) change what's below
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

  const shown = room.up || room.down
  return (
    <div
      inert={!shown}
      className={cn(
        'fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 z-30 flex -translate-x-1/2 items-center rounded-full border border-line-strong bg-raised/90 p-1 shadow-lg shadow-black/40 backdrop-blur-md transition-[opacity,translate,bottom] duration-300 ease-(--ease-out) in-data-savebar:bottom-[calc(5.5rem+env(safe-area-inset-bottom))]',
        shown ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0',
      )}
    >
      <Jump show={room.up} onClick={() => go('top')} label="Back to top">
        <ArrowUp /> Top
      </Jump>
      {/* A hairline between the two when both show */}
      <span
        aria-hidden
        className={cn(
          'h-5 w-px bg-line-strong transition-opacity duration-300',
          room.up && room.down ? 'opacity-100' : 'opacity-0',
        )}
      />
      <Jump show={room.down} onClick={() => go('bottom')} label="Jump to bottom">
        Bottom <ArrowDown />
      </Jump>
    </div>
  )
}

/** One half of the pill; folds its width to zero when there's nowhere to go. */
function Jump({
  show,
  onClick,
  label,
  children,
}: {
  show: boolean
  onClick: () => void
  label: string
  children: ReactNode
}) {
  return (
    <div
      inert={!show}
      className={cn(
        'grid transition-[grid-template-columns,opacity] duration-300 ease-(--ease-out)',
        show ? 'grid-cols-[1fr] opacity-100' : 'grid-cols-[0fr] opacity-0',
      )}
    >
      <div className="min-w-0 overflow-hidden">
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          className="flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium whitespace-nowrap text-dim transition-colors hover:bg-line hover:text-paper active:scale-95 pointer-coarse:h-11 pointer-coarse:px-4 [&_svg]:size-4"
        >
          {children}
        </button>
      </div>
    </div>
  )
}
