import {
  createAgentSession,
  SessionManager as SdkSessionManager,
  type AgentSession,
  type AgentSessionEvent,
} from '@mariozechner/pi-coding-agent'
import { StreamBatcher } from './stream-batcher'
import type { SessionStreamEvent, ChatMessageIPC } from '../shared/ipc-types'

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
    const { session } = await createAgentSession({ cwd })
    const sessionId = session.sessionId
    console.log(`[session] create ${sessionId} cwd=${cwd}`)

    const managed = this.wrapSession(session, sessionId)
    this.sessions.set(sessionId, managed)
    console.log(`[session] created ${sessionId}`)
    return sessionId
  }

  /**
   * Reconnect to an existing session by its stable ID.
   * Opens the session file from disk and creates a new AgentSession wrapping it.
   * Populates message history from the SDK's persisted messages.
   */
  async reconnect(sessionId: string, cwd: string): Promise<ChatMessageIPC[]> {
    console.log(`[session] reconnect ${sessionId} cwd=${cwd}`)

    // Discover the session file for this session ID within the project's session dir
    const infos = await SdkSessionManager.list(cwd)
    const match = infos.find(info => info.id === sessionId)
    if (!match?.path) {
      throw new Error(`Session not found on disk: ${sessionId}`)
    }

    // Open the existing session file
    const sdkSessionMgr = SdkSessionManager.open(match.path)

    // Create a new AgentSession wrapping the opened session manager
    const { session } = await createAgentSession({
      cwd,
      sessionManager: sdkSessionMgr,
    })

    const stableId = session.sessionId
    console.log(`[session] reconnected ${stableId} (requested: ${sessionId})`)

    const managed = this.wrapSession(session, stableId)

    // Populate message history from the SDK's persisted messages
    managed.messages = this.extractHistoryFromSdkMessages(session.messages)

    this.sessions.set(stableId, managed)
    return managed.messages
  }

  /** Send a user prompt to an active session. */
  async prompt(sessionId: string, text: string): Promise<void> {
    const managed = this.getManaged(sessionId)
    await managed.session.prompt(text, { streamingBehavior: 'steer' })
  }

  /** Abort the current streaming response. */
  abort(sessionId: string): void {
    const managed = this.getManaged(sessionId)
    managed.session.abort()
    console.log(`[session] abort ${sessionId}`)
  }

  /** Get the accumulated message history for a session. */
  getHistory(sessionId: string): ChatMessageIPC[] {
    const managed = this.getManaged(sessionId)
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
    console.log(`[session] dispose ${sessionId}`)
  }

  /** Dispose all active sessions. Called on app quit. */
  disposeAll(): void {
    for (const [id] of this.sessions) {
      this.dispose(id)
    }
  }

  /** Get the number of active sessions. */
  get sessionCount(): number {
    return this.sessions.size
  }

  private getManaged(sessionId: string): ManagedSession {
    const managed = this.sessions.get(sessionId)
    if (!managed) {
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
    const result: ChatMessageIPC[] = []
    for (const msg of sdkMessages) {
      // Only process messages with user or assistant role
      const role = msg.role
      if (role !== 'user' && role !== 'assistant') continue

      let content = ''
      if (role === 'user') {
        // UserMessage.content: string | (TextContent | ImageContent)[]
        const userContent = (msg as any).content
        if (typeof userContent === 'string') {
          content = userContent
        } else if (Array.isArray(userContent)) {
          content = userContent
            .filter((block: any) => block.type === 'text')
            .map((block: any) => block.text)
            .join('')
        }
      } else {
        // AssistantMessage.content: (TextContent | ThinkingContent | ToolCall)[]
        const assistantContent = (msg as any).content
        if (Array.isArray(assistantContent)) {
          content = assistantContent
            .filter((block: any) => block.type === 'text')
            .map((block: any) => block.text)
            .join('')
        }
      }

      // Extract tool calls from assistant messages
      let toolCalls: ChatMessageIPC['toolCalls']
      if (role === 'assistant') {
        const assistantContent = (msg as any).content
        if (Array.isArray(assistantContent)) {
          const tcBlocks = assistantContent.filter((block: any) => block.type === 'toolcall')
          if (tcBlocks.length > 0) {
            toolCalls = tcBlocks.map((tc: any) => ({
              id: tc.id ?? crypto.randomUUID(),
              name: tc.function?.name ?? tc.name ?? 'unknown',
              args: tc.function?.arguments ? JSON.parse(tc.function.arguments) : tc.args,
            }))
          }
        }
      }

      result.push({
        id: (msg as any).id ?? crypto.randomUUID(),
        role: role as 'user' | 'assistant',
        content,
        toolCalls,
        timestamp: (msg as any).timestamp ?? Date.now(),
      })
    }
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
    const emit = (streamEvent: SessionStreamEvent) => {
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
        // Check if this is a user message start — if so, flush any pending assistant
        if (event.message?.role === 'user') {
          this.finalizeAssistantMessage(managed)
          // Record the user message
          let content = ''
          if (typeof event.message.content === 'string') {
            content = event.message.content
          } else if (Array.isArray(event.message.content)) {
            content = event.message.content
              .filter((block: any) => block.type === 'text')
              .map((block: any) => block.text)
              .join('')
          }
          managed.messages.push({
            id: (event.message as any).id ?? crypto.randomUUID(),
            role: 'user',
            content,
            timestamp: Date.now(),
          })
        }
        break
      }
      case 'message_end': {
        // Finalize the assistant message when the message ends
        if (managed.currentAssistantId) {
          this.finalizeAssistantMessage(managed)
        }
        break
      }
      case 'tool_execution_start':
        batcher.flush()
        emit({ type: 'tool_call', toolName: event.toolName, args: event.args })
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
      case 'tool_execution_end':
        batcher.flush()
        emit({
          type: 'tool_result',
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
        emit({ type: 'done' })
        break
      case 'turn_end':
        // turn_end fires per turn; agent_end fires when fully done.
        // We emit 'done' on agent_end, so turn_end is just a no-op here.
        break
      default:
        // agent_start, turn_start, tool_execution_update
        // are internal bookkeeping — not useful for the renderer.
        break
    }
  }

  /**
   * Finalize the current in-progress assistant message.
   * Called on message_end, agent_end, or before a new user message.
   */
  private finalizeAssistantMessage(managed: ManagedSession): void {
    if (!managed.currentAssistantId) return
    managed.messages.push({
      id: managed.currentAssistantId,
      role: 'assistant',
      content: managed.currentAssistantContent,
      timestamp: Date.now(),
    })
    managed.currentAssistantId = null
    managed.currentAssistantContent = ''
  }
}
