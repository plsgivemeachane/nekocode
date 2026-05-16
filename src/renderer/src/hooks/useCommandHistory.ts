import { useState, useCallback, useEffect, useRef } from 'react'
import { createLogger } from '../utils/logger'

const logger = createLogger('useCommandHistory')

/** Storage key for command history in localStorage */
const STORAGE_KEY = 'nekocode:command-history'

/** Maximum number of recent commands to track */
const MAX_HISTORY = 10

/** A single command history entry */
export interface CommandHistoryEntry {
  /** Command name (without / prefix) */
  name: string
  /** Command source type */
  source: string
  /** ISO timestamp of when this command was last used */
  lastUsed: string
  /** Number of times this command has been used */
  useCount: number
}

export interface UseCommandHistoryOutput {
  /** Record recent command usage */
  recordUsage: (name: string, source: string) => void
  /** Get the set of recently used command names (most recent first) */
  getRecentNames: () => Set<string>
  /** Get full history entries sorted by most recent */
  getHistory: () => CommandHistoryEntry[]
  /** Clear all command history */
  clearHistory: () => void
}

/** Load history from localStorage */
function loadHistory(): CommandHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as CommandHistoryEntry[]
  } catch (err) {
    logger.warn('Failed to load command history from localStorage:', err)
    return []
  }
}

/** Save history to localStorage */
function saveHistory(entries: CommandHistoryEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY)))
  } catch (err) {
    logger.warn('Failed to save command history to localStorage:', err)
  }
}

/**
 * Manages command usage history persisted in localStorage.
 * Tracks the last N commands used, sorted by recency and frequency.
 */
export function useCommandHistory(): UseCommandHistoryOutput {
  const mountedRef = useRef(true)

  // Keep an in-memory copy to avoid excessive localStorage reads
  const [history, setHistory] = useState<CommandHistoryEntry[]>(() => loadHistory())

  // Sync to localStorage whenever history changes
  useEffect(() => {
    if (mountedRef.current) {
      saveHistory(history)
    }
  }, [history])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const recordUsage = useCallback((name: string, source: string) => {
    setHistory((prev) => {
      // Find existing entry
      const existingIndex = prev.findIndex((e) => e.name === name)
      const now = new Date().toISOString()

      if (existingIndex >= 0) {
        // Update existing: bump to top, increment count
        const updated = [...prev]
        const entry = updated[existingIndex]
        updated.splice(existingIndex, 1)
        updated.unshift({
          ...entry,
          lastUsed: now,
          useCount: entry.useCount + 1,
        })
        return updated.slice(0, MAX_HISTORY)
      }

      // New entry
      return [
        { name, source, lastUsed: now, useCount: 1 },
        ...prev,
      ].slice(0, MAX_HISTORY)
    })
  }, [])

  const getRecentNames = useCallback((): Set<string> => {
    return new Set(history.map((e) => e.name))
  }, [history])

  const getHistory = useCallback((): CommandHistoryEntry[] => {
    return [...history]
  }, [history])

  const clearHistory = useCallback(() => {
    setHistory([])
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // Ignore storage errors on clear
    }
  }, [])

  return {
    recordUsage,
    getRecentNames,
    getHistory,
    clearHistory,
  }
}
