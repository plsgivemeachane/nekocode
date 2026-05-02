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

  constructor(config?: Partial<ThreadPoolConfig>, onSessionEvent?: SessionEventCallback) {
    this.config = { ...DEFAULT_POOL_CONFIG, ...config }
    this.onSessionEvent = onSessionEvent ?? null

    // Resolve worker path - will be compiled to .js in dist/
    // In development, we use the source file directly via ts-node/register
    const isDev = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV
    if (isDev) {
      // In development, we'll use a different approach - inline worker code
      this.workerPath = join(__dirname, 'worker-bootstrap.js')
    } else {
      this.workerPath = join(__dirname, 'worker-bootstrap.js')
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
   * Schedule next operation to an available worker
   */
  private scheduleNext(): void {
    // No pending operations or shutting down
    if (this.pendingOperations.length === 0 || this.isShuttingDown) {
      return
    }

    // Find an idle worker
    const idleWorker = this.workers.find(w => w.isIdle)
    if (!idleWorker) {
      // All workers busy - consider scaling up
      if (this.workers.length < this.config.maxThreads) {
        logger.debug('All workers busy, creating new worker...')
        const newWorker = this.createWorker()
        this.dispatchToWorker(newWorker)
      }
      return
    }

    this.dispatchToWorker(idleWorker)
  }

  /**
   * Dispatch operation to worker
   */
  private dispatchToWorker(state: WorkerState): void {
    const operation = this.pendingOperations.shift()
    if (!operation) return

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
  }

  /**
   * Wait for all active operations to complete
   */
  private async waitForActiveOperations(): Promise<void> {
    while (this.activeOperations.size > 0) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
}
