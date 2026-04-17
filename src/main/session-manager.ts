import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager as SdkSessionManager,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
  type SessionMessageEntry,
} from '@mariozechner/pi-coding-agent'
import type { TextContent, ToolCall, Message } from '@mariozechner/pi-ai'
import { unlinkSync } from 'fs'
import { StreamBatcher } from './stream-batcher'
import type { SessionStreamEvent, ChatMessageIPC, ModelInfo, ExtensionLoadError, UsageData } from '../shared/ipc-types'
import { createLogger } from './logger'
const logger = createLogger('session-manager')

/** Internal representation of a managed session */
interface ManagedSession {
  session: AgentSession
  unsubscribe: () => void
  batcher: StreamBatcher
  extensionErrors: ExtensionLoadError[]
  extensionsDisabled: boolean
  /** Accumulated message history for fast IPC retrieval */
  messages: ChatMessageIPC[]
  /** Tracks the current assistant message being streamed */
  currentAssistantId: string | null
  currentAssistantContent: string
  /** Whether the user has sent at least one prompt in this session */
  hasPrompted: boolean
  /** Tracks cumulative token usage across all assistant messages */
  usageTotals: { input: number; output: number; totalCost: number }
  /** Tracks the current tool call being executed */
  currentToolCallId: string | null
}

/** Callback type for emitting events to the renderer */
export type SessionEventCallback = (sessionId: string, event: SessionStreamEvent) => void

/**
 * Manages pi SDK sessions with persistence support.
 *
 * Sessions use stable IDs from the pi SDK (persisted on disk).
 * Messages are accumulated in memory and can be retrieved for history loading.
 * Existing sessions can be reconnected via their stable ID.
 *
 * Session lifecycle:
 *   create(cwd) -> subscribe to events -> prompt(text) -> ... -> dispose()
 *   reconnect(sessionId, cwd) -> load history -> prompt(text) -> ... -> dispose()
 */
export class PiSessionManager {
  private sessions = new Map<string, ManagedSession>()
  private readonly onEvent: SessionEventCallback
  private readonly allowExtensionFallback: boolean

  constructor(onEvent: SessionEventCallback) {
    this.onEvent = onEvent
    this.allowExtensionFallback = process.env.NEKOCODE_ALLOW_EXTENSION_FALLBACK === '1'
  }

  /**
   * Create a new pi SDK session for the given working directory.
   * Returns the stable session ID from the SDK (persisted on disk).
   */
  async create(cwd: string): Promise<string> {
    const primaryAttempt = await this.createSdkSession(SessionManager.create(cwd), cwd, 'create')
    const primaryErrors = this.normalizeExtensionErrors(primaryAttempt.extensionsResult.errors)

    let session = primaryAttempt.session
    let extensionsResult = primaryAttempt.extensionsResult
    let extensionErrors = primaryErrors
    let extensionsDisabled = false

    if (this.shouldRetryWithoutExtensions(primaryErrors, primaryAttempt.extensionsResult.extensions.length)) {
      if (!this.allowExtensionFallback) {
        this.logExtensionErrors('create', primaryErrors)
        throw new Error(`[create] Systemic extension loader failure (${primaryErrors.length}) - set NEKOCODE_ALLOW_EXTENSION_FALLBACK=1 to allow degraded reconnect/create without extensions`)
      }
      logger.warn('[create] Detected systemic extension loader failure signature, retrying with extensions disabled')
      const retryAttempt = await this.createSdkSession(SessionManager.create(cwd), cwd, 'create-noext', { noExtensions: true })
      session = retryAttempt.session
      extensionsResult = retryAttempt.extensionsResult
      extensionsDisabled = retryAttempt.extensionsResult.errors.length === 0
      if (extensionsDisabled) {
        logger.warn(`[create] Primary extension load failed (${primaryErrors.length}); fallback create without extensions succeeded`)
        extensionErrors = [
          {
            path: '__create__',
            message: `Create fallback engaged: extensions disabled for this session due to systemic extension loader failure (primaryErrors=${primaryErrors.length})`,
          },
        ]
      } else {
        extensionErrors = [
          ...primaryErrors,
          ...this.normalizeExtensionErrors(retryAttempt.extensionsResult.errors),
          {
            path: '__create__',
            message: 'Create fallback attempted with extensions disabled but still encountered extension load errors',
          },
        ]
      }
    }

    this.logExtensionErrors('create', extensionErrors)
    logger.info(`[create] Extensions loaded: ${extensionsResult.extensions.length}, errors: ${extensionsResult.errors.length}`)
    for (const ext of extensionsResult.extensions) {
      logger.info(`[create] Extension: ${ext.path}`)
    }

    const sessionId = session.sessionId
    logger.info(`Create ${sessionId} cwd=${cwd}`)

    const managed = this.wrapSession(session, sessionId, extensionErrors, extensionsDisabled)
    this.sessions.set(sessionId, managed)
    logger.info(`Created ${sessionId}`)
    return sessionId
  }

