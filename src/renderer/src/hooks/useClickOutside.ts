import { useEffect } from 'react'

/**
 * Calls `handler` when a mousedown event occurs outside the element
 * referenced by `ref`. Only active while `isOpen` is true.
 */
export function useClickOutside(
  ref: React.RefObject<HTMLElement | null>,
  isOpen: boolean,
  handler: () => void,
) {
  useEffect(() => {
    if (!isOpen) return
    const listener = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        handler()
      }
    }
    document.addEventListener('mousedown', listener)
    return () => document.removeEventListener('mousedown', listener)
  }, [ref, isOpen, handler])
}
