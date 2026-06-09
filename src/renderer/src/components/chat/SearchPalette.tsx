/**
 * SearchPalette.tsx — Multi-mode search dialog for NekoCode.
 *
 * Extends the CommandDialog (cmdk) to provide a unified search interface with four modes:
 *   - 'all'      : No prefix → search commands + files + sessions
 *   - 'commands' : '>' prefix → slash commands only
 *   - 'files'    : '@' prefix → file search only
 *   - 'sessions' : ':' prefix → session search only
 *
 * Mode is detected automatically from the input prefix via useSearchMode.
 * Mode tabs at the top allow explicit mode switching.
 *
 * Replaces the GlobalCommandPalette with a superset of its functionality.
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import type { CommandInfo, SearchResultEntry } from '../../../../shared/ipc-types'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '../ui/command'
import { useSearchMode, type SearchMode } from '../../hooks/useSearchMode'
import { useSearchFiles } from '../../hooks/useSearchFiles'
import { useSearchSessions } from '../../hooks/useSearchSessions'

// ━━ Props ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface SearchPaletteProps {
  /** Whether the palette is visible */
  visible: boolean
  /** Initial mode to open with (default: 'all') */
  initialMode?: SearchMode
  /** Commands to display (from useCommands) */
  commands: CommandInfo[]
  /** Whether commands are still loading */
  isCommandsLoading?: boolean
  /** The current project path for file search */
  projectPath: string | null
  /** Called when a command is selected */
  onCommandSelect: (command: CommandInfo) => void
  /** Called when a file is selected */
  onFileSelect: (file: SearchResultEntry) => void
  /** Called when a session is selected */
  onSessionSelect: (sessionId: string, cwd: string) => void
  /** Called when the palette should close */
  onClose: () => void
  /** Set of recently used command names */
  recentCommandNames?: Set<string>
}

// ━━ Mode tab config ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface ModeTab {
  mode: SearchMode
  label: string
  prefix: string
  icon: string
}

const MODE_TABS: ModeTab[] = [
  { mode: 'all', label: 'All', prefix: '', icon: '🔍' },
  { mode: 'commands', label: 'Commands', prefix: '>', icon: '⌘' },
  { mode: 'files', label: 'Files', prefix: '@', icon: '📄' },
  { mode: 'sessions', label: 'Sessions', prefix: ':', icon: '💬' },
]

// ━━ Source badge colors ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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

