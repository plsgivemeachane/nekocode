import type { ChatMessageIPC, ModelInfo, ExtensionLoadError, SessionStreamEvent } from '../../shared/ipc-types'
import { ThreadOperationQueue } from './thread-operation-queue'
import { createLogger } from '../logger'
import type { ISessionManager } from '../manager-types'

const logger = createLogger('threaded-session-manager')

/**
 * Thread-safe wrapper for SessionManager operations.
 *
 * ALL operations are offloaded to worker threads to prevent main thread blocking.
 * CPU-intensive SDK operations (create, reconnect, prompt) run in worker threads
 * with streaming events forwarded via parentPort.postMessage().
 *
 * Architecture:
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                      Main Thread                                │
 * │  ┌────────────────────────────────────────────────────────────┐ │
 * │  │              ThreadedSessionManager (Proxy)                 │ │
 * │  │  - All operations delegated to ThreadOperationQueue        │ │
 * │  │  - Events received from workers and forwarded to renderer  │ │
 * │  └────────────────────────────────────────────────────────────┘ │
 * │                          │                                      │
 * │                          ▼                                      │
 * │  ┌────────────────────────────────────────────────────────────┐ │
 * │  │              ThreadOperationQueue                           │ │
 * │  │  - Dispatches operations to worker threads                 │ │
 * │  │  - Receives events from workers via parentPort             │ │
 * │  │  - Forwards events to onSessionEvent callback              │ │
 * │  └────────────────────────────────────────────────────────────┘ │
 * │                          │                                      │
 * │                          ▼                                      │
 * │  ┌────────────────────────────────────────────────────────────┐ │
 * │  │              Worker Thread Pool                             │ │
 * │  │  - Handles ALL SDK operations (create, reconnect, prompt)  │ │
 * │  │  - Manages session lifecycle and subscriptions             │ │
 * │  │  - Forwards streaming events via parentPort                │ │
 * │  └────────────────────────────────────────────────────────────┘ │
 * └─────────────────────────────────────────────────────────────────┘
 */
export class ThreadedSessionManager implements ISessionManager {
  private operationQueue: ThreadOperationQueue
  private eventCallback: (sessionId: string, event: SessionStreamEvent) => void
  private sessionCountValue = 0
  // Cache for extension info per session
  private extensionErrorsCache = new Map<string, ExtensionLoadError[]>()
  private extensionsDisabledCache = new Map<string, boolean>()

  constructor(
    operationQueue: ThreadOperationQueue,
    eventCallback: (sessionId: string, event: SessionStreamEvent) => void
  ) {
    this.operationQueue = operationQueue
    this.eventCallback = eventCallback
  }

  // =========================================================================
  // Session Lifecycle - All Offloaded to Worker Threads
  // =========================================================================

  /**
   * Create a new agent session.
   * Offloaded to worker thread (CPU intensive: extension loading).
   */
  async create(cwd: string): Promise<string> {
    logger.debug(`create: ${cwd} - offloading to worker thread`)

    const result = await this.operationQueue.execute<
      { cwd: string },
      { sessionId: string; extensionErrors: ExtensionLoadError[]; extensionsDisabled: boolean }
    >(
      'session:create',
      { cwd },
      'high'
    )

    this.sessionCountValue++
    // Cache extension info
    this.extensionErrorsCache.set(result.sessionId, result.extensionErrors)
    this.extensionsDisabledCache.set(result.sessionId, result.extensionsDisabled)
    logger.info(`Created session ${result.sessionId}`)
    return result.sessionId
  }

  /**
   * Reconnect to an existing session.
   * Offloaded to worker thread (CPU intensive: extension loading, history extraction).
   */
  async reconnect(sessionId: string, cwd: string): Promise<ChatMessageIPC[]> {
    logger.debug(`reconnect: ${sessionId} - offloading to worker thread`)

    const result = await this.operationQueue.execute<
      { sessionId: string; cwd: string },
      {
        sessionId: string
        history: ChatMessageIPC[]
        extensionErrors: ExtensionLoadError[]
        extensionsDisabled: boolean
      }
    >(
      'session:reconnect',
      { sessionId, cwd },
      'high'
    )

    this.sessionCountValue++
    // Cache extension info
    this.extensionErrorsCache.set(result.sessionId, result.extensionErrors)
    this.extensionsDisabledCache.set(result.sessionId, result.extensionsDisabled)
    logger.info(`Reconnected session ${result.sessionId}`)
    return result.history
  }

  /**
   * Send a user prompt to an active session.
   * Offloaded to worker thread (CPU intensive: AI processing).
   */
  async prompt(sessionId: string, text: string): Promise<void> {
    logger.debug(`prompt: ${sessionId} - offloading to worker thread`)

    await this.operationQueue.execute<{ sessionId: string; text: string }, void>(
      'session:prompt',
      { sessionId, text },
      'high'
    )
  }

  /**
   * Abort the current streaming response.
   * Offloaded to worker thread.
   */
  abort(sessionId: string): void {
    logger.debug(`abort: ${sessionId} - sending to worker thread`)

    // Fire and forget - abort needs to be immediate
    this.operationQueue.execute<{ sessionId: string }, { success: boolean }>(
      'session:abort',
      { sessionId },
      'high'
    ).catch(err => {
      logger.warn(`Abort failed for ${sessionId}:`, err)
    })
  }

