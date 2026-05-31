import React, { useMemo } from 'react'
import type { CommandInfo } from '../../../../shared/ipc-types'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '../ui/command'

interface GlobalCommandPaletteProps {
  /** Whether the palette is visible */
  visible: boolean
  /** Commands to display */
  commands: CommandInfo[]
  /** Whether commands are still loading */
  isLoading?: boolean
  /** Called when a command is selected */
  onSelect: (command: CommandInfo) => void
  /** Called when the palette should close */
  onClose: () => void
  /** Set of recently used command names for section separation */
  recentCommandNames?: Set<string>
}

/** Source badge colors matching CommandPalette.tsx */
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
    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${colorClass}`}>
      {source}
    </span>
  )
}

/**
 * GlobalCommandPalette — Modal command palette triggered by Ctrl+Shift+P / Ctrl+K.
 * Uses the shadcn/ui CommandDialog (cmdk) for keyboard navigation, search, and accessibility.
 */
export function GlobalCommandPalette({ visible, commands, isLoading, onSelect, onClose, recentCommandNames }: GlobalCommandPaletteProps) {
  // Split into recent/other sections
  const { recentCommands, otherCommands, showRecentSection } = useMemo(() => {
    if (!recentCommandNames || recentCommandNames.size === 0) {
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
  }, [commands, recentCommandNames])

  const handleSelect = React.useCallback((commandName: string) => {
    // Find the command by name across both sections
    const cmd = recentCommands.find(c => c.name === commandName) || otherCommands.find(c => c.name === commandName)
    if (cmd) {
      onSelect(cmd)
      onClose()
    }
  }, [recentCommands, otherCommands, onSelect, onClose])

  return (
    <CommandDialog
      open={visible}
      onOpenChange={(open) => { if (!open) onClose() }}
      title="Command Palette"
      description="Search for a command to run..."
      className="bg-surface-900/95 border-surface-700/70 backdrop-blur-md [&_[cmdk-group-heading]]:text-text-muted [&_[cmdk-input-wrapper]]:border-surface-800/60 [&_[cmdk-input]]:text-text-primary [&_[cmdk-input]]:placeholder:text-text-muted [&_[cmdk-empty]]:text-text-muted [&_[cmdk-item]]:text-text-secondary [&_[cmdk-item][data-selected=true]]:bg-accent-400/10 [&_[cmdk-item][data-selected=true]]:text-text-primary"
      showCloseButton={false}
    >
      <CommandInput placeholder="Search commands..." />
      <CommandList>
        {isLoading ? (
          <div className="flex items-center justify-center py-6 text-text-muted text-sm">
            <svg className="w-4 h-4 animate-spin mr-2" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" strokeDasharray="31.4 31.4" strokeLinecap="round" />
            </svg>
            Loading commands...
          </div>
        ) : (
          <>
            <CommandEmpty>No commands found</CommandEmpty>
            {showRecentSection && (
              <CommandGroup heading="Recent">
                {recentCommands.map((cmd) => (
                  <CommandItem
                    key={`recent-${cmd.name}`}
                    value={cmd.name}
                    onSelect={handleSelect}
                    className="flex items-center gap-3 text-[12px] cursor-pointer"
                  >
                    <span className="font-mono font-medium flex-1 truncate">{cmd.name}</span>
                    {cmd.description && (
                      <span className="text-[12px] text-text-muted truncate max-w-[200px]">{cmd.description}</span>
                    )}
                    {getSourceBadge(cmd.source)}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {showRecentSection && <CommandSeparator />}
            <CommandGroup heading={showRecentSection ? 'All Commands' : 'Commands'}>
              {otherCommands.map((cmd) => (
                <CommandItem
                  key={`other-${cmd.name}`}
                  value={cmd.name}
                  onSelect={handleSelect}
                  className="flex items-center gap-3 text-[12px] cursor-pointer"
                >
                  <span className="font-mono font-medium flex-1 truncate">{cmd.name}</span>
                  {cmd.description && (
                    <span className="text-[12px] text-text-muted truncate max-w-[200px]">{cmd.description}</span>
                  )}
                  {getSourceBadge(cmd.source)}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  )
}
