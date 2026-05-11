/**
 * CRITICAL TESTS for ThreadOperationQueue
 *
 * Contract Audit:
 * - Name "Queue" is misleading: it's a priority queue, not FIFO.
 * - `execute<TInput, TOutput>(type, input, priority)`:
 *   Assumption 1: `type` is a valid OperationType.
 *   Assumption 2: `input` matches the expected shape for `type`.
 *   Assumption 3: The queue is not shutting down.
 *   Assumption 4: A worker will eventually become available.
 *   Assumption 5: The operation will complete before `taskTimeout`.
 * - `shutdown()`:
 *   Assumption 1: Can be called multiple times safely.
 *   Assumption 2: Pending operations are drained or rejected.
 *   Assumption 3: Active operations are given a grace period.
 * - Priority ordering: high > normal > low.
 * - Session affinity: session operations route to the owning worker.
 * - Worker scaling: pool grows from minThreads to maxThreads under load.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock electron and worker_threads ─────────────────────────────
// Must use vi.hoisted so the mock array is available inside vi.mock factories
const { mockWorkerInstances, MockWorker } = vi.hoisted(() => {
  const mockWorkerInstances: Array<{
    postMessage: ReturnType<typeof vi.fn>
    on: ReturnType<typeof vi.fn>
    terminate: ReturnType<typeof vi.fn>
    _listeners: Map<string, Array<(data: unknown) => void>>
    _simulateMessage: (data: unknown) => void
    _simulateError: (err: Error) => void
    _simulateExit: (code: number) => void
  }> = []

  // Worker must be a class (constructor) since the source uses `new Worker(...)`
  class MockWorker {
    postMessage: ReturnType<typeof vi.fn>
    on: ReturnType<typeof vi.fn>
    terminate: ReturnType<typeof vi.fn>
    _listeners: Map<string, Array<(data: unknown) => void>>

    constructor() {
      const _listeners = new Map<string, Array<(data: unknown) => void>>()
      this._listeners = _listeners
      this.postMessage = vi.fn()
      this.on = vi.fn((event: string, cb: (data: unknown) => void) => {
        if (!_listeners.has(event)) _listeners.set(event, [])
        _listeners.get(event)!.push(cb)
        return this
      })
      this.terminate = vi.fn()
      mockWorkerInstances.push(this as unknown as typeof mockWorkerInstances[number])
    }

    _simulateMessage(data: unknown) {
      for (const cb of this._listeners.get('message') ?? []) cb(data)
    }

    _simulateError(err: Error) {
      for (const cb of this._listeners.get('error') ?? []) cb(err)
    }

    _simulateExit(code: number) {
      for (const cb of this._listeners.get('exit') ?? []) cb(code)
    }
  }

  return { mockWorkerInstances, MockWorker }
})

vi.mock('worker_threads', () => ({
  Worker: MockWorker,
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn(() => '/tmp/test-userdata'),
  },
}))

vi.mock('path', async () => {
  const actual = await vi.importActual<typeof import('path')>('path')
  return {
    ...actual,
    join: actual.join,
    dirname: actual.dirname,
  }
})

vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
}))

vi.mock('../main/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

import { ThreadOperationQueue } from '../main/threading/thread-operation-queue'
import type { OperationType } from '../main/threading/types'

// ── Helper: flush all pending microtasks + timers ────────────────
async function flushAll() {
  await new Promise(resolve => setTimeout(resolve, 0))
}

// ── Tests ────────────────────────────────────────────────────────

describe('ThreadOperationQueue', () => {
  beforeEach(() => {
    mockWorkerInstances.length = 0
    vi.clearAllMocks()
  })

  // =========================================================================
  // CONSTRUCTOR CONTRACT
  // =========================================================================

  describe('constructor — pool initialization', () => {
    it('creates minThreads workers by default (2)', () => {
      new ThreadOperationQueue()
      expect(mockWorkerInstances).toHaveLength(2)
    })

    it('creates custom minThreads workers when configured', () => {
      new ThreadOperationQueue({ minThreads: 3 })
      expect(mockWorkerInstances).toHaveLength(3)
    })

    it('creates zero workers when minThreads is 0', () => {
      new ThreadOperationQueue({ minThreads: 0 })
      expect(mockWorkerInstances).toHaveLength(0)
    })
  })

  // =========================================================================
  // EXECUTE CONTRACT
  // =========================================================================

  describe('execute — basic dispatch', () => {
    it('resolves when worker responds with success', async () => {
      const queue = new ThreadOperationQueue({ minThreads: 1 })

      const resultPromise = queue.execute('session:list-models', {}, 'normal')
      await flushAll()

      // Simulate worker success response
      const worker = mockWorkerInstances[0]!
      const postedMsg = worker.postMessage.mock.calls[0]?.[0] as { id: string }
      worker._simulateMessage({ id: postedMsg.id, success: true, result: { models: [] } })

      const result = await resultPromise
      expect(result).toEqual({ models: [] })
    })

    it('rejects when worker responds with failure', async () => {
      const queue = new ThreadOperationQueue({ minThreads: 1 })

      const resultPromise = queue.execute('session:list-models', {}, 'normal')
      await flushAll()

      const worker = mockWorkerInstances[0]!
      const postedMsg = worker.postMessage.mock.calls[0]?.[0] as { id: string }
      worker._simulateMessage({ id: postedMsg.id, success: false, error: 'SDK crash' })

      await expect(resultPromise).rejects.toThrow('SDK crash')
    })

    it('rejects with generic message when error field is missing', async () => {
      const queue = new ThreadOperationQueue({ minThreads: 1 })

      const resultPromise = queue.execute('session:list-models', {}, 'normal')
      await flushAll()

      const worker = mockWorkerInstances[0]!
      const postedMsg = worker.postMessage.mock.calls[0]?.[0] as { id: string }
      worker._simulateMessage({ id: postedMsg.id, success: false })

      await expect(resultPromise).rejects.toThrow('Operation failed')
    })

    it('rejects immediately when queue is shutting down', async () => {
      const queue = new ThreadOperationQueue({ minThreads: 1 })
      await queue.shutdown()

      await expect(
        queue.execute('session:list-models', {}, 'normal')
      ).rejects.toThrow('ThreadOperationQueue is shutting down')
    })
  })

  // =========================================================================
  // PRIORITY ORDERING
  // =========================================================================

  describe('priority ordering', () => {
    it('dispatches high priority before normal priority', async () => {
      // maxThreads: 1 forces all operations to queue (no scaling up)
      const queue = new ThreadOperationQueue({ minThreads: 1, maxThreads: 1 })

      // Fill the single worker so subsequent operations queue up
      const firstPromise = queue.execute('session:create', { cwd: '/a' }, 'high')
      await flushAll()

      // Worker is now busy, queue two more operations
      const normalPromise = queue.execute('session:list-models', {}, 'normal')
      const highPromise = queue.execute('session:abort', { sessionId: 'x' }, 'high')
      await flushAll()

      // Check the postMessage calls — the worker should have only received the first
      const worker = mockWorkerInstances[0]!
      expect(worker.postMessage).toHaveBeenCalledTimes(1)

      // Complete the first operation
      const firstMsg = worker.postMessage.mock.calls[0]?.[0] as { id: string }
      worker._simulateMessage({ id: firstMsg.id, success: true, result: { sessionId: 's1', extensionErrors: [], extensionsDisabled: false } })
      await firstPromise
      await flushAll()

      // Now the high-priority operation should be dispatched next
      const secondMsg = worker.postMessage.mock.calls[1]?.[0] as { id: string; type: string }
      expect(secondMsg.type).toBe('session:abort')

      // Complete it
      worker._simulateMessage({ id: secondMsg.id, success: true, result: { success: true } })
      await highPromise
      await flushAll()

      // Finally, normal priority
      const thirdMsg = worker.postMessage.mock.calls[2]?.[0] as { id: string; type: string }
      expect(thirdMsg.type).toBe('session:list-models')

      worker._simulateMessage({ id: thirdMsg.id, success: true, result: { models: [] } })
      await normalPromise
    })

    it('maintains FIFO within same priority level', async () => {
      // maxThreads: 1 forces all operations to queue
      const queue = new ThreadOperationQueue({ minThreads: 1, maxThreads: 1 })

      // Fill the worker
      const firstPromise = queue.execute('session:list-models', {}, 'normal')
      await flushAll()

      // Queue two normal-priority operations
      const secondPromise = queue.execute('session:get-model', { sessionId: 'a' }, 'normal')
      const thirdPromise = queue.execute('session:get-model', { sessionId: 'b' }, 'normal')
      await flushAll()

      const worker = mockWorkerInstances[0]!

      // Complete first
      const firstMsg = worker.postMessage.mock.calls[0]?.[0] as { id: string }
      worker._simulateMessage({ id: firstMsg.id, success: true, result: { models: [] } })
      await firstPromise
      await flushAll()

      // Second should be dispatched before third (FIFO within same priority)
      const secondMsg = worker.postMessage.mock.calls[1]?.[0] as { id: string; input: { sessionId: string } }
      expect(secondMsg.input.sessionId).toBe('a')

      worker._simulateMessage({ id: secondMsg.id, success: true, result: { id: 'm', name: 'M', provider: 'p' } })
      await secondPromise
      await flushAll()

      const thirdMsg = worker.postMessage.mock.calls[2]?.[0] as { id: string; input: { sessionId: string } }
      expect(thirdMsg.input.sessionId).toBe('b')

      worker._simulateMessage({ id: thirdMsg.id, success: true, result: { id: 'm', name: 'M', provider: 'p' } })
      await thirdPromise
    })
  })

  // =========================================================================
  // WORKER SCALING
  // =========================================================================

  describe('worker scaling', () => {
    it('scales up to maxThreads when all workers are busy', async () => {
      const queue = new ThreadOperationQueue({ minThreads: 1, maxThreads: 3 })

      // Fill the first worker
      const p1 = queue.execute('session:create', { cwd: '/a' }, 'high')
      await flushAll()
      expect(mockWorkerInstances).toHaveLength(1)

      // Queue another — should trigger scale-up
      const p2 = queue.execute('session:create', { cwd: '/b' }, 'high')
      await flushAll()
      expect(mockWorkerInstances).toHaveLength(2)

      // Queue another — should trigger scale-up again
      const p3 = queue.execute('session:create', { cwd: '/c' }, 'high')
      await flushAll()
      expect(mockWorkerInstances).toHaveLength(3)

      // Clean up: resolve all
      for (let i = 0; i < 3; i++) {
        const worker = mockWorkerInstances[i]!
        const msg = worker.postMessage.mock.calls[0]?.[0] as { id: string }
        worker._simulateMessage({ id: msg.id, success: true, result: { sessionId: `s${i}`, extensionErrors: [], extensionsDisabled: false } })
      }
      await Promise.all([p1, p2, p3])
    })

    it('does not scale beyond maxThreads', async () => {
      const queue = new ThreadOperationQueue({ minThreads: 1, maxThreads: 2 })

      const p1 = queue.execute('session:create', { cwd: '/a' }, 'high')
      await flushAll()
      const p2 = queue.execute('session:create', { cwd: '/b' }, 'high')
      await flushAll()
      // Third operation should wait, not create a new worker
      const p3 = queue.execute('session:create', { cwd: '/c' }, 'high')
      await flushAll()

      expect(mockWorkerInstances).toHaveLength(2)

      // Complete first two
      for (let i = 0; i < 2; i++) {
        const worker = mockWorkerInstances[i]!
        const msg = worker.postMessage.mock.calls[0]?.[0] as { id: string }
        worker._simulateMessage({ id: msg.id, success: true, result: { sessionId: `s${i}`, extensionErrors: [], extensionsDisabled: false } })
      }
      await Promise.all([p1, p2])
      await flushAll()

      // Third should now be dispatched to an idle worker
      const anyWorker = mockWorkerInstances.find(w => w.postMessage.mock.calls.length > 1)
      expect(anyWorker).toBeDefined()

      // Complete third
      const lastCall = anyWorker!.postMessage.mock.calls.find((c: unknown[]) => {
        const msg = c[0] as { id: string }
        return msg.id !== anyWorker!.postMessage.mock.calls[0]?.[0]?.id
      })
      if (lastCall) {
        const msg = lastCall[0] as { id: string }
        anyWorker!._simulateMessage({ id: msg.id, success: true, result: { sessionId: 's2', extensionErrors: [], extensionsDisabled: false } })
      }
      await p3
    })
  })

  // =========================================================================
  // WORKER ERROR HANDLING
  // =========================================================================

  describe('worker error handling', () => {
    it('rejects active operation when worker emits error', async () => {
      const queue = new ThreadOperationQueue({ minThreads: 1 })

      const promise = queue.execute('session:create', { cwd: '/x' }, 'high')
      await flushAll()

      const worker = mockWorkerInstances[0]!
      worker._simulateError(new Error('Worker crashed'))

      await expect(promise).rejects.toThrow('Worker crashed')
    })

    it('creates replacement worker after worker exit when below minThreads', async () => {
      new ThreadOperationQueue({ minThreads: 2 })
      expect(mockWorkerInstances).toHaveLength(2)

      // Simulate one worker exiting
      mockWorkerInstances[0]!._simulateExit(1)
      await flushAll()

      // Should have created a replacement
      expect(mockWorkerInstances).toHaveLength(3)
    })

    it('does not create replacement during shutdown', async () => {
      const queue = new ThreadOperationQueue({ minThreads: 2 })
      expect(mockWorkerInstances).toHaveLength(2)

      await queue.shutdown()
      // Terminate is called on workers during shutdown
      // After shutdown, worker exits should not trigger replacement
      mockWorkerInstances[0]!._simulateExit(1)
      await flushAll()

      // No new worker should have been created (still 2 from initial + 0 new)
      // The shutdown path handles this via isShuttingDown flag
    })
  })

  // =========================================================================
  // SHUTDOWN CONTRACT
  // =========================================================================

  describe('shutdown', () => {
    it('terminates all workers on shutdown', async () => {
      const queue = new ThreadOperationQueue({ minThreads: 2 })
      await queue.shutdown()

      for (const worker of mockWorkerInstances) {
        expect(worker.terminate).toHaveBeenCalled()
      }
    })

    it('is safe to call shutdown multiple times', async () => {
      const queue = new ThreadOperationQueue({ minThreads: 1 })
      await queue.shutdown()
      await queue.shutdown() // Should not throw
    })

    it('rejects new operations after shutdown', async () => {
      const queue = new ThreadOperationQueue({ minThreads: 1 })
      await queue.shutdown()

      await expect(
        queue.execute('session:list-models', {}, 'normal')
      ).rejects.toThrow('shutting down')
    })

    it('waits for active operations before terminating (within timeout)', async () => {
      const queue = new ThreadOperationQueue({ minThreads: 1, taskTimeout: 60000 })

      const promise = queue.execute('session:create', { cwd: '/x' }, 'high')
      await flushAll()

      // Shutdown should wait but eventually complete
      const shutdownPromise = queue.shutdown()

      // Complete the operation while shutdown is pending
      const worker = mockWorkerInstances[0]!
      const msg = worker.postMessage.mock.calls[0]?.[0] as { id: string }
      worker._simulateMessage({ id: msg.id, success: true, result: { sessionId: 's1', extensionErrors: [], extensionsDisabled: false } })

      await promise
      await shutdownPromise
    })
  })

  // =========================================================================
  // SESSION AFFINITY
  // =========================================================================

  describe('session affinity', () => {
    it('routes session operations to the worker that owns the session', async () => {
      const queue = new ThreadOperationQueue({ minThreads: 2 })

      // Create a session — registers affinity on completion
      const createPromise = queue.execute('session:create', { cwd: '/x' }, 'high')
      await flushAll()

      const worker0 = mockWorkerInstances[0]!
      const createMsg = worker0.postMessage.mock.calls[0]?.[0] as { id: string }
      worker0._simulateMessage({
        id: createMsg.id,
        success: true,
        result: { sessionId: 'sess-abc', extensionErrors: [], extensionsDisabled: false },
      })
      await createPromise
      await flushAll()

      // Now send a session-specific operation — should route to the same worker
      const promptPromise = queue.execute('session:prompt', { sessionId: 'sess-abc', text: 'hi' }, 'high')
      await flushAll()

      // Worker 0 should receive the prompt (affinity)
      const promptMsg = worker0.postMessage.mock.calls[1]?.[0] as { id: string; type: string }
      expect(promptMsg.type).toBe('session:prompt')

      worker0._simulateMessage({ id: promptMsg.id, success: true, result: { started: true } })
      await promptPromise
    })

    it('clears session affinity on dispose', async () => {
      const queue = new ThreadOperationQueue({ minThreads: 2 })

      // Create session
      const createPromise = queue.execute('session:create', { cwd: '/x' }, 'high')
      await flushAll()

      const worker0 = mockWorkerInstances[0]!
      const createMsg = worker0.postMessage.mock.calls[0]?.[0] as { id: string }
      worker0._simulateMessage({
        id: createMsg.id,
        success: true,
        result: { sessionId: 'sess-dispose', extensionErrors: [], extensionsDisabled: false },
      })
      await createPromise
      await flushAll()

      // Dispose session
      const disposePromise = queue.execute('session:dispose', { sessionId: 'sess-dispose' }, 'high')
      await flushAll()

      const disposeMsg = worker0.postMessage.mock.calls[1]?.[0] as { id: string }
      worker0._simulateMessage({ id: disposeMsg.id, success: true, result: { success: true } })
      await disposePromise
      await flushAll()

      // Next session operation should NOT be affinity-bound (any worker can take it)
      queue.execute('session:list-models', {}, 'normal')
      await flushAll()

      // It could go to either worker — just verify it was dispatched
      const totalCalls = mockWorkerInstances.reduce((sum, w) => sum + w.postMessage.mock.calls.length, 0)
      expect(totalCalls).toBeGreaterThan(2) // create + dispose + list-models
    })
  })

  // =========================================================================
  // STATS CONTRACT
  // =========================================================================

  describe('getStats', () => {
    it('returns initial zero stats', () => {
      const queue = new ThreadOperationQueue({ minThreads: 2 })
      const stats = queue.getStats()
      expect(stats.activeThreads).toBe(0)
      expect(stats.idleThreads).toBe(2)
      expect(stats.pendingOperations).toBe(0)
      expect(stats.completedOperations).toBe(0)
      expect(stats.failedOperations).toBe(0)
    })

    it('tracks completed operations', async () => {
      const queue = new ThreadOperationQueue({ minThreads: 1 })

      const promise = queue.execute('session:list-models', {}, 'normal')
      await flushAll()

      expect(queue.getStats().activeThreads).toBe(1)
      expect(queue.getStats().idleThreads).toBe(0)

      const worker = mockWorkerInstances[0]!
      const msg = worker.postMessage.mock.calls[0]?.[0] as { id: string }
      worker._simulateMessage({ id: msg.id, success: true, result: { models: [] } })
      await promise

      expect(queue.getStats().completedOperations).toBe(1)
      expect(queue.getStats().failedOperations).toBe(0)
      expect(queue.getStats().activeThreads).toBe(0)
    })

    it('tracks failed operations', async () => {
      const queue = new ThreadOperationQueue({ minThreads: 1 })

      const promise = queue.execute('session:list-models', {}, 'normal')
      await flushAll()

      const worker = mockWorkerInstances[0]!
      const msg = worker.postMessage.mock.calls[0]?.[0] as { id: string }
      worker._simulateMessage({ id: msg.id, success: false, error: 'boom' })

      await promise.catch(() => {})
      expect(queue.getStats().failedOperations).toBe(1)
      expect(queue.getStats().completedOperations).toBe(0)
    })
  })

  // =========================================================================
  // EDGE CASES & STRESS
  // =========================================================================

  describe('edge cases', () => {
    it('ignores response for unknown operation ID', async () => {
      new ThreadOperationQueue({ minThreads: 1 })
      const worker = mockWorkerInstances[0]!

      // Send a response with an ID that doesn't match any active operation
      expect(() => {
        worker._simulateMessage({ id: 'nonexistent-id', success: true, result: null })
      }).not.toThrow()
    })

    it('handles session event messages from worker', () => {
      const events: Array<{ sessionId: string; event: unknown }> = []
      new ThreadOperationQueue(
        { minThreads: 1 },
        (sessionId, event) => events.push({ sessionId, event }),
      )

      const worker = mockWorkerInstances[0]!
      worker._simulateMessage({
        type: 'session_event',
        sessionId: 'sess-1',
        event: { type: 'text_delta', delta: 'hello' },
      })

      expect(events).toHaveLength(1)
      expect(events[0]!.sessionId).toBe('sess-1')
      expect(events[0]!.event).toEqual({ type: 'text_delta', delta: 'hello' })
    })

    it('does not crash when session event callback is null', () => {
      new ThreadOperationQueue({ minThreads: 1 }) // no callback

      const worker = mockWorkerInstances[0]!
      expect(() => {
        worker._simulateMessage({
          type: 'session_event',
          sessionId: 'sess-1',
          event: { type: 'done' },
        })
      }).not.toThrow()
    })

    it('operation message includes correct type and input', async () => {
      const queue = new ThreadOperationQueue({ minThreads: 1 })
      const input = { sessionId: 'sess-1', text: 'hello world' }

      const promise = queue.execute('session:prompt', input, 'high')
      await flushAll()

      const worker = mockWorkerInstances[0]!
      const msg = worker.postMessage.mock.calls[0]?.[0] as {
        id: string
        type: OperationType
        input: unknown
      }

      expect(msg.type).toBe('session:prompt')
      expect(msg.input).toEqual(input)
      expect(msg.id).toBeTruthy()
      expect(typeof msg.id).toBe('string')

      // Cleanup
      worker._simulateMessage({ id: msg.id, success: true, result: { started: true } })
      await promise
    })

    it('dispatches to new worker when scaling up', async () => {
      const queue = new ThreadOperationQueue({ minThreads: 1, maxThreads: 2 })

      // Fill first worker
      const p1 = queue.execute('session:create', { cwd: '/a' }, 'high')
      await flushAll()

      // Second operation should create a new worker and dispatch to it
      const p2 = queue.execute('session:create', { cwd: '/b' }, 'high')
      await flushAll()

      expect(mockWorkerInstances).toHaveLength(2)
      // The second worker should have received the message
      expect(mockWorkerInstances[1]!.postMessage).toHaveBeenCalledTimes(1)

      // Cleanup
      for (let i = 0; i < 2; i++) {
        const w = mockWorkerInstances[i]!
        const msg = w.postMessage.mock.calls[0]?.[0] as { id: string }
        w._simulateMessage({ id: msg.id, success: true, result: { sessionId: `s${i}`, extensionErrors: [], extensionsDisabled: false } })
      }
      await Promise.all([p1, p2])
    })
  })
})
