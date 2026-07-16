import { SessionManager as SdkSessionManager } from '@earendil-works/pi-coding-agent'
import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import { unlinkSync, readFileSync, existsSync } from 'fs'
import { StreamBatcher } from './stream-batcher'
import type { SessionStreamEvent, ChatMessageIPC, CommandInfo, ModelInfo, ExtensionLoadError, UsageData, UIResponse } from '../shared/ipc-types'
import { createLogger } from './logger'
import { createSecureAuthStorage } from './secure-key-store'
import { loadWithFallback } from './extension-loader'
import { ElectronUIContext, MainThreadUITransport } from './electron-ui-context'
import { extractHistoryFromSdkMessages, loadHistoryFromDisk as loadHistoryFromDiskImpl } from './message-store'
import { AgentEventProcessor, ManagedSession as BaseManagedSession } from './agent-event-processor'

const logger = createLogger('session-manager')

/** Internal representation of a managed session.
 * Extends the shared ManagedSession with main-thread-specific fields. */
interface ManagedSession extends BaseManagedSession {
  session: AgentSession
  batcher: StreamBatcher
  /** Whether the user has sent at least one prompt in this session */
  hasPrompted: boolean
  /** Previous file content before write/edit tool execution (toolCallId -> previousContent) */
  previousFileContent: Map<string, string>
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
  private allowExtensionFallback: boolean
  private onEvent: SessionEventCallback
  /** Shared agent event processor — eliminates duplication with worker-bootstrap */
  private agentEventProcessor: AgentEventProcessor

  constructor(onEvent: SessionEventCallback) {
    this.onEvent = onEvent
    this.allowExtensionFallback = process.env.NEKOCODE_ALLOW_EXTENSION_FALLBACK === '1'

    // Create the shared event processor with main-thread-specific options:
    // - onBatchableEvent: push text_delta/thinking events into StreamBatcher for batching
    // - onFlush: flush the StreamBatcher before tool events and agent_end
    // - capturePreviousFileContent: read file content before write/edit tools for diff display
    this.agentEventProcessor = new AgentEventProcessor(
      (sessionId, event) => this.onEvent(sessionId, event),
      {
        capturePreviousFileContent: true,
        readFileContent: (filePath) => {
          try { return readFileSync(filePath, 'utf-8') } catch { return null }
        },
        fileExists: (filePath) => existsSync(filePath),
      },
    )
  }

  /**
   * Create a new agent session for the given working directory.
   * Returns the stable session ID from the SDK (persisted on disk).
   */
  async create(cwd: string): Promise<string> {
    const { session, extensionErrors, extensionsDisabled } = await loadWithFallback(
      'create',
      () => SdkSessionManager.create(cwd),
      cwd,
      this.allowExtensionFallback,
    )

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
      logger.info(`Reconnect ${sessionId} - already in memory`)
      try {
        const diskMessages = await loadHistoryFromDiskImpl(sessionId, cwd, 0)
        if (diskMessages.length > existing.messages.length) {
          logger.info(`Reconnect ${sessionId} - refreshed in-memory history ${existing.messages.length} -> ${diskMessages.length}`)
          existing.messages = diskMessages
          // Recalculate usageTotals from refreshed messages
          existing.usageTotals = { input: 0, output: 0, totalCost: 0 }
          for (const msg of existing.messages) {
            if (msg.role === 'assistant' && msg.usage) {
              existing.usageTotals.input += msg.usage.inputTokens
              existing.usageTotals.output += msg.usage.outputTokens
              existing.usageTotals.totalCost += msg.usage.totalCost
            }
          }
        }
      } catch (err) {
        logger.debug(`Reconnect ${sessionId} - disk reconciliation failed: ${err}`)
      }
      // Emit current usage to ensure stats bar is updated
      if (existing.usageTotals.input > 0 || existing.usageTotals.output > 0 || existing.usageTotals.totalCost > 0) {
        const ctxUsage = existing.session.getContextUsage()
        const usageData: UsageData = {
          inputTokens: existing.usageTotals.input,
          outputTokens: existing.usageTotals.output,
          totalCost: existing.usageTotals.totalCost,
          contextPercent: ctxUsage?.percent ?? 0,
          contextWindow: ctxUsage?.contextWindow ?? 0,
        }
        this.onEvent(sessionId, { type: 'usage_update', usage: usageData })
      }
      return existing.messages
    }

    // Discover the session file for this session ID within the project's session dir
    const infos = await SdkSessionManager.list(cwd)
    const match = infos.find(info => info.id === sessionId)
    if (!match?.path) {
      throw new Error(`Session not found on disk: ${sessionId}`)
    }

    const { session, extensionErrors, extensionsDisabled } = await loadWithFallback(
      'reconnect',
      () => SdkSessionManager.open(match.path),
      cwd,
      this.allowExtensionFallback,
    )

    const stableId = session.sessionId
    logger.info(`Reconnected ${stableId} (requested: ${sessionId})`)

