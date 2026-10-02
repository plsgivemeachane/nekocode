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
import { usePolling } from './usePolling'
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

  // ── Repository detection ──
  /** Whether the active project is a git repository. null = not yet checked */
  isGitRepo: boolean | null
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

  // ── isGitRepo flag ──
  // Tracks whether the active project is a git repository.
  // When false, all git operations are skipped and empty state is shown.
  const [isGitRepo, setIsGitRepoState] = useState<boolean | null>(null) // null = not yet checked

  // Keep the ref in sync with the state
  const setIsGitRepo = useCallback((value: boolean | null) => {
    isGitRepoRef.current = value
    setIsGitRepoState(value)
  }, [])

  // ── isInitialLoad sentinel ──
  // Distinguishes "we haven't loaded status yet" from "status loaded and repo is clean"
  const [isInitialLoad, setIsInitialLoad] = useState(true)

  // Track the active project path so we can reset state when it changes
  const prevProjectPathRef = useRef<string | null>(null)

  // Every project switch invalidates work started for the previous project.
  // This is advanced during render so an old promise cannot win before the
  // project-reset effect has run.
  const projectGenerationRef = useRef(0)
  const projectPathRef = useRef(activeProjectPath)
  if (projectPathRef.current !== activeProjectPath) {
    projectPathRef.current = activeProjectPath
    projectGenerationRef.current += 1
  }

  const diffRequestRef = useRef(0)

  // ── Operation locking ──
  // Prevents concurrent mutations (stage/unstage/commit) that could race
  const pendingOperationsRef = useRef<Map<string, Promise<void>>>(new Map())

  // ── Visibility tracking ──
  // Pause polling when the window is hidden to save battery
  // (now handled by usePolling hook)

  // ── Git repo detection ref ──
  // Mirrors the isGitRepo state so the polling interval can read the latest value
  // without being a dependency of the effect that sets up the interval.
  const isGitRepoRef = useRef<boolean | null>(null)

  const isCurrentProjectRequest = useCallback((path: string | null, generation: number) => (
    path === projectPathRef.current && generation === projectGenerationRef.current
  ), [])

  // ── Helpers ──

  const clearError = useCallback(() => setError(null), [])

  const clearDiff = useCallback(() => {
    // Invalidate an in-flight diff so it cannot resurrect after clearing.
    diffRequestRef.current += 1
    setSelectedDiff(null)
    setDiffSummary(null)
    setIsDiffLoading(false)
  }, [])

  /**
   * Operation lock — prevents concurrent mutations of the same type.
   * If an operation is already in-flight for the same key, the new call waits
   * for the previous one to complete before starting.
   */
  const withLock = useCallback(<T = void>(key: string, fn: () => Promise<T>): Promise<T> => {
    // Wait for any existing operation with this key to finish
    const existing = pendingOperationsRef.current.get(key)
    // Start the new operation
    // Start the first operation immediately, while later callers chain from
    // the current tail. Registering each tail before returning keeps three or
    // more callers in strict FIFO order.
    // swallow error from previous op
    const operation = existing ? existing.catch(() => {}).then(fn) : fn()
    const promise = operation.then(() => undefined, () => undefined)
    promise.finally(() => {
      // Only remove if we're still the active promise
      if (pendingOperationsRef.current.get(key) === promise) {
        pendingOperationsRef.current.delete(key)
      }
    })
    pendingOperationsRef.current.set(key, promise)
    return operation
  }, [])

  // ── Refresh functions ──

  const refreshStatus = useCallback(async () => {
    if (!activeProjectPath) return
    // Skip if we know this is not a git repo
    if (isGitRepoRef.current === false) return
    const requestPath = activeProjectPath
    const requestGeneration = projectGenerationRef.current
    try {
      setIsStatusLoading(true)
      const result = await window.nekocode.git.getStatus(requestPath)
      if (!isCurrentProjectRequest(requestPath, requestGeneration)) return
      setStatus(result)
      // Clear error on success
      setError(null)
      // Mark initial load as complete
      setIsInitialLoad(false)
    } catch (err) {
      if (!isCurrentProjectRequest(requestPath, requestGeneration)) return
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('refreshStatus failed', msg)
      setError(msg)
      // Re-throw so that usePolling's backoff mechanism engages.
      // Callers that need to handle this already have their own try/catch.
      throw err
    } finally {
      if (isCurrentProjectRequest(requestPath, requestGeneration)) setIsStatusLoading(false)
    }
  }, [activeProjectPath, isGitRepo, isCurrentProjectRequest])

  const refreshLog = useCallback(async () => {
    if (!activeProjectPath) return
    if (isGitRepoRef.current === false) return
    const requestPath = activeProjectPath
    const requestGeneration = projectGenerationRef.current
    try {
      setIsLogLoading(true)
      const result = await window.nekocode.git.getLog(requestPath, 50)
      if (!isCurrentProjectRequest(requestPath, requestGeneration)) return
      setLog(result)
    } catch (err) {
      if (!isCurrentProjectRequest(requestPath, requestGeneration)) return
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('refreshLog failed', msg)
      setError(msg)
    } finally {
      if (isCurrentProjectRequest(requestPath, requestGeneration)) setIsLogLoading(false)
    }
  }, [activeProjectPath, isGitRepo])

  const refreshBranches = useCallback(async () => {
    if (!activeProjectPath) return
    if (isGitRepoRef.current === false) return
    const requestPath = activeProjectPath
    const requestGeneration = projectGenerationRef.current
    try {
      setIsBranchesLoading(true)
      const result = await window.nekocode.git.branchList(requestPath)
      if (!isCurrentProjectRequest(requestPath, requestGeneration)) return
      setBranches(result)
    } catch (err) {
      if (!isCurrentProjectRequest(requestPath, requestGeneration)) return
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('refreshBranches failed', msg)
      setError(msg)
    } finally {
      if (isCurrentProjectRequest(requestPath, requestGeneration)) setIsBranchesLoading(false)
    }
  }, [activeProjectPath, isGitRepo])

  const refreshStashes = useCallback(async () => {
    if (!activeProjectPath) return
    if (isGitRepoRef.current === false) return
    const requestPath = activeProjectPath
    const requestGeneration = projectGenerationRef.current
    try {
      const result = await window.nekocode.git.stashList(requestPath)
      if (!isCurrentProjectRequest(requestPath, requestGeneration)) return
      setStashes(result)
    } catch (err) {
      logger.debug('refreshStashes failed (may not be a git repo)', err)
    }
  }, [activeProjectPath, isGitRepo])

  const refreshAll = useCallback(async () => {
    await Promise.allSettled([refreshStatus(), refreshLog(), refreshBranches(), refreshStashes()])
  }, [refreshStatus, refreshLog, refreshBranches, refreshStashes])
  const refreshAllRef = useRef(refreshAll)
  refreshAllRef.current = refreshAll

  // ── Mutations (auto-refresh status after mutation) ──

  const stageFile = useCallback(async (filePath: string) => {
    if (!activeProjectPath) return
    if (isGitRepo === false) return
    // Guard: empty string filePath is invalid — the IPC call would receive '' as the path
    if (!filePath.trim()) return
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
  }, [activeProjectPath, isGitRepo, refreshStatus, withLock])

  const unstageFile = useCallback(async (filePath: string) => {
    if (!activeProjectPath) return
    if (isGitRepo === false) return
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
  }, [activeProjectPath, isGitRepo, refreshStatus, withLock])

  const stageAll = useCallback(async () => {
    if (!activeProjectPath) return
    if (isGitRepo === false) return
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
  }, [activeProjectPath, isGitRepo, refreshStatus, withLock])

  const unstageAll = useCallback(async () => {
    if (!activeProjectPath) return
    if (isGitRepo === false) return
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
  }, [activeProjectPath, isGitRepo, refreshStatus, withLock])

  const commit = useCallback(async (message: string): Promise<GitCommitResult> => {
    if (!activeProjectPath) throw new Error('No active project')
    if (isGitRepo === false) throw new Error('Not a git repository')
    // Guard: empty commit message is invalid
    if (!message.trim()) throw new Error('Commit message cannot be empty')
    return withLock<GitCommitResult>('commit', async () => {
      const result = await window.nekocode.git.commit(activeProjectPath, message)
      await Promise.allSettled([refreshStatus(), refreshLog()])
      return result
    })
  }, [activeProjectPath, isGitRepo, refreshStatus, refreshLog, withLock])

  const push = useCallback(async () => {
    if (!activeProjectPath) return
    if (isGitRepo === false) return
    try {
      await window.nekocode.git.push(activeProjectPath)
      await refreshStatus()
      setError(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      throw err
    }
  }, [activeProjectPath, isGitRepo, refreshStatus])

  const pull = useCallback(async (): Promise<GitPullResult> => {
    if (!activeProjectPath) throw new Error('No active project')
    if (isGitRepo === false) throw new Error('Not a git repository')
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
  }, [activeProjectPath, isGitRepo, refreshStatus, refreshLog])

  const fetch = useCallback(async () => {
    if (!activeProjectPath) return
    if (isGitRepo === false) return
    try {
      await window.nekocode.git.fetch(activeProjectPath)
      await refreshStatus()
      setError(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      throw err
    }
  }, [activeProjectPath, isGitRepo, refreshStatus])

  const createBranch = useCallback(async (name: string, checkout: boolean = true) => {
    if (!activeProjectPath) return
    if (isGitRepo === false) return
    try {
      await window.nekocode.git.branchCreate(activeProjectPath, name, checkout)
      await Promise.allSettled([refreshBranches(), refreshStatus()])
      setError(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      throw err
    }
  }, [activeProjectPath, isGitRepo, refreshBranches, refreshStatus])

  const switchBranch = useCallback(async (name: string) => {
    if (!activeProjectPath) return
    if (isGitRepo === false) return
    try {
      await window.nekocode.git.branchSwitch(activeProjectPath, name)
      await Promise.allSettled([refreshBranches(), refreshStatus(), refreshLog()])
      setError(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      throw err
    }
  }, [activeProjectPath, isGitRepo, refreshBranches, refreshStatus, refreshLog])

  const stashChanges = useCallback(async (message?: string) => {
    if (!activeProjectPath) return
    if (isGitRepo === false) return
    try {
      await window.nekocode.git.stash(activeProjectPath, message)
      await Promise.allSettled([refreshStatus(), refreshStashes()])
      setError(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      throw err
    }
  }, [activeProjectPath, isGitRepo, refreshStatus, refreshStashes])

  const stashPop = useCallback(async () => {
    if (!activeProjectPath) return
    if (isGitRepo === false) return
    try {
      await window.nekocode.git.stashPop(activeProjectPath)
      await Promise.allSettled([refreshStatus(), refreshStashes()])
      setError(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      throw err
    }
  }, [activeProjectPath, isGitRepo, refreshStatus, refreshStashes])

  // ── Diff queries ──

  const viewDiff = useCallback(async (filePath: string, staged: boolean = false) => {
    if (!activeProjectPath) return
    if (isGitRepoRef.current === false) return
    const requestPath = activeProjectPath
    const requestGeneration = projectGenerationRef.current
    const requestId = ++diffRequestRef.current
    try {
      setIsDiffLoading(true)
      const [diffResult, summaryResult] = await Promise.all([
        window.nekocode.git.getDiff(requestPath, filePath, staged),
        window.nekocode.git.getDiffSummary(requestPath, staged),
      ])
      if (!isCurrentProjectRequest(requestPath, requestGeneration) || requestId !== diffRequestRef.current) return
      setSelectedDiff(diffResult)
      setDiffSummary(summaryResult)
    } catch (err) {
      if (!isCurrentProjectRequest(requestPath, requestGeneration) || requestId !== diffRequestRef.current) return
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
    } finally {
      if (isCurrentProjectRequest(requestPath, requestGeneration) && requestId === diffRequestRef.current) {
        setIsDiffLoading(false)
      }
    }
  }, [activeProjectPath, isGitRepo, isCurrentProjectRequest])

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
      setIsDiffLoading(false)
      // Stale request finalizers cannot release loading state in the new project.
      setIsStatusLoading(false)
      setIsLogLoading(false)
      setIsBranchesLoading(false)
      setError(null)
      setIsInitialLoad(true)
      setIsGitRepo(null) // Reset git repo detection
      prevProjectPathRef.current = activeProjectPath
    }

    // Initial load — check if this is a git repo first, then load data
    if (activeProjectPath) {
      // Check if the directory is a git repository before attempting any operations
      const projectPath = activeProjectPath
      const projectGeneration = projectGenerationRef.current
      window.nekocode.git.isRepo(projectPath).then((isRepo) => {
        if (!isCurrentProjectRequest(projectPath, projectGeneration)) return
        setIsGitRepo(isRepo)
        if (isRepo) {
          // It's a git repo, load all data
          refreshAllRef.current()
        } else {
          // Not a git repo, show empty state without errors
          logger.info(`Project at ${projectPath} is not a git repository — skipping git operations`)
          setIsInitialLoad(false)
        }
      }).catch((err) => {
        if (!isCurrentProjectRequest(projectPath, projectGeneration)) return
        // If the isRepo check itself fails, assume it's not a git repo
        logger.debug('isRepo check failed, assuming not a git repo', err)
        setIsGitRepo(false)
        setIsInitialLoad(false)
      })
    }
  }, [activeProjectPath, isCurrentProjectRequest, setIsGitRepo])

  // ── Polling via usePolling hook ──
  // Replaces the manual setInterval + visibility + backoff logic.
  // refreshStatus re-throws errors after handling them, so usePolling's
  // standard backoff mechanism engages automatically on failure.
  usePolling({
    interval: pollInterval,
    enabled: !!activeProjectPath && isGitRepo !== false,
    pauseWhenHidden: true,
    onPoll: refreshStatus,
    onSuccess: () => { setError(null) },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
    },
  })

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
    isGitRepo,
  }
}

// Historical notes retained from the polling implementation: the minimum and
// maximum intervals bound exponential backoff; successful polls clear errors
// and reset backoff, hidden windows and non-git projects are skipped, and
// visibility restoration immediately refreshes and restarts polling.
