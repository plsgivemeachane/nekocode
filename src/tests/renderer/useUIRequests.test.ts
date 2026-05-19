
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useUIRequests } from '@/renderer/src/hooks/useUIRequests'
import type { UIRequest, NekoCodeIPC } from '@/shared/ipc-types'

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
let onUIRequestCallback: ((request: UIRequest) => void) | null = null
const mockUIRespond = vi.fn()
const mockOnUIRequest = vi.fn((cb: (req: UIRequest) => void) => {
  onUIRequestCallback = cb
  return () => { onUIRequestCallback = null }
})

beforeEach(() => {
  vi.clearAllMocks()
  onUIRequestCallback = null
  mockNekoCode({
    session: {
      onUIRequest: mockOnUIRequest,
      uiRespond: mockUIRespond,
    },
  })
})

// ── Helpers ──────────────────────────────────────────────────────────
function makeUIRequest(overrides: Partial<UIRequest> = {}): UIRequest {
  return {
    id: 'req-1',
    sessionId: 'session-1',
    type: 'confirm',
    title: 'Confirm action',
    ...overrides,
  }
}

function emitUIRequest(request: UIRequest): void {
  if (onUIRequestCallback) {
    onUIRequestCallback(request)
  }
}

// ── Tests ──────────────────────────────────────────────────────────
describe('useUIRequests', () => {
  // ═══════════════════════════════════════════════════════════════════
  // CONTRACT AUDIT: "activeRequest" — What is the initial/lifecycle state?
  // ═══════════════════════════════════════════════════════════════════
  describe('activeRequest — lifecycle contract', () => {
    it('starts with null when no sessionId', () => {
      const { result } = renderHook(() => useUIRequests(null))
      expect(result.current.activeRequest).toBeNull()
    })

    it('subscribes to onUIRequest when sessionId is provided', () => {
      renderHook(() => useUIRequests('session-1'))
      expect(mockOnUIRequest).toHaveBeenCalledTimes(1)
    })

    it('sets activeRequest when a matching UI request arrives', () => {
      const { result } = renderHook(() => useUIRequests('session-1'))

      act(() => {
        emitUIRequest(makeUIRequest({ id: 'req-1', sessionId: 'session-1' }))
      })

      expect(result.current.activeRequest).not.toBeNull()
      expect(result.current.activeRequest!.request.id).toBe('req-1')
    })

    // CRITICAL DRILL: What if the request is for a different session?
    it('ignores UI requests for a different session', () => {
      const { result } = renderHook(() => useUIRequests('session-1'))

      act(() => {
        emitUIRequest(makeUIRequest({ id: 'req-2', sessionId: 'session-OTHER' }))
      })

      expect(result.current.activeRequest).toBeNull()
    })

    // CRITICAL DRILL: What if a second request arrives while one is pending?
    it('ignores a second UI request while one is already active', () => {
      const { result } = renderHook(() => useUIRequests('session-1'))

      act(() => {
        emitUIRequest(makeUIRequest({ id: 'req-1', sessionId: 'session-1' }))
      })

      expect(result.current.activeRequest!.request.id).toBe('req-1')

      // Second request should be ignored
      act(() => {
        emitUIRequest(makeUIRequest({ id: 'req-2', sessionId: 'session-1' }))
      })

      // Still the first request
      expect(result.current.activeRequest!.request.id).toBe('req-1')
    })
  })

  // ═══════════════════════════════════════════════════════════════════
  // CONTRACT AUDIT: "localState" — What are the defaults for each type?
  // ═══════════════════════════════════════════════════════════════════
  describe('localState — default values contract', () => {
    it('initializes inputValue from request.defaultValue for input type', () => {
      const { result } = renderHook(() => useUIRequests('session-1'))

      act(() => {
        emitUIRequest(makeUIRequest({
          type: 'input',
          defaultValue: 'hello',
          placeholder: 'Enter text',
        }))
      })

      expect(result.current.activeRequest!.localState.inputValue).toBe('hello')
    })

    it('initializes inputValue to empty string when no defaultValue', () => {
      const { result } = renderHook(() => useUIRequests('session-1'))

      act(() => {
        emitUIRequest(makeUIRequest({ type: 'input' }))
      })

      expect(result.current.activeRequest!.localState.inputValue).toBe('')
    })

    it('initializes highlightedIndex to -1 (no selection)', () => {
      const { result } = renderHook(() => useUIRequests('session-1'))

      act(() => {
        emitUIRequest(makeUIRequest({ type: 'select' }))
      })

      expect(result.current.activeRequest!.localState.highlightedIndex).toBe(-1)
    })
  })

  // ═══════════════════════════════════════════════════════════════════
  // CONTRACT AUDIT: "updateLocalState" — Partial update or full replace?
  // ═══════════════════════════════════════════════════════════════════
  describe('updateLocalState — contract & assumptions', () => {
    it('patches localState without replacing unrelated fields', () => {
      const { result } = renderHook(() => useUIRequests('session-1'))

      act(() => {
        emitUIRequest(makeUIRequest({ type: 'input', defaultValue: 'hello' }))
      })

      // Update only highlightedIndex
      act(() => {
        result.current.updateLocalState({ highlightedIndex: 2 })
      })

      // inputValue should be preserved
      expect(result.current.activeRequest!.localState.inputValue).toBe('hello')
      expect(result.current.activeRequest!.localState.highlightedIndex).toBe(2)
    })

    // CRITICAL DRILL: What if there is no active request?
    it('does nothing when called with no active request', () => {
      const { result } = renderHook(() => useUIRequests('session-1'))

      expect(() => {
        act(() => {
          result.current.updateLocalState({ inputValue: 'test' })
        })
      }).not.toThrow()

      expect(result.current.activeRequest).toBeNull()
    })
  })

  // ═══════════════════════════════════════════════════════════════════
  // CONTRACT AUDIT: "confirm" — What does confirm actually send?
  // ═══════════════════════════════════════════════════════════════════
  describe('confirm — contract & assumptions', () => {
    it('sends a confirmed response with the correct IDs', () => {
      const { result } = renderHook(() => useUIRequests('session-1'))

      act(() => {
        emitUIRequest(makeUIRequest({ id: 'req-1', sessionId: 'session-1', type: 'confirm' }))
      })

      act(() => {
        result.current.confirm()
      })

      expect(mockUIRespond).toHaveBeenCalledTimes(1)
      expect(mockUIRespond).toHaveBeenCalledWith({
        requestId: 'req-1',
        sessionId: 'session-1',
        confirmed: true,
      })
    })

    it('passes selectedValue for select type', () => {
      const { result } = renderHook(() => useUIRequests('session-1'))

      act(() => {
        emitUIRequest(makeUIRequest({ id: 'req-1', sessionId: 'session-1', type: 'select' }))
      })

      act(() => {
        result.current.confirm('option-1')
      })

      expect(mockUIRespond).toHaveBeenCalledWith(
        expect.objectContaining({
          confirmed: true,
          selectedValue: 'option-1',
        })
      )
    })

    it('passes inputValue for input type', () => {
      const { result } = renderHook(() => useUIRequests('session-1'))

      act(() => {
        emitUIRequest(makeUIRequest({ id: 'req-1', sessionId: 'session-1', type: 'input' }))
      })

      act(() => {
        result.current.confirm(undefined, 'typed text')
      })

      expect(mockUIRespond).toHaveBeenCalledWith(
        expect.objectContaining({
          confirmed: true,
          inputValue: 'typed text',
        })
      )
    })

    it('clears the active request after confirming', () => {
      const { result } = renderHook(() => useUIRequests('session-1'))

      act(() => {
        emitUIRequest(makeUIRequest({ id: 'req-1', sessionId: 'session-1' }))
      })

      expect(result.current.activeRequest).not.toBeNull()

      act(() => {
        result.current.confirm()
      })

      expect(result.current.activeRequest).toBeNull()
    })

    // CRITICAL DRILL: What if confirm is called with no active request?
    it('does nothing when called with no active request', () => {
      const { result } = renderHook(() => useUIRequests('session-1'))

      act(() => {
        result.current.confirm()
      })

      expect(mockUIRespond).not.toHaveBeenCalled()
    })
  })

  // ═══════════════════════════════════════════════════════════════════
  // CONTRACT AUDIT: "cancel" — What does cancel send?
  // ═══════════════════════════════════════════════════════════════════
  describe('cancel — contract & assumptions', () => {
    it('sends a response with confirmed=false', () => {
      const { result } = renderHook(() => useUIRequests('session-1'))

      act(() => {
        emitUIRequest(makeUIRequest({ id: 'req-1', sessionId: 'session-1' }))
      })

      act(() => {
        result.current.cancel()
      })

      expect(mockUIRespond).toHaveBeenCalledWith({
        requestId: 'req-1',
        sessionId: 'session-1',
        confirmed: false,
      })
    })

    it('clears the active request after cancelling', () => {
      const { result } = renderHook(() => useUIRequests('session-1'))

      act(() => {
        emitUIRequest(makeUIRequest({ sessionId: 'session-1' }))
      })

      act(() => {
        result.current.cancel()
      })

      expect(result.current.activeRequest).toBeNull()
    })

    // CRITICAL DRILL: Cancel with no active request
    it('does nothing when called with no active request', () => {
      const { result } = renderHook(() => useUIRequests('session-1'))

      act(() => {
        result.current.cancel()
      })

      expect(mockUIRespond).not.toHaveBeenCalled()
    })
  })

  // ═══════════════════════════════════════════════════════════════════
  // ABSTRACTION AMBIGUITY: After confirm/cancel, can a new request arrive?
  // ═══════════════════════════════════════════════════════════════════
  describe('sequential request handling', () => {
    it('accepts a new request after the previous one was confirmed', () => {
      const { result } = renderHook(() => useUIRequests('session-1'))

      act(() => {
        emitUIRequest(makeUIRequest({ id: 'req-1', sessionId: 'session-1' }))
      })

      act(() => {
        result.current.confirm()
      })

      // Now send a second request
      act(() => {
        emitUIRequest(makeUIRequest({ id: 'req-2', sessionId: 'session-1' }))
      })

      expect(result.current.activeRequest!.request.id).toBe('req-2')
    })

    it('accepts a new request after the previous one was cancelled', () => {
      const { result } = renderHook(() => useUIRequests('session-1'))

      act(() => {
        emitUIRequest(makeUIRequest({ id: 'req-1', sessionId: 'session-1' }))
      })

      act(() => {
        result.current.cancel()
      })

      act(() => {
        emitUIRequest(makeUIRequest({ id: 'req-2', sessionId: 'session-1' }))
      })

      expect(result.current.activeRequest!.request.id).toBe('req-2')
    })
  })
})