  /**
   * Dispose a session.
   * Offloaded to worker thread.
   */
  dispose(sessionId: string): void {
    logger.debug(`dispose: ${sessionId} - sending to worker thread`)

    // Clean up cached data
    this.extensionErrorsCache.delete(sessionId)
    this.extensionsDisabledCache.delete(sessionId)

    // Fire and forget
    this.operationQueue.execute<{ sessionId: string }, { success: boolean }>(
      'session:dispose',
      { sessionId },
      'high'
    ).then(() => {
      this.sessionCountValue = Math.max(0, this.sessionCountValue - 1)
    }).catch(err => {
      logger.warn(`Dispose failed for ${sessionId}:`, err)
    })
  }

  /**
   * Dispose all active sessions.
   * Offloaded to worker thread.
   */
  disposeAll(): void {
    logger.debug('disposeAll - sending to worker thread')

    // Fire and forget
    this.operationQueue.execute<Record<string, never>, { success: boolean }>(
      'session:dispose-all',
      {},
      'high'
    ).then(() => {
      this.sessionCountValue = 0
    }).catch(err => {
      logger.warn('DisposeAll failed:', err)
    })
  }

  /**
   * Delete a session file from disk.
   * This is I/O but we keep it simple.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async deleteSession(sessionId: string, _cwd: string): Promise<void> {
    logger.debug(`deleteSession: ${sessionId}`)
    // Keep on main thread for now - this is a simple file deletion
    // Could be moved to worker if needed
    throw new Error('deleteSession should be handled by core manager')
  }

  // =========================================================================
  // Session Info - Offloaded to Worker Thread
  // =========================================================================

  /**
   * Get the accumulated message history for a session.
   * Offloaded to worker thread.
   */
  async getHistory(sessionId: string): Promise<ChatMessageIPC[]> {
    logger.debug(`getHistory: ${sessionId} - offloading to worker thread`)

    const result = await this.operationQueue.execute<
      { sessionId: string },
      { messages: ChatMessageIPC[] }
    >(
      'session:load-history',
      { sessionId },
      'normal'
    )

    return result.messages
  }

  /**
   * Load message history from disk.
   * Offloaded to worker thread for file I/O.
   */
  async loadHistoryFromDisk(sessionId: string, cwd: string, limit: number = 0): Promise<ChatMessageIPC[]> {
    logger.debug(`loadHistoryFromDisk: ${sessionId} - offloading to worker thread`)

    try {
      const result = await this.operationQueue.execute<
        { sessionId: string; cwd: string; limit: number },
        { messages: ChatMessageIPC[] }
      >(
        'session:load-history-disk',
        { sessionId, cwd, limit },
        'low'
      )
      return result.messages
    } catch (err) {
      logger.error(`loadHistoryFromDisk failed for ${sessionId}:`, err)
      return []
    }
  }

  /**
   * Get extension load errors for a session.
   * Returns cached value from create/reconnect.
   */
  getExtensionLoadErrors(sessionId: string): ExtensionLoadError[] {
    return this.extensionErrorsCache.get(sessionId) ?? []
  }

  /**
   * Check if extensions are disabled for a session.
   * Returns cached value from create/reconnect.
   */
  getExtensionsDisabled(sessionId: string): boolean {
    return this.extensionsDisabledCache.get(sessionId) ?? false
  }

  // =========================================================================
  // Model Operations - Offloaded to Worker Thread
  // =========================================================================

  /**
   * Get the current model for a session.
   * Offloaded to worker thread.
   */
  async getModel(sessionId: string): Promise<ModelInfo | null> {
    logger.debug(`getModel: ${sessionId} - offloading to worker thread`)

    try {
      const result = await this.operationQueue.execute<
        { sessionId: string },
        { id: string; name: string; provider: string }
      >(
        'session:get-model',
        { sessionId },
        'normal'
      )

      return result
    } catch (err) {
      logger.error(`getModel failed for ${sessionId}:`, err)
      return null
    }
  }

  /**
   * List all available models.
   * Offloaded to worker thread for registry operations.
   */
  async listModels(): Promise<ModelInfo[]> {
    logger.debug('listModels - offloading to worker thread')

    try {
      const result = await this.operationQueue.execute<
        Record<string, never>,
        { models: ModelInfo[] }
      >(
        'session:list-models',
        {},
        'normal'
      )
      return result.models
    } catch (err) {
      logger.error('listModels failed:', err)
      return []
    }
  }

  /**
   * Set the model for a session.
   * Offloaded to worker thread.
   */
  async setModel(sessionId: string, provider: string, modelId: string): Promise<ModelInfo> {
    logger.debug(`setModel: ${sessionId} -> ${provider}/${modelId} - offloading to worker thread`)

    const result = await this.operationQueue.execute<
      { sessionId: string; provider: string; modelId: string },
      { id: string; name: string; provider: string }
    >(
      'session:set-model',
      { sessionId, provider, modelId },
      'normal'
    )

    return result
  }

  // =========================================================================
  // Properties
  // =========================================================================

  /**
   * Get the number of active sessions.
   */
  get sessionCount(): number {
    return this.sessionCountValue
  }
}
