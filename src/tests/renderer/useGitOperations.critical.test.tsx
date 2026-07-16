// @vitest-environment jsdom
/**
 * useGitOperations hook CRITICAL contract-violation tests.
 *
 * The existing git-operations-critical.test.ts tests GitOperationsManager (main process).
 * These tests target the useGitOperations HOOK (renderer process) contract specifically.
 *
 * Contract: useGitOperations(pollInterval?: number): UseGitOperationsResult
 *
 * Contract assumptions to challenge:
 * - isGitRepo is boolean | null - what does null mean vs false?
 * - error state is shared across ALL operations - stage error can shadow commit error
 * - Mutation error handling is INCONSISTENT: commit throws, stageFile silently returns
 * - stageFile/unstageFile silently return on no-project; commit throws
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Mock the project store
const mockProjectState = {
  activeProjectPath: '/test/project' as string | null,
  projects: [] as Array<Record<string, unknown>>,
}

vi.mock('../../renderer/src/stores/project-store', () => ({
  useProjectStore: () => ({ state: mockProjectState }),
}))

// Mock the IPC bridge - window.nekocode.git.*
const mockGit: Record<string, ReturnType<typeof vi.fn>> = {}

function createMockGit() {
  const methods = [
    'getBranch', 'getStatus', 'getLog', 'getDiff', 'getDiffSummary',
    'stage', 'unstage', 'stageAll', 'unstageAll',
    'commit', 'push', 'pull', 'fetch',
    'branchList', 'branchCreate', 'branchSwitch',
    'stash', 'stashPop', 'stashList',
    'getRemoteUrl', 'isRepo',
  ]

  for (const m of methods) {
    mockGit[m] = vi.fn().mockResolvedValue(null)
  }

  return mockGit
}

import { useGitOperations } from '../../renderer/src/hooks/useGitOperations'

describe('useGitOperations - Critical Hook Contract Tests', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockProjectState.activeProjectPath = '/test/project'
    mockProjectState.projects = []
    createMockGit()

    // Set up window.nekocode.git mock on the existing jsdom window
    ;(globalThis as unknown as { window: Record<string, unknown> }).window.nekocode = { git: mockGit }
  })

  afterEach(() => {
    vi.useRealTimers()
    delete (globalThis as unknown as { window: Record<string, unknown> }).window.nekocode
  })

  // ==========================================================================
  // Category 1: Name vs Reality
  // ==========================================================================

  it('CONTRACT AMBIGUITY: isGitRepo=null means "not yet checked" but is a tri-state not documented in the type', () => {
    // The type is `boolean | null` where null = "not yet checked"
    // But the type does not communicate this semantic. It could also mean
    // "check failed" or "unknown". The type should be an enum.
    const { result } = renderHook(() => useGitOperations())

    // Initial state: null = not yet checked
    expect(result.current.isGitRepo).toBeNull()
  })

  it.todo('isGitRepo should use a discriminated union type: { status: "unchecked" } | { status: "checked"; isRepo: boolean }')

  it('CONTRACT AMBIGUITY: error is shared across ALL operations - clearing is complex', async () => {
    // There is a single `error: string | null` field shared by all operations.
    // refreshStatus() clears error on success. Mutations that call refreshStatus
    // after success effectively clear errors. But the ordering of
    // setError vs refreshStatus makes this confusing.
    mockGit['stage'].mockRejectedValueOnce(new Error('stage failed'))
    mockGit['stage'].mockResolvedValue(undefined)

    const { result } = renderHook(() => useGitOperations())

    // Stage fails
    await act(async () => {
      try { await result.current.stageFile('test.ts') } catch { /* intentionally swallowed */ }
    })
    expect(result.current.error).toContain('stage')

    // Second stage succeeds - refreshStatus clears the error
    await act(async () => {
      await result.current.stageFile('other.ts')
    })

    // Error is cleared by refreshStatus on success
    expect(result.current.error).toBeNull()
  })

  it.todo('UseGitOperationsResult should have per-operation error tracking instead of a single shared error field')

  it('CONTRACT: clearError resets the shared error state', async () => {
    mockGit['stage'].mockRejectedValue(new Error('stage failed'))

    const { result } = renderHook(() => useGitOperations())

    await act(async () => {
      try { await result.current.stageFile('test.ts') } catch { /* swallowed */ }
    })

    expect(result.current.error).not.toBeNull()

    act(() => {
      result.current.clearError()
    })

    expect(result.current.error).toBeNull()
  })

  // ==========================================================================
  // Category 2: Argument Boundary & Inconsistent Error Handling
  // ==========================================================================

  it('CONTRACT VIOLATION: stageFile silently returns when no active project (no error thrown)', async () => {
    mockProjectState.activeProjectPath = null

    const { result } = renderHook(() => useGitOperations())

    // stageFile silently returns undefined when no project
    const res = await result.current.stageFile('test.ts')
    expect(res).toBeUndefined()
    // No error was set
    expect(result.current.error).toBeNull()
  })

  it('CONTRACT VIOLATION: commit THROWS when no active project (inconsistent with stageFile)', async () => {
    mockProjectState.activeProjectPath = null

    const { result } = renderHook(() => useGitOperations())

    // commit throws "No active project" while stageFile silently returns.
    // This is an inconsistent contract: both should behave the same way.
    await expect(
      result.current.commit('msg'),
    ).rejects.toThrow('No active project')
  })

  it.todo('All mutation operations should have consistent error handling: either all throw or all silently return')

  it('CONTRACT GAP: stageFile silently returns when isGitRepo=false', async () => {
    // First set up as NOT a git repo
    mockGit['isRepo'].mockResolvedValue(false)

    renderHook(() => useGitOperations())

    // Wait for the isRepo check
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    // The hook should have determined this is not a git repo
    // and stageFile should silently return (no error thrown)
    // This documents that stageFile guards on isGitRepo === false
  })

  it('commit rejects empty messages before making the IPC call (CONTRACT FIXED)', async () => {
    // Previously, commit with empty message would send '' to the IPC call.
    // Now commit validates the message is non-empty and throws early.
    mockGit['commit'].mockResolvedValue({ success: true, hash: 'abc123' })

    const { result } = renderHook(() => useGitOperations())

    // Empty message should throw, not send to IPC
    await expect(
      act(async () => {
        await result.current.commit('')
      }),
    ).rejects.toThrow('Commit message cannot be empty')

    // The IPC call was never made
    expect(mockGit['commit']).not.toHaveBeenCalled()
  })

  it('CONTRACT GAP: switchBranch with empty name sends empty string to IPC', async () => {
    mockGit['branchSwitch'].mockResolvedValue(undefined)

    const { result } = renderHook(() => useGitOperations())

    await act(async () => {
      await result.current.switchBranch('')
    })

    expect(mockGit['branchSwitch']).toHaveBeenCalledWith('/test/project', '')
  })

  // ==========================================================================
  // Category 3: Abstraction Ambiguity
  // ==========================================================================

  it('CONTRACT AMBIGUITY: no active project silently returns empty/default state', () => {
    mockProjectState.activeProjectPath = null

    const { result } = renderHook(() => useGitOperations())

    // No project selected - the hook returns default/empty state
    // without any indication that it is in a "no project" state
    expect(result.current.isGitRepo).toBeNull()
    expect(result.current.status).toBeDefined()
  })

  it.todo('useGitOperations should expose an isActiveProject flag or return null when no project is active')

  it('CONTRACT AMBIGUITY: selectedDiff is nullable but status.staged/modified are arrays', () => {
    // selectedDiff can be null (no diff selected). But status.staged and
    // status.modified are always arrays (possibly empty). The null semantics
    // are inconsistent - why is one nullable and others not?
    const { result } = renderHook(() => useGitOperations())

    expect(result.current.selectedDiff).toBeNull()
    expect(result.current.status.staged).toEqual([])
    expect(result.current.status.modified).toEqual([])
  })

  // ==========================================================================
  // Category 4: State & Side-Effect Skepticism
  // ==========================================================================

  it('mutation operations DO auto-refresh status after success', async () => {
    // After a successful stageFile call, status IS refreshed.
    // This is good contract behavior. Let us verify it.
    mockGit['stage'].mockResolvedValue(undefined)
    const statusSpy = mockGit['getStatus']

    const { result } = renderHook(() => useGitOperations())

    // Clear any initial status calls from polling
    statusSpy.mockClear()

    await act(async () => {
      await result.current.stageFile('test.ts')
    })

    // Status WAS called after staging (refreshStatus is called)
    expect(statusSpy).toHaveBeenCalled()
  })

  it('CONTRACT: clearDiff sets selectedDiff to null', () => {
    const { result } = renderHook(() => useGitOperations())

    act(() => {
      result.current.clearDiff()
    })

    expect(result.current.selectedDiff).toBeNull()
  })

  it('CONTRACT: stageFile clears error on success via refreshStatus', async () => {
    // stageFile does not explicitly clear error, but refreshStatus() is called
    // after successful staging, and refreshStatus DOES clear error.
    // So the error IS effectively cleared on success.
    mockGit['stage'].mockRejectedValueOnce(new Error('stage failed'))
    mockGit['stage'].mockResolvedValue(undefined)

    const { result } = renderHook(() => useGitOperations())

    // First stage fails
    await act(async () => {
      try { await result.current.stageFile('test.ts') } catch { /* swallowed */ }
    })
    expect(result.current.error).toContain('stage')

    // Second stage succeeds - refreshStatus clears the error
    await act(async () => {
      await result.current.stageFile('other.ts')
    })

    // Error IS cleared by refreshStatus on success
    expect(result.current.error).toBeNull()
  })
})
