import { Worker } from 'worker_threads'
import { app } from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'
import {
  type ThreadPoolConfig,
  type ThreadPoolStats,
  type OperationPriority,
  type OperationType,
  type WorkerMessage,
  type WorkerResponse,
  type WorkerEventMessage,
  DEFAULT_POOL_CONFIG,
} from './types'
import type { SessionStreamEvent } from '../../shared/ipc-types'
import { createLogger } from '../logger'

const logger = createLogger('thread-queue')

/**
 * Internal representation of a pending operation
 */
interface PendingOperation {
  id: string
  type: OperationType
  input: unknown
  priority: OperationPriority
  timestamp: number
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

/**
 * Internal representation of an active operation
 */
interface ActiveOperation {
  worker: Worker
  operation: PendingOperation
  startTime: number
  timeoutId: NodeJS.Timeout | null
}

/**
 * Worker state tracking
 */
interface WorkerState {
  worker: Worker
  isIdle: boolean
  currentOperationId: string | null
}

/**
 * Callback type for handling session events from worker threads
 */
export type SessionEventCallback = (sessionId: string, event: SessionStreamEvent) => void

/**
 * Manages a pool of worker threads for offloading heavy operations.
 * Implements priority-based scheduling and automatic scaling.
 *
 * Architecture:
 * ┌─────────────────────────────────────────────────────────────┐
 * │                    Main Thread                               │
 * │  ┌─────────────────────────────────────────────────────┐   │
 * │  │              Operation Queue (Priority)              │   │
 * │  │   [High Priority] → [Normal Priority] → [Low]       │   │
 * │  └─────────────────────────────────────────────────────┘   │
 * │                           │                                  │
 * │                           ▼                                  │
 * │  ┌─────────────────────────────────────────────────────┐   │
 * │  │              Worker Thread Pool                       │   │
 * │  │   [Worker 1] [Worker 2] [Worker 3] [Worker 4]       │   │
 * │  └─────────────────────────────────────────────────────┘   │
 * └─────────────────────────────────────────────────────────────┘
 */
export class ThreadOperationQueue {
  private config: ThreadPoolConfig
  private workers: WorkerState[] = []
  private pendingOperations: PendingOperation[] = []
  private activeOperations = new Map<string, ActiveOperation>()
  private stats = { completed: 0, failed: 0 }
  private isShuttingDown = false
  private workerPath: string
  private onSessionEvent: SessionEventCallback | null = null
  // Session affinity: maps sessionId to the worker that owns that session
  // This ensures all operations for a session go to the same worker
  private sessionToWorker = new Map<string, WorkerState>()

  constructor(config?: Partial<ThreadPoolConfig>, onSessionEvent?: SessionEventCallback) {
    this.config = { ...DEFAULT_POOL_CONFIG, ...config }
    this.onSessionEvent = onSessionEvent ?? null

    // Resolve worker path - the worker is built to workers/worker-bootstrap.mjs
    // This is a separate directory that won't be wiped by electron-vite during builds
    const isDev = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV
    if (isDev) {
      // In development, use absolute path to the built worker file
      // The worker is built by scripts/build-worker.cjs to workers/
      this.workerPath = join(process.cwd(), 'workers', 'worker-bootstrap.mjs')
    } else {
      // In production, the worker is in the workers directory relative to the app
      this.workerPath = join(process.cwd(), 'workers', 'worker-bootstrap.mjs')
    }

    this.initializePool()
  }

  /**
   * Submit an operation to be processed in a worker thread.
   * Returns a promise that resolves when the operation completes.
   *
   * @param type - Operation type identifier
   * @param input - Input data for the operation
   * @param priority - Priority level (high/normal/low)
   * @returns Promise that resolves with the operation result
   */
  async execute<TInput, TOutput>(
    type: OperationType,
    input: TInput,
    priority: OperationPriority = 'normal'
  ): Promise<TOutput> {
    if (this.isShuttingDown) {
      throw new Error('ThreadOperationQueue is shutting down')
    }

    return new Promise<TOutput>((resolve, reject) => {
      const operation: PendingOperation = {
        id: randomUUID(),
        type,
        input,
        priority,
        timestamp: Date.now(),
        resolve: resolve as (value: unknown) => void,
        reject,
      }

      // Priority queue insertion
      this.enqueueOperation(operation)
      this.scheduleNext()
    })
  }

