
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useCommands } from '@/renderer/src/hooks/useCommands'
import type { CommandInfo, NekoCodeIPC } from '@/shared/ipc-types'

// Type-safe helper to mock window.nekocode in tests
function mockNekoCode(partial: Record<string, unknown>): void {
  ;(window as unknown as { nekocode: NekoCodeIPC }).nekocode = partial as unknown as NekoCodeIPC
}

// ── Mock logger ────────────────────────────────────────────────────
vi.mock('@/renderer/src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

// ── Mock window.nekocode ────────────────────────────────────────────
const mockGetCommands = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  mockNekoCode({
    session: {
      getCommands: mockGetCommands,
    },
  })
})

// ── Helpers ──────────────────────────────────────────────────────────
function makeCommand(overrides: Partial<CommandInfo> = {}): CommandInfo {
  return {
    name: 'test-cmd',
    description: 'A test command',
    source: 'extension',
    ...overrides,
  }
}

function makeCommands(names: string[]): CommandInfo[] {
  return names.map((name, i) => makeCommand({ name, description: `Command ${i}` }))
}

// ── Tests ──────────────────────────────────────────────────────────
describe('useCommands', () => {
  // ═══════════════════════════════════════════════════════════════════
  // CONTRACT AUDIT: "commands" — What is the sort contract?
  // ═══════════════════════════════════════════════════════════════════
  describe('commands — sort contract', () => {
    it('starts with empty commands when sessionId is null', async () => {
      mockGetCommands.mockResolvedValue([])

      const { result } = renderHook(() => useCommands({ sessionId: null }))

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.commands).toEqual([])
    })

    it('sorts commands alphabetically when no history exists', async () => {
      const cmds = makeCommands(['zebra', 'alpha', 'middle'])
      mockGetCommands.mockResolvedValue(cmds)

      const { result } = renderHook(() => useCommands({ sessionId: 'session-1' }))

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      const names = result.current.commands.map(c => c.name)
      expect(names).toEqual(['alpha', 'middle', 'zebra'])
    })

    it('places recently used commands before non-recent ones', async () => {
      const cmds = makeCommands(['alpha', 'beta', 'gamma', 'delta'])
      mockGetCommands.mockResolvedValue(cmds)

      const { result } = renderHook(() => useCommands({ sessionId: 'session-1' }))

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      // Record usage for "gamma" — it should move to the front
      act(() => {
        result.current.recordCommandUsage('gamma', 'slash')
      })

      const names = result.current.commands.map(c => c.name)
      expect(names[0]).toBe('gamma')
      // Remaining should be alphabetical
      expect(names.slice(1)).toEqual(['alpha', 'beta', 'delta'])
    })

    it('sorts recent commands by most-recently-used-first', async () => {
      const cmds = makeCommands(['alpha', 'beta', 'gamma', 'delta'])
      mockGetCommands.mockResolvedValue(cmds)

      const { result } = renderHook(() => useCommands({ sessionId: 'session-1' }))

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      // Use beta first, then gamma — gamma is most recent
      act(() => {
        result.current.recordCommandUsage('beta', 'slash')
        result.current.recordCommandUsage('gamma', 'slash')
      })

      const names = result.current.commands.map(c => c.name)
      // gamma is most recent, then beta, then the rest alphabetically
      expect(names[0]).toBe('gamma')
      expect(names[1]).toBe('beta')
      expect(names.slice(2)).toEqual(['alpha', 'delta'])
    })
  })

  // ═══════════════════════════════════════════════════════════════════
  // CONTRACT AUDIT: "filterCommands" — What does "filter" promise?
  // ═══════════════════════════════════════════════════════════════════
  describe('filterCommands — contract & assumptions', () => {
    it('returns all commands when query is empty string', async () => {
      const cmds = makeCommands(['alpha', 'beta'])
      mockGetCommands.mockResolvedValue(cmds)

      const { result } = renderHook(() => useCommands({ sessionId: 'session-1' }))

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      const filtered = result.current.filterCommands('')
      expect(filtered).toHaveLength(2)
    })

    it('filters by command name (case-insensitive)', async () => {
      const cmds = makeCommands(['Alpha', 'beta', 'GAMMA'])
      mockGetCommands.mockResolvedValue(cmds)

      const { result } = renderHook(() => useCommands({ sessionId: 'session-1' }))

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      const filtered = result.current.filterCommands('alp')
      expect(filtered).toHaveLength(1)
      expect(filtered[0].name).toBe('Alpha')
    })

    it('filters by description (case-insensitive)', async () => {
      const cmds = [
        makeCommand({ name: 'cmd1', description: 'Deploy to production' }),
        makeCommand({ name: 'cmd2', description: 'Run tests' }),
      ]
      mockGetCommands.mockResolvedValue(cmds)

      const { result } = renderHook(() => useCommands({ sessionId: 'session-1' }))

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      const filtered = result.current.filterCommands('PROD')
      expect(filtered).toHaveLength(1)
      expect(filtered[0].name).toBe('cmd1')
    })

    // CRITICAL DRILL: What if description is undefined?
    it('handles commands with undefined description without crashing', async () => {
      const cmds = [
        makeCommand({ name: 'no-desc', description: undefined }),
        makeCommand({ name: 'has-desc', description: 'A description' }),
      ]
      mockGetCommands.mockResolvedValue(cmds)

      const { result } = renderHook(() => useCommands({ sessionId: 'session-1' }))

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      // Search for something that only matches the description
      const filtered = result.current.filterCommands('desc')
      // "no-desc" matches by name; "has-desc" matches by name and description
      expect(filtered.length).toBeGreaterThanOrEqual(1)
    })

    // CRITICAL DRILL: Special regex characters in query
    it('handles special regex-like characters in query without crashing', async () => {
      const cmds = makeCommands(['test'])
      mockGetCommands.mockResolvedValue(cmds)

      const { result } = renderHook(() => useCommands({ sessionId: 'session-1' }))

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      // The implementation uses toLowerCase().includes(), not regex
      // So these should not crash
      expect(() => result.current.filterCommands('[regex]')).not.toThrow()
      expect(() => result.current.filterCommands('test.*')).not.toThrow()
    })
  })

  // ═══════════════════════════════════════════════════════════════════
  // CONTRACT AUDIT: "refreshCommands" — What happens on failure?
  // ═══════════════════════════════════════════════════════════════════
  describe('refreshCommands — failure & edge cases', () => {
    it('sets isLoading to false even when fetch fails', async () => {
      mockGetCommands.mockRejectedValue(new Error('Network error'))

      const { result } = renderHook(() => useCommands({ sessionId: 'session-1' }))

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.commands).toEqual([])
    })

    it('clears commands on fetch failure', async () => {
      // First load succeeds
      mockGetCommands.mockResolvedValueOnce(makeCommands(['cmd1']))

      const { result } = renderHook(() => useCommands({ sessionId: 'session-1' }))

      await waitFor(() => {
        expect(result.current.commands).toHaveLength(1)
      })

      // Then refresh fails
      mockGetCommands.mockRejectedValueOnce(new Error('Network error'))

      await act(async () => {
        await result.current.refreshCommands()
      })

      expect(result.current.commands).toEqual([])
    })

    it('does not update state after unmount during fetch', async () => {
      let resolveFetch: (value: CommandInfo[]) => void
      mockGetCommands.mockReturnValue(new Promise<CommandInfo[]>((resolve) => {
        resolveFetch = resolve
      }))

      const { result, unmount } = renderHook(() => useCommands({ sessionId: 'session-1' }))

      expect(result.current.isLoading).toBe(true)

      unmount()

      // Resolve after unmount — should not cause state update
      await act(async () => {
        resolveFetch!(makeCommands(['late-cmd']))
      })

      // No crash = success. State update was guarded by mountedRef.
    })

    // CRITICAL DRILL: sessionId is null — should not fetch
    it('does not fetch commands when sessionId is null', async () => {
      const { result } = renderHook(() => useCommands({ sessionId: null }))

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(mockGetCommands).not.toHaveBeenCalled()
      expect(result.current.commands).toEqual([])
    })
  })

  // ═══════════════════════════════════════════════════════════════════
  // CONTRACT AUDIT: "recordCommandUsage" & history delegation
  // ═══════════════════════════════════════════════════════════════════
  describe('command history delegation', () => {
    it('records command usage and returns recent names', async () => {
      mockGetCommands.mockResolvedValue(makeCommands(['help', 'status']))

      const { result } = renderHook(() => useCommands({ sessionId: 'session-1' }))

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      act(() => {
        result.current.recordCommandUsage('help', 'slash')
      })

      const recentNames = result.current.getRecentCommandNames()
      expect(recentNames.has('help')).toBe(true)
      expect(recentNames.has('status')).toBe(false)
    })

    it('returns command history entries', async () => {
      mockGetCommands.mockResolvedValue(makeCommands(['help']))

      const { result } = renderHook(() => useCommands({ sessionId: 'session-1' }))

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      act(() => {
        result.current.recordCommandUsage('help', 'slash')
      })

      const history = result.current.getCommandHistory()
      expect(history).toHaveLength(1)
      expect(history[0].name).toBe('help')
    })
  })
})
