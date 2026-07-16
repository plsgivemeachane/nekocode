/**
 * useSearchFiles.ts — Hook for searching files via the main process.
 *
 * Debounces the query, calls the IPC search:files channel,
 * and provides loading / error / result state.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import type { SearchResultEntry } from '../../../shared/ipc-types'
import { createLogger } from '../utils/logger'

const logger = createLogger('useSearchFiles')

/** Default debounce delay in ms */
const DEBOUNCE_MS = 150

interface UseSearchFilesResult {
  /** Matching file entries */
  results: SearchResultEntry[]
  /** Whether a search is in progress */
  isLoading: boolean
  /** Error message if the search failed */
  error: string | null
  /** Manually trigger a search (useful for initial load) */
  search: (query: string) => Promise<void>
}

/**
 * Search for files in a project directory.
 *
 * @param projectPath - Absolute path to the project root (null = no project, skip search)
 * @param query - The search query string
 * @param debounceMs - Debounce delay in milliseconds
 */
export function useSearchFiles(
  projectPath: string | null | undefined,
  query: string,
  debounceMs: number = DEBOUNCE_MS,
): UseSearchFilesResult {
  const [results, setResults] = useState<SearchResultEntry[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef(false)

  const search = useCallback(async (q: string) => {
    if (!projectPath) {
      setResults([])
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const result = await window.nekocode.search.files({
        projectPath,
        query: q,
        limit: 50,
      })

      // Only update if this search wasn't superseded
      if (!abortRef.current) {
        setResults(result.files)
      }
    } catch (err) {
      logger.error('File search failed', err)
      if (!abortRef.current) {
        setError(err instanceof Error ? err.message : 'Search failed')
        setResults([])
      }
    } finally {
      if (!abortRef.current) {
        setIsLoading(false)
      }
    }
  }, [projectPath])

  // Debounced search effect
  useEffect(() => {
    abortRef.current = false

    // Clear any pending timer
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }

    // If no project, clear results immediately
    if (!projectPath) {
      setResults([])
      setIsLoading(false)
      return
    }

    // Empty query is allowed — the backend returns all files (up to limit)
    // when query is empty, which gives users immediate file suggestions.
    if (!query.trim()) {
      // Still search with empty query to get initial file list
      setIsLoading(true)
      timerRef.current = setTimeout(() => {
        search(query)
      }, debounceMs)
      return
    }

    setIsLoading(true)

    timerRef.current = setTimeout(() => {
      search(query)
    }, debounceMs)

    return () => {
      abortRef.current = true
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [projectPath, query, debounceMs, search])

  return { results, isLoading, error, search }
}
