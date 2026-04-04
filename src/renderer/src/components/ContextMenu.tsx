import { useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'

export interface ContextMenuItem {
  label: string
  icon?: React.ReactNode
  onClick: () => void
  danger?: boolean
  disabled?: boolean
  shortcut?: string
}

export interface ContextMenuSeparator {
  type: 'separator'
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuEntry[]
  onClose: () => void
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const adjustedPos = useRef({ x, y })

  // Adjust position to stay within viewport
  useEffect(() => {
    const menu = menuRef.current
    if (!menu) return

    const rect = menu.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight

    let ax = x
    let ay = y
    if (rect.right > vw) ax = x - rect.width
    if (rect.bottom > vh) ay = y - rect.height
    if (ax < 0) ax = 4
    if (ay < 0) ay = 4

    adjustedPos.current = { x: ax, y: ay }
    menu.style.left = `${ax}px`
    menu.style.top = `${ay}px`
  }, [x, y])

  // Close on click outside, scroll, or Escape
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleScroll = () => onClose()
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }

    // Delay listener attachment to avoid the triggering right-click closing it
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClick)
      document.addEventListener('scroll', handleScroll, true)
      document.addEventListener('keydown', handleKey)
    }, 0)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('scroll', handleScroll, true)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  const handleItemClick = useCallback((item: ContextMenuItem) => {
    if (item.disabled) return
    item.onClick()
    onClose()
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-[9999]" style={{ pointerEvents: 'none' }}>
      <div
        ref={menuRef}
        className="fixed min-w-[180px] py-1 rounded-lg border border-surface-700/60 bg-surface-900/95 backdrop-blur-md shadow-xl shadow-black/40"
        style={{ pointerEvents: 'auto' }}
      >
        {items.map((item, i) => {
          if (item.type === 'separator') {
            return (
              <div
                key={`sep-${i}`}
                className="my-1 mx-2 h-px bg-surface-700/60"
              />
            )
          }

          return (
            <button
              key={`${item.label}-${i}`}
              onClick={() => handleItemClick(item)}
              disabled={item.disabled}
              className={`
                w-full flex items-center gap-2.5 px-2.5 py-[6px] text-[12px] text-left transition-colors duration-100
                ${item.danger
                  ? 'text-error/80 hover:bg-error/10 hover:text-error'
                  : item.disabled
                    ? 'text-text-tertiary/40 cursor-default'
                    : 'text-text-secondary hover:bg-surface-800/60 hover:text-text-primary'
                }
              `}
            >
              {item.icon && <span className="w-4 h-4 flex items-center justify-center shrink-0">{item.icon}</span>}
              <span className="flex-1">{item.label}</span>
              {item.shortcut && (
                <span className="text-[10px] text-text-tertiary/50 ml-4">{item.shortcut}</span>
              )}
            </button>
          )
        })}
      </div>
    </div>,
    document.body,
  )
}
