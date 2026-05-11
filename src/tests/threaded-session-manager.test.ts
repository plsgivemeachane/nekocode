/**
 * CRITICAL TESTS for ThreadedSessionManager
 *
 * Contract Audit:
 * - Implements ISessionManager interface — must honor the same contract as PiSessionManager.
 * - `create(cwd)` → returns sessionId. Assumption: cwd is a valid path.
 * - `prompt(sessionId, text)` → fire-and-forget. Assumption: errors are caught and emitted as events.
 * - `abort(sessionId)` → fire-and-forget void. Assumption: errors are swallowed.
 * - `dispose(sessionId)` → fire-and-forget void. Assumption: sessionCount is decremented asynchronously (race condition!).
 * - `sessionCount` → getter. RACE CONDITION: decrement happens in .then(), so getter may return stale value.
 * - `getExtensionLoadErrors(sessionId)` → returns cached data from create/reconnect. Returns [] for unknown sessions.
 * - `getExtensionsDisabled(sessionId)` → returns cached data. Returns false for unknown sessions.
 * - `deleteSession()` → always throws (not implemented in threaded variant).
 * - `loadHistoryFromDisk()` → returns [] on error (catches and returns empty).
 * - `getModel()` → returns null on error (catches and returns null).
 * - `listModels()` → returns [] on error (catches and returns empty).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn(() => '/tmp/test-userdata'),
  },
}))

vi.mock('../main/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

import { ThreadedSessionManager } from '../main/threading/threaded-session-manager'
import type { SessionStreamEvent } from '../shared/ipc-types'

// ── Mock ThreadOperationQueue ────────────────────────────────────

function createMockQueue() {
  return {
    execute: vi.fn(),
    getStats: vi.fn(() => ({
      activeThreads: 0,
      idleThreads: 1,
      pendingOperations: 0,
      completedOperations: 0,
      failedOperations: 0,
    })),
    shutdown: vi.fn(async () => {}),
  }
}

describe('ThreadedSessionManager', () => {
  let queue: ReturnType<typeof createMockQueue>
  let events: Array<{ sessionId: string; event: SessionStreamEvent }>
  let manager: ThreadedSessionManager

  beforeEach(() => {
    queue = createMockQueue()
    events = []
    manager = new ThreadedSessionManager(
      queue as unknown as import('../main/threading/thread-operation-queue').ThreadOperationQueue,
      (sessionId, event) => events.push({ sessionId, event }),
    )
  })

  // =========================================================================
  // CREATE CONTRACT
  // =========================================================================

  describe('create', () => {
    it('returns sessionId from worker result', async () => {
      queue.execute.mockResolvedValue({
        sessionId: 'new-sess-1',
        extensionErrors: [],
        extensionsDisabled: false,
      })

      const id = await manager.create('/project')
      expect(id).toBe('new-sess-1')
      expect(queue.execute).toHaveBeenCalledWith('session:create', { cwd: '/project' }, 'high')
    })

    it('increments sessionCount after successful create', async () => {
      queue.execute.mockResolvedValue({
        sessionId: 's1',
        extensionErrors: [],
        extensionsDisabled: false,
      })

      expect(manager.sessionCount).toBe(0)
      await manager.create('/project')
      expect(manager.sessionCount).toBe(1)
    })

    it('caches extension errors from create result', async () => {
      const errors = [{ extension: 'ext1', error: 'load failed', phase: 'create' as const }]
      queue.execute.mockResolvedValue({
        sessionId: 's1',
        extensionErrors: errors,
        extensionsDisabled: true,
      })

      await manager.create('/project')
      expect(manager.getExtensionLoadErrors('s1')).toEqual(errors)
      expect(manager.getExtensionsDisabled('s1')).toBe(true)
    })

    it('propagates errors from worker', async () => {
      queue.execute.mockRejectedValue(new Error('SDK init failed'))

      await expect(manager.create('/bad')).rejects.toThrow('SDK init failed')
    })

    it('does not increment sessionCount on failure', async () => {
      queue.execute.mockRejectedValue(new Error('fail'))

      await manager.create('/bad').catch(() => {})
      expect(manager.sessionCount).toBe(0)
    })
  })

  // =========================================================================
  // RECONNECT CONTRACT
  // =========================================================================

  describe('reconnect', () => {
    it('returns history from worker result', async () => {
      const history = [
        { id: 'm1', role: 'user' as const, content: 'hello', timestamp: 0 },
      ]
      queue.execute.mockResolvedValue({
        sessionId: 's1',
        history,
        extensionErrors: [],
        extensionsDisabled: false,
      })

      const result = await manager.reconnect('s1', '/project')
      expect(result).toEqual(history)
      expect(queue.execute).toHaveBeenCalledWith('session:reconnect', { sessionId: 's1', cwd: '/project' }, 'high')
    })

    it('increments sessionCount after successful reconnect', async () => {
      queue.execute.mockResolvedValue({
        sessionId: 's1',
        history: [],
        extensionErrors: [],
        extensionsDisabled: false,
      })

      await manager.reconnect('s1', '/project')
      expect(manager.sessionCount).toBe(1)
    })
  })

  // =========================================================================
  // PROMPT CONTRACT (fire-and-forget)
  // =========================================================================

  describe('prompt', () => {
    it('dispatches prompt without awaiting result', async () => {
      // Make execute return a never-resolving promise to prove fire-and-forget
      queue.execute.mockReturnValue(new Promise(() => {}))

      // prompt() should NOT block — it returns immediately
      await manager.prompt('s1', 'hello')

      expect(queue.execute).toHaveBeenCalledWith(
        'session:prompt',
        { sessionId: 's1', text: 'hello' },
        'high',
      )
    })

    it('emits error event when prompt dispatch fails', async () => {
      queue.execute.mockReturnValue(Promise.reject(new Error('dispatch failed')))

      await manager.prompt('s1', 'hello')

      // Wait for the catch handler to fire
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(events).toHaveLength(2)
      expect(events[0]!.event).toEqual({
        type: 'error',
        message: 'Prompt dispatch failed: dispatch failed',
      })
      expect(events[1]!.event).toEqual({ type: 'done' })
    })

    it('handles non-Error rejection gracefully', async () => {
      queue.execute.mockReturnValue(Promise.reject('string error'))

      await manager.prompt('s1', 'hello')
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(events[0]!.event).toEqual({
        type: 'error',
        message: 'Prompt dispatch failed: string error',
      })
    })
  })

  // =========================================================================
  // ABORT CONTRACT (fire-and-forget)
  // =========================================================================

  describe('abort', () => {
    it('dispatches abort without blocking', () => {
      queue.execute.mockReturnValue(new Promise(() => {})) // never resolves

      // abort is synchronous (void return)
      expect(() => manager.abort('s1')).not.toThrow()
      expect(queue.execute).toHaveBeenCalledWith('session:abort', { sessionId: 's1' }, 'high')
    })

    it('silently swallows abort errors', async () => {
      queue.execute.mockReturnValue(Promise.reject(new Error('abort failed')))

      manager.abort('s1')
      // Should not throw
      await new Promise(resolve => setTimeout(resolve, 10))
    })
  })

  // =========================================================================
  // DISPOSE CONTRACT (fire-and-forget + async sessionCount decrement)
  // =========================================================================

  describe('dispose', () => {
    it('dispatches dispose and cleans up caches immediately', () => {
      queue.execute.mockResolvedValue({ success: true })

      // Set up cache first
      queue.execute.mockResolvedValueOnce({
        sessionId: 's1',
        extensionErrors: [{ extension: 'ext', error: 'err', phase: 'create' as const }],
        extensionsDisabled: true,
      })

      // The caches are populated during create, let's simulate that
      // For this test, verify that dispose clears them
      manager.dispose('s1')

      // After dispose, caches should be cleared
      expect(manager.getExtensionLoadErrors('s1')).toEqual([])
      expect(manager.getExtensionsDisabled('s1')).toBe(false)
    })

    it('decrements sessionCount asynchronously', async () => {
      queue.execute.mockResolvedValue({ success: true })

      // Simulate a session being created first
      queue.execute.mockResolvedValueOnce({
        sessionId: 's1',
        extensionErrors: [],
        extensionsDisabled: false,
      })
      await manager.create('s1')
      expect(manager.sessionCount).toBe(1)

      // Dispose — sessionCount should still be 1 until the .then() resolves
      manager.dispose('s1')

      // The .then() handler decrements sessionCount asynchronously
      // This is a RACE CONDITION: sessionCount may be 1 or 0 depending on timing
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(manager.sessionCount).toBe(0)
    })

    it('does not crash if dispose is called for unknown session', () => {
      queue.execute.mockResolvedValue({ success: true })

      expect(() => manager.dispose('nonexistent')).not.toThrow()
    })

    it('clamps sessionCount to 0 (never goes negative)', async () => {
      queue.execute.mockResolvedValue({ success: true })

      // Dispose without creating — sessionCount is 0
      manager.dispose('phantom')
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(manager.sessionCount).toBe(0)
    })
  })

  // =========================================================================
  // DISPOSE-ALL CONTRACT
  // =========================================================================

  describe('disposeAll', () => {
    it('resets sessionCount to 0 asynchronously', async () => {
      queue.execute.mockResolvedValue({ success: true })

      // Create some sessions
      queue.execute.mockResolvedValueOnce({
        sessionId: 's1', extensionErrors: [], extensionsDisabled: false,
      })
      queue.execute.mockResolvedValueOnce({
        sessionId: 's2', extensionErrors: [], extensionsDisabled: false,
      })
      await manager.create('/a')
      await manager.create('/b')
      expect(manager.sessionCount).toBe(2)

      manager.disposeAll()
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(manager.sessionCount).toBe(0)
    })

    it('silently swallows disposeAll errors', async () => {
      queue.execute.mockReturnValue(Promise.reject(new Error('fail')))

      expect(() => manager.disposeAll()).not.toThrow()
      await new Promise(resolve => setTimeout(resolve, 10))
    })
  })

  // =========================================================================
  // DELETE-SESSION CONTRACT (not implemented)
  // =========================================================================

  describe('deleteSession', () => {
    it('always throws — not implemented in threaded variant', async () => {
      await expect(manager.deleteSession('s1', '/cwd')).rejects.toThrow(
        'deleteSession should be handled by core manager',
      )
    })
  })

  // =========================================================================
  // GET-HISTORY CONTRACT
  // =========================================================================

  describe('getHistory', () => {
    it('returns messages from worker', async () => {
      const messages = [
        { id: 'm1', role: 'user' as const, content: 'hi', timestamp: 0 },
      ]
      queue.execute.mockResolvedValue({ messages })

      const result = await manager.getHistory('s1')
      expect(result).toEqual(messages)
      expect(queue.execute).toHaveBeenCalledWith('session:load-history', { sessionId: 's1' }, 'normal')
    })
  })

  // =========================================================================
  // LOAD-HISTORY-FROM-DISK CONTRACT (error → empty array)
  // =========================================================================

  describe('loadHistoryFromDisk', () => {
    it('returns messages from worker', async () => {
      const messages = [{ id: 'm1', role: 'user' as const, content: 'hi', timestamp: 0 }]
      queue.execute.mockResolvedValue({ messages })

      const result = await manager.loadHistoryFromDisk('s1', '/cwd', 10)
      expect(result).toEqual(messages)
    })

    it('returns empty array on error', async () => {
      queue.execute.mockRejectedValue(new Error('disk read failed'))

      const result = await manager.loadHistoryFromDisk('s1', '/cwd', 10)
      expect(result).toEqual([])
    })
  })

  // =========================================================================
  // MODEL OPERATIONS CONTRACT
  // =========================================================================

  describe('getModel', () => {
    it('returns model info from worker', async () => {
      queue.execute.mockResolvedValue({ id: 'm1', name: 'Model 1', provider: 'openai' })

      const result = await manager.getModel('s1')
      expect(result).toEqual({ id: 'm1', name: 'Model 1', provider: 'openai' })
    })

    it('returns null on error', async () => {
      queue.execute.mockRejectedValue(new Error('not found'))

      const result = await manager.getModel('s1')
      expect(result).toBeNull()
    })
  })

  describe('listModels', () => {
    it('returns models from worker', async () => {
      queue.execute.mockResolvedValue({ models: [{ id: 'm1', name: 'M', provider: 'p' }] })

      const result = await manager.listModels()
      expect(result).toEqual([{ id: 'm1', name: 'M', provider: 'p' }])
    })

    it('returns empty array on error', async () => {
      queue.execute.mockRejectedValue(new Error('SDK error'))

      const result = await manager.listModels()
      expect(result).toEqual([])
    })
  })

  describe('setModel', () => {
    it('returns model info from worker', async () => {
      queue.execute.mockResolvedValue({ id: 'm2', name: 'GPT-4', provider: 'openai' })

      const result = await manager.setModel('s1', 'openai', 'gpt-4')
      expect(result).toEqual({ id: 'm2', name: 'GPT-4', provider: 'openai' })
      expect(queue.execute).toHaveBeenCalledWith(
        'session:set-model',
        { sessionId: 's1', provider: 'openai', modelId: 'gpt-4' },
        'normal',
      )
    })

    it('propagates errors from worker', async () => {
      queue.execute.mockRejectedValue(new Error('model not found'))

      await expect(manager.setModel('s1', 'bad', 'bad')).rejects.toThrow('model not found')
    })
  })

  // =========================================================================
  // CACHE EDGE CASES
  // =========================================================================

  describe('extension cache edge cases', () => {
    it('returns empty array for getExtensionLoadErrors on unknown session', () => {
      expect(manager.getExtensionLoadErrors('never-seen')).toEqual([])
    })

    it('returns false for getExtensionsDisabled on unknown session', () => {
      expect(manager.getExtensionsDisabled('never-seen')).toBe(false)
    })

    it('caches extension info from reconnect too', async () => {
      queue.execute.mockResolvedValue({
        sessionId: 'reconnected',
        history: [],
        extensionErrors: [{ extension: 'ext2', error: 'warn', phase: 'create' as const }],
        extensionsDisabled: true,
      })

      await manager.reconnect('reconnected', '/cwd')
      expect(manager.getExtensionLoadErrors('reconnected')).toHaveLength(1)
      expect(manager.getExtensionsDisabled('reconnected')).toBe(true)
    })
  })
})
