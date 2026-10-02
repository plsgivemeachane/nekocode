// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGitOperations } from '@/renderer/src/hooks/useGitOperations'
import { clearMockIPC, setupMockIPC } from '../__utils__/test-utils'
import type {
  GitBranchListResult,
  GitDiffResult,
  GitLogResult,
  GitStashListResult,
  GitStatusResult,
} from '@/shared/ipc-types'

const project = vi.hoisted(() => ({ activeProjectPath: '/project-a' as string | null }))
vi.mock('@/renderer/src/stores/project-store', () => ({
  useProjectStore: () => ({ state: project }),
}))

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function status(current: string): GitStatusResult {
  return { current, isClean: true, staged: [], modified: [], untracked: [], conflicting: [], ahead: 0, behind: 0 }
}

describe('f3746fa: Git IPC ordering and project isolation', () => {
  let ipc: ReturnType<typeof setupMockIPC>

  beforeEach(() => {
    vi.useFakeTimers()
    project.activeProjectPath = '/project-a'
    ipc = setupMockIPC()
    vi.mocked(ipc.git.getStatus).mockResolvedValue(status('a'))
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    clearMockIPC()
  })

  async function mount() {
    const hook = renderHook(() => useGitOperations())
    await act(async () => {})
    expect(hook.result.current.isGitRepo).toBe(true)
    expect(hook.result.current.status.current).toBe('a')
    vi.mocked(ipc.git.stage).mockClear()
    return hook
  }

  it('serializes two queued stages until the first mutation and refresh finish', async () => {
    const { result } = await mount()
    const first = deferred<void>()
    const refresh = deferred<GitStatusResult>()
    vi.mocked(ipc.git.stage).mockImplementationOnce(() => first.promise)
    vi.mocked(ipc.git.getStatus).mockImplementationOnce(() => refresh.promise)
    let operations!: Promise<void>[]
    act(() => {
      operations = [result.current.stageFile('first.ts'), result.current.stageFile('second.ts')]
    })
    expect(ipc.git.stage).toHaveBeenCalledTimes(1)
    await act(async () => { first.resolve() })
    expect(ipc.git.stage).toHaveBeenCalledTimes(1)
    await act(async () => { refresh.resolve(status('a')); await Promise.all(operations) })
    expect(vi.mocked(ipc.git.stage).mock.calls.map(call => call[1])).toEqual(['first.ts', 'second.ts'])
  })

  it('serializes three queued stages instead of releasing both waiters together', async () => {
    const { result } = await mount()
    const first = deferred<void>()
    const second = deferred<void>()
    vi.mocked(ipc.git.stage)
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    let operations!: Promise<void>[]
    act(() => {
      operations = ['first.ts', 'second.ts', 'third.ts'].map(file => result.current.stageFile(file))
    })
    expect(ipc.git.stage).toHaveBeenCalledTimes(1)
    await act(async () => { first.resolve(); await operations[0] })
    const callsWhileSecondPending = vi.mocked(ipc.git.stage).mock.calls.map(call => call[1])
    await act(async () => { second.resolve(); await Promise.all(operations) })
    expect(callsWhileSecondPending).toEqual(['first.ts', 'second.ts'])
    expect(ipc.git.stage).toHaveBeenCalledTimes(3)
  })

  it('releases the stage lock after rejection so a queued operation can succeed', async () => {
    const { result } = await mount()
    const first = deferred<void>()
    vi.mocked(ipc.git.stage).mockImplementationOnce(() => first.promise)
    let rejected!: Promise<unknown>
    let queued!: Promise<void>
    act(() => {
      rejected = result.current.stageFile('first.ts').catch(error => error)
      queued = result.current.stageFile('second.ts')
    })
    const failure = new Error('index lock unavailable')
    await act(async () => { first.reject(failure); await queued })
    expect(await rejected).toBe(failure)
    expect(ipc.git.stage).toHaveBeenCalledTimes(2)
    expect(result.current.error).toBeNull()
  })

  it('ignores an old project status response after switching projects', async () => {
    const { result, rerender } = await mount()
    const stale = deferred<GitStatusResult>()
    vi.mocked(ipc.git.getStatus).mockImplementation(path => path === '/project-a' ? stale.promise : Promise.resolve(status('b')))
    let pending!: Promise<void>
    act(() => { pending = result.current.refreshStatus() })
    project.activeProjectPath = '/project-b'
    rerender()
    await act(async () => {})
    expect(result.current.status.current).toBe('b')
    await act(async () => { stale.resolve(status('stale-a')); await pending })
    expect(result.current.status.current).toBe('b')
  })

  it('ignores an old repository probe after the new project has been detected', async () => {
    const { result, rerender } = await mount()
    const stale = deferred<boolean>()
    vi.mocked(ipc.git.isRepo).mockImplementation(path => path === '/project-b' ? stale.promise : Promise.resolve(true))
    project.activeProjectPath = '/project-b'
    rerender()
    await act(async () => {})
    project.activeProjectPath = '/project-c'
    rerender()
    await act(async () => {})
    expect(result.current.isGitRepo).toBe(true)
    await act(async () => { stale.resolve(false) })
    expect(result.current.isGitRepo).toBe(true)
    expect(ipc.git.isRepo).toHaveBeenLastCalledWith('/project-c')
  })

  it('keeps the newest selected file when diff responses arrive out of order', async () => {
    const { result } = await mount()
    const stale = deferred<GitDiffResult>()
    vi.mocked(ipc.git.getDiff).mockImplementation((_path, file) => file === 'first.ts' ? stale.promise : Promise.resolve({ patch: 'second patch' }))
    let first!: Promise<void>
    act(() => { first = result.current.viewDiff('first.ts') })
    await act(async () => { await result.current.viewDiff('second.ts') })
    expect(result.current.selectedDiff?.patch).toBe('second patch')
    await act(async () => { stale.resolve({ patch: 'first patch' }); await first })
    expect(result.current.selectedDiff?.patch).toBe('second patch')
  })

  it('does not repopulate a diff after the user clears it during loading', async () => {
    const { result } = await mount()
    const pendingDiff = deferred<GitDiffResult>()
    vi.mocked(ipc.git.getDiff).mockImplementationOnce(() => pendingDiff.promise)
    let pending!: Promise<void>
    act(() => { pending = result.current.viewDiff('first.ts') })
    act(() => result.current.clearDiff())
    await act(async () => { pendingDiff.resolve({ patch: 'cancelled patch' }); await pending })
    expect(result.current.selectedDiff).toBeNull()
    expect(result.current.diffSummary).toBeNull()
    expect(result.current.isDiffLoading).toBe(false)
  })

  it('ignores stale log, branch, and stash responses after switching projects', async () => {
    const { result, rerender } = await mount()
    const staleLog = deferred<GitLogResult>()
    const staleBranches = deferred<GitBranchListResult>()
    const staleStashes = deferred<GitStashListResult>()
    vi.mocked(ipc.git.getLog).mockImplementation(path => path === '/project-a'
      ? staleLog.promise
      : Promise.resolve({ commits: [], total: 0 }))
    vi.mocked(ipc.git.branchList).mockImplementation(path => path === '/project-a'
      ? staleBranches.promise
      : Promise.resolve({ branches: [], current: 'b' }))
    vi.mocked(ipc.git.stashList).mockImplementation(path => path === '/project-a'
      ? staleStashes.promise
      : Promise.resolve({ stashes: [] }))
    let pending!: Promise<void>
    act(() => {
      pending = Promise.all([
        result.current.refreshLog(),
        result.current.refreshBranches(),
        result.current.refreshAll(),
      ]).then(() => undefined)
    })
    project.activeProjectPath = '/project-b'
    rerender()
    await act(async () => {})
    await act(async () => {
      staleLog.resolve({ commits: [{
        hash: 'stale', hashAbbrev: 'stale', message: 'stale', author: 'stale',
        authorEmail: 'stale@example.test', date: '', parents: [], relativeDate: 'now',
      }], total: 1 })
      staleBranches.resolve({ branches: [], current: 'stale-a' })
      staleStashes.resolve({ stashes: [{
        index: 0, message: 'stale', branchName: 'stale', hash: 'stale', date: '',
      }] })
      await pending
    })
    expect(result.current.branches.current).toBe('b')
    expect(result.current.log.commits).toEqual([])
    expect(result.current.stashes.stashes).toEqual([])
  })

  it('clears pending query loading flags when switching to a non-Git project', async () => {
    const { result, rerender } = await mount()
    const oldStatus = deferred<GitStatusResult>()
    const oldLog = deferred<Awaited<ReturnType<typeof ipc.git.getLog>>>()
    const oldBranches = deferred<Awaited<ReturnType<typeof ipc.git.branchList>>>()
    vi.mocked(ipc.git.getStatus).mockImplementationOnce(() => oldStatus.promise)
    vi.mocked(ipc.git.getLog).mockImplementationOnce(() => oldLog.promise)
    vi.mocked(ipc.git.branchList).mockImplementationOnce(() => oldBranches.promise)
    let pending!: Promise<void>[]
    act(() => {
      pending = [result.current.refreshStatus(), result.current.refreshLog(), result.current.refreshBranches()]
    })
    expect(result.current.isStatusLoading).toBe(true)
    expect(result.current.isLogLoading).toBe(true)
    expect(result.current.isBranchesLoading).toBe(true)
    vi.mocked(ipc.git.isRepo).mockResolvedValue(false)
    project.activeProjectPath = '/not-a-repo'
    rerender()
    await act(async () => {})
    expect(result.current.isGitRepo).toBe(false)
    expect(result.current.isStatusLoading).toBe(false)
    expect(result.current.isLogLoading).toBe(false)
    expect(result.current.isBranchesLoading).toBe(false)
    await act(async () => {
      oldStatus.resolve(status('stale-a'))
      oldLog.resolve({ commits: [], total: 99 })
      oldBranches.resolve({ branches: [], current: 'stale-a' })
      await Promise.all(pending)
    })
    expect(result.current.status.current).toBeNull()
    expect(result.current.log.total).toBe(0)
    expect(result.current.branches.current).toBeNull()
    expect(result.current.isStatusLoading).toBe(false)
    expect(result.current.isLogLoading).toBe(false)
    expect(result.current.isBranchesLoading).toBe(false)
  })

  it('preserves a status refresh error after a successful commit', async () => {
    const { result } = await mount()
    vi.mocked(ipc.git.getStatus).mockRejectedValue(new Error('status refresh unavailable'))
    await act(async () => { await result.current.commit('fix: correct behavior') })
    expect(ipc.git.commit).toHaveBeenCalledTimes(1)
    expect(result.current.error).toBe('status refresh unavailable')
  })
})
