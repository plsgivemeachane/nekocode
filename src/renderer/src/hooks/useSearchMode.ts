/**
 * useSearchMode.ts — Detects the search mode from the user's input prefix.
 *
 * Modes:
 *   - 'commands' : Input starts with '>'  →  slash commands
 *   - 'files'    : Input starts with '@'  →  file search
 *   - 'sessions' : Input starts with ':'  →  session search
 *   - 'all'      : No prefix              →  search everything
 *
 * The prefix character is stripped from the query before passing it downstream.
 */

import { useMemo } from 'react'

export type SearchMode = 'commands' | 'files' | 'sessions' | 'all'

/** Map of prefix characters to their search mode */
const PREFIX_MAP: Record<string, SearchMode> = {
  '>': 'commands',
  '@': 'files',
  ':': 'sessions',
}

interface SearchModeResult {
  /** The detected search mode */
  mode: SearchMode
  /** The query with the prefix character stripped */
  query: string
}

/**
 * Parse the raw input value and detect the search mode.
 * The prefix character (>, @, :) is consumed — not passed to downstream search.
 */
export function useSearchMode(rawInput: string): SearchModeResult {
  return useMemo(() => {
    const trimmed = rawInput.trimStart()
    if (!trimmed) {
      return { mode: 'all', query: '' }
    }

    const firstChar = trimmed[0]!
    const detectedMode = PREFIX_MAP[firstChar]

    if (detectedMode) {
      // Strip the prefix and any leading whitespace after it
      const query = trimmed.slice(1).trimStart()
      return { mode: detectedMode, query }
    }

    // No recognized prefix — search everything
    return { mode: 'all', query: trimmed }
  }, [rawInput])
}