  /**
   * Reconnect to an existing session by its stable ID.
   * Opens the session file from disk and creates a new AgentSession wrapping it.
   * Populates message history from the SDK's persisted messages.
   */
  async reconnect(sessionId: string, cwd: string): Promise<ChatMessageIPC[]> {
    logger.info(`Reconnect ${sessionId} cwd=${cwd}`)

    // If the session is still in memory (never disposed), return its existing messages
    // after reconciling with disk to avoid returning stale/empty caches.
    const existing = this.sessions.get(sessionId)
    if (existing) {
      logger.info(`Reconnect ${sessionId} — already in memory`)
      // Reconcile synchronously so reconnect callers get the best available history now.
      try {
        const diskMessages = await this.loadHistoryFromDisk(sessionId, cwd, 0)
        if (diskMessages.length > existing.messages.length) {
          logger.info(`Reconnect ${sessionId} — refreshed in-memory history ${existing.messages.length} -> ${diskMessages.length}`)
          existing.messages = diskMessages
        }
      } catch (err) {
        // Best-effort reconciliation; keep using in-memory history if disk read fails.
        logger.debug(`Reconnect ${sessionId} — disk reconciliation failed: ${err}`)
      }
      return existing.messages
    }

    // Discover the session file for this session ID within the project's session dir
    const infos = await SdkSessionManager.list(cwd)
    const match = infos.find(info => info.id === sessionId)
    if (!match?.path) {
      throw new Error(`Session not found on disk: ${sessionId}`)
    }

    const primarySessionManager = SdkSessionManager.open(match.path)
    const primaryAttempt = await this.createSdkSession(primarySessionManager, cwd, 'reconnect')
    const primaryErrors = this.normalizeExtensionErrors(primaryAttempt.extensionsResult.errors)

    let session = primaryAttempt.session
    let extensionsResult = primaryAttempt.extensionsResult
    let extensionErrors = primaryErrors
    let extensionsDisabled = false

    if (this.shouldRetryWithoutExtensions(primaryErrors, primaryAttempt.extensionsResult.extensions.length)) {
      if (!this.allowExtensionFallback) {
        this.logExtensionErrors('reconnect', primaryErrors)
        throw new Error(`[reconnect] Systemic extension loader failure (${primaryErrors.length}) - set NEKOCODE_ALLOW_EXTENSION_FALLBACK=1 to allow degraded reconnect/create without extensions`)
      }
      logger.warn('[reconnect] Detected systemic extension loader failure signature, retrying with extensions disabled')
      const retrySessionManager = SdkSessionManager.open(match.path)
      const retryAttempt = await this.createSdkSession(retrySessionManager, cwd, 'reconnect-noext', { noExtensions: true })
      session = retryAttempt.session
      extensionsResult = retryAttempt.extensionsResult
      extensionsDisabled = retryAttempt.extensionsResult.errors.length === 0
      if (extensionsDisabled) {
        logger.warn(`[reconnect] Primary extension load failed (${primaryErrors.length}); fallback reconnect without extensions succeeded`)
        extensionErrors = [
          {
            path: '__reconnect__',
            message: `Reconnect fallback engaged: extensions disabled for this session due to systemic extension loader failure (primaryErrors=${primaryErrors.length})`,
          },
        ]
      } else {
        extensionErrors = [
          ...primaryErrors,
          ...this.normalizeExtensionErrors(retryAttempt.extensionsResult.errors),
          {
            path: '__reconnect__',
            message: 'Reconnect fallback attempted with extensions disabled but still encountered extension load errors',
          },
        ]
      }
    }

    this.logExtensionErrors('reconnect', extensionErrors)
    logger.info(`[reconnect] Extensions loaded: ${extensionsResult.extensions.length}, errors: ${extensionsResult.errors.length}`)
    for (const ext of extensionsResult.extensions) {
      logger.info(`[reconnect] Extension: ${ext.path}`)
    }

    const stableId = session.sessionId
    logger.info(`Reconnected ${stableId} (requested: ${sessionId})`)

    const managed = this.wrapSession(session, stableId, extensionErrors, extensionsDisabled)

    // Populate message history from the SDK's persisted messages
    managed.messages = this.extractHistoryFromSdkMessages(session.messages)

    this.sessions.set(stableId, managed)
    return managed.messages
  }

