import React, { useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import type { CommandInfo } from '../../../../shared/ipc-types'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '../ui/command'

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

/**
 * CommandPalette — Inline slash-command palette anchored to the chat input.
 * Uses the shadcn/ui Command (cmdk) for keyboard navigation and search.
 * Positioned via portal to avoid clipping issues.
 */
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
  // Split into recent/other sections when no active filter query
  const { recentCommands, otherCommands, showRecentSection } = useMemo(() => {
    if (query || !recentCommandNames || recentCommandNames.size === 0) {
      return { recentCommands: [], otherCommands: commands, showRecentSection: false }
    }
    const recent: CommandInfo[] = []
    const other: CommandInfo[] = []
    for (const cmd of commands) {
      if (recentCommandNames.has(cmd.name)) {
        recent.push(cmd)
      } else {
        other.push(cmd)
      }
    }
    return { recentCommands: recent, otherCommands: other, showRecentSection: recent.length > 0 && other.length > 0 }
  }, [commands, query, recentCommandNames])

  const handleSelect = React.useCallback((commandName: string) => {
    // Find the command by name across both sections
    const cmd = recentCommands.find(c => c.name === commandName) || otherCommands.find(c => c.name === commandName)
    if (cmd) {
      onSelect(cmd)
    }
  }, [recentCommands, otherCommands, onSelect])

  // Close on Escape — cmdk handles ArrowUp/Down/Enter natively
  useEffect(() => {
    if (!visible) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [visible, onClose])

  if (!visible || !anchorRect) return null

  // Position the palette above the input
  const style: React.CSSProperties = {
    position: 'fixed',
    left: anchorRect.left,
    bottom: window.innerHeight - anchorRect.top + 4,
    width: Math.max(anchorRect.width, 320),
    maxHeight: '280px',
    zIndex: 50,
  }

  return createPortal(
    <div
      style={style}
      className="rounded-lg overflow-hidden shadow-xl"
      role="listbox"
      aria-label="Slash commands"
    >
      <Command
        className="bg-surface-800 border border-surface-600 [&_[cmdk-group-heading]]:text-surface-500 [&_[cmdk-input-wrapper]]:border-surface-700 [&_[cmdk-input]]:text-surface-200 [&_[cmdk-input]]:placeholder:text-surface-500 [&_[cmdk-empty]]:text-surface-500 [&_[cmdk-item]]:text-surface-300 [&_[cmdk-item][data-selected=true]]:bg-surface-600/50 [&_[cmdk-item][data-selected=true]]:text-surface-100"
        // Pass the query to cmdk so it filters by default
        filter={(value, search) => {
          // When we have an external query, cmdk handles filtering via the search prop
          // If the value includes the search string, it matches
          if (value.toLowerCase().includes(search.toLowerCase())) return 1
          // Also check description match — we encode it in the value as "name|description"
          return 0
        }}
      >
        {/* Hidden input — we drive search from the external query */}
        <CommandInput value={query} onValueChange={() => {}} className="hidden" />

        {/* Header */}
        <div className="px-3 py-2 border-b border-surface-700 flex items-center justify-between">
          <span className="text-xs text-surface-400 font-medium">Commands</span>
          {isLoading ? (
            <span className="text-xs text-surface-500">Loading...</span>
          ) : (
            <span className="text-xs text-surface-500">{commands.length} available</span>
          )}
        </div>

        <CommandList className="max-h-[200px]">
          {isLoading ? (
            <div className="px-3 py-4 text-center text-sm text-surface-500">Loading commands...</div>
          ) : (
            <>
              <CommandEmpty>No commands found</CommandEmpty>
              {showRecentSection && (
                <CommandGroup heading="Recent">
                  {recentCommands.map((cmd) => (
                    <CommandItem
                      key={`recent-${cmd.source}-${cmd.name}`}
                      value={`${cmd.name}|${cmd.description || ''}`}
                      onSelect={() => handleSelect(cmd.name)}
                      className="flex items-center gap-3 text-sm cursor-pointer"
                    >
                      <span className="text-surface-400 text-sm font-mono w-5 flex-shrink-0">/</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">{cmd.name}</span>
                          {getSourceBadge(cmd.source)}
                        </div>
                        {cmd.description && (
                          <p className="text-xs text-surface-500 mt-0.5 truncate">{cmd.description}</p>
                        )}
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {showRecentSection && <CommandSeparator />}
              <CommandGroup heading={showRecentSection ? 'All Commands' : undefined}>
                {otherCommands.map((cmd) => (
                  <CommandItem
                    key={`other-${cmd.source}-${cmd.name}`}
                    value={`${cmd.name}|${cmd.description || ''}`}
                    onSelect={() => handleSelect(cmd.name)}
                    className="flex items-center gap-3 text-sm cursor-pointer"
                  >
                    <span className="text-surface-400 text-sm font-mono w-5 flex-shrink-0">/</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{cmd.name}</span>
                        {getSourceBadge(cmd.source)}
                      </div>
                      {cmd.description && (
                        <p className="text-xs text-surface-500 mt-0.5 truncate">{cmd.description}</p>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>

        {/* Footer */}
        <div className="px-3 py-1.5 border-t border-surface-700 flex items-center gap-4 text-[10px] text-surface-500">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>tab select</span>
          <span>Esc close</span>
        </div>
      </Command>
    </div>,
    document.body
  )
}
