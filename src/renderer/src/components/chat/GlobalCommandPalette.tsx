import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import type { CommandInfo } from '../../../../shared/ipc-types'

/** Source badge colors matching CommandPalette.tsx */
const SOURCE_COLORS: Record<string, string> = {
  extension: 'bg-purple-500/20 text-purple-400',
  skill: 'bg-blue-500/20 text-blue-400',
  prompt: 'bg-green-500/20 text-green-400',
  builtin: 'bg-yellow-500/20 text-yellow-400',
}

interface GlobalCommandPaletteProps {
  /** Whether the palette is visible */
  visible: boolean
  /** Commands to display (already sorted with recent first by useCommands) */
  commands: CommandInfo[]
  /** Whether commands are loading */
  isLoading: boolean
  /** Called when a command is selected */
  onSelect: (command: CommandInfo) => void
  /** Called when the palette should close */
  onClose: () => void
  /** Set of recently used command names for section separation */
  recentCommandNames?: Set<string>
}

/**
 * A global, centered command palette triggered by Ctrl+Shift+P.
 * Unlike the inline CommandPalette (triggered by / in ChatInput),
 * this renders as a modal overlay with its own search input.
 */
export function GlobalCommandPalette({ visible, commands, isLoading, onSelect, onClose, recentCommandNames }: GlobalCommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Filter commands by query
  const filtered = useMemo(() => {
    if (!query) return commands
    const lower = query.toLowerCase()
    return commands.filter(
      (cmd) =>
        cmd.name.toLowerCase().includes(lower) ||
        cmd.description?.toLowerCase().includes(lower)
    )
  }, [commands, query])

  // Split into recent/other sections when no query
  const { recentCommands, otherCommands, showRecentSection } = useMemo(() => {
    if (query || !recentCommandNames || recentCommandNames.size === 0) {
      return { recentCommands: [], otherCommands: filtered, showRecentSection: false }
    }
    const recent: CommandInfo[] = []
    const other: CommandInfo[] = []
    for (const cmd of filtered) {
      if (recentCommandNames.has(cmd.name)) {
        recent.push(cmd)
      } else {
        other.push(cmd)
      }
    }
    return { recentCommands: recent, otherCommands: other, showRecentSection: recent.length > 0 && other.length > 0 }
  }, [filtered, query, recentCommandNames])

  // Navigable count excludes separators
  const navigableCount = showRecentSection
    ? recentCommands.length + otherCommands.length
    : filtered.length

  // Get command at navigation index (skipping separators)
  const getCommandAtIndex = useCallback((index: number): CommandInfo | undefined => {
    if (!showRecentSection) return filtered[index]
    if (index < recentCommands.length) return recentCommands[index]
    return otherCommands[index - recentCommands.length]
  }, [showRecentSection, filtered, recentCommands, otherCommands])

  // Reset state when palette opens/closes
  useEffect(() => {
    if (visible) {
      setQuery('')
      setHighlightedIndex(0)
      // Focus input after a frame to ensure the portal is mounted
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [visible])

  // Clamp highlighted index when filtered list changes
  useEffect(() => {
    if (filtered.length === 0) {
      setHighlightedIndex(-1)
    } else if (highlightedIndex >= filtered.length) {
      setHighlightedIndex(filtered.length - 1)
    } else if (highlightedIndex < 0) {
      setHighlightedIndex(0)
    }
  }, [filtered.length, highlightedIndex])

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightedIndex < 0 || !listRef.current) return
    const el = listRef.current.children[highlightedIndex] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlightedIndex])

  // Global keyboard handler
  useEffect(() => {
    if (!visible) return

    const handler = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setHighlightedIndex(prev => Math.min(prev + 1, filtered.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setHighlightedIndex(prev => Math.max(prev - 1, 0))
          break
        case 'Enter':
          e.preventDefault()
          {
            const cmd = getCommandAtIndex(highlightedIndex)
            if (cmd) onSelect(cmd)
          }
          break
        case 'Escape':
          e.preventDefault()
          onClose()
          break
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [visible, highlightedIndex, onSelect, onClose, getCommandAtIndex])

  if (!visible) return null

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[18vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Palette container */}
      <div className="relative w-full max-w-lg mx-4 rounded-xl border border-surface-700/70 bg-surface-900/95 shadow-2xl shadow-black/40 backdrop-blur-md overflow-hidden animate-fade-in">
        {/* Search input */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-surface-800/60">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" className="text-text-muted shrink-0">
            <path d="M7 12.5a5.5 5.5 0 100-11 5.5 5.5 0 000 11z" stroke="currentColor" strokeWidth="1.3" />
            <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search commands..."
            className="flex-1 text-sm bg-transparent text-text-primary placeholder:text-text-muted focus:outline-none font-mono"
          />
          <kbd className="text-[10px] font-mono text-text-muted px-1.5 py-0.5 bg-surface-800/80 rounded border border-surface-700/50">Esc</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-64 overflow-y-auto py-1.5">
          {isLoading ? (
            <div className="flex items-center justify-center py-6 text-text-muted text-sm">
              <svg className="w-4 h-4 animate-spin mr-2" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" strokeDasharray="31.4 31.4" strokeLinecap="round" />
              </svg>
              Loading commands…
            </div>
          ) : navigableCount === 0 ? (
            <div className="py-6 text-center text-text-muted text-sm">No commands found</div>
          ) : (
            <>
              {showRecentSection && (
                <div className="px-4 py-1 text-[10px] text-text-muted font-medium uppercase tracking-wider">
                  Recent
                </div>
              )}
              {recentCommands.map((cmd) => {
                const idx = filtered.indexOf(cmd)
                const isHighlighted = idx === highlightedIndex
                const isHovered = hoveredIndex === idx
                const sourceColor = SOURCE_COLORS[cmd.source] ?? SOURCE_COLORS.builtin
                return (
                  <button
                    key={`recent-${cmd.name}`}
                    onClick={() => onSelect(cmd)}
                    onMouseEnter={() => { setHighlightedIndex(idx); setHoveredIndex(idx) }}
                    onMouseLeave={() => setHoveredIndex(null)}
                    className={`w-full text-left px-4 py-2 flex items-center gap-3 transition-colors ${
                      isHighlighted
                        ? 'bg-accent-400/10 text-text-primary'
                        : 'text-text-secondary'
                    }`}
                  >
                    <span className={`text-[12px] font-mono font-medium truncate flex-1 ${isHighlighted ? 'text-text-primary' : ''}`}>
                      {cmd.name}
                    </span>
                    {cmd.description && (
                      <span className={`text-[12px] truncate transition-colors ${isHovered ? 'text-text-secondary max-w-[300px]' : 'text-text-muted max-w-[200px]'}`}>{cmd.description}</span>
                    )}
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${sourceColor}`}>
                      {cmd.source}
                    </span>
                  </button>
                )
              })}
              {showRecentSection && (
                <div className="px-4 py-1 text-[10px] text-text-muted font-medium uppercase tracking-wider border-t border-surface-800/60 mt-1 pt-1">
                  All Commands
                </div>
              )}
              {otherCommands.map((cmd) => {
                const idx = showRecentSection
                  ? recentCommands.length + otherCommands.indexOf(cmd)
                  : filtered.indexOf(cmd)
                const isHighlighted = idx === highlightedIndex
                const isHovered = hoveredIndex === idx
                const sourceColor = SOURCE_COLORS[cmd.source] ?? SOURCE_COLORS.builtin
                return (
                  <button
                    key={`other-${cmd.name}`}
                    onClick={() => onSelect(cmd)}
                    onMouseEnter={() => { setHighlightedIndex(idx); setHoveredIndex(idx) }}
                    onMouseLeave={() => setHoveredIndex(null)}
                    className={`w-full text-left px-4 py-2 flex items-center gap-3 transition-colors ${
                      isHighlighted
                        ? 'bg-accent-400/10 text-text-primary'
                        : 'text-text-secondary'
                    }`}
                  >
                    <span className={`text-[12px] font-mono font-medium truncate flex-1 ${isHighlighted ? 'text-text-primary' : ''}`}>
                      {cmd.name}
                    </span>
                    {cmd.description && (
                      <span className={`text-[12px] truncate transition-colors ${isHovered ? 'text-text-secondary max-w-[300px]' : 'text-text-muted max-w-[200px]'}`}>{cmd.description}</span>
                    )}
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${sourceColor}`}>
                      {cmd.source}
                    </span>
                  </button>
                )
              })}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-surface-800/60 text-[10px] font-mono text-text-muted">
          <span>&uarr;&darr; navigate &middot; Enter select</span>
          <span>{navigableCount} command{navigableCount !== 1 ? 's' : ''}</span>
        </div>
      </div>
    </div>,
    document.body
  )
}