  /** Get normalized extension load errors captured for the session. */
  getExtensionLoadErrors(sessionId: string): ExtensionLoadError[] {
    const managed = this.sessions.get(sessionId)
    if (!managed) return []
    return managed.extensionErrors
  }

  /** Whether reconnect/create is currently running with extensions disabled for this session. */
  getExtensionsDisabled(sessionId: string): boolean {
    const managed = this.sessions.get(sessionId)
    if (!managed) return false
    return managed.extensionsDisabled
  }

  /**
   * Attempt to refresh an in-memory session from disk in the background.
   * If the session has been persisted (has an assistant message), reload its
   * messages from disk. Only updates if disk has more messages than memory,
   * and never overwrites while the session is actively streaming.
   */
  private async tryRefreshFromDisk(sessionId: string, cwd: string): Promise<void> {
    try {
      const managed = this.sessions.get(sessionId)
      if (!managed) return

      // Don't refresh while streaming — in-memory state is authoritative then
      if (managed.currentAssistantId) return

      const infos = await SdkSessionManager.list(cwd)
      const match = infos.find(info => info.id === sessionId)
      if (!match?.path) return // Not on disk yet (empty session) — that's fine

      const sdkSessionMgr = SdkSessionManager.open(match.path)
      const diskMessages = this.extractHistoryFromSdkMessages(sdkSessionMgr.getEntries().filter((e): e is SessionMessageEntry => e.type === "message").map(e => e.message))

      // Only update if disk has strictly more messages than memory
      if (diskMessages.length > managed.messages.length) {
        logger.info(`Background refresh ${sessionId} — updated ${managed.messages.length} -> ${diskMessages.length} messages`)
        managed.messages = diskMessages
      }
    } catch (err) {
      // Best-effort background refresh — log but don't throw
      logger.debug(`Background refresh failed for ${sessionId}: ${err}`)
    }
  }

  /** Send a user prompt to an active session. */
  async prompt(sessionId: string, text: string): Promise<void> {
    logger.info(`Prompt ${sessionId} text=${text.slice(0, 120)}${text.length > 120 ? '...' : ''}`)
    const managed = this.getManaged(sessionId)
    logger.debug(`Prompt ${sessionId} — streaming state: currentAssistantId=${managed.currentAssistantId ?? 'none'}, currentToolCallId=${managed.currentToolCallId ?? 'none'}`)
    if (!managed.hasPrompted) {
      this.onEvent(sessionId, { type: 'user_message', text })
      managed.hasPrompted = true
    }
    await managed.session.prompt(text, { streamingBehavior: 'steer' })
    logger.debug(`Prompt ${sessionId} — SDK prompt() returned (streaming initiated)`)
  }

