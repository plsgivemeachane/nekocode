// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePolling } from '@/renderer/src/hooks/usePolling'

describe('f3746fa: polling visibility and reactive state', () => {
  let hiddenDescriptor: PropertyDescriptor | undefined

  beforeEach(() => {
    vi.useFakeTimers()
    hiddenDescriptor = Object.getOwnPropertyDescriptor(document, 'hidden')
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  })

  afterEach(() => {
    cleanup()
    if (hiddenDescriptor) Object.defineProperty(document, 'hidden', hiddenDescriptor)
    else Reflect.deleteProperty(document, 'hidden')
    vi.useRealTimers()
  })

  it('publishes zero errors after a successful manual refresh following a failed tick', async () => {
    const onPoll = vi.fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValue(undefined)
    const { result } = renderHook(() => usePolling({ interval: 1000, onPoll }))
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(result.current.errorCount).toBe(1)
    await act(async () => { result.current.refresh() })
    expect(onPoll).toHaveBeenCalledTimes(2)
    expect(result.current.errorCount).toBe(0)
  })

  it('publishes zero errors when resetBackoff resets the consecutive error state', async () => {
    const onPoll = vi.fn<() => Promise<void>>().mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => usePolling({ interval: 1000, onPoll }))
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(result.current.errorCount).toBe(1)
    act(() => result.current.resetBackoff())
    expect(result.current.errorCount).toBe(0)
  })

  it('pauses from the first tick when mounted in an already hidden window', async () => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    const onPoll = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    renderHook(() => usePolling({ interval: 1000, onPoll, pauseWhenHidden: true }))
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(onPoll).not.toHaveBeenCalled()
  })

  it('does not publish an old poll completion into a re-enabled polling generation', async () => {
    let resolveOld!: () => void
    const oldPoll = vi.fn(() => new Promise<void>(resolve => { resolveOld = resolve }))
    const newPoll = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    const onSuccess = vi.fn()
    const { rerender } = renderHook(
      ({ enabled, onPoll }) => usePolling({ enabled, onPoll, onSuccess, interval: 1000 }),
      { initialProps: { enabled: true, onPoll: oldPoll as () => Promise<void> } },
    )
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(oldPoll).toHaveBeenCalledTimes(1)
    rerender({ enabled: false, onPoll: newPoll })
    rerender({ enabled: true, onPoll: newPoll })
    await act(async () => { resolveOld() })
    expect(newPoll).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('suppresses overlapping manual and timed polls and stops scheduling on unmount', async () => {
    let resolvePoll!: () => void
    const onPoll = vi.fn(() => new Promise<void>(resolve => { resolvePoll = resolve }))
    const { result, unmount } = renderHook(() => usePolling({ interval: 1000, onPoll }))
    act(() => { result.current.refresh(); result.current.refresh(); result.current.refresh() })
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(onPoll).toHaveBeenCalledTimes(1)
    unmount()
    await act(async () => { resolvePoll() })
    expect(vi.getTimerCount()).toBe(0)
  })
})
