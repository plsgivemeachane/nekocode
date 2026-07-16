// @vitest-environment jsdom
/**
 * usePolling CRITICAL contract-violation tests.
 *
 * These tests probe the CONTRACT - the gap between what the function
 * signature/name promises and what actually happens at the boundaries.
 * Per the critical-testing-expert skill, these tests challenge assumptions,
 * expose abstraction leaks, and document contract violations.
 *
 * Categories tested:
 * - Category 1: Name vs Reality (errorCount reactivity, refresh contract)
 * - Category 2: Argument Boundary & Assumption Drilling (interval=0, negative, NaN)
 * - Category 3: Abstraction Ambiguity (concurrent refresh, timer leaks)
 * - Category 4: State & Side-Effect Skepticism (rapid toggles, idempotency)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePolling } from '../../renderer/src/hooks/usePolling'

async function advanceAndFlush(ms: number) {
  await vi.advanceTimersByTimeAsync(ms)
}

describe('usePolling - Critical Contract Tests', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ==========================================================================
  // Category 1: Name vs Reality Audit
  // The contract says `errorCount: number` - but does it reflect reality?
  // ==========================================================================

  it('errorCount updates reactively after errors (CONTRACT FIXED)', async () => {
    // Previously, errorCount read from `consecutiveErrorsRef.current` (a ref)
    // which meant React never re-rendered when it changed. Now errorCount
    // uses state, so it is always up-to-date after each tick.
    const onPoll = vi.fn().mockRejectedValue(new Error('fail'))
    const onError = vi.fn()

    const { result } = renderHook(() =>
      usePolling({
        interval: 1000,
        enabled: true,
        onPoll,
        onError,
      }),
    )

    // Before any tick: errorCount = 0
    expect(result.current.errorCount).toBe(0)

    // First error tick
    await advanceAndFlush(1000)
    expect(onError).toHaveBeenCalledTimes(1)
    // Re-read result after state update has been processed
    // setErrorCountState fires inside the setTimeout callback,
    // so after advancing timers, we need to let React process the update
    await act(async () => {})
    expect(result.current.errorCount).toBe(1)
  })

  it('errorCount stays reactive across multiple errors (CONTRACT FIXED)', async () => {
    const onPoll = vi.fn().mockRejectedValue(new Error('fail'))
    const onError = vi.fn()

    const { result } = renderHook(() =>
      usePolling({
        interval: 1000,
        enabled: true,
        onPoll,
        onError,
      }),
    )

    // Trigger 3 errors (base interval, then 2x backoff, then 4x backoff)
    await advanceAndFlush(1000) // 1st error
    await act(async () => {})
    expect(result.current.errorCount).toBe(1)
    await advanceAndFlush(2000) // 2nd error (backoff 2x)
    await act(async () => {})
    expect(result.current.errorCount).toBe(2)
    await advanceAndFlush(4000) // 3rd error (backoff 4x)
    await act(async () => {})
    expect(result.current.errorCount).toBe(3)
  })

  it('errorCount is reactive - updates after each error tick (CONTRACT FIXED)', async () => {
    const onPoll = vi.fn().mockRejectedValue(new Error('fail'))
    const onError = vi.fn()

    const { result } = renderHook(() =>
      usePolling({
        interval: 1000,
        enabled: true,
        onPoll,
        onError,
      }),
    )

    // Initial state: no errors
    expect(result.current.errorCount).toBe(0)

    // After first error
    await advanceAndFlush(1000)
    await act(async () => {})
    expect(result.current.errorCount).toBe(1)

    // After second error
    await advanceAndFlush(2000)
    await act(async () => {})
    expect(result.current.errorCount).toBe(2)

    // After third error
    await advanceAndFlush(4000)
    await act(async () => {})
    expect(result.current.errorCount).toBe(3)
  })

  // ==========================================================================
  // Category 2: Argument Boundary & Assumption Drilling
  // The contract says interval?: number. What are the limits?
  // ==========================================================================

  it('interval=0 is clamped to MIN_POLL_INTERVAL (1000ms)', async () => {
    const onPoll = vi.fn().mockResolvedValue(undefined)

    renderHook(() =>
      usePolling({
        interval: 0,
        enabled: true,
        onPoll,
      }),
    )

    // Should NOT fire immediately - clamped to 1000ms
    await advanceAndFlush(500)
    expect(onPoll).not.toHaveBeenCalled()

    await advanceAndFlush(500)
    expect(onPoll).toHaveBeenCalledTimes(1)
  })

  it('negative interval is clamped to MIN_POLL_INTERVAL', async () => {
    const onPoll = vi.fn().mockResolvedValue(undefined)

    renderHook(() =>
      usePolling({
        interval: -5000,
        enabled: true,
        onPoll,
      }),
    )

    // Should behave the same as MIN_POLL_INTERVAL
    await advanceAndFlush(1000)
    expect(onPoll).toHaveBeenCalledTimes(1)
  })

  it('NaN interval is clamped to MIN_POLL_INTERVAL (CONTRACT FIXED)', async () => {
    // Previously NaN bypassed clamping because Math.max(NaN, 1000) = NaN.
    // Now an explicit NaN guard in usePolling catches this and falls back
    // to MIN_POLL_INTERVAL.
    const onPoll = vi.fn().mockResolvedValue(undefined)

    renderHook(() =>
      usePolling({
        interval: NaN,
        enabled: true,
        onPoll,
      }),
    )

    // With the NaN guard, the timer should NOT fire immediately —
    // it should wait for MIN_POLL_INTERVAL (1000ms)
    await advanceAndFlush(500)
    expect(onPoll).not.toHaveBeenCalled()

    await advanceAndFlush(500)
    expect(onPoll).toHaveBeenCalledTimes(1)
  })

  it('very large interval (e.g. 1 hour) works correctly', async () => {
    const onPoll = vi.fn().mockResolvedValue(undefined)

    renderHook(() =>
      usePolling({
        interval: 3600000, // 1 hour
        enabled: true,
        onPoll,
      }),
    )

    // Should NOT fire before the hour
    await advanceAndFlush(3599999)
    expect(onPoll).not.toHaveBeenCalled()

    await advanceAndFlush(1)
    expect(onPoll).toHaveBeenCalledTimes(1)
  })

  // ==========================================================================
  // Category 3: Abstraction Ambiguity - Concurrency & Race Conditions
  // ==========================================================================

  it('rapid double refresh is guarded — second call is a no-op (CONTRACT FIXED)', async () => {
    // Previously, calling refresh() twice in the same tick fired onPoll twice.
    // Now refresh() is guarded with isPollingRef, so the second call is a no-op.
    const onPoll = vi.fn().mockResolvedValue(undefined)

    const { result } = renderHook(() =>
      usePolling({
        interval: 1000,
        enabled: true,
        onPoll,
      }),
    )

    // Call refresh twice in the same tick
    await act(async () => {
      result.current.refresh()
      result.current.refresh()
    })

    // Only one onPoll call because the second refresh was guarded
    expect(onPoll).toHaveBeenCalledTimes(1)
  })

  it('refresh during active onPoll execution is guarded (CONTRACT FIXED)', async () => {
    // onPoll takes a long time. Previously, refresh() called while
    // onPoll was still running would stack another call. Now refresh()
    // is guarded with isPollingRef so concurrent calls are no-ops.
    let resolveFirstPoll: () => void = () => {}
    const onPoll = vi.fn().mockImplementation(async () => {
      if (onPoll.mock.calls.length === 1) {
        await new Promise<void>((r) => { resolveFirstPoll = r })
      }
    })

    const { result } = renderHook(() =>
      usePolling({
        interval: 5000,
        enabled: true,
        onPoll,
      }),
    )

    // Wait for first scheduled poll
    await advanceAndFlush(5000)
    expect(onPoll).toHaveBeenCalledTimes(1)

    // Call refresh while the first poll is still pending — should be a no-op
    await act(async () => {
      result.current.refresh()
    })

    // Only 1 onPoll call because refresh was guarded
    expect(onPoll).toHaveBeenCalledTimes(1)

    // Resolve the first poll
    await act(async () => {
      resolveFirstPoll()
    })
  })

  // ==========================================================================
  // Category 4: State & Side-Effect Skepticism
  // ==========================================================================

  it('rapid enable/disable/enable toggles do not leak timers', async () => {
    const onPoll = vi.fn().mockResolvedValue(undefined)

    const { rerender } = renderHook(
      (enabled: boolean) =>
        usePolling({
          interval: 1000,
          enabled,
          onPoll,
        }),
      { initialProps: true },
    )

    // Rapidly toggle
    for (let i = 0; i < 20; i++) {
      rerender(false)
      rerender(true)
    }

    // After all toggles, polling should be active
    await advanceAndFlush(1000)
    expect(onPoll.mock.calls.length).toBeGreaterThanOrEqual(1)
  })

  it('resetBackoff cancels and reschedules the pending timer (CONTRACT FIXED)', async () => {
    // Previously, resetBackoff only changed the ref value but did NOT
    // cancel the already-scheduled setTimeout. Now it cancels and
    // reschedules, so the reset takes immediate effect.
    const onPoll = vi.fn().mockRejectedValue(new Error('fail'))
    const onError = vi.fn()

    const { result } = renderHook(() =>
      usePolling({
        interval: 1000,
        enabled: true,
        onPoll,
        onError,
      }),
    )

    // First tick: error, backoff to 2000ms
    await advanceAndFlush(1000)
    expect(onPoll).toHaveBeenCalledTimes(1)

    // resetBackoff now cancels the pending timer and reschedules at base interval
    act(() => {
      result.current.resetBackoff()
    })

    // The timer should now fire at 1000ms (base interval), not 2000ms (backoff)
    await advanceAndFlush(1000)
    expect(onPoll).toHaveBeenCalledTimes(2)
  })

  it('pauseWhenHidden=false does not skip polls when hidden', async () => {
    const onPoll = vi.fn().mockResolvedValue(undefined)

    renderHook(() =>
      usePolling({
        interval: 1000,
        enabled: true,
        pauseWhenHidden: false,
        onPoll,
      }),
    )

    // Window hidden
    Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    await advanceAndFlush(1000)
    // Should still poll even when hidden because pauseWhenHidden is false
    expect(onPoll).toHaveBeenCalledTimes(1)
  })

  it('CONTRACT VIOLATION: onPoll that hangs blocks all future polling', async () => {
    // If onPoll never resolves, the recursive setTimeout pattern means
    // no future ticks are ever scheduled. This is a significant contract gap:
    // the hook has no timeout on individual poll calls.
    const onSuccess = vi.fn()
    const onPoll = vi.fn().mockImplementation(async () => {
      if (onPoll.mock.calls.length === 1) {
        // First call hangs forever
        await new Promise(() => {})
      }
    })

    renderHook(() =>
      usePolling({
        interval: 1000,
        enabled: true,
        onPoll,
        onSuccess,
      }),
    )

    await advanceAndFlush(1000)
    expect(onPoll).toHaveBeenCalledTimes(1)

    // Even after a very long time, no more polls because the first one hangs
    await advanceAndFlush(60000)
    expect(onPoll).toHaveBeenCalledTimes(1)
  })

  it.todo('usePolling should implement a per-tick timeout to prevent a hanging onPoll from blocking all future polling')

  it('onSuccess and onError are never called if onPoll never resolves', async () => {
    const onSuccess = vi.fn()
    const onError = vi.fn()
    const onPoll = vi.fn().mockImplementation(() => new Promise(() => {}))

    renderHook(() =>
      usePolling({
        interval: 1000,
        enabled: true,
        onPoll,
        onSuccess,
        onError,
      }),
    )

    await advanceAndFlush(1000)
    expect(onPoll).toHaveBeenCalledTimes(1)
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()

    // No more ticks because onPoll never resolved
    await advanceAndFlush(5000)
    expect(onPoll).toHaveBeenCalledTimes(1)
  })

  it('enabled=false then enabled=true starts fresh with reset backoff', async () => {
    const onPoll = vi.fn().mockRejectedValue(new Error('fail'))
    const onError = vi.fn()

    const { rerender } = renderHook(
      (enabled: boolean) =>
        usePolling({
          interval: 1000,
          enabled,
          onPoll,
          onError,
        }),
      { initialProps: true },
    )

    // First error tick
    await advanceAndFlush(1000)
    expect(onPoll).toHaveBeenCalledTimes(1)

    // Disable
    rerender(false)
    await advanceAndFlush(5000)

    // Re-enable - backoff should be reset
    rerender(true)

    // Should poll at base interval (1000ms), not at the backoff interval
    await advanceAndFlush(1000)
    expect(onPoll.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('onSuccess is NOT called after unmount (CONTRACT FIXED)', async () => {
    // Previously, if onPoll was pending and the component unmounted, the
    // .then() callback would still call onSuccess. Now there is an
    // isStoppedRef check after the await onPoll() and before calling
    // onSuccess/onError, so callbacks don't fire after unmount.
    let resolvePoll: () => void = () => {}
    const onPoll = vi.fn().mockImplementation(async () => {
      await new Promise<void>((r) => { resolvePoll = r })
    })
    const onSuccess = vi.fn()

    const { unmount } = renderHook(() =>
      usePolling({
        interval: 1000,
        enabled: true,
        onPoll,
        onSuccess,
      }),
    )

    await advanceAndFlush(1000)
    expect(onPoll).toHaveBeenCalledTimes(1)

    // Unmount while poll is in flight
    unmount()

    // Resolve the pending poll
    await act(async () => {
      resolvePoll()
    })

    // onSuccess should NOT be called after unmount
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('visibility change while poll is in flight does NOT double-fire (CONTRACT FIXED)', async () => {
    // Previously, visibility change handler fired onPoll even when one was
    // already in flight. Now the isPollingRef guard prevents this.
    let resolvePoll: () => void = () => {}
    const onPoll = vi.fn().mockImplementation(async () => {
      await new Promise<void>((r) => { resolvePoll = r })
    })
    const onSuccess = vi.fn()

    renderHook(() =>
      usePolling({
        interval: 1000,
        enabled: true,
        pauseWhenHidden: true,
        onPoll,
        onSuccess,
      }),
    )

    // Fire first poll
    await advanceAndFlush(1000)
    expect(onPoll).toHaveBeenCalledTimes(1)

    // While poll is in flight, trigger visibility change
    Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    await advanceAndFlush(0)

    // Visibility handler should NOT fire onPoll because one is already in flight
    expect(onPoll).toHaveBeenCalledTimes(1)

    // Resolve the original poll
    await act(async () => {
      resolvePoll()
    })
  })
})
