
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useWorkflowSteps } from '@/renderer/src/hooks/useWorkflowSteps'
import type { WorkflowStepEvent, SessionStreamEvent, NekoCodeIPC } from '@/shared/ipc-types'

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
let onEventCallback: ((payload: { sessionId: string; event: SessionStreamEvent }) => void) | null = null
const mockOnEvent = vi.fn((cb: (payload: { sessionId: string; event: SessionStreamEvent }) => void) => {
  onEventCallback = cb
  return () => { onEventCallback = null }
})

beforeEach(() => {
  vi.clearAllMocks()
  onEventCallback = null
  mockNekoCode({
    session: {
      onEvent: mockOnEvent,
    },
  })
})

// ── Helpers ──────────────────────────────────────────────────────────
function makeStep(overrides: Partial<WorkflowStepEvent> = {}): WorkflowStepEvent {
  return {
    sessionId: 'session-1',
    workflowId: 'wf-1',
    workflowName: 'deploy',
    stepIndex: 0,
    totalSteps: 3,
    stepName: 'build',
    status: 'running',
    ...overrides,
  }
}

function emitEvent(sessionId: string, event: SessionStreamEvent): void {
  if (onEventCallback) {
    onEventCallback({ sessionId, event })
  }
}

function emitWorkflowStep(step: WorkflowStepEvent): void {
  emitEvent(step.sessionId, { type: 'workflow_step', step })
}