    const managed = this.wrapSession(session, stableId, extensionErrors, extensionsDisabled)

    // Populate message history from the SDK's persisted messages
    managed.messages = extractHistoryFromSdkMessages(session.messages)

    // Restore cumulative usageTotals from loaded messages
    for (const msg of managed.messages) {
      if (msg.role === 'assistant' && msg.usage) {
        managed.usageTotals.input += msg.usage.inputTokens
        managed.usageTotals.output += msg.usage.outputTokens
        managed.usageTotals.totalCost += msg.usage.totalCost
      }
    }

    // Emit restored usage to renderer so stats bar is updated
    if (managed.usageTotals.input > 0 || managed.usageTotals.output > 0 || managed.usageTotals.totalCost > 0) {
      const ctxUsage = managed.session.getContextUsage()
      const usageData: UsageData = {
        inputTokens: managed.usageTotals.input,
        outputTokens: managed.usageTotals.output,
        totalCost: managed.usageTotals.totalCost,
        contextPercent: ctxUsage?.percent ?? 0,
        contextWindow: ctxUsage?.contextWindow ?? 0,
      }
      this.onEvent(stableId, { type: 'usage_update', usage: usageData })
    }

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
   * Get all available slash commands for a session.
   * Combines builtin commands, extension commands, skills, and prompts.
   */
  getCommands(sessionId: string): CommandInfo[] {
    const managed = this.sessions.get(sessionId)
    if (!managed) return []

    const commands: CommandInfo[] = []
    const seen = new Set<string>()

    // 1. Collect extension commands from the ExtensionRunner
    try {
      const runner = managed.session.extensionRunner
      if (runner) {
        const resolved = runner.getRegisteredCommands()
        for (const cmd of resolved) {
          if (!seen.has(cmd.invocationName)) {
            seen.add(cmd.invocationName)
            commands.push({
              name: cmd.invocationName,
              description: cmd.description,
              source: 'extension',
            })
          }
        }
      }
    } catch {
      // ExtensionRunner may not be available if extensions are disabled
    }

    // 2. Collect skills from the ResourceLoader
    try {
      const loader = managed.session.resourceLoader
      if (loader) {
        const { skills } = loader.getSkills()
        for (const skill of skills) {
          const name = `skill:${skill.name}`
          if (!seen.has(name)) {
            seen.add(name)
            commands.push({
              name,
              description: skill.description,
              source: 'skill',
            })
          }
        }

        // 3. Collect prompt templates
        const { prompts } = loader.getPrompts()
        for (const prompt of prompts) {
          if (!seen.has(prompt.name)) {
            seen.add(prompt.name)
            commands.push({
              name: prompt.name,
              description: prompt.description,
              source: 'prompt',
            })
          }
        }
      }
    } catch {
      // ResourceLoader may not be available
    }

    return commands
  }

  /**
   * Handle a UI response from the renderer (user interacted with a dialog).
   * Forwards the response to the ElectronUIContext which resolves the pending promise.
   */
  handleUIResponse(response: UIResponse): void {
    const managed = this.sessions.get(response.sessionId)
    if (!managed) {
      logger.warn(`handleUIResponse: session not found ${response.sessionId}`)
      return
    }
    managed.uiContext.handleResponse(response)
  }

  /** Send a user prompt to an active session. */
  async prompt(sessionId: string, text: string): Promise<void> {
    // Security: Do not log user prompt text — may contain sensitive data (passwords, API keys, PII)
    // Log only the session ID and prompt length for debugging
    logger.info(`Prompt ${sessionId} textLength=${text.length}`)
    const managed = this.getManaged(sessionId)
    logger.debug(`Prompt ${sessionId} - streaming state: currentAssistantId=${managed.currentAssistantId ?? 'none'}, currentToolCallId=${managed.currentToolCallId ?? 'none'}`)
    if (!managed.hasPrompted) {
      this.onEvent(sessionId, { type: 'user_message', text })
      managed.hasPrompted = true
    }
    await managed.session.prompt(text, { streamingBehavior: 'steer' })
    logger.debug(`Prompt ${sessionId} - SDK prompt() returned (streaming initiated)`)
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
    logger.debug(`getHistory ${sessionId} - returning ${managed.messages.length} message(s)`)
    return [...managed.messages]
  }

  /**
   * Load message history from disk WITHOUT creating an agent session.
   * Lightweight alternative to reconnect() - just reads the session file and extracts messages.
   * Used for preloading session timelines in the sidebar.
   * @param limit Max number of recent messages to return (0 = all)
   */
  async loadHistoryFromDisk(sessionId: string, cwd: string, limit: number = 0): Promise<ChatMessageIPC[]> {
    return loadHistoryFromDiskImpl(sessionId, cwd, limit)
  }