// ━━ Component ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function SearchPalette({
  visible,
  initialMode = 'all',
  commands,
  isCommandsLoading,
  projectPath,
  onCommandSelect,
  onFileSelect,
  onSessionSelect,
  onClose,
  recentCommandNames,
}: SearchPaletteProps) {
  // Track the raw input value so we can detect mode from prefix
  const [rawInput, setRawInput] = useState('')
  const [manualMode, setManualMode] = useState<SearchMode | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Detect mode from input prefix
  const { mode: detectedMode, query } = useSearchMode(rawInput)

  // Manual mode overrides detected mode when user clicks a tab
  const activeMode = manualMode ?? detectedMode

  // Reset state when visibility changes
  useEffect(() => {
    if (visible) {
      setRawInput('')
      setManualMode(initialMode === 'all' ? null : initialMode)
      // Focus the input after the dialog opens
      setTimeout(() => {
        inputRef.current?.focus()
      }, 50)
    } else {
      setRawInput('')
      setManualMode(null)
    }
  }, [visible, initialMode])

  // File search
  const { results: fileResults, isLoading: isFilesLoading } = useSearchFiles(
    projectPath,
    // Only search files when the mode includes files
    activeMode === 'files' || activeMode === 'all' ? query : '',
  )

  // Session search
  const sessionResults = useSearchSessions(
    activeMode === 'sessions' || activeMode === 'all' ? query : '',
  )

  // Split commands into recent/other sections
  const { recentCommands, otherCommands } = useMemo(() => {
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
    return { recentCommands: recent, otherCommands: other }
  }, [commands, recentCommandNames])

  // Filter commands based on query when in command or all mode
  const filteredCommands = useMemo(() => {
    if (activeMode !== 'commands' && activeMode !== 'all') return []
    if (!query.trim()) return otherCommands
    const lowerQ = query.toLowerCase()
    return otherCommands.filter(
      (cmd) =>
        cmd.name.toLowerCase().includes(lowerQ) ||
        (cmd.description && cmd.description.toLowerCase().includes(lowerQ)),
    )
  }, [activeMode, query, otherCommands])

  const filteredRecent = useMemo(() => {
    if (activeMode !== 'commands' && activeMode !== 'all') return []
    if (!query.trim()) return recentCommands
    const lowerQ = query.toLowerCase()
    return recentCommands.filter(
      (cmd) =>
        cmd.name.toLowerCase().includes(lowerQ) ||
        (cmd.description && cmd.description.toLowerCase().includes(lowerQ)),
    )
  }, [activeMode, query, recentCommands])

  // Handle command selection
  const handleCommandSelect = useCallback(
    (commandName: string) => {
      const cmd =
        filteredRecent.find((c) => c.name === commandName) ||
        filteredCommands.find((c) => c.name === commandName)
      if (cmd) {
        onCommandSelect(cmd)
        onClose()
      }
    },
    [filteredRecent, filteredCommands, onCommandSelect, onClose],
  )

  // Handle file selection
  const handleFileSelect = useCallback(
    (filePath: string) => {
      const file = fileResults.find((f) => f.relativePath === filePath || f.absolutePath === filePath)
      if (file) {
        onFileSelect(file)
        onClose()
      }
    },
    [fileResults, onFileSelect, onClose],
  )

  // Handle session selection
  const handleSessionSelect = useCallback(
    (sessionId: string) => {
      const session = sessionResults.find((s) => s.sessionId === sessionId)
      if (session) {
        onSessionSelect(session.sessionId, session.cwd)
        onClose()
      }
    },
    [sessionResults, onSessionSelect, onClose],
  )

  // Handle mode tab click
  const handleModeTabClick = useCallback((tabMode: SearchMode) => {
    if (tabMode === 'all') {
      setManualMode(null)
      // Clear any prefix from input
      setRawInput((prev) => {
        const trimmed = prev.trimStart()
        if (trimmed && ('>@:'.includes(trimmed[0]!))) {
          return trimmed.slice(1).trimStart()
        }
        return prev
      })
    } else {
      setManualMode(tabMode)
      // Prepend the mode prefix to input
      const prefix = MODE_TABS.find((t) => t.mode === tabMode)?.prefix ?? ''
      setRawInput(prefix + ' ')
    }
  }, [])

  // Handle input change — detect mode from prefix
  const handleInputChange = useCallback((value: string) => {
    setRawInput(value)
    // If user typed a prefix, clear manual mode override (auto-detect takes over)
    const trimmed = value.trimStart()
    if (trimmed && ('>@:'.includes(trimmed[0]!))) {
      setManualMode(null)
    }
  }, [])

  // Determine what to show
  const showCommands = activeMode === 'commands' || activeMode === 'all'
  const showFiles = activeMode === 'files' || activeMode === 'all'
  const showSessions = activeMode === 'sessions' || activeMode === 'all'

  const hasAnyResults =
    (showCommands && (filteredRecent.length > 0 || filteredCommands.length > 0)) ||
    (showFiles && fileResults.length > 0) ||
    (showSessions && sessionResults.length > 0)

  return (
    <CommandDialog
      open={visible}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title="Search"
      description="Search commands, files, and sessions..."
      className="bg-surface-900/95 border-surface-700/70 backdrop-blur-md [&_[cmdk-group-heading]]:text-text-muted [&_[cmdk-input-wrapper]]:border-surface-800/60 [&_[cmdk-input]]:text-text-primary [&_[cmdk-input]]:placeholder:text-text-muted [&_[cmdk-empty]]:text-text-muted [&_[cmdk-item]]:text-text-secondary [&_[cmdk-item][data-selected=true]]:bg-accent-400/10 [&_[cmdk-item][data-selected=true]]:text-text-primary"
      showCloseButton={false}
    >
      {/* Mode tabs */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-surface-800/60">
        {MODE_TABS.map((tab) => (
          <button
            key={tab.mode}
            type="button"
            onClick={() => handleModeTabClick(tab.mode)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
              activeMode === tab.mode
                ? 'bg-accent-400/15 text-accent-400 border border-accent-400/30'
                : 'text-text-muted hover:text-text-secondary hover:bg-surface-800/40 border border-transparent'
            }`}
          >
            <span className="text-[10px]">{tab.icon}</span>
            {tab.label}
            {tab.prefix && (
              <kbd className="text-[9px] px-1 py-0.5 rounded bg-surface-800/60 text-text-muted font-mono">
                {tab.prefix}
              </kbd>
            )}
          </button>
        ))}
      </div>

      {/* Search input */}
      <CommandInput
        placeholder="Search... (prefix with > @ : to filter by mode)"
        value={rawInput}
        onValueChange={handleInputChange}
        ref={inputRef as React.Ref<HTMLInputElement>}
      />

      <CommandList>
        {/* Loading state */}
        {(isCommandsLoading || isFilesLoading) && !hasAnyResults ? (
          <div className="flex items-center justify-center py-6 text-text-muted text-sm">
            <svg className="w-4 h-4 animate-spin mr-2" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" strokeDasharray="31.4 31.4" strokeLinecap="round" />
            </svg>
            Searching...
          </div>
        ) : !hasAnyResults && query.trim() ? (
          <CommandEmpty>No results found</CommandEmpty>
        ) : !hasAnyResults ? (
          <CommandEmpty>Type to search commands, files, and sessions</CommandEmpty>
        ) : (
          <>
            {/* Recent Commands Section */}
            {showCommands && filteredRecent.length > 0 && (
              <CommandGroup heading="Recent Commands">
                {filteredRecent.map((cmd) => (
                  <CommandItem
                    key={`recent-${cmd.name}`}
                    value={cmd.name}
                    onSelect={handleCommandSelect}
                    className="flex items-center gap-3 text-[12px] cursor-pointer"
                  >
                    <span className="font-mono font-medium flex-1 truncate">{cmd.name}</span>
                    {cmd.description && (
                      <span className="text-[12px] text-text-muted truncate max-w-[200px]">
                        {cmd.description}
                      </span>
                    )}
                    {getSourceBadge(cmd.source)}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {/* Commands Section */}
            {showCommands && filteredCommands.length > 0 && (
              <>
                {filteredRecent.length > 0 && <CommandSeparator />}
                <CommandGroup heading={filteredRecent.length > 0 ? 'All Commands' : 'Commands'}>
                  {filteredCommands.map((cmd) => (
                    <CommandItem
                      key={`other-${cmd.name}`}
                      value={cmd.name}
                      onSelect={handleCommandSelect}
                      className="flex items-center gap-3 text-[12px] cursor-pointer"
                    >
                      <span className="font-mono font-medium flex-1 truncate">{cmd.name}</span>
                      {cmd.description && (
                        <span className="text-[12px] text-text-muted truncate max-w-[200px]">
                          {cmd.description}
                        </span>
                      )}
                      {getSourceBadge(cmd.source)}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}

            {/* Files Section */}
            {showFiles && fileResults.length > 0 && (
              <>
                {(showCommands && (filteredRecent.length > 0 || filteredCommands.length > 0)) && (
                  <CommandSeparator />
                )}
                <CommandGroup heading="Files">
                  {fileResults.map((file) => (
                    <CommandItem
                      key={file.absolutePath}
                      value={file.relativePath}
                      onSelect={handleFileSelect}
                      className="flex items-center gap-3 text-[12px] cursor-pointer"
                    >
                      <span className="text-blue-400 shrink-0">📄</span>
                      <span className="font-medium truncate">{file.fileName}</span>
                      <span className="text-[11px] text-text-muted truncate flex-1">
                        {file.relativePath}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}

            {/* Sessions Section */}
            {showSessions && sessionResults.length > 0 && (
              <>
                {((showCommands && (filteredRecent.length > 0 || filteredCommands.length > 0)) ||
                  (showFiles && fileResults.length > 0)) && <CommandSeparator />}
                <CommandGroup heading="Sessions">
                  {sessionResults.map((session) => (
                    <CommandItem
                      key={session.sessionId}
                      value={session.sessionId}
                      onSelect={handleSessionSelect}
                      className="flex items-center gap-3 text-[12px] cursor-pointer"
                    >
                      <span className="text-green-400 shrink-0">💬</span>
                      <span className="font-medium truncate">{session.name}</span>
                      <span className="text-[11px] text-text-muted truncate flex-1">
                        {session.cwd}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </>
        )}
      </CommandList>
    </CommandDialog>
  )
}
