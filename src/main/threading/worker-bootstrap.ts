import { parentPort } from 'worker_threads'
import type { WorkerMessage, WorkerResponse, OperationType, WorkerEventMessage } from './types'
import type { AgentSessionEvent, AgentSession } from '@mariozechner/pi-coding-agent'
import { createLogger } from '../logger'
import type { SessionStreamEvent, ChatMessageIPC, ExtensionLoadError, UsageData } from '../../shared/ipc-types'

// Create logger for worker thread
const logger = createLogger('worker')

/**
 * Worker thread entry point.
 * Receives operations from main thread and executes them.
 *
 * This worker handles ALL CPU-intensive operations:
 * - Session create/reconnect/prompt (SDK operations)
 * - Session discovery (filesystem scanning)
 * - History loading from disk
 * - Model listing
 * - Workspace file I/O
 *
 * Streaming events from SDK sessions are forwarded to the main thread
 * via parentPort.postMessage() with type: 'session_event'.
 */

// ============================================================================
// Session State Management
// ============================================================================

/**
 * Internal representation of a managed session in the worker
 */
interface ManagedSession {
  session: AgentSession
  unsubscribe: () => void
  extensionErrors: ExtensionLoadError[]
  extensionsDisabled: boolean
  messages: ChatMessageIPC[]
  currentAssistantId: string | null
  currentAssistantContent: string
  currentToolCallId: string | null
  usageTotals: { input: number; output: number; totalCost: number }
}

// Active sessions in this worker
const sessions = new Map<string, ManagedSession>()

// ============================================================================
// Event Forwarding
// ============================================================================

/**
 * Emit an event to the main thread
 */
function emitEvent(sessionId: string, event: SessionStreamEvent): void {
  const message: WorkerEventMessage = {
    type: 'session_event',
    sessionId,
    event,
  }
  parentPort?.postMessage(message)
}

/**
 * Handle an agent session event and translate it to IPC format
 * This mirrors the handleAgentEvent in session-manager.ts
 */
function handleAgentEvent(sessionId: string, event: AgentSessionEvent, managed: ManagedSession): void {
  logger.debug(`handleAgentEvent: type=${event.type}`)

  switch (event.type) {
    case 'message_update': {
      const sub = event.assistantMessageEvent
      if (sub.type === 'text_delta') {
        if (!managed.currentAssistantId) {
          managed.currentAssistantId = crypto.randomUUID()
          managed.currentAssistantContent = ''
        }
        managed.currentAssistantContent += sub.delta
        emitEvent(sessionId, { type: 'text_delta', delta: sub.delta })
      }
      break
    }
    case 'message_start': {
      logger.debug(`message_start: role=${event.message?.role ?? 'unknown'}`)
      if (event.message?.role === 'user') {
        finalizeAssistantMessage(managed)
        
        let content = ''
        if (typeof event.message.content === 'string') {
          content = event.message.content
        } else if (Array.isArray(event.message.content)) {
          content = event.message.content
            .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
            .map(block => block.text)
            .join('')
        }
        
        managed.messages.push({
          id: crypto.randomUUID(),
          role: 'user',
          content,
          timestamp: Date.now(),
        })
        emitEvent(sessionId, { type: 'user_message', text: content })
      }
      break
    }
    case 'message_end': {
      logger.debug(`message_end: role=${event.message?.role ?? 'unknown'}`)
      if (managed.currentAssistantId) {
        finalizeAssistantMessage(managed)
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
        emitEvent(sessionId, { type: 'usage_update', usage: usageData })
      }
      break
    }
    case 'tool_execution_start': {
      logger.debug(`tool_execution_start: name=${event.toolName}`)
      emitEvent(sessionId, {
        type: 'tool_call',
        toolCallId: event.toolCallId ?? managed.currentToolCallId ?? crypto.randomUUID(),
        toolName: event.toolName,
        args: event.args,
      })
      
      finalizeAssistantMessage(managed)
      managed.currentToolCallId = event.toolCallId ?? crypto.randomUUID()
      
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
      logger.debug(`tool_execution_end: name=${event.toolName}`)
      emitEvent(sessionId, {
        type: 'tool_result',
        toolCallId: event.toolCallId ?? managed.currentToolCallId ?? '',
        toolName: event.toolName,
        result: event.result,
        isError: event.isError,
      })
      
      if (managed.currentToolCallId) {
        const lastMsg = managed.messages[managed.messages.length - 1]
        if (lastMsg?.toolCalls) {
          const tc = lastMsg.toolCalls.find(t => t.id === managed.currentToolCallId)
          if (tc) {
            tc.result = event.result
            tc.isError = event.isError
          }
        }
        managed.currentToolCallId = null
      }
      break
    }
    case 'agent_end': {
      finalizeAssistantMessage(managed)
      logger.debug(`agent_end: total messages=${managed.messages.length}`)
      emitEvent(sessionId, { type: 'done' })
      break
    }
    default: {
      // Handle other event types if needed
      logger.debug(`Unhandled event type: ${(event as { type: string }).type}`)
    }
  }
}