  /**
   * Get current thread pool statistics
   */
  getStats(): ThreadPoolStats {
    const activeThreads = this.activeOperations.size
    const idleThreads = this.workers.filter(w => w.isIdle).length

    return {
      activeThreads,
      idleThreads,
      pendingOperations: this.pendingOperations.length,
      completedOperations: this.stats.completed,
      failedOperations: this.stats.failed,
    }
  }

  /**
   * Gracefully shutdown all worker threads
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down thread pool...')
    this.isShuttingDown = true

    // Wait for active operations to complete or timeout
    const activeCount = this.activeOperations.size
    if (activeCount > 0) {
      logger.info(`Waiting for ${activeCount} active operations to complete...`)

      await Promise.race([
        this.waitForActiveOperations(),
        new Promise<void>(resolve => setTimeout(resolve, 10000)),
      ])
    }

    // Terminate all workers
    for (const state of this.workers) {
      try {
        state.worker.terminate()
      } catch (err) {
        logger.warn('Error terminating worker:', err)
      }
    }

    this.workers = []
    this.pendingOperations = []
    logger.info('Thread pool shutdown complete')
  }

  // ========================================================================
  // Private Methods - Pool Management
  // ========================================================================

  /**
   * Initialize the worker pool with minimum threads
   */
  private initializePool(): void {
    logger.info(`Initializing thread pool with ${this.config.minThreads} workers...`)

    for (let i = 0; i < this.config.minThreads; i++) {
      this.createWorker()
    }

    logger.info('Thread pool initialized')
  }

  /**
   * Create a new worker thread
   */
  private createWorker(): WorkerState {
    logger.debug('Creating new worker...')

    const worker = new Worker(this.workerPath, {
      env: {
        ...process.env,
        NODE_ENV: process.env.NODE_ENV || 'development',
        USERDATA_PATH: app.getPath('userData'),
      },
    })

    const state: WorkerState = {
      worker,
      isIdle: true,
      currentOperationId: null,
    }

    worker.on('message', (message: WorkerResponse | WorkerEventMessage) => {
      this.handleWorkerMessage(state, message)
    })

    worker.on('error', (error: Error) => {
      logger.error('Worker error:', error)
      this.handleWorkerError(state, error)
    })

    worker.on('exit', (code: number) => {
      if (code !== 0) {
        logger.warn(`Worker exited with code ${code}`)
      }
      this.handleWorkerExit(state)
    })

    this.workers.push(state)
    logger.debug('Worker created')
    return state
  }

  /**
   * Handle message from worker (operation completed or event)
   */
  private handleWorkerMessage(state: WorkerState, message: WorkerResponse | WorkerEventMessage): void {
    // Check if this is an event message
    if ('type' in message && message.type === 'session_event') {
      this.handleWorkerEvent(message)
      return
    }

    // Otherwise, it's an operation response
    const response = message as WorkerResponse
    const activeOp = this.activeOperations.get(response.id)

    if (!activeOp) {
      logger.warn(`Received response for unknown operation: ${response.id}`)
      return
    }

    // Clear timeout
    if (activeOp.timeoutId) {
      clearTimeout(activeOp.timeoutId)
    }

    // Remove from active operations
    this.activeOperations.delete(response.id)

    // Mark worker as idle
    state.isIdle = true
    state.currentOperationId = null

    if (response.success) {
      this.stats.completed++
      
      // Handle session affinity
      if (activeOp.operation.type === 'session:create') {
        // session:create returns sessionId in the output - register affinity
        const result = response.result as { sessionId?: string }
        if (result.sessionId) {
          this.sessionToWorker.set(result.sessionId, state)
          logger.debug(`Registered session affinity: ${result.sessionId} -> worker ${this.workers.indexOf(state)}`)
        }
      } else if (this.clearsSessionAffinity(activeOp.operation.type)) {
        // session:dispose or session:delete - clear affinity
        const sessionId = this.getSessionIdFromInput(activeOp.operation.type, activeOp.operation.input)
        if (sessionId && this.sessionToWorker.has(sessionId)) {
          this.sessionToWorker.delete(sessionId)
          logger.debug(`Cleared session affinity for ${sessionId}`)
        }
      }
      
      activeOp.operation.resolve(response.result)
      logger.debug(`Operation ${response.id} completed successfully`)
    } else {
      this.stats.failed++
      activeOp.operation.reject(new Error(response.error || 'Operation failed'))
      logger.warn(`Operation ${response.id} failed: ${response.error}`)
    }

    // Schedule next operation
    this.scheduleNext()
  }

