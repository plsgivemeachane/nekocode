/**
 * usePolling — Reusable React hook for interval-based polling with
 * visibility-aware pause and exponential backoff.
 *
 * This hook extracts the polling pattern previously duplicated in
 * useGitOperations and can be reused for any periodic data fetching.
 *
 * Features:
 * - Configurable poll interval with exponential backoff on errors
 * - Visibility-based pause (stops polling when window is hidden)
 * - Immediate refresh when window becomes visible again
 * - Conditional polling (only polls when `enabled` is true)
 * - Clean interval management on unmount
 * - Manual refresh trigger via returned `refresh` function
 *
 * IMPORTANT: For backoff to work, onPoll MUST re-throw errors after
 * handling them. If onPoll catches errors internally without re-throwing,
 * usePolling cannot detect failures and backoff will not engage.
 *
 * @example
 * ```tsx
 * // Correct: refreshStatus re-throws after setting error state
 * const { refresh, errorCount, resetBackoff } = usePolling({
 *   interval: 5000,
 *   enabled: isGitRepo && !!activeProjectPath,
 *   onPoll: refreshStatus, // re-throws errors
 *   onSuccess: () => { setError(null) },
 *   onError: (err) => { setError(String(err)) },
 * })
 * ```
 */

import { useEffect, useRef, useCallback, useState } from 'react'

/** Default polling interval (ms) */
const DEFAULT_POLL_INTERVAL = 5000

/** Minimum polling interval allowed (ms) */
const MIN_POLL_INTERVAL = 1000

/** Maximum polling interval for backoff (ms) */
const MAX_POLL_INTERVAL = 30000

/**
 * Return type for usePolling.
 */
export interface UsePollingResult {
  /** Manually trigger a poll (also resets backoff on success) */
  refresh: () => void
  /** Current consecutive error count (0 = no errors) */
  errorCount: number
  /** Reset backoff state, returning to base interval */
  resetBackoff: () => void
}

/**
 * Configuration options for usePolling.
 */
export interface UsePollingOptions {
  /**
   * The polling interval in milliseconds.
   * Default: 5000 (5 seconds)
   * Minimum: 1000ms (clamped automatically)
   */
  interval?: number

  /**
   * Whether polling is enabled.
   * When false, no interval is set up and no polling occurs.
   * Default: true
   */
  enabled?: boolean

  /**
   * Whether to pause polling when the window is hidden.
   * When true, polls are skipped while the window is hidden.
 * On visibility change (hidden → visible), the callback is called immediately.
   * Default: true
   */
  pauseWhenHidden?: boolean

  /**
   * Called on each poll tick.
   * MUST re-throw errors for backoff to engage.
   */
  onPoll: () => Promise<void>

  /**
   * Called when a poll succeeds (no error thrown).
   * Use this to reset error state.
   */
  onSuccess?: () => void

  /**
   * Called when a poll fails.
   * Use this to update error state. The error is also used for backoff.
   */
  onError?: (error: unknown) => void
}

/**
 * Reusable hook for interval-based polling with backoff and visibility awareness.
 *
 * Uses recursive setTimeout instead of setInterval so that the backoff
 * interval actually changes between ticks — setInterval would keep firing
 * at the original rate even when the effective interval increases.
 */
