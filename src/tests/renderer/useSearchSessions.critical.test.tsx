// @vitest-environment jsdom
/**
 * useSearchSessions CRITICAL contract-violation tests.
 *
 * There were ZERO tests for this hook before. These tests probe the contract:
 *   useSearchSessions(query: string): SessionSearchResult[]
 *
 * Contract assumptions to challenge:
 * - "query" is just a string - what about empty, whitespace, very long, special chars?
 * - Returns up to 20 results - what about projects with 100+ sessions?
 * - matchScore uses substring matching - what about Unicode, regex chars, injection?
 * - Empty query returns all sessions with score 0.5 - is that the right contract?
 * - Projects with no sessions, null sessions, duplicate session IDs
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

// Mock the project store before importing the hook
const mockState = {
  projects: [] as Array<{
    id: string
    name: string
    path: string
    sessions: Array<{ id: string; firstMessage: string; created: string; messageCount: number }>
  }>,
}

vi.mock('../../renderer/src/stores/project-store', () => ({
  useProjectStore: () => ({ state: mockState }),
}))

import { useSearchSessions } from '../../renderer/src/hooks/useSearchSessions'

function makeProject(
  path: string,
  sessions: Array<{ id: string; firstMessage?: string; messageCount?: number }> = [],
) {
  return {
    id: path,
    name: path.split('/').pop() || path,
    path,
    sessions: sessions.map((s) => ({
      id: s.id,
      firstMessage: s.firstMessage ?? '',
      created: new Date().toISOString(),
      messageCount: s.messageCount ?? 0,
    })),
  }
}

function resetMockState() {
  mockState.projects = []
}

describe('useSearchSessions - Critical Contract Tests', () => {
  beforeEach(() => {
    resetMockState()
  })

  // ==========================================================================
  // Category 1: Name vs Reality
  // "Search sessions" implies it returns sessions that match the query.
  // But empty query returns ALL sessions. Is "return everything" a "search"?
  // ==========================================================================

  it('CONTRACT AMBIGUITY: empty query returns ALL sessions, not zero results', () => {
    // The name "searchSessions" suggests a search operation.
    // But passing an empty query returns up to 20 sessions.
    // This is a UI convenience (suggestions), but violates the "search" contract.
    mockState.projects = [
      makeProject('/proj1', [
        { id: 's1', firstMessage: 'Hello' },
        { id: 's2', firstMessage: 'World' },
      ]),
    ]

    const { result } = renderHook(() => useSearchSessions(''))
    expect(result.current).toHaveLength(2)
    // All results have neutral score 0.5 - not really "search results"
    expect(result.current[0].score).toBe(0.5)
  })

  it('whitespace-only query returns ALL sessions (not treated as empty)', () => {
    // "   " is truthy but .trim() is empty. The hook uses .trim() for the
    // early return. Let's verify the contract.
    mockState.projects = [
      makeProject('/proj1', [
        { id: 's1', firstMessage: 'Hello' },
      ]),
    ]

    const { result } = renderHook(() => useSearchSessions('   '))
    // Whitespace is trimmed, so this should behave like empty query
    expect(result.current).toHaveLength(1)
    expect(result.current[0].score).toBe(0.5)
  })

  // ==========================================================================
  // Category 2: Argument Boundary & Assumption Drilling
  // ==========================================================================

  it('very long query does not crash', () => {
    mockState.projects = [
      makeProject('/proj1', [
        { id: 's1', firstMessage: 'Hello' },
      ]),
    ]

    const longQuery = 'a'.repeat(100000)
    const { result } = renderHook(() => useSearchSessions(longQuery))
    expect(result.current).toHaveLength(0)
  })

  it('query with regex special characters is treated literally', () => {
    mockState.projects = [
      makeProject('/proj1', [
        { id: 's1', firstMessage: 'test [abc] plus (group) and $end^' },
      ]),
    ]

    // These characters have special meaning in regex but the hook uses
    // substring matching (indexOf), not regex. This should work fine.
    const { result } = renderHook(() => useSearchSessions('[abc]'))
    expect(result.current).toHaveLength(1)
  })

  it('query with Unicode characters matches correctly', () => {
    mockState.projects = [
      makeProject('/proj1', [
        { id: 's1', firstMessage: 'Hello \u4e16\u754c\u3067\u3059' },
      ]),
    ]

    const { result } = renderHook(() => useSearchSessions('\u4e16\u754c'))
    expect(result.current).toHaveLength(1)
  })

  it('projects with undefined sessions array is handled gracefully (CONTRACT FIXED)', () => {
    // Previously, a project with sessions=undefined would cause a TypeError.
    // Now the hook guards with `project.sessions ?? []`.
    mockState.projects = [
      {
        id: '/proj1',
        name: 'proj1',
        path: '/proj1',
        sessions: undefined as unknown as Array<{ id: string; firstMessage: string; created: string; messageCount: number }>,
      },
    ]

    // Should NOT throw — undefined sessions is treated as empty array
    const { result } = renderHook(() => useSearchSessions('test'))
    expect(result.current).toEqual([])
  })

  it('handles projects with undefined/null sessions gracefully (CONTRACT FIXED)', () => {
    // Previously, a project with undefined sessions would cause a TypeError
    // when iterating. Now the hook guards with `project.sessions ?? []`.
    mockState.projects = [
      {
        id: '/proj1',
        name: 'proj1',
        path: '/proj1',
        sessions: undefined as unknown as Array<{ id: string; firstMessage: string; created: string; messageCount: number }>,
      },
      {
        id: '/proj2',
        name: 'proj2',
        path: '/proj2',
        sessions: null as unknown as Array<{ id: string; firstMessage: string; created: string; messageCount: number }>,
      },
      {
        id: '/proj3',
        name: 'proj3',
        path: '/proj3',
        sessions: [],
      },
    ]

    // Should NOT throw — undefined/null sessions are treated as empty arrays
    const { result } = renderHook(() => useSearchSessions(''))
    expect(result.current).toEqual([])
  })

  // ==========================================================================
  // Category 3: Result limit boundary & scoring edge cases
  // ==========================================================================

  it('returns at most 20 results even with more sessions', () => {
    const sessions = Array.from({ length: 50 }, (_, i) => ({
      id: `s${i}`,
      firstMessage: `Session ${i}`,
    }))
    mockState.projects = [makeProject('/proj1', sessions)]

    // Empty query - returns first 20
    const { result } = renderHook(() => useSearchSessions(''))
    expect(result.current).toHaveLength(20)
  })

  it('returns at most 20 results for matching queries', () => {
    const sessions = Array.from({ length: 50 }, (_, i) => ({
      id: `s${i}`,
      firstMessage: `Match session ${i}`,
    }))
    mockState.projects = [makeProject('/proj1', sessions)]

    const { result } = renderHook(() => useSearchSessions('Match'))
    expect(result.current).toHaveLength(20)
  })

  it('results are sorted by score descending', () => {
    mockState.projects = [
      makeProject('/proj1', [
        { id: 's1', firstMessage: 'Find this exact match at start' },
        { id: 's2', firstMessage: 'This one has Find in the middle' },
        { id: 's3', firstMessage: 'Another find with lowercase' },
      ]),
    ]

    const { result } = renderHook(() => useSearchSessions('Find'))
    expect(result.current.length).toBeGreaterThan(0)
    // Verify descending order
    for (let i = 1; i < result.current.length; i++) {
      expect(result.current[i - 1].score).toBeGreaterThanOrEqual(result.current[i].score)
    }
  })

  it('CONTRACT AMBIGUITY: match scoring is case-insensitive but result name is original case', () => {
    mockState.projects = [
      makeProject('/proj1', [
        { id: 's1', firstMessage: 'Hello World' },
      ]),
    ]

    const { result } = renderHook(() => useSearchSessions('hello'))
    expect(result.current).toHaveLength(1)
    // The match was case-insensitive, but the returned name preserves original case
    expect(result.current[0].name).toBe('Hello World'.slice(0, 40))
  })

  it('firstMessage is truncated to 40 chars in the name field', () => {
    mockState.projects = [
      makeProject('/proj1', [
        { id: 's1', firstMessage: 'A'.repeat(100) },
      ]),
    ]

    const { result } = renderHook(() => useSearchSessions(''))
    expect(result.current[0].name).toHaveLength(40)
  })

  it('session with empty firstMessage uses id prefix (8 chars) as name', () => {
    mockState.projects = [
      makeProject('/proj1', [
        { id: 'session-abc-123-def', firstMessage: '' },
      ]),
    ]

    const { result } = renderHook(() => useSearchSessions(''))
    expect(result.current[0].name).toBe('session-') // first 8 chars of id
  })

  it('CONTRACT GAP: duplicate session IDs across projects return duplicate entries', () => {
    // Two projects can have sessions with the same ID. The hook does not
    // deduplicate, so the same session ID appears twice in results.
    mockState.projects = [
      makeProject('/proj1', [{ id: 'shared-id', firstMessage: 'From proj1' }]),
      makeProject('/proj2', [{ id: 'shared-id', firstMessage: 'From proj2' }]),
    ]

    const { result } = renderHook(() => useSearchSessions('From'))
    // Both are returned, even though they share the same session ID
    expect(result.current).toHaveLength(2)
    expect(result.current[0].sessionId).toBe('shared-id')
    expect(result.current[1].sessionId).toBe('shared-id')
    // They differ by cwd
    expect(result.current[0].cwd).not.toBe(result.current[1].cwd)
  })

  it.todo('useSearchSessions should consider whether duplicate session IDs across projects need deduplication')

  // ==========================================================================
  // Category 4: State & Side-Effect Skepticism
  // ==========================================================================

  it('multiple projects with zero sessions returns empty', () => {
    mockState.projects = [
      makeProject('/proj1', []),
      makeProject('/proj2', []),
    ]

    const { result } = renderHook(() => useSearchSessions('test'))
    expect(result.current).toHaveLength(0)
  })

  it('query matching project path returns sessions from that project', () => {
    mockState.projects = [
      makeProject('/home/user/myproject', [
        { id: 's1', firstMessage: 'Unrelated' },
      ]),
    ]

    const { result } = renderHook(() => useSearchSessions('myproject'))
    expect(result.current).toHaveLength(1)
    // The match was on the project path, not the session name
    expect(result.current[0].cwd).toBe('/home/user/myproject')
  })

  it('no matching sessions returns empty array', () => {
    mockState.projects = [
      makeProject('/proj1', [
        { id: 's1', firstMessage: 'Hello World' },
      ]),
    ]

    const { result } = renderHook(() => useSearchSessions('xyzzy'))
    expect(result.current).toHaveLength(0)
  })

  it('changing query re-computes results', () => {
    mockState.projects = [
      makeProject('/proj1', [
        { id: 's1', firstMessage: 'Alpha Beta' },
        { id: 's2', firstMessage: 'Gamma Delta' },
      ]),
    ]

    const { result, rerender } = renderHook(
      (query: string) => useSearchSessions(query),
      { initialProps: 'Alpha' },
    )

    expect(result.current).toHaveLength(1)
    expect(result.current[0].sessionId).toBe('s1')

    rerender('Gamma')
    expect(result.current).toHaveLength(1)
    expect(result.current[0].sessionId).toBe('s2')
  })

  it('matchScore prefers matches at the start of text', () => {
    // This tests the position bonus in matchScore indirectly
    mockState.projects = [
      makeProject('/proj1', [
        { id: 's1', firstMessage: 'Find at start' },
        { id: 's2', firstMessage: 'The word Find is in the middle' },
      ]),
    ]

    const { result } = renderHook(() => useSearchSessions('Find'))
    expect(result.current).toHaveLength(2)
    // First result should have higher score (match at start gets positionBonus)
    expect(result.current[0].score).toBeGreaterThan(result.current[1].score)
    expect(result.current[0].sessionId).toBe('s1')
  })
})
