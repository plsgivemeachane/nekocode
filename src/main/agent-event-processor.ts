/**
 * AgentEventProcessor — Shared logic for processing SDK agent events.
 *
 * This module eliminates the duplication between session-manager.ts and
 * worker-bootstrap.ts, both of which had near-identical handleAgentEvent()
 * functions (~200 lines of duplicated switch/case logic).
 *
 * Architecture:
 * - ManagedSession interface: shared session state (messages, streaming state, usage)
 * - AgentEventProcessor class: processes AgentSessionEvent objects, updates
 *   ManagedSession state, and emits SessionStreamEvents via a callback
 *
 * The processor is agnostic to the transport layer — the caller provides an
 * `emit` callback that can forward events to a StreamBatcher (main thread) or
 * parentPort.postMessage() (worker thread).
 */

import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import type { ContextUsage } from '@earendil-works/pi-coding-agent'
import type { SessionStreamEvent, ChatMessageIPC, UsageData, ExtensionLoadError } from '../shared/ipc-types'
import { extractTextContent } from './text-extractor'
import { createLogger } from './logger'

const logger = createLogger('agent-event-processor')

// ============================================================================
// ManagedSession — Shared session state interface
// ============================================================================

/**
 * Internal representation of a managed session.
 * Shared between PiSessionManager (main thread) and worker-bootstrap (worker thread).
 *
 * This interface captures only the event-processing state. Callers may extend
 * it with additional fields (e.g., batcher, previousFileContent) via their own
 * extended interfaces.
 */
export interface ManagedSession {
  /** The underlying SDK session */
  session: {
    getContextUsage(): ContextUsage | undefined
  }
  /** Unsubscribe function for the session's event stream */
  unsubscribe: () => void
  /** Extension load errors from session creation */
  extensionErrors: ExtensionLoadError[]
  /** Whether extensions were disabled for this session */
  extensionsDisabled: boolean
  /** Accumulated message history for fast IPC retrieval */
  messages: ChatMessageIPC[]
  /** Tracks the current assistant message being streamed */
  currentAssistantId: string | null
  currentAssistantContent: string
  /** Tracks the current thinking content being streamed */
  currentThinkingId: string | null
  currentThinkingContent: string
  /** Tracks the current tool call being executed */
  currentToolCallId: string | null
  /** Cumulative token usage across all assistant messages */
  usageTotals: { input: number; output: number; totalCost: number }
  /** Electron-specific UI context for forwarding extension UI requests to renderer */
  uiContext: import('./electron-ui-context').ElectronUIContext
}

// ============================================================================
// AgentEventProcessor — Processes agent events and emits stream events
// ============================================================================

/**
 * Configuration for the event processor.
 * Controls optional behaviors that differ between main thread and worker thread.
 */
export interface AgentEventProcessorOptions {
  /**
   * Called for batchable events (text_delta, thinking_start, thinking_delta, thinking_end)
   * BEFORE the emit callback. Use this to push events into a StreamBatcher.
   * The emit callback is called AFTER this, so for batchable events you should
   * typically have emit be a no-op and let the batcher handle delivery on flush.
   */
  onBatchableEvent?: (event: SessionStreamEvent) => void

  /**
   * Called when a flush is needed (e.g., before tool_execution_start, agent_end).
   * Use this to flush a StreamBatcher. Worker thread can leave this unset.
   */
  onFlush?: () => void

  /**
   * Whether to capture previous file content for write/edit tools.
   * Only the main thread (session-manager) needs this since it has filesystem
   * access with the project root. Worker thread does not capture diffs.
   */
  capturePreviousFileContent?: boolean

  /**
   * Read file content for diff capture. Only used when capturePreviousFileContent is true.
   * Must return the file content as a string, or throw if the file doesn't exist.
   */
  readFileContent?: (filePath: string) => string | null

  /**
   * Check if a file exists. Only used when capturePreviousFileContent is true.
   */
  fileExists?: (filePath: string) => boolean

  /**
   * Whether to emit a 'user_message' event on message_start with role='user'.
   * Worker thread emits this for the renderer; main thread does not
   * (it relies on the prompt() call itself).
   */
  emitUserMessage?: boolean
}