  /**
   * Handle event message from worker (streaming event)
   */
  private handleWorkerEvent(message: WorkerEventMessage): void {
    if (this.onSessionEvent) {
      this.onSessionEvent(message.sessionId, message.event)
    }
  }

  /**
   * Handle worker error
   */
  private handleWorkerError(state: WorkerState, error: Error): void {
    logger.error('Worker error:', error)

    // If there's an active operation, reject it
    if (state.currentOperationId) {
      const activeOp = this.activeOperations.get(state.currentOperationId)
      if (activeOp) {
        if (activeOp.timeoutId) {
          clearTimeout(activeOp.timeoutId)
        }
        this.activeOperations.delete(state.currentOperationId)
        this.stats.failed++
        activeOp.operation.reject(error)
      }
    }

    state.isIdle = true
    state.currentOperationId = null

    // Schedule next operation
    this.scheduleNext()
  }

  /**
   * Handle worker exit
   */
  private handleWorkerExit(state: WorkerState): void {
    // Remove from workers list
    const index = this.workers.indexOf(state)
    if (index !== -1) {
      this.workers.splice(index, 1)
    }

    // If we're below minimum, create a new worker
    if (!this.isShuttingDown && this.workers.length < this.config.minThreads) {
      logger.info('Creating replacement worker...')
      this.createWorker()
    }
  }

  /**
   * Enqueue operation with priority
   */
  private enqueueOperation(operation: PendingOperation): void {
    // Insert based on priority: high > normal > low
    const priorityOrder = { high: 0, normal: 1, low: 2 }
    const opPriority = priorityOrder[operation.priority]

    let insertIndex = this.pendingOperations.length
    for (let i = 0; i < this.pendingOperations.length; i++) {
      const pendingPriority = priorityOrder[this.pendingOperations[i].priority]
      if (opPriority < pendingPriority) {
        insertIndex = i
        break
      }
    }

    this.pendingOperations.splice(insertIndex, 0, operation)
    logger.debug(`Enqueued operation ${operation.id} (type=${operation.type}, priority=${operation.priority})`)
  }