  /** Abort the current streaming response. */
  abort(sessionId: string): void {
    const managed = this.getManaged(sessionId)
    managed.session.abort()
    logger.info(`Abort ${sessionId}`)
  }

  /** Get the accumulated message history for a session. */
  getHistory(sessionId: string): ChatMessageIPC[] {
    const managed = this.getManaged(sessionId)
    logger.debug(`getHistory ${sessionId} — returning ${managed.messages.length} message(s)`)
    // Return a copy to prevent mutation
    return [...managed.messages]
  }

  /**
   * Load message history from disk WITHOUT creating an agent session.
   * Lightweight alternative to reconnect() — just reads the session file and extracts messages.
   * Used for preloading session timelines in the sidebar.
   * @param limit Max number of recent messages to return (0 = all)
   */
  async loadHistoryFromDisk(sessionId: string, cwd: string, limit: number = 0): Promise<ChatMessageIPC[]> {
    logger.info(`loadHistoryFromDisk ${sessionId} cwd=${cwd} limit=${limit}`)
    const infos = await SdkSessionManager.list(cwd)
    const match = infos.find(info => info.id === sessionId)
    if (!match?.path) {
      logger.debug(`loadHistoryFromDisk ${sessionId} — not found on disk, returning empty`)
      return []
    }

    const sdkSessionMgr = SdkSessionManager.open(match.path)
    const allMessages = this.extractHistoryFromSdkMessages(
      sdkSessionMgr.getEntries()
        .filter((e): e is SessionMessageEntry => e.type === "message")
        .map(e => e.message)
    )
    const diskMessages = limit > 0 && allMessages.length > limit
      ? allMessages.slice(-limit)
      : allMessages
    logger.debug(`loadHistoryFromDisk ${sessionId} — ${diskMessages.length}/${allMessages.length} message(s) returned`)
    return diskMessages
  }

  /** Delete a session file from disk and dispose it if active. */
  async deleteSession(sessionId: string, cwd: string): Promise<void> {
    // If the session is currently in memory, dispose it first
    if (this.sessions.has(sessionId)) {
      this.dispose(sessionId)
    }
    // Find and delete the session file from disk
    const infos = await SdkSessionManager.list(cwd)
    const match = infos.find(info => info.id === sessionId)
    if (match?.path) {
      try {
        unlinkSync(match.path)
        logger.info(`deleteSession ${sessionId} — deleted file ${match.path}`)
      } catch (err) {
        logger.warn(`deleteSession ${sessionId} — failed to delete file ${match.path}:`, err)
        throw err
      }
    } else {
      logger.warn(`deleteSession ${sessionId} — session file not found on disk for cwd=${cwd}`)
    }
  }

  /** Dispose a session, cleaning up subscriptions and SDK resources. */
  dispose(sessionId: string): void {
    const managed = this.getManaged(sessionId)
    managed.batcher.dispose()
    managed.unsubscribe()
    // Clean up empty session files (never prompted)
    try {
      const sm = managed.session.sessionManager
      if (sm.isPersisted()) {
        const sessionFile = sm.getSessionFile()
        if (sessionFile && sm.getEntries().length === 0) {
          unlinkSync(sessionFile)
          logger.info(`Dispose ${sessionId} — deleted empty session file`)
        }
      }
    } catch (err) {
      logger.warn(`Dispose ${sessionId} — failed to clean up session file:`, err)
    }
    managed.session.dispose()
    this.sessions.delete(sessionId)
    logger.info(`Dispose ${sessionId}`)
  }

  /** Dispose all active sessions. Called on app quit. */
  disposeAll(): void {
    for (const [id] of this.sessions) {
      this.dispose(id)
    }
  }

