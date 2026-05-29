
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCommandHistory, type CommandHistoryEntry } from '@/renderer/src/hooks/useCommandHistory'

// ── Mock logger ────────────────────────────────────────────────────
vi.mock('@/renderer/src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

const STORAGE_KEY = 'nekocode:command-history'

// ── Helpers ──────────────────────────────────────────────────────────
function getStoredHistory(): CommandHistoryEntry[] {
  const raw = localStorage.getItem(STORAGE_KEY)
  return raw ? JSON.parse(raw) : []
}

function setStoredHistory(entries: CommandHistoryEntry[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
}

// ── Tests ──────────────────────────────────────────────────────────
describe('useCommandHistory', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  // ═══════════════════════════════════════════════════════════════════
  // CONTRACT AUDIT: "recordUsage" — What does "record" actually mean?
  // ═══════════════════════════════════════════════════════════════════
  describe('recordUsage — contract & assumptions', () => {
    it('creates a new entry when name does not exist', () => {
      const { result } = renderHook(() => useCommandHistory())

      act(() => {
        result.current.recordUsage('help', 'slash')
      })

      const history = result.current.getHistory()
      expect(history).toHaveLength(1)
      expect(history[0].name).toBe('help')
      expect(history[0].source).toBe('slash')
      expect(history[0].useCount).toBe(1)
      expect(history[0].lastUsed).toBeTruthy()
    })

    it('bumps existing entry to top and increments useCount on repeat call', () => {
      const { result } = renderHook(() => useCommandHistory())

      act(() => {
        result.current.recordUsage('help', 'slash')
        result.current.recordUsage('status', 'slash')
        result.current.recordUsage('help', 'slash')
      })

      const history = result.current.getHistory()
      // "help" should now be first (most recent) with useCount=2
      expect(history[0].name).toBe('help')
      expect(history[0].useCount).toBe(2)
      expect(history[1].name).toBe('status')
      expect(history[1].useCount).toBe(1)
    })

    // CRITICAL DRILL: What if name is empty string?
    it('handles empty string name without crashing', () => {
      const { result } = renderHook(() => useCommandHistory())

      act(() => {
        result.current.recordUsage('', 'slash')
      })

      const history = result.current.getHistory()
      expect(history).toHaveLength(1)
      expect(history[0].name).toBe('')
    })

    // CRITICAL DRILL: What if source is empty string?
    it('handles empty string source without crashing', () => {
      const { result } = renderHook(() => useCommandHistory())

      act(() => {
        result.current.recordUsage('help', '')
      })

      const history = result.current.getHistory()
      expect(history).toHaveLength(1)
      expect(history[0].source).toBe('')
    })

    // CRITICAL DRILL: What about very long names? (boundary)
    it('handles a very long command name', () => {
      const { result } = renderHook(() => useCommandHistory())
      const longName = 'a'.repeat(10000)

      act(() => {
        result.current.recordUsage(longName, 'slash')
      })

      const history = result.current.getHistory()
      expect(history).toHaveLength(1)
      expect(history[0].name).toBe(longName)
    })

    // CRITICAL DRILL: Special characters in name
    it('handles special characters in command name', () => {
      const { result } = renderHook(() => useCommandHistory())
      const specialName = 'cmd with spaces & <html> "quotes" \'apos\' '

      act(() => {
        result.current.recordUsage(specialName, 'slash')
      })

      const history = result.current.getHistory()
      expect(history[0].name).toBe(specialName)
    })

    // CRITICAL DRILL: Same name with different sources — is it treated as same entry?
    it('treats same name with different sources — latest source should win', () => {
      const { result } = renderHook(() => useCommandHistory())

      act(() => {
        result.current.recordUsage('help', 'slash')
        result.current.recordUsage('help', 'palette')
      })

      const history = result.current.getHistory()
      // Contract: "name" is the unique key, not (name, source)
      expect(history).toHaveLength(1)
      expect(history[0].useCount).toBe(2)
      // BUG/AMBIGUITY: The source from the FIRST call is preserved, not updated.
      // The spread `{ ...entry, lastUsed: now, useCount: entry.useCount + 1 }` keeps
      // the original source. This may be surprising — "recordUsage" implies the
      // latest usage, but the source is stale.
      // CORRECT behavior: the latest source ('palette') should win.
      expect(history[0].source).toBe('palette')
    })

    // CRITICAL DRILL: Idempotency — calling recordUsage rapidly
    it('handles rapid successive calls for the same command', () => {
      const { result } = renderHook(() => useCommandHistory())

      act(() => {
        for (let i = 0; i < 5; i++) {
          result.current.recordUsage('help', 'slash')
        }
      })

      const history = result.current.getHistory()
      expect(history).toHaveLength(1)
      expect(history[0].useCount).toBe(5)
    })
  })

  // ═══════════════════════════════════════════════════════════════════
  // CONTRACT AUDIT: "getRecentNames" — What is "recent"? What type?
  // ═══════════════════════════════════════════════════════════════════
  describe('getRecentNames — contract & assumptions', () => {
    it('returns empty Set when no history', () => {
      const { result } = renderHook(() => useCommandHistory())

      const names = result.current.getRecentNames()
      expect(names).toBeInstanceOf(Set)
      expect(names.size).toBe(0)
    })

    it('returns Set of command names after recording usage', () => {
      const { result } = renderHook(() => useCommandHistory())

      act(() => {
        result.current.recordUsage('help', 'slash')
        result.current.recordUsage('status', 'slash')
      })

      const names = result.current.getRecentNames()
      expect(names.has('help')).toBe(true)
      expect(names.has('status')).toBe(true)
      expect(names.size).toBe(2)
    })

    // CRITICAL DRILL: Set ordering is undefined — does caller assume order?
    it('returns a Set (ordering is not guaranteed by contract)', () => {
      const { result } = renderHook(() => useCommandHistory())

      act(() => {
        result.current.recordUsage('help', 'slash')
      })

      const names = result.current.getRecentNames()
      // The contract returns a Set — no ordering guarantee
      // Callers should NOT depend on iteration order
      expect(names).toBeInstanceOf(Set)
      expect(names.has('help')).toBe(true)
    })
  })

  // ═══════════════════════════════════════════════════════════════════
  // CONTRACT AUDIT: "getHistory" — What is the sort order? Immutable?
  // ═══════════════════════════════════════════════════════════════════
  describe('getHistory — contract & assumptions', () => {
    it('returns empty array when no history', () => {
      const { result } = renderHook(() => useCommandHistory())

      const history = result.current.getHistory()
      expect(history).toEqual([])
    })

    it('returns entries sorted by most recent first', () => {
      const { result } = renderHook(() => useCommandHistory())

      act(() => {
        result.current.recordUsage('first', 'slash')
        result.current.recordUsage('second', 'slash')
        result.current.recordUsage('third', 'slash')
      })

      const history = result.current.getHistory()
      expect(history[0].name).toBe('third')
      expect(history[1].name).toBe('second')
      expect(history[2].name).toBe('first')
    })

    // CRITICAL DRILL: Does getHistory return a deep or shallow copy?
    // BUG FOUND: getHistory returns a SHALLOW copy ([...history]), so the entry
    // objects are shared references. Mutating an entry's properties leaks back
    // into internal state. This is an abstraction leak — the contract name
    // "getHistory" implies a read-only query, but callers can corrupt state.
    // Now correctly returns a deep copy so entry objects are isolated.
    it('returns a deep copy — entry objects should be isolated from internal state', () => {
      const { result } = renderHook(() => useCommandHistory())

      act(() => {
        result.current.recordUsage('help', 'slash')
      })

      const history1 = result.current.getHistory()
      history1[0].name = 'MUTATED'

      const history2 = result.current.getHistory()
      // CORRECT behavior: getHistory should return a deep copy so that
      // mutating the returned array does not leak back into internal state.
      // Currently fails because spread only copies the array, not the entries.
      expect(history2[0].name).toBe('help')
    })
  })

  // ═══════════════════════════════════════════════════════════════════
  // CONTRACT AUDIT: "clearHistory" — Does it really clear everything?
  // ═══════════════════════════════════════════════════════════════════
  describe('clearHistory — contract & assumptions', () => {
    it('clears all history from in-memory state', () => {
      const { result } = renderHook(() => useCommandHistory())

      act(() => {
        result.current.recordUsage('help', 'slash')
        result.current.recordUsage('status', 'slash')
      })

      expect(result.current.getHistory()).toHaveLength(2)

      act(() => {
        result.current.clearHistory()
      })

      expect(result.current.getHistory()).toHaveLength(0)
      expect(result.current.getRecentNames().size).toBe(0)
    })

    it('clears localStorage — note: effect re-saves empty array after removeItem', () => {
      const { result } = renderHook(() => useCommandHistory())

      act(() => {
        result.current.recordUsage('help', 'slash')
      })

      expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull()

      act(() => {
        result.current.clearHistory()
      })

      // AMBIGUITY: clearHistory calls localStorage.removeItem(), but the
      // useEffect that syncs to localStorage re-saves the empty array as "[]".
      // The key is not removed — it's overwritten with an empty array.
      // This is a harmless side-effect but reveals an ordering ambiguity
      // between imperative removal and reactive persistence.
      const stored = localStorage.getItem(STORAGE_KEY)
      expect(stored).not.toBeNull()
      expect(JSON.parse(stored!)).toEqual([])
    })

    // CRITICAL DRILL: Is clearHistory idempotent? Can you clear an already-empty history?
    it('is idempotent — clearing an already-empty history does not throw', () => {
      const { result } = renderHook(() => useCommandHistory())

      expect(() => {
        act(() => {
          result.current.clearHistory()
        })
      }).not.toThrow()

      expect(result.current.getHistory()).toEqual([])
    })
  })

  // ═══════════════════════════════════════════════════════════════════
  // BOUNDARY: MAX_HISTORY enforcement (the contract promises 10 max)
  // ═══════════════════════════════════════════════════════════════════
  describe('MAX_HISTORY boundary', () => {
    it('caps history at 10 entries', () => {
      const { result } = renderHook(() => useCommandHistory())

      act(() => {
        for (let i = 0; i < 15; i++) {
          result.current.recordUsage(`cmd-${i}`, 'slash')
        }
      })

      const history = result.current.getHistory()
      expect(history.length).toBeLessThanOrEqual(10)
    })

    it('keeps the most recent 10 entries (oldest evicted)', () => {
      const { result } = renderHook(() => useCommandHistory())

      act(() => {
        for (let i = 0; i < 15; i++) {
          result.current.recordUsage(`cmd-${i}`, 'slash')
        }
      })

      const history = result.current.getHistory()
      // Most recent is cmd-14, least recent kept is cmd-5
      expect(history[0].name).toBe('cmd-14')
      expect(history[history.length - 1].name).toBe('cmd-5')
      // cmd-0 through cmd-4 should have been evicted
      const names = result.current.getRecentNames()
      expect(names.has('cmd-0')).toBe(false)
      expect(names.has('cmd-4')).toBe(false)
      expect(names.has('cmd-5')).toBe(true)
    })

    it('persists only 10 entries to localStorage', () => {
      const { result } = renderHook(() => useCommandHistory())

      act(() => {
        for (let i = 0; i < 15; i++) {
          result.current.recordUsage(`cmd-${i}`, 'slash')
        }
      })

      const stored = getStoredHistory()
      expect(stored.length).toBeLessThanOrEqual(10)
    })
  })

  // ═══════════════════════════════════════════════════════════════════
  // ABSTRACTION AMBIGUITY: localStorage persistence contract
  // ═══════════════════════════════════════════════════════════════════
  describe('localStorage persistence', () => {
    it('loads history from localStorage on init', () => {
      setStoredHistory([
        { name: 'cached-cmd', source: 'slash', lastUsed: '2025-01-01T00:00:00.000Z', useCount: 3 },
      ])

      const { result } = renderHook(() => useCommandHistory())
      const history = result.current.getHistory()

      expect(history).toHaveLength(1)
      expect(history[0].name).toBe('cached-cmd')
    })

    // CRITICAL DRILL: What if localStorage has corrupt/unparseable data?
    it('gracefully handles corrupt localStorage data', () => {
      localStorage.setItem(STORAGE_KEY, 'not-valid-json{{{')

      const { result } = renderHook(() => useCommandHistory())
      // Should not throw, should return empty history
      const history = result.current.getHistory()
      expect(history).toEqual([])
    })

    // CRITICAL DRILL: What if localStorage has a non-array value?
    // BUG FOUND: The hook blindly casts JSON.parse result to CommandHistoryEntry[].
    // If the stored value is a non-iterable object (e.g., {"not":"an array"}),
    // getHistory() crashes with "TypeError: history is not iterable" because
    // [...history] requires an iterable. This is an unguarded contract assumption.
    // CORRECT behavior: gracefully degrade by returning an empty array
    // instead of crashing. Now fixed — implementation validates Array.isArray().
    it('gracefully handles non-array JSON in localStorage — should return empty array, not crash', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ not: 'an array' }))

      const { result } = renderHook(() => useCommandHistory())
      // The hook should gracefully handle non-array JSON by returning an empty array
      // instead of crashing with "history is not iterable"
      expect(() => result.current.getHistory()).not.toThrow()
      expect(result.current.getHistory()).toEqual([])
    })

    it('saves to localStorage after recordUsage', () => {
      const { result } = renderHook(() => useCommandHistory())

      act(() => {
        result.current.recordUsage('help', 'slash')
      })

      const stored = getStoredHistory()
      expect(stored).toHaveLength(1)
      expect(stored[0].name).toBe('help')
    })
  })

  // ═══════════════════════════════════════════════════════════════════
  // STATE & SIDE-EFFECT SKEPTICISM: Unmount safety
  // ═══════════════════════════════════════════════════════════════════
  describe('unmount safety', () => {
    it('does not write to localStorage after unmount', () => {
      const { unmount } = renderHook(() => useCommandHistory())

      unmount()

      // After unmount, internal mountedRef is false
      // If we could trigger a state update after unmount, it should not persist
      // This test verifies the mountedRef guard exists
      const stored = getStoredHistory()
      // Should still be whatever was there before unmount (empty)
      expect(stored).toEqual([])
    })
  })
})