  /** Delete a session file from disk and dispose it if active. */
  async deleteSession(sessionId: string, cwd: string): Promise<void> {
    if (this.sessions.has(sessionId)) {
      this.dispose(sessionId)
    }
    const infos = await SdkSessionManager.list(cwd)
    const match = infos.find(info => info.id === sessionId)
    if (match?.path) {
      try {
        unlinkSync(match.path)
        logger.info(`deleteSession ${sessionId} - deleted file ${match.path}`)
      } catch (err) {
        logger.warn(`deleteSession ${sessionId} - failed to delete file ${match.path}:`, err)
        throw err
      }
    } else {
      logger.warn(`deleteSession ${sessionId} - session file not found on disk for cwd=${cwd}`)
    }
  }

  /** Dispose a session, cleaning up subscriptions and SDK resources. */
  dispose(sessionId: string): void {
    const managed = this.getManaged(sessionId)
    managed.batcher.dispose()
    managed.unsubscribe()
    try {
      const sm = managed.session.sessionManager
      if (sm.isPersisted()) {
        const sessionFile = sm.getSessionFile()
        if (sessionFile && sm.getEntries().length === 0) {
          unlinkSync(sessionFile)
          logger.info(`Dispose ${sessionId} - deleted empty session file`)
        }
      }
    } catch (err) {
      logger.warn(`Dispose ${sessionId} - failed to clean up session file:`, err)
    }
    managed.session.dispose()
    managed.uiContext.dispose()
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
  getModel(sessionId: string): ModelInfo {
    const managed = this.getManaged(sessionId)
    const model = managed.session.model
    if (!model) throw new Error(`No model set for session: ${sessionId}`)
    return { id: model.id, name: model.name, provider: model.provider }
  }

  /** List all available models with valid API keys. */
  async listModels(): Promise<ModelInfo[]> {
    let modelRegistry: import('@earendil-works/pi-coding-agent').ModelRegistry | null = null
    for (const [, managed] of this.sessions) {
      modelRegistry = managed.session.modelRegistry
      break
    }
    if (!modelRegistry) {
      const { ModelRegistry } = await import('@earendil-works/pi-coding-agent')
      const authStorage = await createSecureAuthStorage()
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
      logger.error(`getManaged: session not found ${sessionId} - active sessions: [${Array.from(this.sessions.keys()).join(', ')}]`)
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

    // Create the ElectronUIContext for forwarding extension UI requests to the renderer
    const uiContext = new ElectronUIContext(sessionId, new MainThreadUITransport())

    const managed: ManagedSession = {
      session,
      unsubscribe: () => {},
      batcher,
      extensionErrors,
      extensionsDisabled,
      messages: [],
      currentAssistantId: null,
      currentAssistantContent: '',
      currentThinkingId: null,
      currentThinkingContent: '',
      currentToolCallId: null,
      previousFileContent: new Map(),
      hasPrompted: false,
      usageTotals: { input: 0, output: 0, totalCost: 0 },
      uiContext,
    }

    // Bind the ElectronUIContext to the session's extension runner
    // so extension ui.select(), ui.confirm(), ui.input() calls are forwarded to the renderer
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      session.bindExtensions({ uiContext: uiContext as any })
      logger.info(`wrapSession ${sessionId} - bound ElectronUIContext`)
    } catch (err) {
      logger.warn(`wrapSession ${sessionId} - failed to bind ElectronUIContext:`, err)
    }

    managed.unsubscribe = session.subscribe((agentEvent: AgentSessionEvent) => {
      this.handleAgentEvent(sessionId, agentEvent, batcher, managed)
    })

    return managed
  }

  /**
   * Translate AgentSessionEvent into simplified SessionStreamEvent for the renderer.
   * Delegates to the shared AgentEventProcessor to avoid duplicating event-handling logic.
   */
  private handleAgentEvent(
    sessionId: string,
    event: AgentSessionEvent,
    batcher: StreamBatcher,
    managed: ManagedSession,
  ): void {
    // Delegate to shared processor with batcher-aware callbacks
    const processor = new AgentEventProcessor(
      (sid, streamEvent) => this.onEvent(sid, streamEvent),
      {
        onBatchableEvent: (streamEvent) => batcher.push(streamEvent),
        onFlush: () => batcher.flush(),
        capturePreviousFileContent: true,
        readFileContent: (filePath) => {
          try { return readFileSync(filePath, 'utf-8') } catch { return null }
        },
        fileExists: (filePath) => existsSync(filePath),
      },
    )
    processor.handleAgentEvent(sessionId, event, managed)
  }

  /**
   * Finalize the current in-progress assistant message.
   * Delegates to the shared AgentEventProcessor.
   */
  private finalizeAssistantMessage(managed: ManagedSession): void {
    this.agentEventProcessor.finalizeAssistantMessage(managed)
  }

  /**
   * Finalize the current in-progress thinking message.
   * Delegates to the shared AgentEventProcessor.
   */
  private finalizeThinkingMessage(managed: ManagedSession): void {
    this.agentEventProcessor.finalizeThinkingMessage(managed)
  }
}