/**
 * Finalize the current assistant message being streamed
 */
function finalizeAssistantMessage(managed: ManagedSession): void {
  if (managed.currentAssistantId && managed.currentAssistantContent) {
    const assistantMsg: ChatMessageIPC = {
      id: managed.currentAssistantId,
      role: 'assistant',
      content: managed.currentAssistantContent,
      timestamp: Date.now(),
    }
    managed.messages.push(assistantMsg)
    managed.currentAssistantId = null
    managed.currentAssistantContent = ''
  }
}

// ============================================================================
// Operation Handlers
// ============================================================================

/**
 * Dispatch an operation to the appropriate handler
 */
async function dispatchOperation(type: OperationType, input: unknown): Promise<unknown> {
  switch (type) {
    // Session operations - CPU intensive SDK operations
    case 'session:create':
      return handleSessionCreate(input as { cwd: string })
    case 'session:reconnect':
      return handleSessionReconnect(input as { sessionId: string; cwd: string })
    case 'session:prompt':
      return handleSessionPrompt(input as { sessionId: string; text: string })
    case 'session:abort':
      return handleSessionAbort(input as { sessionId: string })
    case 'session:dispose':
      return handleSessionDispose(input as { sessionId: string })
    case 'session:dispose-all':
      return handleSessionDisposeAll()
    case 'session:load-history':
      return handleSessionLoadHistory(input as { sessionId: string })
    case 'session:load-history-disk':
      return handleSessionLoadHistoryDisk(input as { sessionId: string; cwd: string; limit: number })
    case 'session:list-models':
      return handleSessionListModels()
    case 'session:set-model':
      return handleSessionSetModel(input as { sessionId: string; provider: string; modelId: string })
    case 'session:get-model':
      return handleSessionGetModel(input as { sessionId: string })

    // Project operations
    case 'project:discover-sessions':
      return handleProjectDiscoverSessions(input as { path: string })
    case 'project:save-workspace':
      return handleProjectSaveWorkspace(input as {
        projectPaths: string[]
        activeSessionId: string | null
        activeProjectPath: string | null
        workspacePath: string
      })

    default:
      throw new Error(`Unknown operation type: ${type}`)
  }
}

// ============================================================================
// Session Operations
// ============================================================================

/**
 * Create a new session - CPU intensive due to extension loading
 */
async function handleSessionCreate(input: { cwd: string }): Promise<{
  sessionId: string
  extensionErrors: ExtensionLoadError[]
  extensionsDisabled: boolean
}> {
  logger.debug(`Creating session for cwd: ${input.cwd}`)

  const { loadWithFallback } = await import('../extension-loader')
  const { SessionManager: SdkSessionManager } = await import('@mariozechner/pi-coding-agent')

  const allowExtensionFallback = process.env.NEKOCODE_ALLOW_EXTENSION_FALLBACK === '1'

  const { session, extensionErrors, extensionsDisabled } = await loadWithFallback(
    'create',
    () => SdkSessionManager.create(input.cwd),
    input.cwd,
    allowExtensionFallback,
  )

  const sessionId = session.sessionId
  logger.info(`Created session ${sessionId}`)

  // Wrap session with event handling
  const managed = wrapSession(session, sessionId, extensionErrors, extensionsDisabled)
  sessions.set(sessionId, managed)

  return {
    sessionId,
    extensionErrors,
    extensionsDisabled,
  }
}

/**
 * Reconnect to an existing session - CPU intensive due to extension loading and history extraction
 */
