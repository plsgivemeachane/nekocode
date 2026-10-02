// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSearchFiles } from '../../renderer/src/hooks/useSearchFiles'

const searchFiles = vi.fn().mockResolvedValue({ files: [] })

beforeEach(() => {
  vi.useFakeTimers()
  searchFiles.mockClear()
  Object.defineProperty(window, 'nekocode', {
    configurable: true,
    value: { search: { files: searchFiles } },
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useSearchFiles debounce cleanup', () => {
  it.each(['', '   ', 'readme'])('cancels the pending search on unmount for query %j', async (query) => {
    const { unmount } = renderHook(() => useSearchFiles('/project', query, 150))
    unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(150) })
    expect(searchFiles).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