// ── Tests ──────────────────────────────────────────────────────────
describe('useWorkflowSteps', () => {
  // ═══════════════════════════════════════════════════════════════════
  // CONTRACT AUDIT: "workflows" — What is the initial state?
  // ═══════════════════════════════════════════════════════════════════
  describe('workflows — initial state', () => {
    it('starts with an empty Map when sessionId is null', () => {
      const { result } = renderHook(() => useWorkflowSteps(null))
      expect(result.current.workflows.size).toBe(0)
    })

    it('starts with an empty Map when sessionId is provided but no events', () => {
      const { result } = renderHook(() => useWorkflowSteps('session-1'))
      expect(result.current.workflows.size).toBe(0)
    })
  })

  // ═══════════════════════════════════════════════════════════════════
  // CONTRACT AUDIT: Workflow tracking — name vs reality
  // ═══════════════════════════════════════════════════════════════════
  describe('workflow tracking — contract & assumptions', () => {
    it('creates a new workflow from the first step event', () => {
      const { result } = renderHook(() => useWorkflowSteps('session-1'))

      act(() => {
        emitWorkflowStep(makeStep({ workflowId: 'wf-1', stepIndex: 0 }))
      })

      expect(result.current.workflows.size).toBe(1)
      const wf = result.current.workflows.get('wf-1')
      expect(wf).toBeDefined()
      expect(wf!.workflowName).toBe('deploy')
      expect(wf!.steps.size).toBe(1)
      expect(wf!.isActive).toBe(true)
    })

    it('adds steps to an existing workflow', () => {
      const { result } = renderHook(() => useWorkflowSteps('session-1'))

      act(() => {
        emitWorkflowStep(makeStep({ workflowId: 'wf-1', stepIndex: 0, stepName: 'build' }))
        emitWorkflowStep(makeStep({ workflowId: 'wf-1', stepIndex: 1, stepName: 'test' }))
      })

      const wf = result.current.workflows.get('wf-1')
      expect(wf!.steps.size).toBe(2)
      expect(wf!.steps.get(0)!.stepName).toBe('build')
      expect(wf!.steps.get(1)!.stepName).toBe('test')
    })

    it('updates an existing step when the same stepIndex is received again', () => {
      const { result } = renderHook(() => useWorkflowSteps('session-1'))

      act(() => {
        emitWorkflowStep(makeStep({ workflowId: 'wf-1', stepIndex: 0, status: 'running' }))
      })

      const wf1 = result.current.workflows.get('wf-1')!
      expect(wf1.steps.get(0)!.status).toBe('running')

      act(() => {
        emitWorkflowStep(makeStep({ workflowId: 'wf-1', stepIndex: 0, status: 'completed' }))
      })

      const wf2 = result.current.workflows.get('wf-1')!
      expect(wf2.steps.get(0)!.status).toBe('completed')
    })

    // CRITICAL DRILL: "isActive" — What defines "active"?
    it('marks workflow as active when status is running', () => {
      const { result } = renderHook(() => useWorkflowSteps('session-1'))

      act(() => {
        emitWorkflowStep(makeStep({ status: 'running' }))
      })

      expect(result.current.workflows.get('wf-1')!.isActive).toBe(true)
    })

    it('marks workflow as active when status is waiting', () => {
      const { result } = renderHook(() => useWorkflowSteps('session-1'))

      act(() => {
        emitWorkflowStep(makeStep({ status: 'waiting' }))
      })

      expect(result.current.workflows.get('wf-1')!.isActive).toBe(true)
    })

    it('marks workflow as inactive when status is completed', () => {
      const { result } = renderHook(() => useWorkflowSteps('session-1'))

      act(() => {
        emitWorkflowStep(makeStep({ status: 'completed' }))
      })

      expect(result.current.workflows.get('wf-1')!.isActive).toBe(false)
    })

    it('marks workflow as inactive when status is failed', () => {
      const { result } = renderHook(() => useWorkflowSteps('session-1'))

      act(() => {
        emitWorkflowStep(makeStep({ status: 'failed' }))
      })

      expect(result.current.workflows.get('wf-1')!.isActive).toBe(false)
    })

    // CRITICAL DRILL: totalSteps updates — what if it grows?
    it('updates totalSteps to the maximum seen', () => {
      const { result } = renderHook(() => useWorkflowSteps('session-1'))

      act(() => {
        emitWorkflowStep(makeStep({ totalSteps: 3, stepIndex: 0 }))
      })

      expect(result.current.workflows.get('wf-1')!.totalSteps).toBe(3)

      act(() => {
        emitWorkflowStep(makeStep({ totalSteps: 5, stepIndex: 1 }))
      })

      expect(result.current.workflows.get('wf-1')!.totalSteps).toBe(5)
    })

    // CRITICAL DRILL: Events for a different session are ignored
    it('ignores events for a different sessionId', () => {
      const { result } = renderHook(() => useWorkflowSteps('session-1'))

      act(() => {
        emitWorkflowStep(makeStep({ sessionId: 'session-OTHER', workflowId: 'wf-other' }))
      })

      // The onEvent callback filters by payload.sessionId === sessionId
      // But note: the filtering is based on payload.sessionId, not step.sessionId
      // This test verifies the callback filtering works correctly
      expect(result.current.workflows.size).toBe(0)
    })

    // CRITICAL DRILL: Ignores non-workflow_step events
    it('ignores non-workflow_step event types', () => {
      const { result } = renderHook(() => useWorkflowSteps('session-1'))

      act(() => {
        emitEvent('session-1', { type: 'text_delta', delta: 'hello' } satisfies SessionStreamEvent)
      })

      expect(result.current.workflows.size).toBe(0)
    })

    // CRITICAL DRILL: Multiple concurrent workflows
    it('tracks multiple workflows independently', () => {
      const { result } = renderHook(() => useWorkflowSteps('session-1'))

      act(() => {
        emitWorkflowStep(makeStep({ workflowId: 'wf-1', stepName: 'build' }))
        emitWorkflowStep(makeStep({ workflowId: 'wf-2', workflowName: 'test', stepName: 'lint' }))
      })

      expect(result.current.workflows.size).toBe(2)
      expect(result.current.workflows.get('wf-1')!.workflowName).toBe('deploy')
      expect(result.current.workflows.get('wf-2')!.workflowName).toBe('test')
    })
  })

  // ═══════════════════════════════════════════════════════════════════
  // CONTRACT AUDIT: "getWorkflow" — What if ID doesn't exist?
  // ═══════════════════════════════════════════════════════════════════
  describe('getWorkflow — contract & assumptions', () => {
    it('returns undefined for unknown workflowId', () => {
      const { result } = renderHook(() => useWorkflowSteps('session-1'))

      expect(result.current.getWorkflow('nonexistent')).toBeUndefined()
    })

    it('returns the workflow by ID after events', () => {
      const { result } = renderHook(() => useWorkflowSteps('session-1'))

      act(() => {
        emitWorkflowStep(makeStep({ workflowId: 'wf-1' }))
      })

      expect(result.current.getWorkflow('wf-1')).toBeDefined()
      expect(result.current.getWorkflow('wf-1')!.workflowId).toBe('wf-1')
    })

    // CRITICAL DRILL: Empty string workflowId
    it('handles empty string workflowId without crashing', () => {
      const { result } = renderHook(() => useWorkflowSteps('session-1'))

      act(() => {
        emitWorkflowStep(makeStep({ workflowId: '' }))
      })

      expect(result.current.getWorkflow('')).toBeDefined()
    })
  })

  // ═══════════════════════════════════════════════════════════════════
  // CONTRACT AUDIT: "getActiveWorkflow" — What is "most recently active"?
  // ═══════════════════════════════════════════════════════════════════
  describe('getActiveWorkflow — contract & assumptions', () => {
    it('returns undefined when no workflows exist', () => {
      const { result } = renderHook(() => useWorkflowSteps('session-1'))

      expect(result.current.getActiveWorkflow()).toBeUndefined()
    })

    it('returns the active workflow with the lexicographically highest ID', () => {
      const { result } = renderHook(() => useWorkflowSteps('session-1'))

      act(() => {
        emitWorkflowStep(makeStep({ workflowId: 'wf-a', status: 'running' }))
        emitWorkflowStep(makeStep({ workflowId: 'wf-b', status: 'running' }))
      })

      const active = result.current.getActiveWorkflow()
      // Contract: uses workflowId comparison (wf-b > wf-a)
      expect(active).toBeDefined()
      expect(active!.workflowId).toBe('wf-b')
    })

    it('skips inactive workflows', () => {
      const { result } = renderHook(() => useWorkflowSteps('session-1'))

      act(() => {
        emitWorkflowStep(makeStep({ workflowId: 'wf-1', status: 'completed' }))
      })

      expect(result.current.getActiveWorkflow()).toBeUndefined()
    })

    it('returns an active workflow when one exists alongside inactive ones', () => {
      const { result } = renderHook(() => useWorkflowSteps('session-1'))

      act(() => {
        emitWorkflowStep(makeStep({ workflowId: 'wf-1', status: 'completed' }))
        emitWorkflowStep(makeStep({ workflowId: 'wf-2', status: 'running' }))
      })

      const active = result.current.getActiveWorkflow()
      expect(active).toBeDefined()
      expect(active!.workflowId).toBe('wf-2')
    })
  })

  // ═══════════════════════════════════════════════════════════════════
  // STATE & SIDE-EFFECT SKEPTICISM: Cleanup on unmount/session change
  // ═══════════════════════════════════════════════════════════════════
  describe('cleanup & unmount', () => {
    it('clears workflows when sessionId becomes null', () => {
      const { result, rerender } = renderHook(
        ({ sid }) => useWorkflowSteps(sid),
        { initialProps: { sid: 'session-1' as string | null } }
      )

      act(() => {
        emitWorkflowStep(makeStep({ workflowId: 'wf-1' }))
      })

      expect(result.current.workflows.size).toBe(1)

      // Rerender with null sessionId
      rerender({ sid: null })

      expect(result.current.workflows.size).toBe(0)
    })

    it('unsubscribes from events on unmount', () => {
      const { unmount } = renderHook(() => useWorkflowSteps('session-1'))

      // The mock onEvent returns an unsub function
      // After unmount, onEventCallback should be cleared
      unmount()

      expect(onEventCallback).toBeNull()
    })
  })
})