  /** Get the current model for a session. */
  getModel(sessionId: string): ModelInfo | null {
    const managed = this.sessions.get(sessionId)
    if (!managed) return null
    const model = managed.session.model
    if (!model) return null
    return { id: model.id, name: model.name, provider: model.provider }
  }

  /** List all available models with valid API keys. */
  async listModels(): Promise<ModelInfo[]> {
    let modelRegistry: import('@mariozechner/pi-coding-agent').ModelRegistry | null = null
    for (const [, managed] of this.sessions) {
      modelRegistry = managed.session.modelRegistry
      break
    }
    if (!modelRegistry) {
      const { ModelRegistry, AuthStorage } = await import('@mariozechner/pi-coding-agent')
      const authStorage = AuthStorage.create()
      modelRegistry = ModelRegistry.create(authStorage)
    }
    const available = modelRegistry.getAvailable()
    return available.map((m) => ({ id: m.id, name: m.name, provider: m.provider }))
  }

  /** Set the model for a session. */
  async setModel(sessionId: string, provider: string, modelId: string): Promise<ModelInfo> {
    const managed = this.getManaged(sessionId)
    const modelRegistry = managed.session.modelRegistry
    const model = modelRegistry.find(provider, modelId)
    if (!model) {
      throw new Error(`Model not found: ${provider}/${modelId}`)
    }
    await managed.session.setModel(model)
    const updated = managed.session.model
    if (!updated) throw new Error(`Failed to set model: ${provider}/${modelId}`)
    return { id: updated.id, name: updated.name, provider: updated.provider }
  }

  /** Get the number of active sessions. */
  get sessionCount(): number {
    return this.sessions.size
  }

  private getManaged(sessionId: string): ManagedSession {
    const managed = this.sessions.get(sessionId)
    if (!managed) {
      logger.error(`getManaged: session not found ${sessionId} — active sessions: [${Array.from(this.sessions.keys()).join(', ')}]`)
      throw new Error(`Session not found: ${sessionId}`)
    }
    return managed
  }

  /**
   * Wrap an AgentSession with event handling and message accumulation.
   */
  private wrapSession(
    session: AgentSession,
    sessionId: string,
    extensionErrors: ExtensionLoadError[],
    extensionsDisabled: boolean,
  ): ManagedSession {
    const batcher = new StreamBatcher((event) => {
      this.onEvent(sessionId, event)
    })

    const managed: ManagedSession = {
      session,
      unsubscribe: () => {}, // placeholder, replaced below
      batcher,
      extensionErrors,
      extensionsDisabled,
      messages: [],
      currentAssistantId: null,
      currentAssistantContent: '',
      currentToolCallId: null,
      hasPrompted: false,
      usageTotals: { input: 0, output: 0, totalCost: 0 },
    }

    managed.unsubscribe = session.subscribe((agentEvent: AgentSessionEvent) => {
      this.handleAgentEvent(sessionId, agentEvent, batcher, managed)
    })

    return managed
  }

  private async createSdkSession(
    sessionManager: SessionManager,
    cwd: string,
    mode: 'create' | 'create-noext' | 'reconnect' | 'reconnect-noext',
    loaderOptions?: { noExtensions?: boolean },
  ): Promise<Awaited<ReturnType<typeof createAgentSession>>> {
    const loader = this.createResourceLoader(cwd, loaderOptions)
    logger.debug(`[${mode}] createSdkSession loaderCwd=${cwd} processCwd=${process.cwd()} NODE_PATH=${process.env.NODE_PATH ?? ''}`)
    await loader.reload()
    return createAgentSession({
      cwd,
      resourceLoader: loader,
      sessionManager,
    })
  }

  private createResourceLoader(cwd: string, options?: { noExtensions?: boolean }): DefaultResourceLoader {
    return new DefaultResourceLoader({
      cwd,
      agentDir: getAgentDir(),
      settingsManager: SettingsManager.create(),
      noExtensions: options?.noExtensions,
    })
  }

