/**
 * useGitOperations — React hook that wraps the Git IPC API
 * with automatic refresh, loading states, and error handling.
 *
 * Polls git status on an interval and provides memoized callbacks
 * for all git operations that auto-refresh after mutation.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { useProjectStore } from '../stores/project-store'
import { createLogger } from '../utils/logger'
import type {
  GitStatusResult,
  GitLogResult,
  GitDiffResult,
  GitDiffSummaryResult,
  GitCommitResult,
  GitBranchListResult,
  GitPullResult,
  GitStashListResult,
} from '../../../shared/ipc-types'

const logger = createLogger('useGitOperations')

/** Default polling interval for git status (ms) */
const STATUS_POLL_INTERVAL = 5000

/** Minimum polling interval allowed (ms) */
const MIN_POLL_INTERVAL = 1000

/** Maximum polling interval for backoff (ms) */
const MAX_POLL_INTERVAL = 30000

// ━━ Empty / default states ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const EMPTY_STATUS: GitStatusResult = {
  current: null,
  isClean: true,
  staged: [],
  modified: [],
  untracked: [],
  conflicting: [],
  ahead: 0,
  behind: 0,
}

const EMPTY_LOG: GitLogResult = {
  commits: [],
  total: 0,
}

const EMPTY_BRANCHES: GitBranchListResult = {
  branches: [],
  current: null,
}

const EMPTY_STASHES: GitStashListResult = {
  stashes: [],
}

// ━━ Hook return type ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface UseGitOperationsResult {
  // ── Status ──
  /** Current git status */
  status: GitStatusResult
  /** Whether status is currently being fetched */
  isStatusLoading: boolean
  /** Whether this is the initial load (status hasn't been fetched yet) */
  isInitialLoad: boolean
  /** Last error from a git operation */
  error: string | null
  /** Clear the current error */
  clearError: () => void

  // ── Log ──
  /** Recent commit log */
  log: GitLogResult
  /** Whether log is currently being fetched */
  isLogLoading: boolean

  // ── Branches ──
  /** Branch list */
  branches: GitBranchListResult
  /** Whether branch list is currently being fetched */
  isBranchesLoading: boolean

  // ── Stashes ──
  /** Stash list */
  stashes: GitStashListResult

  // ── Diff ──
  /** Diff result for a selected file */
  selectedDiff: GitDiffResult | null
  /** Whether a diff is being loaded */
  isDiffLoading: boolean

  // ── Diff summary ──
  /** Diff summary for staged/unstaged */
  diffSummary: GitDiffSummaryResult | null

  // ── Mutations ──
  /** Stage a file */
  stageFile: (filePath: string) => Promise<void>
  /** Unstage a file */
  unstageFile: (filePath: string) => Promise<void>
  /** Stage all changes */
  stageAll: () => Promise<void>
  /** Unstage all changes */
  unstageAll: () => Promise<void>
  /** Commit staged changes */
  commit: (message: string) => Promise<GitCommitResult>
  /** Push to remote */
  push: () => Promise<void>
  /** Pull from remote */
  pull: () => Promise<GitPullResult>
  /** Fetch from remote */
  fetch: () => Promise<void>
  /** Create a new branch */
  createBranch: (name: string, checkout?: boolean) => Promise<void>
  /** Switch to a branch */
  switchBranch: (name: string) => Promise<void>
  /** Stash current changes */
  stashChanges: (message?: string) => Promise<void>
  /** Pop the latest stash */
  stashPop: () => Promise<void>

  // ── Queries ──
  /** View diff for a specific file */
  viewDiff: (filePath: string, staged?: boolean) => Promise<void>
  /** Refresh all data */
  refreshAll: () => Promise<void>
  /** Refresh status only */
  refreshStatus: () => Promise<void>
  /** Refresh log only */
  refreshLog: () => Promise<void>
  /** Refresh branches only */
  refreshBranches: () => Promise<void>
  /** Clear the selected diff */
  clearDiff: () => void
}