async function handleSessionReconnect(input: {
  sessionId: string
  cwd: string
}): Promise<{
  sessionId: string
  history: ChatMessageIPC[]
  extensionErrors: ExtensionLoadError[]
  extensionsDisabled: boolean
}> {
  logger.debug(`Reconnecting session: ${input.sessionId}`)

  // Check if already in memory
  const existing = sessions.get(input.sessionId)
  if (existing) {
    return {
      sessionId: input.sessionId,
      history: existing.messages,
      extensionErrors: existing.extensionErrors,
      extensionsDisabled: existing.extensionsDisabled,
    }
  }

  const { loadWithFallback } = await import('../extension-loader')
  const { SessionManager: SdkSessionManager } = await import('@mariozechner/pi-coding-agent')
  const { extractHistoryFromSdkMessages } = await import('../message-store')

  // Find session file
  const infos = await SdkSessionManager.list(input.cwd)
  const match = infos.find(info => info.id === input.sessionId)

  if (!match?.path) {
    throw new Error(`Session not found on disk: ${input.sessionId}`)
  }

  const allowExtensionFallback = process.env.NEKOCODE_ALLOW_EXTENSION_FALLBACK === '1'

  const { session, extensionErrors, extensionsDisabled } = await loadWithFallback(
    'reconnect',
    async () => SdkSessionManager.open(match.path),
    input.cwd,
    allowExtensionFallback,
  )

  const sessionId = session.sessionId
  logger.info(`Reconnected session ${sessionId}`)

  // Extract history from SDK messages
  const messages = extractHistoryFromSdkMessages(session.messages)

  // Wrap session with event handling
  const managed = wrapSession(session, sessionId, extensionErrors, extensionsDisabled)
  managed.messages = messages
  sessions.set(sessionId, managed)

  return {
    sessionId,
    history: messages,
    extensionErrors,
    extensionsDisabled,
  }
}

/**
 * Send a prompt to a session - CPU intensive due to AI processing
 */
async function handleSessionPrompt(input: { sessionId: string; text: string }): Promise<void> {
  logger.debug(`Prompt for session: ${input.sessionId}`)

  const managed = sessions.get(input.sessionId)
  if (!managed) {
    throw new Error(`Session not found: ${input.sessionId}`)
  }

  await managed.session.prompt(input.text, { streamingBehavior: 'steer' })
}

/**
 * Abort a session's current operation
 */
function handleSessionAbort(input: { sessionId: string }): { success: boolean } {
  logger.debug(`Abort session: ${input.sessionId}`)

  const managed = sessions.get(input.sessionId)
  if (managed) {
    managed.session.abort()
  }

  return { success: true }
}

/**
 * Dispose a session
 */
function handleSessionDispose(input: { sessionId: string }): { success: boolean } {
  logger.debug(`Dispose session: ${input.sessionId}`)

  const managed = sessions.get(input.sessionId)
  if (managed) {
    managed.unsubscribe()
    managed.session.dispose()
    sessions.delete(input.sessionId)
  }

  return { success: true }
}

/**
 * Dispose all sessions
 */
function handleSessionDisposeAll(): { success: boolean } {
  logger.debug('Dispose all sessions')

  for (const [id, managed] of sessions) {
    try {
      managed.unsubscribe()
      managed.session.dispose()
    } catch (err) {
      logger.warn(`Failed to dispose session ${id}:`, err)
    }
  }
  sessions.clear()

  return { success: true }
}

/**
 * Load history from a session in memory
 */
function handleSessionLoadHistory(input: { sessionId: string }): { messages: ChatMessageIPC[] } {
  logger.debug(`Load history for session: ${input.sessionId}`)

  const managed = sessions.get(input.sessionId)
  if (!managed) {
    throw new Error(`Session not found: ${input.sessionId}`)
  }

  return { messages: [...managed.messages] }
}

/**
 * Load history from disk
 */
async function handleSessionLoadHistoryDisk(input: {
  sessionId: string
  cwd: string
  limit: number
}): Promise<{ messages: ChatMessageIPC[] }> {
  logger.debug(`Load history from disk: ${input.sessionId}`)

  const { loadHistoryFromDisk } = await import('../message-store')
  const messages = await loadHistoryFromDisk(input.sessionId, input.cwd, input.limit)

  return { messages }
}

/**
 * List available models
 */
async function handleSessionListModels(): Promise<{ models: Array<{ id: string; name: string; provider: string }> }> {
  logger.debug('Listing available models')

  const { ModelRegistry, AuthStorage } = await import('@mariozechner/pi-coding-agent')
  const authStorage = AuthStorage.create()
  const modelRegistry = ModelRegistry.create(authStorage)

  const available = modelRegistry.getAvailable()
  const models = available.map(m => ({
    id: m.id,
    name: m.name,
    provider: m.provider,
  }))

  return { models }
}

