import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import type { CommandInfo } from '../../../../shared/ipc-types'

export interface CommandPaletteProps {
  /** Commands to display */
  commands: CommandInfo[]
  /** Current filter text (the text after '/') */
  query: string
  /** Whether the palette is visible */
  visible: boolean
  /** Called when a command is selected */
  onSelect: (command: CommandInfo) => void
  /** Called when the palette should close (Escape, click outside, etc.) */
  onClose: () => void
  /** Anchor position for the palette (bottom of the input) */
  anchorRect: DOMRect | null
  /** Whether commands are still loading */
  isLoading?: boolean
  /** Set of recently used command names for section separation */
  recentCommandNames?: Set<string>
}

/** Source badge colors */
const SOURCE_COLORS: Record<string, string> = {
  extension: 'bg-purple-500/20 text-purple-400',
  skill: 'bg-blue-500/20 text-blue-400',
  prompt: 'bg-green-500/20 text-green-400',
  builtin: 'bg-yellow-500/20 text-yellow-400',
}

function getSourceBadge(source?: string) {
  if (!source) return null
  const colorClass = SOURCE_COLORS[source] || 'bg-surface-600/50 text-surface-300'
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${colorClass}`}>
      {source}
    </span>
  )
}

export function CommandPalette({
  commands,
  query,
  visible,
  onSelect,
  onClose,
  anchorRect,
  isLoading = false,
  recentCommandNames,
}: CommandPaletteProps) {
  const paletteRef = useRef<HTMLDivElement>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  // Filter commands based on query (text after /)
  // When filtering, don't separate into recent/rest sections
  const filteredCommands = useMemo(() => {
    if (!query) return commands
    const lower = query.toLowerCase()
    return commands.filter(
      (cmd) =>
        cmd.name.toLowerCase().includes(lower) ||
        cmd.description?.toLowerCase().includes(lower)
    )
  }, [commands, query])

  // When no query, split into recent and rest sections
  const { recentCommands, otherCommands, showRecentSection } = useMemo(() => {
    if (query || !recentCommandNames || recentCommandNames.size === 0) {
      return { recentCommands: [], otherCommands: filteredCommands, showRecentSection: false }
    }
    const recent: CommandInfo[] = []
    const other: CommandInfo[] = []
    for (const cmd of filteredCommands) {
      if (recentCommandNames.has(cmd.name)) {
        recent.push(cmd)
      } else {
        other.push(cmd)
      }
    }
    return { recentCommands: recent, otherCommands: other, showRecentSection: recent.length > 0 && other.length > 0 }
  }, [filteredCommands, query, recentCommandNames])

  // Flat list for index-based navigation (accounting for section separator)
  const allItems = useMemo(() => {
    if (!showRecentSection) return filteredCommands
    // Insert a null separator between recent and other
    return [...recentCommands, null as unknown as CommandInfo, ...otherCommands]
  }, [showRecentSection, recentCommands, otherCommands, filteredCommands])

  // Reset selected index when filtered list changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [filteredCommands.length])

  // Get the actual command at a navigation index (skipping separator)
  const getCommandAtIndex = useCallback(
    (index: number): CommandInfo | undefined => {
      if (!showRecentSection) return filteredCommands[index]
      // Skip the separator (null) in navigation
      let actualIndex = 0
      for (const item of allItems) {
        if (item === null) continue  // separator
        if (actualIndex === index) return item
        actualIndex++
      }
      return undefined
    },
    [showRecentSection, filteredCommands, allItems]
  )

  // Total navigable commands (excluding separator)
  const navigableCount = showRecentSection
    ? recentCommands.length + otherCommands.length
    : filteredCommands.length

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!visible) return

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((prev) =>
            prev < navigableCount - 1 ? prev + 1 : 0
          )
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : navigableCount - 1
          )
          break
        case 'Enter':
          e.preventDefault()
          {
            const cmd = getCommandAtIndex(selectedIndex)
            if (cmd) onSelect(cmd)
          }
          break
        case 'Escape':
          e.preventDefault()
          onClose()
          break
        case 'Tab':
          e.preventDefault()
          {
            const cmd = getCommandAtIndex(selectedIndex)
            if (cmd) onSelect(cmd)
          }
          break
      }
    },
    [visible, navigableCount, selectedIndex, onSelect, onClose, getCommandAtIndex]
  )

  // Register keyboard listener
  useEffect(() => {
    if (!visible) return
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [visible, handleKeyDown])

  // Close on click outside
  useEffect(() => {
    if (!visible) return
    const handleClick = (e: MouseEvent) => {
      if (paletteRef.current && !paletteRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    // Delay to avoid the triggering click closing it
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClick)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClick)
    }
  }, [visible, onClose])

  if (!visible || !anchorRect) return null

  // Position the palette above the input
  const style: React.CSSProperties = {
    position: 'fixed',
    left: anchorRect.left,
    bottom: window.innerHeight - anchorRect.top + 4, // 4px gap above input
    width: Math.max(anchorRect.width, 320),
    maxHeight: '280px',
    zIndex: 50,
  }

  return createPortal(
    <div
      ref={paletteRef}
      style={style}
      className="bg-surface-800 border border-surface-600 rounded-lg shadow-xl overflow-hidden flex flex-col"
      role="listbox"
      aria-label="Slash commands"
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-surface-700 flex items-center justify-between">
        <span className="text-xs text-surface-400 font-medium">Commands</span>
        {isLoading && (
          <span className="text-xs text-surface-500">Loading...</span>
        )}
        {!isLoading && (
          <span className="text-xs text-surface-500">{filteredCommands.length} available</span>
        )}
      </div>

      {/* Command list */}
      <div className="overflow-y-auto flex-1 py-1">
        {navigableCount === 0 && !isLoading && (
          <div className="px-3 py-4 text-center text-sm text-surface-500">
            No commands found
          </div>
        )}
        {showRecentSection && (
          <div className="px-3 py-1 text-[10px] text-surface-500 font-medium uppercase tracking-wider">
            Recent
          </div>
        )}
        {recentCommands.map((cmd) => {
          const navIndex = filteredCommands.indexOf(cmd)
          const isHovered = hoveredIndex === navIndex
          return (
            <div
              key={`recent-${cmd.source}-${cmd.name}`}
              role="option"
              aria-selected={navIndex === selectedIndex}
              className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors ${navIndex === selectedIndex ? 'bg-surface-600/50 text-surface-100' : 'text-surface-300 hover:bg-surface-700/50 hover:text-surface-100'}`}
              onClick={() => onSelect(cmd)}
              onMouseEnter={() => { setSelectedIndex(navIndex); setHoveredIndex(navIndex) }}
              onMouseLeave={() => setHoveredIndex(null)}
            >
              <span className="text-surface-400 text-sm font-mono w-5 flex-shrink-0">/</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{cmd.name}</span>
                  {getSourceBadge(cmd.source)}
                </div>
                {cmd.description && (
                  <p className={`text-xs mt-0.5 transition-all ${isHovered ? 'text-surface-300' : 'text-surface-500 truncate'}`}>{cmd.description}</p>
                )}
              </div>
            </div>
          )
        })}
        {showRecentSection && (
          <div className="px-3 py-1 text-[10px] text-surface-500 font-medium uppercase tracking-wider border-t border-surface-700/50 mt-1 pt-1">
            All Commands
          </div>
        )}
        {otherCommands.map((cmd) => {
          const navIndex = showRecentSection
            ? recentCommands.length + otherCommands.indexOf(cmd)
            : filteredCommands.indexOf(cmd)
          const isHovered = hoveredIndex === navIndex
          return (
            <div
              key={`other-${cmd.source}-${cmd.name}`}
              role="option"
              aria-selected={navIndex === selectedIndex}
              className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors ${navIndex === selectedIndex ? 'bg-surface-600/50 text-surface-100' : 'text-surface-300 hover:bg-surface-700/50 hover:text-surface-100'}`}
              onClick={() => onSelect(cmd)}
              onMouseEnter={() => { setSelectedIndex(navIndex); setHoveredIndex(navIndex) }}
              onMouseLeave={() => setHoveredIndex(null)}
            >
              <span className="text-surface-400 text-sm font-mono w-5 flex-shrink-0">/</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{cmd.name}</span>
                  {getSourceBadge(cmd.source)}
                </div>
                {cmd.description && (
                  <p className={`text-xs mt-0.5 transition-all ${isHovered ? 'text-surface-300' : 'text-surface-500 truncate'}`}>{cmd.description}</p>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div className="px-3 py-1.5 border-t border-surface-700 flex items-center gap-4 text-[10px] text-surface-500">
        <span>↑↓ navigate
        </span>
        <span>↵ select
        </span>
        <span>Tab complete
        </span>
        <span>Esc close
        </span>
      </div>
    </div>,
    document.body
  )
}
