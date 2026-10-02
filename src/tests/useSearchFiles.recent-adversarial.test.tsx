// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSearchFiles } from '../renderer/src/hooks/useSearchFiles'

type SearchResult = { files: Array<{ relativePath: string; absolutePath: string; fileName: string; score: number }> }

describe('useSearchFiles recent adversarial cases', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    Reflect.deleteProperty(window, 'nekocode')
    vi.useRealTimers()
  })

  it('keeps the newest query result when an older request resolves later', async () => {
    const pending: Array<{ query: string; resolve: (result: SearchResult) => void }> = []
    const files = vi.fn((request: { query: string }) => new Promise<SearchResult>((resolve) => {
      pending.push({ query: request.query, resolve })
    }))
    Object.defineProperty(window, 'nekocode', {
      configurable: true,
      value: { search: { files } },
    })

    const { result, rerender } = renderHook(
      ({ query }) => useSearchFiles('/project', query, 0),
      { initialProps: { query: 'old' } },
    )

    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(files).toHaveBeenCalledWith(expect.objectContaining({ query: 'old' }))

    rerender({ query: 'new' })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(files).toHaveBeenCalledWith(expect.objectContaining({ query: 'new' }))

    const oldResult: SearchResult = { files: [{ relativePath: 'old.ts', absolutePath: '/project/old.ts', fileName: 'old.ts', score: 1 }] }
    const newResult: SearchResult = { files: [{ relativePath: 'new.ts', absolutePath: '/project/new.ts', fileName: 'new.ts', score: 1 }] }
    await act(async () => {
      pending.find((request) => request.query === 'new')!.resolve(newResult)
      await Promise.resolve()
      pending.find((request) => request.query === 'old')!.resolve(oldResult)
      await Promise.resolve()
    })

    expect(result.current.results.map((file) => file.relativePath)).toEqual(['new.ts'])
  })

  it('clears results immediately when the project is removed while a search is pending', async () => {
    let resolveSearch!: (result: SearchResult) => void
    const files = vi.fn(() => new Promise<SearchResult>((resolve) => { resolveSearch = resolve }))
    Object.defineProperty(window, 'nekocode', { configurable: true, value: { search: { files } } })
    const { result, rerender } = renderHook(
      ({ projectPath }) => useSearchFiles(projectPath, 'query', 0),
      { initialProps: { projectPath: '/project' as string | null } },
    )
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    rerender({ projectPath: null })
    expect(result.current.results).toEqual([])
    resolveSearch({ files: [{ relativePath: 'late.ts', absolutePath: '/project/late.ts', fileName: 'late.ts', score: 1 }] })
    await act(async () => { await Promise.resolve() })
    expect(result.current.results).toEqual([])
    expect(result.current.isLoading).toBe(false)
  })
})