  private shouldRetryWithoutExtensions(errors: ExtensionLoadError[], loadedExtensionsCount: number): boolean {
    if (loadedExtensionsCount > 0 || errors.length === 0) return false
    const uniqueMessages = new Set(errors.map(error => error.message))
    if (uniqueMessages.size !== 1) return false
    const onlyMessage = errors[0]?.message ?? ''
    return onlyMessage.includes('(void 0) is not a function')
  }

  private normalizeExtensionErrors(errors: unknown[]): ExtensionLoadError[] {
    return errors.map((error, index) => {
      if (typeof error === 'string') {
        return {
          path: `unknown:${index}`,
          message: error,
        }
      }

      if (error && typeof error === 'object') {
        const path = 'path' in error && typeof error.path === 'string' ? error.path : `unknown:${index}`
        const message = 'error' in error && typeof error.error === 'string'
          ? error.error
          : 'message' in error && typeof error.message === 'string'
            ? error.message
            : String(error)
        const stack = 'stack' in error && typeof error.stack === 'string' ? error.stack : undefined
        return { path, message, stack }
      }

      return {
        path: `unknown:${index}`,
        message: String(error),
      }
    })
  }

  private logExtensionErrors(mode: 'create' | 'reconnect', errors: ExtensionLoadError[]): void {
    if (errors.length === 0) return
    const markerOnly = errors.every(error => error.path === '__reconnect__' || error.path === '__create__')
    if (markerOnly) {
      for (const extensionError of errors) {
        logger.warn(`[${mode}] ${extensionError.message}`)
      }
      return
    }
    logger.error(`[${mode}] Extension load errors (${errors.length})`)
    const uniqueMessages = new Set(errors.map(error => error.message))
    if (uniqueMessages.size === 1) {
      logger.error(`[${mode}] Extension error fingerprint: uniform-message across all failures -> ${errors[0].message}`)
    }
    const stackCount = errors.filter(error => !!error.stack).length
    if (stackCount === 0) {
      logger.error(`[${mode}] Extension diagnostics: no stack traces provided by SDK error payload`)
    }
    for (const extensionError of errors) {
      logger.error(`[${mode}] Extension load error path=${extensionError.path} message=${extensionError.message}`)
      if (extensionError.stack) {
        logger.error(`[${mode}] Extension load stack path=${extensionError.path}\n${extensionError.stack}`)
      }
    }
  }

  /**
   * Extract ChatMessageIPC[] from the SDK's AgentMessage[].
   * Converts the SDK's internal message format to the lightweight IPC format.
   * Only handles UserMessage and AssistantMessage — skips BashExecutionMessage,
   * ToolResultMessage, and other custom message types.
   */
  private extractHistoryFromSdkMessages(
    sdkMessages: AgentSession['messages'],
  ): ChatMessageIPC[] {
    logger.debug(`extractHistoryFromSdkMessages: ${sdkMessages.length} raw SDK message(s)`)
    const result: ChatMessageIPC[] = []
    // First pass: collect toolResult messages keyed by toolCallId
    const toolResults = new Map<string, { result: unknown; isError: boolean }>()
    for (const msg of sdkMessages) {
      if (!('role' in msg)) continue
      const m = msg as Message
      if (m.role === 'toolResult') {
        const content = Array.isArray(m.content)
          ? m.content.filter((b): b is TextContent => b.type === 'text').map(b => b.text).join('')
          : ''
        toolResults.set(m.toolCallId, { result: content, isError: !!m.isError })
      }
    }

    for (const msg of sdkMessages) {
      if (!('role' in msg)) continue
      const m = msg as Message
      const role = m.role
      if (role !== 'user' && role !== 'assistant') continue

      let content = ''
      if (role === 'user') {
        const userContent = m.content
        if (typeof userContent === 'string') {
          content = userContent
        } else if (Array.isArray(userContent)) {
          content = userContent
            .filter((block): block is TextContent => block.type === 'text')
            .map(block => block.text)
            .join('')
        }
      } else {
        const assistantContent = m.content
        if (Array.isArray(assistantContent)) {
          content = assistantContent
            .filter((block): block is TextContent => block.type === 'text')
            .map(block => block.text)
            .join('')
        }
      }

      // Extract tool calls from assistant messages
      let toolCalls: ChatMessageIPC['toolCalls']
      if (role === 'assistant') {
        const assistantContent = m.content
        if (Array.isArray(assistantContent)) {
          const tcBlocks = assistantContent.filter((block): block is ToolCall => block.type === 'toolCall')
          if (tcBlocks.length > 0) {
            toolCalls = tcBlocks.map(tc => {
              const tcResult = toolResults.get(tc.id)
              return {
                id: tc.id,
                name: tc.name,
                args: tc.arguments,
                result: tcResult?.result,
                isError: tcResult?.isError,
              }
            })
          }
        }
      }

      result.push({
        id: crypto.randomUUID(),
        role,
        content,
        toolCalls,
        timestamp: 'timestamp' in m ? m.timestamp : Date.now(),
      })
    }
    logger.debug(`extractHistoryFromSdkMessages: produced ${result.length} ChatMessageIPC(s)`)
    return result
  }