/**
 * Set model for a session
 */
async function handleSessionSetModel(input: {
  sessionId: string
  provider: string
  modelId: string
}): Promise<{ id: string; name: string; provider: string }> {
  logger.debug(`Set model for session: ${input.sessionId}`)

  const managed = sessions.get(input.sessionId)
  if (!managed) {
    throw new Error(`Session not found: ${input.sessionId}`)
  }

  const model = managed.session.modelRegistry.find(input.provider, input.modelId)
  if (!model) {
    throw new Error(`Model not found: ${input.provider}/${input.modelId}`)
  }

  await managed.session.setModel(model)

  return {
    id: model.id,
    name: model.name,
    provider: model.provider,
  }
}

/**
 * Get model for a session
 */
function handleSessionGetModel(input: { sessionId: string }): { id: string; name: string; provider: string } {
  const managed = sessions.get(input.sessionId)
  if (!managed) {
    throw new Error(`Session not found: ${input.sessionId}`)
  }

  const model = managed.session.model
  if (!model) {
    throw new Error(`No model set for session: ${input.sessionId}`)
  }

  return {
    id: model.id,
    name: model.name,
    provider: model.provider,
  }
}

// ============================================================================
// Project Operations
// ============================================================================

/**
 * Discover sessions for a path
 */
async function handleProjectDiscoverSessions(input: { path: string }): Promise<{ sessions: Array<{
  id: string
  firstMessage: string
  created: string
  messageCount: number
}> }> {
  logger.debug(`Discovering sessions for path: ${input.path}`)

  const { SessionManager } = await import('@mariozechner/pi-coding-agent')

  try {
    const sessionList = await SessionManager.list(input.path)
    return {
      sessions: sessionList
        .filter(s => s.messageCount > 0)
        .map(s => ({
          id: s.id,
          firstMessage: s.firstMessage,
          created: s.created.toISOString(),
          messageCount: s.messageCount,
        })),
    }
  } catch (err) {
    logger.error(`Failed to discover sessions for ${input.path}:`, err)
    return { sessions: [] }
  }
}

/**
 * Save workspace to disk
 */
async function handleProjectSaveWorkspace(input: {
  projectPaths: string[]
  activeSessionId: string | null
  activeProjectPath: string | null
  workspacePath: string
}): Promise<{ success: boolean }> {
  logger.debug('Saving workspace...')

  const { writeFile, mkdir } = await import('fs/promises')
  const { dirname } = await import('path')

  try {
    const state = JSON.stringify({
      projectPaths: input.projectPaths,
      activeSessionId: input.activeSessionId,
      activeProjectPath: input.activeProjectPath,
    }, null, 2)

    await mkdir(dirname(input.workspacePath), { recursive: true })
    await writeFile(input.workspacePath, state, 'utf-8')

    return { success: true }
  } catch (err) {
    logger.error('Failed to save workspace:', err)
    throw err
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Wrap an AgentSession with event handling
 */
function wrapSession(
  session: AgentSession,
  sessionId: string,
  extensionErrors: ExtensionLoadError[],
  extensionsDisabled: boolean,
): ManagedSession {
  const managed: ManagedSession = {
    session,
    unsubscribe: () => {},
    extensionErrors,
    extensionsDisabled,
    messages: [],
    currentAssistantId: null,
    currentAssistantContent: '',
    currentToolCallId: null,
    usageTotals: { input: 0, output: 0, totalCost: 0 },
  }

  // Subscribe to session events
  managed.unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    handleAgentEvent(sessionId, event, managed)
  })

  return managed
}

// ============================================================================
// Message Handler
// ============================================================================

parentPort?.on('message', async (message: WorkerMessage) => {
  const { id, type, input } = message

  logger.debug(`Received operation: ${type}`)

  try {
    const result = await dispatchOperation(type, input)

    const response: WorkerResponse = {
      id,
      success: true,
      result,
    }
    parentPort?.postMessage(response)
  } catch (error: unknown) {
    logger.error(`Operation ${type} failed:`, error)

    const response: WorkerResponse = {
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
    parentPort?.postMessage(response)
  }
})

logger.info('Worker thread initialized')