// ━━ Hook implementation ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function useGitOperations(pollInterval: number = STATUS_POLL_INTERVAL): UseGitOperationsResult {
  const { state } = useProjectStore()
  const activeProjectPath = state.activeProjectPath

  // ── State ──
  const [status, setStatus] = useState<GitStatusResult>(EMPTY_STATUS)
  const [log, setLog] = useState<GitLogResult>(EMPTY_LOG)
  const [branches, setBranches] = useState<GitBranchListResult>(EMPTY_BRANCHES)
  const [stashes, setStashes] = useState<GitStashListResult>(EMPTY_STASHES)
  const [selectedDiff, setSelectedDiff] = useState<GitDiffResult | null>(null)
  const [diffSummary, setDiffSummary] = useState<GitDiffSummaryResult | null>(null)

  const [isStatusLoading, setIsStatusLoading] = useState(false)
  const [isLogLoading, setIsLogLoading] = useState(false)
  const [isBranchesLoading, setIsBranchesLoading] = useState(false)
  const [isDiffLoading, setIsDiffLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ── isInitialLoad sentinel ──
  // Distinguishes "we haven't loaded status yet" from "status loaded and repo is clean"
  const [isInitialLoad, setIsInitialLoad] = useState(true)

  // Track the active project path so we can reset state when it changes
  const prevProjectPathRef = useRef<string | null>(null)
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Operation locking ──
  // Prevents concurrent mutations (stage/unstage/commit) that could race
  const pendingOperationsRef = useRef<Map<string, Promise<void>>>(new Map())

  // ── Polling backoff ──
  // Increases polling interval after consecutive failures
  const consecutiveErrorsRef = useRef(0)
  const effectivePollInterval = useRef(pollInterval)

  // ── Visibility tracking ──
  // Pause polling when the window is hidden to save battery
  const isWindowVisibleRef = useRef(true)

  // ── Helpers ──

  const clearError = useCallback(() => setError(null), [])

  const clearDiff = useCallback(() => {
    setSelectedDiff(null)
    setDiffSummary(null)
  }, [])

  /**
   * Operation lock — prevents concurrent mutations of the same type.
   * If an operation is already in-flight for the same key, the new call waits
   * for the previous one to complete before starting.
   */
  const withLock = useCallback(async <T = void>(key: string, fn: () => Promise<T>): Promise<T> => {
    // Wait for any existing operation with this key to finish
    const existing = pendingOperationsRef.current.get(key)
    if (existing) {
      await existing.catch(() => {}) // swallow error from previous op
    }
    // Start the new operation
    const promise = fn().finally(() => {
      // Only remove if we're still the active promise
      if (pendingOperationsRef.current.get(key) === promise) {
        pendingOperationsRef.current.delete(key)
      }
    }) as Promise<void>
    pendingOperationsRef.current.set(key, promise)
    return promise as unknown as T
  }, [])

  // ── Refresh functions ──

  const refreshStatus = useCallback(async () => {
    if (!activeProjectPath) return
    try {
      setIsStatusLoading(true)
      const result = await window.nekocode.git.getStatus(activeProjectPath)
      setStatus(result)
      // Clear error on success AND reset backoff
      setError(null)
      consecutiveErrorsRef.current = 0
      effectivePollInterval.current = Math.max(pollInterval, MIN_POLL_INTERVAL)
      // Mark initial load as complete
      setIsInitialLoad(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('refreshStatus failed', msg)
      setError(msg)
      // Apply backoff: double the interval on each consecutive error
      consecutiveErrorsRef.current++
      effectivePollInterval.current = Math.min(
        effectivePollInterval.current * 2,
        MAX_POLL_INTERVAL
      )
    } finally {
      setIsStatusLoading(false)
    }
  }, [activeProjectPath, pollInterval])

  const refreshLog = useCallback(async () => {
    if (!activeProjectPath) return
    try {
      setIsLogLoading(true)
      const result = await window.nekocode.git.getLog(activeProjectPath, 50)
      setLog(result)
      // Don't clear error here — only the operation that succeeded should clear its own error
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('refreshLog failed', msg)
      setError(msg)
    } finally {
      setIsLogLoading(false)
    }
  }, [activeProjectPath])

  const refreshBranches = useCallback(async () => {
    if (!activeProjectPath) return
    try {
      setIsBranchesLoading(true)
      const result = await window.nekocode.git.branchList(activeProjectPath)
      setBranches(result)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('refreshBranches failed', msg)
      setError(msg)
    } finally {
      setIsBranchesLoading(false)
    }
  }, [activeProjectPath])

  const refreshStashes = useCallback(async () => {
    if (!activeProjectPath) return
    try {
      const result = await window.nekocode.git.stashList(activeProjectPath)
      setStashes(result)
    } catch (err) {
      logger.debug('refreshStashes failed (may not be a git repo)', err)
    }
  }, [activeProjectPath])

  const refreshAll = useCallback(async () => {
    await Promise.allSettled([refreshStatus(), refreshLog(), refreshBranches(), refreshStashes()])
  }, [refreshStatus, refreshLog, refreshBranches, refreshStashes])

  // ── Mutations (auto-refresh status after mutation) ──

  const stageFile = useCallback(async (filePath: string) => {
    if (!activeProjectPath) return
    await withLock('stage', async () => {
      try {
        await window.nekocode.git.stage(activeProjectPath, filePath)
        await refreshStatus()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        throw err
      }
    })
  }, [activeProjectPath, refreshStatus, withLock])

  const unstageFile = useCallback(async (filePath: string) => {
    if (!activeProjectPath) return
    await withLock('unstage', async () => {
      try {
        await window.nekocode.git.unstage(activeProjectPath, filePath)
        await refreshStatus()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        throw err
      }
    })
  }, [activeProjectPath, refreshStatus, withLock])

  const stageAll = useCallback(async () => {
    if (!activeProjectPath) return
    await withLock('stageAll', async () => {
      try {
        await window.nekocode.git.stageAll(activeProjectPath)
        await refreshStatus()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        throw err
      }
    })
  }, [activeProjectPath, refreshStatus, withLock])

  const unstageAll = useCallback(async () => {
    if (!activeProjectPath) return
    await withLock('unstageAll', async () => {
      try {
        await window.nekocode.git.unstageAll(activeProjectPath)
        await refreshStatus()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        throw err
      }
    })
  }, [activeProjectPath, refreshStatus, withLock])

  const commit = useCallback(async (message: string): Promise<GitCommitResult> => {
    if (!activeProjectPath) throw new Error('No active project')
    return withLock<GitCommitResult>('commit', async () => {
      const result = await window.nekocode.git.commit(activeProjectPath, message)
      await Promise.allSettled([refreshStatus(), refreshLog()])
      setError(null)
      return result
    })
  }, [activeProjectPath, refreshStatus, refreshLog, withLock])

  const push = useCallback(async () => {
    if (!activeProjectPath) return
    try {
      await window.nekocode.git.push(activeProjectPath)
      await refreshStatus()
      setError(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      throw err
    }
  }, [activeProjectPath, refreshStatus])

  const pull = useCallback(async (): Promise<GitPullResult> => {
    if (!activeProjectPath) throw new Error('No active project')
    try {
      const result = await window.nekocode.git.pull(activeProjectPath)
      await Promise.allSettled([refreshStatus(), refreshLog()])
      setError(null)
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      throw err
    }
  }, [activeProjectPath, refreshStatus, refreshLog])

  const fetch = useCallback(async () => {
    if (!activeProjectPath) return
    try {
      await window.nekocode.git.fetch(activeProjectPath)
      await refreshStatus()
      setError(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      throw err
    }
  }, [activeProjectPath, refreshStatus])

  const createBranch = useCallback(async (name: string, checkout: boolean = true) => {
    if (!activeProjectPath) return
    try {
      await window.nekocode.git.branchCreate(activeProjectPath, name, checkout)
      await Promise.allSettled([refreshBranches(), refreshStatus()])
      setError(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      throw err
    }
  }, [activeProjectPath, refreshBranches, refreshStatus])

  const switchBranch = useCallback(async (name: string) => {
    if (!activeProjectPath) return
    try {
      await window.nekocode.git.branchSwitch(activeProjectPath, name)
      await Promise.allSettled([refreshBranches(), refreshStatus(), refreshLog()])
      setError(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      throw err
    }
  }, [activeProjectPath, refreshBranches, refreshStatus, refreshLog])

  const stashChanges = useCallback(async (message?: string) => {
    if (!activeProjectPath) return
    try {
      await window.nekocode.git.stash(activeProjectPath, message)
      await Promise.allSettled([refreshStatus(), refreshStashes()])
      setError(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      throw err
    }
  }, [activeProjectPath, refreshStatus, refreshStashes])

  const stashPop = useCallback(async () => {
    if (!activeProjectPath) return
    try {
      await window.nekocode.git.stashPop(activeProjectPath)
      await Promise.allSettled([refreshStatus(), refreshStashes()])
      setError(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      throw err
    }
  }, [activeProjectPath, refreshStatus, refreshStashes])

  // ── Diff queries ──

  const viewDiff = useCallback(async (filePath: string, staged: boolean = false) => {
    if (!activeProjectPath) return
    try {
      setIsDiffLoading(true)
      const [diffResult, summaryResult] = await Promise.all([
        window.nekocode.git.getDiff(activeProjectPath, filePath, staged),
        window.nekocode.git.getDiffSummary(activeProjectPath, staged),
      ])
      setSelectedDiff(diffResult)
      setDiffSummary(summaryResult)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
    } finally {
      setIsDiffLoading(false)
    }
  }, [activeProjectPath])

  // ── Auto-poll status on mount and when project changes ──

  useEffect(() => {
    // Reset state when project changes
    if (prevProjectPathRef.current !== activeProjectPath) {
      setStatus(EMPTY_STATUS)
      setLog(EMPTY_LOG)
      setBranches(EMPTY_BRANCHES)
      setStashes(EMPTY_STASHES)
      setSelectedDiff(null)
      setDiffSummary(null)
      setError(null)
      setIsInitialLoad(true)
      consecutiveErrorsRef.current = 0
      effectivePollInterval.current = pollInterval
      prevProjectPathRef.current = activeProjectPath
    }

    // ── Visibility-based polling pause ──
    const handleVisibilityChange = () => {
      isWindowVisibleRef.current = !document.hidden
      // When becoming visible again, immediately refresh and restart polling
      if (!document.hidden && activeProjectPath) {
        refreshStatus()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    // Initial load
    if (activeProjectPath) {
      refreshAll()
    }

    // Set up polling with backoff — only poll when window is visible
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current)
    }

    if (activeProjectPath) {
      pollTimerRef.current = setInterval(() => {
        // Skip polling if window is hidden
        if (!isWindowVisibleRef.current) return
        refreshStatus()
      }, effectivePollInterval.current)
    }

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [activeProjectPath, refreshAll, refreshStatus, pollInterval])

  return {
    status,
    isStatusLoading,
    isInitialLoad,
    error,
    clearError,
    log,
    isLogLoading,
    branches,
    isBranchesLoading,
    stashes,
    selectedDiff,
    isDiffLoading,
    diffSummary,
    stageFile,
    unstageFile,
    stageAll,
    unstageAll,
    commit,
    push,
    pull,
    fetch,
    createBranch,
    switchBranch,
    stashChanges,
    stashPop,
    viewDiff,
    refreshAll,
    refreshStatus,
    refreshLog,
    refreshBranches,
    clearDiff,
  }
}
