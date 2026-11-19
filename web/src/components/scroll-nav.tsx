import { ArrowDown, ArrowUp } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { cn } from '@/lib/cn'

/** How far from either end before its button shows. */
const EDGE = 320

const still = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * Top and bottom quick jumps, bottom right. Each shows only when it would go
 * somewhere, so short pages never get it.
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
      className={cn(
        'fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-30 in-data-savebar:bottom-[calc(5.5rem+env(safe-area-inset-bottom))] flex flex-col overflow-hidden rounded-full border border-line-strong bg-panel/85 shadow-lg shadow-black/40 backdrop-blur-md transition-[opacity,translate,bottom] duration-300 ease-(--ease-out) sm:right-6 lg:right-10',
        shown ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0',
      )}
      inert={!shown}
    >
      <JumpButton label="Back to top" show={room.up} onClick={() => go('top')}>
        <ArrowUp />
      </JumpButton>
      <JumpButton label="Jump to bottom" show={room.down} onClick={() => go('bottom')}>
        <ArrowDown />
      </JumpButton>
    </div>
  )
}

function JumpButton({
  label,
  show,
  onClick,
  children,
}: {
  label: string
  show: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'grid transition-[grid-template-rows,opacity] duration-300 ease-(--ease-out)',
        show ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
      )}
      inert={!show}
    >
      <div className="min-h-0 overflow-hidden">
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          title={label}
          className="grid size-10 place-items-center text-dim transition-colors hover:bg-raised hover:text-signal active:scale-95 pointer-coarse:size-12 [&_svg]:size-4"
        >
          {children}
        </button>
      </div>
    </div>
  )
}
