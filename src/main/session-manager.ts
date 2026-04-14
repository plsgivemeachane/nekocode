import {
  AuthStorage,
  createAgentSession,
  createEventBus,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  SessionManager as SdkSessionManager,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
  type SessionMessageEntry,
} from '@mariozechner/pi-coding-agent'
import {} from '@mariozechner/pi-coding-agent'
import type { TextContent, ToolCall, Message } from '@mariozechner/pi-ai'
import { StreamBatcher } from './stream-batcher'
import type { SessionStreamEvent, ChatMessageIPC, ModelInfo } from '../shared/ipc-types'
import { createLogger } from './logger'
const logger = createLogger('session-manager')

/** Internal representation of a managed session */
interface ManagedSession {
  session: AgentSession
  unsubscribe: () => void
  batcher: StreamBatcher
  /** Accumulated message history for fast IPC retrieval */
  messages: ChatMessageIPC[]
  /** Tracks the current assistant message being streamed */
  currentAssistantId: string | null
  currentAssistantContent: string
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

  constructor(onEvent: SessionEventCallback) {
    this.onEvent = onEvent
  }

  /**
   * Create a new pi SDK session for the given working directory.
   * Returns the stable session ID from the SDK (persisted on disk).
   */
  async create(cwd: string): Promise<string> {
    const loader = new DefaultResourceLoader({
      cwd: process.cwd(),
      agentDir: getAgentDir(),
      settingsManager: SettingsManager.create(),
    });
    await loader.reload();
    const { session,  extensionsResult } = await createAgentSession({
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(),
    });
    // const { session, extensionsResult } = await createAgentSession({ cwd });  
    if (extensionsResult.errors.length > 0) {
      logger.error(`[create] Extension load errors (${extensionsResult.errors.length}):`, extensionsResult.errors)
    }
    logger.info(`[create] Extensions loaded: ${extensionsResult.extensions.length}, errors: ${extensionsResult.errors.length}`)
    for (const ext of extensionsResult.extensions) {
      logger.info(`[create] Extension: ${ext.name || ext.path}`)
    }

    const sessionId = session.sessionId
    logger.info(`Create ${sessionId} cwd=${cwd}`)

    const managed = this.wrapSession(session, sessionId)
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
    // immediately, but kick off a background disk refresh as a failsafe.
    const existing = this.sessions.get(sessionId)
    if (existing) {
      logger.info(`Reconnect ${sessionId} — already in memory`)
      this.tryRefreshFromDisk(sessionId, cwd).catch(() => {})
      return existing.messages
    }

    // Discover the session file for this session ID within the project's session dir
    const infos = await SdkSessionManager.list(cwd)
    const match = infos.find(info => info.id === sessionId)
    if (!match?.path) {
      throw new Error(`Session not found on disk: ${sessionId}`)
    }

    // Open the existing session file
    const sdkSessionMgr = SdkSessionManager.open(match.path)

    // Create a new AgentSession wrapping the opened session manager
    const { session, extensionsResult } = await createAgentSession({
      cwd,
      sessionManager: sdkSessionMgr,
    })

    if (extensionsResult.errors.length > 0) {
      logger.error(`[reconnect] Extension load errors (${extensionsResult.errors.length}):`, extensionsResult.errors)
    }
    logger.info(`[reconnect] Extensions loaded: ${extensionsResult.extensions.length}, errors: ${extensionsResult.errors.length}`)
    for (const ext of extensionsResult.extensions) {
      logger.info(`[reconnect] Extension: ${ext.name || ext.path}`)
    }

    const stableId = session.sessionId
    logger.info(`Reconnected ${stableId} (requested: ${sessionId})`)

    const managed = this.wrapSession(session, stableId)

    // Populate message history from the SDK's persisted messages
    managed.messages = this.extractHistoryFromSdkMessages(session.messages)

    this.sessions.set(stableId, managed)
    return managed.messages
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

  /** Dispose a session, cleaning up subscriptions and SDK resources. */
  dispose(sessionId: string): void {
    const managed = this.getManaged(sessionId)
    managed.batcher.dispose()
    managed.unsubscribe()
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
    return available.map((m: import('@mariozechner/pi-ai').Model<any>) => ({ id: m.id, name: m.name, provider: m.provider }))
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
  private wrapSession(session: AgentSession, sessionId: string): ManagedSession {
    const batcher = new StreamBatcher((event) => {
      this.onEvent(sessionId, event)
    })

    const managed: ManagedSession = {
      session,
      unsubscribe: () => {}, // placeholder, replaced below
      batcher,
      messages: [],
      currentAssistantId: null,
      currentAssistantContent: '',
      currentToolCallId: null,
    }

    managed.unsubscribe = session.subscribe((agentEvent: AgentSessionEvent) => {
      this.handleAgentEvent(sessionId, agentEvent, batcher, managed)
    })

    return managed
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
