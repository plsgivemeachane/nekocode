import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type { CommandInfo } from '../../../shared/ipc-types'
import { createLogger } from '../utils/logger'
import { useCommandHistory, type CommandHistoryEntry } from './useCommandHistory'

const logger = createLogger('useCommands')

export interface UseCommandsInput {
  sessionId: string | null
}

export interface UseCommandsOutput {
  /** All available commands for the current session */
  commands: CommandInfo[]
  /** Whether commands are currently being loaded */
  isLoading: boolean
  /** Manually refresh the commands list */
  refreshCommands: () => Promise<void>
  /** Filter commands by a search query */
  filterCommands: (query: string) => CommandInfo[]
  /** Record a command usage for history tracking */
  recordCommandUsage: (name: string, source: string) => void
  /** Get recently used command names */
  getRecentCommandNames: () => Set<string>
  /** Get full command history entries */
  getCommandHistory: () => CommandHistoryEntry[]
}

export function useCommands({ sessionId }: UseCommandsInput): UseCommandsOutput {
  const [commands, setCommands] = useState<CommandInfo[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const mountedRef = useRef(true)

  const refreshCommands = useCallback(async () => {
    if (!sessionId) {
      setCommands([])
      return
    }

    setIsLoading(true)
    try {
      const result = await window.nekocode.session.getCommands(sessionId)
      if (mountedRef.current) {
        setCommands(result)
      }
    } catch (err) {
      logger.error('Failed to fetch commands:', err)
      if (mountedRef.current) {
        setCommands([])
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false)
      }
    }
  }, [sessionId])

  // Fetch commands when sessionId changes
  useEffect(() => {
    mountedRef.current = true
    refreshCommands()
    return () => {
      mountedRef.current = false
    }
  }, [refreshCommands])

  // Command history tracking
  const { recordUsage, getRecentNames, getHistory } = useCommandHistory()

  const filterCommands = useCallback(
    (query: string): CommandInfo[] => {
      if (!query) return commands
      const lower = query.toLowerCase()
      return commands.filter(
        (cmd) =>
          cmd.name.toLowerCase().includes(lower) ||
          cmd.description?.toLowerCase().includes(lower)
      )
    },
    [commands]
  )

  /** Commands sorted with recently used first, then alphabetically */
  const sortedCommands = useMemo(() => {
    const recentNames = getRecentNames()
    const recent: CommandInfo[] = []
    const rest: CommandInfo[] = []

    for (const cmd of commands) {
      if (recentNames.has(cmd.name)) {
        recent.push(cmd)
      } else {
        rest.push(cmd)
      }
    }

    // Sort recent by history order (most recent first)
    const historyOrder = getHistory()
    recent.sort((a, b) => {
      const aIdx = historyOrder.findIndex((h) => h.name === a.name)
      const bIdx = historyOrder.findIndex((h) => h.name === b.name)
      return aIdx - bIdx
    })

    // Sort rest alphabetically by name
    rest.sort((a, b) => a.name.localeCompare(b.name))

    return [...recent, ...rest]
  }, [commands, getRecentNames, getHistory])

  return {
    commands: sortedCommands,
    isLoading,
    refreshCommands,
    filterCommands,
    recordCommandUsage: recordUsage,
    getRecentCommandNames: getRecentNames,
    getCommandHistory: getHistory,
  }
}