/**
 * AgentEventProcessor processes SDK agent session events, updates ManagedSession
 * state (messages, usage, streaming state), and emits SessionStreamEvents.
 *
 * Usage:
 *   const processor = new AgentEventProcessor(emitCallback, options)
 *   processor.handleAgentEvent(sessionId, event, managed)
 *   processor.finalizeAssistantMessage(managed)
 *   processor.finalizeThinkingMessage(managed)
 */
export class AgentEventProcessor {
  private readonly emit: (sessionId: string, event: SessionStreamEvent) => void
  private readonly options: AgentEventProcessorOptions

  constructor(
    emit: (sessionId: string, event: SessionStreamEvent) => void,
    options: AgentEventProcessorOptions = {},
  ) {
    this.emit = emit
    this.options = options
  }

  /**
   * Process an agent session event and translate it to IPC format.
   *
   * This is the shared logic previously duplicated between session-manager.ts
   * and worker-bootstrap.ts. It:
   * 1. Updates the managed session's message history
   * 2. Emits stream events for the renderer
   * 3. Tracks usage, thinking, and tool call state
   *
   * Also accumulates messages into the managed session's history.
   */
  handleAgentEvent(
    sessionId: string,
    event: AgentSessionEvent,
    managed: ManagedSession,
  ): void {
    logger.debug(`handleAgentEvent: type=${event.type}`)

    // Helper to safely call onFlush with error boundary
    const safeOnFlush = () => {
      try {
        this.options.onFlush?.()
      } catch (err) {
        logger.error('onFlush callback threw:', err)
      }
    }

    const emitEvent = (streamEvent: SessionStreamEvent, batchable = false) => {
      logger.debug(`emit: ${streamEvent.type}${batchable ? ' (batchable)' : ''}`)
      if (batchable && this.options.onBatchableEvent) {
        // Batchable events go through onBatchableEvent (e.g., StreamBatcher.push)
        // They are NOT sent through the direct emit callback — the batcher
        // handles delivery on flush.
        try {
          this.options.onBatchableEvent(streamEvent)
        } catch (err) {
          // Error boundary: prevent a throwing batch handler from crashing event processing
          logger.error('onBatchableEvent threw:', err)
        }
      } else {
        // Immediate events go through the emit callback directly.
        // Also, batchable events without an onBatchableEvent handler
        // fall through to direct emit (e.g., worker thread with no batcher).
        try {
          this.emit(sessionId, streamEvent)
        } catch (err) {
          // Error boundary: prevent a throwing emit callback from crashing event processing
          logger.error('emit callback threw:', err)
        }
      }
    }

    switch (event.type) {
      case 'message_update': {
        const sub = event.assistantMessageEvent
        if (sub.type === 'text_delta') {
          if (!managed.currentAssistantId) {
            managed.currentAssistantId = crypto.randomUUID()
            managed.currentAssistantContent = ''
          }
          // Guard: if the text_delta event has no text field, treat it as empty
          // instead of propagating undefined to the renderer
          const delta = sub.delta ?? ''
          managed.currentAssistantContent += delta
          emitEvent({ type: 'text_delta', delta }, true)
        } else if (sub.type === 'thinking_start') {
          if (!managed.currentThinkingId) {
            managed.currentThinkingId = crypto.randomUUID()
            managed.currentThinkingContent = ''
          }
          emitEvent({ type: 'thinking_start' }, true)
        } else if (sub.type === 'thinking_delta') {
          if (!managed.currentThinkingId) {
            managed.currentThinkingId = crypto.randomUUID()
            managed.currentThinkingContent = ''
          }
          managed.currentThinkingContent += sub.delta
          emitEvent({ type: 'thinking_delta', delta: sub.delta }, true)
        } else if (sub.type === 'thinking_end') {
          emitEvent({ type: 'thinking_end' }, true)
          if (managed.currentThinkingId) {
            managed.messages.push({
              id: managed.currentThinkingId,
              role: 'assistant',
              content: managed.currentThinkingContent,
              timestamp: Date.now(),
              thinking: true,
            })
            managed.currentThinkingId = null
            managed.currentThinkingContent = ''
          }
        }
        break
      }
      case 'message_start': {
        logger.debug(`message_start: role=${event.message?.role ?? 'unknown'}`)
        if (event.message?.role === 'user') {
          this.finalizeThinkingMessage(managed)
          this.finalizeAssistantMessage(managed)
          // Use shared text-extractor instead of inline content extraction
          const content = extractTextContent(event.message.content)
          managed.messages.push({
            id: crypto.randomUUID(),
            role: 'user',
            content,
            timestamp: Date.now(),
          })
          logger.debug(`message_start: recorded user message, content=${content.length} chars, total=${managed.messages.length}`)

          // Worker thread emits user_message event; main thread doesn't need to
          if (this.options.emitUserMessage) {
            emitEvent({ type: 'user_message', text: content })
          }
        }
        break
      }
      case 'message_end': {
        logger.debug(`message_end: role=${event.message?.role ?? 'unknown'}`)
        if (managed.currentAssistantId) {
          this.finalizeAssistantMessage(managed)
        }
        if (event.message?.role === 'assistant' && 'usage' in event.message && event.message.usage) {
          const usage = event.message.usage as { input: number; output: number; cost: { total: number } }
          managed.usageTotals.input += usage.input
          managed.usageTotals.output += usage.output
          managed.usageTotals.totalCost += usage.cost.total

          // Store per-message usage in the last assistant message
          const lastMsg = managed.messages[managed.messages.length - 1]
          if (lastMsg && lastMsg.role === 'assistant') {
            lastMsg.usage = {
              inputTokens: usage.input,
              outputTokens: usage.output,
              totalCost: usage.cost.total,
            }
          }

          const ctxUsage = managed.session.getContextUsage()
          const usageData: UsageData = {
            inputTokens: managed.usageTotals.input,
            outputTokens: managed.usageTotals.output,
            totalCost: managed.usageTotals.totalCost,
            contextPercent: ctxUsage?.percent ?? 0,
            contextWindow: ctxUsage?.contextWindow ?? 0,
          }
          emitEvent({ type: 'usage_update', usage: usageData })
        }
        break
      }
      case 'tool_execution_start': {
        // Flush any pending streamed content before emitting tool events
        safeOnFlush()
        logger.debug(`tool_execution_start: name=${event.toolName}, id=${event.toolCallId}, args=${JSON.stringify(event.args)?.slice(0, 200)}`)
        emitEvent({ type: 'tool_call', toolCallId: event.toolCallId ?? managed.currentToolCallId ?? crypto.randomUUID(), toolName: event.toolName, args: event.args })
        this.finalizeThinkingMessage(managed)
        this.finalizeAssistantMessage(managed)
        managed.currentToolCallId = event.toolCallId ?? crypto.randomUUID()

        // Capture previous file content for write/edit tools so the renderer
        // can show diffs. We read the file BEFORE the tool modifies it.
        // Only enabled when capturePreviousFileContent is true (main thread).
        if (this.options.capturePreviousFileContent && this.options.readFileContent && this.options.fileExists) {
          const shortToolName = event.toolName.replace(/^toolcall_/, '')
          if ((shortToolName === 'write' || shortToolName === 'edit') && event.args) {
            try {
              const args = event.args as Record<string, unknown>
              const filePath = typeof args.path === 'string' ? args.path : null
              if (filePath && this.options.fileExists(filePath)) {
                const prevContent = this.options.readFileContent(filePath)
                if (prevContent !== null) {
                  // Store in the managed session's previousFileContent map
                  this.storePreviousFileContent(managed, managed.currentToolCallId, prevContent)
                  logger.debug(`Captured previous content for ${filePath} (${prevContent.length} chars) before ${shortToolName}`)
                }
              } else if (filePath) {
                // File doesn't exist yet — it's a new file creation
                this.storePreviousFileContent(managed, managed.currentToolCallId, '')
                logger.debug(`No previous content for ${filePath} (new file) before ${shortToolName}`)
              }
            } catch (err) {
              logger.warn(`Failed to capture previous content for ${event.toolName}:`, err)
            }
          }
        }

        const lastMsg = managed.messages[managed.messages.length - 1]
        if (lastMsg && lastMsg.role === 'assistant') {
          if (!lastMsg.toolCalls) lastMsg.toolCalls = []
          lastMsg.toolCalls.push({
            id: managed.currentToolCallId,
            name: event.toolName,
            args: event.args,
          })
        } else {
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
      case 'tool_execution_end': {
        // Flush any pending streamed content before emitting tool results
        safeOnFlush()
        logger.debug(`tool_execution_end: name=${event.toolName}, id=${event.toolCallId}, isError=${event.isError}, result=${JSON.stringify(event.result)?.slice(0, 200)}`)

        // Inject previousContent into tool result for write/edit tools so the
        // renderer can display diffs between old and new file content.
        let enrichedResult = event.result
        const toolCallId = event.toolCallId ?? managed.currentToolCallId ?? ''
        const previousContent = this.getPreviousFileContent(managed, toolCallId)
        if (previousContent !== undefined) {
          this.deletePreviousFileContent(managed, toolCallId)
          // Preserve the existing result structure but add previousContent
          if (typeof enrichedResult === 'object' && enrichedResult !== null) {
            enrichedResult = { ...(enrichedResult as Record<string, unknown>), previousContent }
          } else {
            // If result is a simple string (e.g. "File written successfully"),
            // wrap it in an object with both the message and previousContent
            enrichedResult = { message: String(enrichedResult), previousContent }
          }
          logger.debug(`Injected previousContent (${previousContent.length} chars) into tool result for ${event.toolName}`)
        }

        emitEvent({
          type: 'tool_result',
          toolCallId: toolCallId,
          toolName: event.toolName,
          result: enrichedResult,
          isError: event.isError,
        })
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
      }
      case 'agent_end':
        safeOnFlush()
        this.finalizeThinkingMessage(managed)
        this.finalizeAssistantMessage(managed)
        logger.debug(`agent_end: total accumulated messages=${managed.messages.length}`)
        emitEvent({ type: 'done' })
        break
      case 'turn_start': {
        // A new turn is starting (e.g. after tool execution).
        // Emit agent_start so the renderer updates status to "Working".
        logger.debug('turn_start: emitting agent_start for continued work')
        emitEvent({ type: 'agent_start' })
        break
      }
      case 'turn_end':
        break
      case 'agent_start':
        safeOnFlush()
        logger.debug('agent_start: flushing batcher, emitting agent_start')
        emitEvent({ type: 'agent_start' })
        break
      default:
        logger.debug(`unhandled event type: ${(event as { type: string }).type}`)
        break
    }
  }

  /**
   * Finalize the current in-progress assistant message.
   * Called on message_end, agent_end, or before a new user message.
   */
  finalizeAssistantMessage(managed: ManagedSession): void {
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

  /**
   * Finalize the current in-progress thinking message.
   * Called on tool_execution_start, agent_end, or before a new user message.
   */
  finalizeThinkingMessage(managed: ManagedSession): void {
    if (!managed.currentThinkingId) return
    logger.debug(`finalizeThinkingMessage: id=${managed.currentThinkingId} content=${managed.currentThinkingContent.length} chars`)
    managed.messages.push({
      id: managed.currentThinkingId,
      role: 'assistant',
      content: managed.currentThinkingContent,
      timestamp: Date.now(),
      thinking: true,
    })
    logger.debug(`finalizeThinkingMessage: total messages now ${managed.messages.length}`)
    managed.currentThinkingId = null
    managed.currentThinkingContent = ''
  }

  // =========================================================================
  // Previous file content management (for diff display)
  //
  // These methods use a type assertion to access the previousFileContent Map
  // on sessions that support it (main thread). Worker thread sessions don't
  // have this field and these methods are no-ops.
  // =========================================================================

  private storePreviousFileContent(managed: ManagedSession, toolCallId: string, content: string): void {
    const extended = managed as ManagedSession & { previousFileContent?: Map<string, string> }
    if (extended.previousFileContent) {
      extended.previousFileContent.set(toolCallId, content)
    }
  }

  private getPreviousFileContent(managed: ManagedSession, toolCallId: string): string | undefined {
    const extended = managed as ManagedSession & { previousFileContent?: Map<string, string> }
    return extended.previousFileContent?.get(toolCallId)
  }

  private deletePreviousFileContent(managed: ManagedSession, toolCallId: string): void {
    const extended = managed as ManagedSession & { previousFileContent?: Map<string, string> }
    extended.previousFileContent?.delete(toolCallId)
  }
}
