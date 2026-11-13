/**
 * Joins truthy class name values into a single space-separated string.
 *
 * A dependency-free helper for conditionally composing Tailwind classes.
 * For more advanced needs (conflict resolution) consider `clsx` + `tailwind-merge`.
 *
 * @example
 * cn('px-2', isActive && 'bg-blue-500', null) // "px-2 bg-blue-500"
 */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}