export function usePolling(options: UsePollingOptions): UsePollingResult {
  const {
    interval = DEFAULT_POLL_INTERVAL,
    enabled = true,
    pauseWhenHidden = true,
    onPoll,
    onSuccess,
    onError,
  } = options

  // ── Refs for stable access inside effects ──
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isWindowVisibleRef = useRef(true)
  const consecutiveErrorsRef = useRef(0)
  // Guard against NaN: Math.max(NaN, 1000) returns NaN, so we need an explicit check
  const safeInterval = Number.isNaN(interval) ? MIN_POLL_INTERVAL : Math.max(interval, MIN_POLL_INTERVAL)
  const effectivePollIntervalRef = useRef(safeInterval)
  const isStoppedRef = useRef(false)
  const isPollingRef = useRef(false) // Guard against concurrent onPoll execution

  // Stable refs for callbacks to avoid re-creating the effect on every render
  const onPollRef = useRef(onPoll)
  onPollRef.current = onPoll
  const onSuccessRef = useRef(onSuccess)
  onSuccessRef.current = onSuccess
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  // ── Reset backoff state ──
  // Also cancels the already-scheduled timer and reschedules at the base interval
  // so that resetBackoff takes immediate effect rather than only affecting the NEXT tick.
  const resetBackoff = useCallback(() => {
    consecutiveErrorsRef.current = 0
    effectivePollIntervalRef.current = safeInterval
    // Cancel and reschedule the pending timer so the reset takes effect immediately
    if (timerRef.current !== null && !isStoppedRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
      scheduleNextTickRef.current()
    }
  }, [safeInterval])

  // ── Schedule the next poll tick using recursive setTimeout ──
  // This is critical: using setTimeout recursively allows the interval
  // to change between ticks (for backoff), unlike setInterval which
  // fires at a fixed rate regardless of ref changes.
  // We store scheduleNextTick in a ref so resetBackoff can call it without
  // circular dependency issues.
  const scheduleNextTickRef = useRef<() => void>(() => {})

  const scheduleNextTick = useCallback(() => {
    if (isStoppedRef.current) return

    timerRef.current = setTimeout(async () => {
      if (isStoppedRef.current) return

      // Skip polling if window is hidden — reschedule at base interval
      if (pauseWhenHidden && !isWindowVisibleRef.current) {
        scheduleNextTick()
        return
      }

      // Guard against concurrent onPoll execution
      if (isPollingRef.current) {
        scheduleNextTick()
        return
      }

      isPollingRef.current = true
      try {
        await onPollRef.current()
        // Check isStoppedRef after the await to prevent calling callbacks after unmount
        if (isStoppedRef.current) return
        onSuccessRef.current?.()
        // Reset backoff on success
        consecutiveErrorsRef.current = 0
        effectivePollIntervalRef.current = safeInterval
        // Trigger React re-render so errorCount is up to date
        setErrorCountState(consecutiveErrorsRef.current)
      } catch (err) {
        // Check isStoppedRef after the await to prevent calling callbacks after unmount
        if (isStoppedRef.current) return
        onErrorRef.current?.(err)
        // Apply backoff: double the interval on each consecutive error
        consecutiveErrorsRef.current++
        effectivePollIntervalRef.current = Math.min(
          effectivePollIntervalRef.current * 2,
          MAX_POLL_INTERVAL,
        )
        // Trigger React re-render so errorCount is up to date
        setErrorCountState(consecutiveErrorsRef.current)
      } finally {
        isPollingRef.current = false
      }

      // Schedule the next tick with the (possibly increased) interval
      scheduleNextTick()
    }, effectivePollIntervalRef.current)
  }, [safeInterval, pauseWhenHidden])

  // Keep the ref in sync so resetBackoff can call scheduleNextTick
  scheduleNextTickRef.current = scheduleNextTick

  // ── Reactive errorCount state ──
  // Previously errorCount read directly from a ref, which meant React never
  // re-rendered when it changed. Now we maintain a state that mirrors the ref
  // and is updated after each poll tick.
  const [errorCountState, setErrorCountState] = useState(0)

  // ── Manual refresh trigger ──
  // Guarded with isPollingRef to prevent concurrent onPoll execution.
  const refresh = useCallback(() => {
    // If a poll is already in flight, skip this refresh call to prevent stacking
    if (isPollingRef.current) return

    // Clear any pending timer and execute a poll immediately
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }

    isPollingRef.current = true
    onPollRef.current().then(() => {
      isPollingRef.current = false
      // Check isStoppedRef after the await to prevent calling callbacks after unmount
      if (isStoppedRef.current) return
      onSuccessRef.current?.()
      resetBackoff()
      if (!isStoppedRef.current) {
        scheduleNextTick()
      }
    }).catch((err) => {
      isPollingRef.current = false
      // Check isStoppedRef after the await to prevent calling callbacks after unmount
      if (isStoppedRef.current) return
      onErrorRef.current?.(err)
      // Don't reset backoff on manual refresh failure
      if (!isStoppedRef.current) {
        scheduleNextTick()
      }
    })
  }, [resetBackoff, scheduleNextTick])

  // ── Set up the polling effect ──
  useEffect(() => {
    // Reset backoff when interval or enabled state changes
    resetBackoff()

    if (!enabled) {
      isStoppedRef.current = true
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      return
    }

    isStoppedRef.current = false

    // ── Visibility-based polling pause ──
    const handleVisibilityChange = () => {
      isWindowVisibleRef.current = !document.hidden
      // When becoming visible again, immediately poll (but only if not already polling)
      if (!document.hidden && !isPollingRef.current) {
        isPollingRef.current = true
        onPollRef.current().then(() => {
          isPollingRef.current = false
          if (isStoppedRef.current) return
          onSuccessRef.current?.()
          resetBackoff()
          setErrorCountState(consecutiveErrorsRef.current)
        }).catch((err) => {
          isPollingRef.current = false
          if (isStoppedRef.current) return
          onErrorRef.current?.(err)
          consecutiveErrorsRef.current++
          effectivePollIntervalRef.current = Math.min(
            effectivePollIntervalRef.current * 2,
            MAX_POLL_INTERVAL,
          )
          setErrorCountState(consecutiveErrorsRef.current)
        })
      }
    }

    if (pauseWhenHidden) {
      document.addEventListener('visibilitychange', handleVisibilityChange)
    }

    // Start the polling loop
    scheduleNextTick()

    return () => {
      isStoppedRef.current = true
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      if (pauseWhenHidden) {
        document.removeEventListener('visibilitychange', handleVisibilityChange)
      }
    }
  }, [enabled, pauseWhenHidden, resetBackoff, scheduleNextTick])

  return {
    refresh,
    errorCount: errorCountState,
    resetBackoff,
  }
}