  /**
   * Schedule next operation to an available worker.
   * Implements session affinity: operations for a session are routed to the
   * worker that owns that session.
   */
  private scheduleNext(): void {
    // No pending operations or shutting down
    if (this.pendingOperations.length === 0 || this.isShuttingDown) {
      return
    }

    // Look at the next pending operation (highest priority)
    const nextOperation = this.pendingOperations[0]
    const sessionId = this.getSessionIdFromInput(nextOperation.type, nextOperation.input)

    // If this operation needs session affinity
    if (this.needsSessionAffinity(nextOperation.type) && sessionId) {
      const affinityWorker = this.sessionToWorker.get(sessionId)
      
      if (affinityWorker) {
        // Session has affinity - only dispatch to that worker
        if (affinityWorker.isIdle) {
          this.pendingOperations.shift()
          this.dispatchToWorker(affinityWorker, nextOperation)
        } else {
          // Affinity worker is busy - wait for it to become idle
          // Don't create a new worker for session operations
          logger.debug(`Worker for session ${sessionId} is busy, waiting...`)
        }
        return
      }
      // No affinity yet (shouldn't happen in normal flow, but handle gracefully)
      // Fall through to normal dispatch
    }

    // Normal dispatch: find any idle worker
    const idleWorker = this.workers.find(w => w.isIdle)
    if (!idleWorker) {
      // All workers busy - consider scaling up
      // But only for operations that don't need affinity or don't have affinity yet
      if (this.workers.length < this.config.maxThreads) {
        logger.debug('All workers busy, creating new worker...')
        const newWorker = this.createWorker()
        this.pendingOperations.shift()
        this.dispatchToWorker(newWorker, nextOperation)
      }
      return
    }

    this.pendingOperations.shift()
    this.dispatchToWorker(idleWorker, nextOperation)
  }

  /**
   * Dispatch operation to worker
   */
  private dispatchToWorker(state: WorkerState, operation: PendingOperation): void {

    state.isIdle = false
    state.currentOperationId = operation.id

    const message: WorkerMessage = {
      id: operation.id,
      type: operation.type,
      input: operation.input,
    }

    // Set up timeout
    const timeoutId = setTimeout(() => {
      logger.warn(`Operation ${operation.id} timed out after ${this.config.taskTimeout}ms`)
      this.handleWorkerError(state, new Error('Operation timed out'))
    }, this.config.taskTimeout)

    this.activeOperations.set(operation.id, {
      worker: state.worker,
      operation,
      startTime: Date.now(),
      timeoutId,
    })

    state.worker.postMessage(message)
    logger.debug(`Dispatched operation ${operation.id} to worker`)
    
    // Register session affinity for create/reconnect operations
    // This is done at dispatch time so subsequent operations wait for the right worker
    if (this.registersSessionAffinity(operation.type)) {
      // For session:create, we don't know the sessionId yet - it will be registered
      // in handleWorkerMessage when the operation completes
      // For session:reconnect, we can register affinity now
      const sessionId = this.getSessionIdFromInput(operation.type, operation.input)
      if (sessionId) {
        this.sessionToWorker.set(sessionId, state)
        logger.debug(`Registered session affinity: ${sessionId} -> worker ${this.workers.indexOf(state)}`)
      }
    }
  }

  /**
   * Wait for all active operations to complete
   */
  private async waitForActiveOperations(): Promise<void> {
    while (this.activeOperations.size > 0) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }

  // ========================================================================
  // Private Methods - Session Affinity
  // ========================================================================

  /**
   * Extract sessionId from operation input if present.
   * Returns null for operations that don't have a sessionId in their input.
   */
  private getSessionIdFromInput(type: OperationType, input: unknown): string | null {
    if (!input || typeof input !== 'object') return null
    
    // session:create doesn't have sessionId in input (it's in the output)
    // session:list-models is global, not session-specific
    if (type === 'session:create' || type === 'session:list-models') {
      return null
    }
    
    // All other session operations have sessionId in their input
    const sessionInput = input as { sessionId?: string }
    return sessionInput.sessionId ?? null
  }

  /**
   * Check if an operation type needs session affinity.
   * These operations should be routed to the worker that owns the session.
   */
  private needsSessionAffinity(type: OperationType): boolean {
    return type.startsWith('session:') && 
           type !== 'session:create' && 
           type !== 'session:list-models'
  }

  /**
   * Check if an operation type creates a session and should register affinity.
   * session:create and session:reconnect create session state in the worker.
   */
  private registersSessionAffinity(type: OperationType): boolean {
    return type === 'session:create' || type === 'session:reconnect'
  }

  /**
   * Check if an operation type clears session affinity.
   * session:dispose and session:delete remove the session from the worker.
   */
  private clearsSessionAffinity(type: OperationType): boolean {
    return type === 'session:dispose' || type === 'session:delete'
  }
}
