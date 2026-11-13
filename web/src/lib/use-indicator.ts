import { type CSSProperties, useLayoutEffect, useRef, useState } from 'react'

/**
 * Positions an absolutely placed indicator under the child matching
 * `selector`. It snaps into place on first paint, then glides on changes.
 */
export function useIndicator<T extends HTMLElement>(selector: string, key: unknown) {
  const ref = useRef<T>(null)
  const [box, setBox] = useState<{ x: number; w: number } | null>(null)
  const [animate, setAnimate] = useState(false)

  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    const measure = () => {
      const el = root.querySelector<HTMLElement>(selector)
      setBox(el ? { x: el.offsetLeft, w: el.offsetWidth } : null)
    }
    measure()
    // Web fonts and wrapping change widths after the first paint
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    for (const child of root.children) observer.observe(child)
    return () => observer.disconnect()
  }, [selector, key])

  useLayoutEffect(() => {
    if (box && !animate) requestAnimationFrame(() => setAnimate(true))
  }, [box, animate])

  const style: CSSProperties = box
    ? {
        width: box.w,
        transform: `translateX(${box.x}px)`,
        opacity: 1,
        transition: animate
          ? 'transform 260ms var(--ease-out), width 260ms var(--ease-out), opacity 150ms'
          : 'none',
      }
    : { opacity: 0, width: 0 }

  return { ref, style }
}
