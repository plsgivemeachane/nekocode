import { createAgentSession, type AgentSession, type AgentSessionEvent } from '@mariozechner/pi-coding-agent'
import { StreamBatcher } from './stream-batcher'
import type { SessionStreamEvent } from '../shared/ipc-types'

/** Internal representation of a managed session */
interface ManagedSession {
  session: AgentSession
  unsubscribe: () => void
  batcher: StreamBatcher
}

/** Callback type for emitting events to the renderer */
export type SessionEventCallback = (sessionId: string, event: SessionStreamEvent) => void

/**
 * Manages pi SDK sessions. Creates, subscribes, and disposes sessions.
 * Per D006: sessions are stored in an in-memory Map with no persistence.
 *
 * Session lifecycle:
 *   create(cwd) -> subscribe to events -> prompt(text) -> ... -> dispose()
 */
export class PiSessionManager {
  private sessions = new Map<string, ManagedSession>()
  private nextId = 1
  private readonly onEvent: SessionEventCallback

  constructor(onEvent: SessionEventCallback) {
    this.onEvent = onEvent
  }

  /**
   * Create a new pi SDK session for the given working directory.
   * Returns the session ID used for all subsequent operations.
   */
  async create(cwd: string): Promise<string> {
    const sessionId = `session-${this.nextId++}`
    console.log(`[session] create ${sessionId} cwd=${cwd}`)

    const { session } = await createAgentSession({ cwd })

    const batcher = new StreamBatcher((event) => {
      this.onEvent(sessionId, event)
    })

    const unsubscribe = session.subscribe((agentEvent: AgentSessionEvent) => {
      this.handleAgentEvent(sessionId, agentEvent, batcher)
    })

    this.sessions.set(sessionId, { session, unsubscribe, batcher })
    console.log(`[session] created ${sessionId}`)
    return sessionId
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
   * Translate AgentSessionEvent into simplified SessionStreamEvent for the renderer.
   * text_delta events go through the batcher; everything else passes through directly.
   */
  private handleAgentEvent(
    sessionId: string,
    event: AgentSessionEvent,
    batcher: StreamBatcher,
  ): void {
    const emit = (streamEvent: SessionStreamEvent) => {
      this.onEvent(sessionId, streamEvent)
    }

    switch (event.type) {
      case 'message_update': {
        const sub = event.assistantMessageEvent
        if (sub.type === 'text_delta') {
          batcher.push({ type: 'text_delta', delta: sub.delta })
        }
        break
      }
      case 'tool_execution_start':
        batcher.flush()
        emit({ type: 'tool_call', toolName: event.toolName, args: event.args })
        break
      case 'tool_execution_end':
        batcher.flush()
        emit({
          type: 'tool_result',
          toolName: event.toolName,
          result: event.result,
          isError: event.isError,
        })
        break
      case 'agent_end':
        batcher.flush()
        emit({ type: 'done' })
        break
      case 'turn_end':
        // turn_end fires per turn; agent_end fires when fully done.
        // We emit 'done' on agent_end, so turn_end is just a no-op here.
        break
      default:
        // agent_start, turn_start, message_start, message_end, tool_execution_update
        // are internal bookkeeping — not useful for the renderer.
        break
    }
  }
}