  /**
   * Translate AgentSessionEvent into simplified SessionStreamEvent for the renderer.
   * Also accumulates messages into the managed session's history.
   */
  private handleAgentEvent(
    sessionId: string,
    event: AgentSessionEvent,
    batcher: StreamBatcher,
    managed: ManagedSession,
  ): void {
    logger.debug(`handleAgentEvent: type=${event.type}`)
    const emit = (streamEvent: SessionStreamEvent) => {
      logger.debug(`emit: ${streamEvent.type}`)
      this.onEvent(sessionId, streamEvent)
    }

    switch (event.type) {
      case 'message_update': {
        const sub = event.assistantMessageEvent
        if (sub.type === 'text_delta') {
          // Start tracking a new assistant message on first delta
          if (!managed.currentAssistantId) {
            managed.currentAssistantId = crypto.randomUUID()
            managed.currentAssistantContent = ''
          }
          managed.currentAssistantContent += sub.delta
          batcher.push({ type: 'text_delta', delta: sub.delta })
        }
        break
      }
      case 'message_start': {
        logger.debug(`message_start: role=${event.message?.role ?? 'unknown'}`)
        // Check if this is a user message start — if so, flush any pending assistant
        if (event.message?.role === 'user') {
          this.finalizeAssistantMessage(managed)
          // Record the user message
          let content = ''
          if (typeof event.message.content === 'string') {
            content = event.message.content
          } else if (Array.isArray(event.message.content)) {
            content = event.message.content
              .filter((block): block is TextContent => block.type === 'text')
              .map(block => block.text)
              .join('')
          }
          managed.messages.push({
            id: crypto.randomUUID(),
            role: 'user',
            content,
            timestamp: Date.now(),
          })
          logger.debug(`message_start: recorded user message, content=${content.length} chars, total=${managed.messages.length}`)
        }
        break
      }
      case 'message_end': {
        logger.debug(`message_end: role=${event.message?.role ?? 'unknown'}`)
        // Finalize the assistant message when the message ends
        if (managed.currentAssistantId) {
          this.finalizeAssistantMessage(managed)
        }
        // Emit usage update if this is an assistant message with usage data
        if (event.message?.role === 'assistant' && 'usage' in event.message && event.message.usage) {
          const usage = event.message.usage as { input: number; output: number; cost: { total: number } }
          managed.usageTotals.input += usage.input
          managed.usageTotals.output += usage.output
          managed.usageTotals.totalCost += usage.cost.total
          const ctxUsage = managed.session.getContextUsage()
          const usageData: UsageData = {
            inputTokens: managed.usageTotals.input,
            outputTokens: managed.usageTotals.output,
            totalCost: managed.usageTotals.totalCost,
            contextPercent: ctxUsage?.percent ?? 0,
            contextWindow: ctxUsage?.contextWindow ?? 0,
          }
          emit({ type: 'usage_update', usage: usageData })
        }
        break
      }
      case 'tool_execution_start': {
        batcher.flush()
        logger.debug(`tool_execution_start: name=${event.toolName}, id=${event.toolCallId}, args=${JSON.stringify(event.args)?.slice(0, 200)}`)
        emit({ type: 'tool_call', toolCallId: event.toolCallId ?? managed.currentToolCallId ?? crypto.randomUUID(), toolName: event.toolName, args: event.args })
        // Finalize any in-progress assistant text before attaching tool calls
        this.finalizeAssistantMessage(managed)
        managed.currentToolCallId = event.toolCallId ?? crypto.randomUUID()
        // Tool calls attach to the now-finalized assistant message
        const lastMsg = managed.messages[managed.messages.length - 1]
        if (lastMsg && lastMsg.role === 'assistant') {
          if (!lastMsg.toolCalls) lastMsg.toolCalls = []
          lastMsg.toolCalls.push({
            id: managed.currentToolCallId,
            name: event.toolName,
            args: event.args,
          })
        } else {
          // No assistant message yet — create a placeholder
          managed.messages.push({
            id: crypto.randomUUID(),
            role: 'assistant',
            content: '',
            toolCalls: [{
              id: managed.currentToolCallId,
              name: event.toolName,
              args: event.args,
            }],
            timestamp: Date.now(),
          })
        }
        break
      }
      case 'tool_execution_end':
        batcher.flush()
        logger.debug(`tool_execution_end: name=${event.toolName}, id=${event.toolCallId}, isError=${event.isError}, result=${JSON.stringify(event.result)?.slice(0, 200)}`)
        emit({
          type: 'tool_result',
          toolCallId: event.toolCallId ?? managed.currentToolCallId ?? '',
          toolName: event.toolName,
          result: event.result,
          isError: event.isError,
        })
        // Update the tool call result
        if (managed.currentToolCallId) {
          const lastMsg = managed.messages[managed.messages.length - 1]
          if (lastMsg?.toolCalls) {
            const tc = lastMsg.toolCalls.find(
              t => t.id === managed.currentToolCallId,
            )
            if (tc) {
              tc.result = event.result
              tc.isError = event.isError
            }
          }
          managed.currentToolCallId = null
        }
        break
      case 'agent_end':
        batcher.flush()
        this.finalizeAssistantMessage(managed)
        logger.debug(`agent_end: total accumulated messages=${managed.messages.length}`)
        emit({ type: 'done' })
        break
      case 'turn_end':
        // turn_end fires per turn; agent_end fires when fully done.
        // We emit 'done' on agent_end, so turn_end is just a no-op here.
        break
      case 'agent_start':
        batcher.flush()
        logger.debug(`agent_start: flushing batcher, emitting agent_start`)
        emit({ type: 'agent_start' })
        break
      default:
        // turn_start, tool_execution_update
        // are internal bookkeeping — not useful for the renderer.
        logger.debug(`unhandled event type: ${(event as { type: string }).type}`)
        break
    }
  }

  /**
   * Finalize the current in-progress assistant message.
   * Called on message_end, agent_end, or before a new user message.
   */
  private finalizeAssistantMessage(managed: ManagedSession): void {
    if (!managed.currentAssistantId) return
    logger.debug(`finalizeAssistantMessage: id=${managed.currentAssistantId} content=${managed.currentAssistantContent.length} chars`)
    managed.messages.push({
      id: managed.currentAssistantId,
      role: 'assistant',
      content: managed.currentAssistantContent,
      timestamp: Date.now(),
    })
    logger.debug(`finalizeAssistantMessage: total messages now ${managed.messages.length}`)
    managed.currentAssistantId = null
    managed.currentAssistantContent = ''
  }
}
