/**
 * Shared IPC types for session and project management.
 * These types are used by both main and renderer processes.
 */

/** Payload for creating a new session */
export interface SessionCreatePayload {
  cwd: string
}

/** Result of session creation */
export interface SessionCreateResult {
  sessionId: string
  stableId: string
  extensionErrors?: ExtensionLoadError[]
  extensionsDisabled?: boolean
}

/** Payload for sending a prompt */
export interface SessionPromptPayload {
  sessionId: string
  text: string
}

/** Payload for aborting the current prompt */
export interface SessionAbortPayload {
  sessionId: string
}

/** Payload for disposing a session */
export interface SessionDisposePayload {
  sessionId: string
}

export interface SessionDeletePayload {
  sessionId: string
  cwd: string
}

/** Payload for reconnecting to an existing session */
export interface SessionReconnectPayload {
  sessionId: string
  cwd: string
}

/** Result of session reconnection */
export interface SessionReconnectResult {
  sessionId: string
  stableId: string
  history: ChatMessageIPC[]
  extensionErrors?: ExtensionLoadError[]
  extensionsDisabled?: boolean
}

/** Normalized extension load error details for UI diagnostics. */
export interface ExtensionLoadError {
  path: string
  message: string
  stack?: string
}

/** Information about a discoverable slash command */
export interface CommandInfo {
  /** Command name without / prefix (e.g., 'deploy', 'skill:brave-search') */
  name: string
  /** Human-readable description for autocomplete UI */
  description?: string
  /** Where the command originates from */
  source: 'extension' | 'prompt' | 'skill' | 'workflow'
}

/** ── UI Protocol Types ────────────────────────────────────────────── */

/** A UI request sent from an extension/workflow to the renderer for user interaction */
export interface UIRequest {
  /** Unique ID for correlating request ↔ response */
  id: string
  /** The session this request belongs to */
  sessionId: string
  /** The type of UI interaction requested */
  type: 'select' | 'confirm' | 'input'
  /** Title/heading for the dialog */
  title: string
  /** Optional description/body text */
  description?: string
  /** For 'select' type: the list of options to choose from */
  options?: UISelectOption[]
  /** For 'input' type: placeholder text */
  placeholder?: string
  /** For 'input' type: default value */
  defaultValue?: string
  /** For 'confirm' type: whether to show a destructive/danger style */
  dangerous?: boolean
}

/** An option in a UI select request */
export interface UISelectOption {
  /** Display label */
  label: string
  /** Optional description */
  description?: string
  /** Optional value (defaults to label if not provided) */
  value?: string
}

/** A response from the renderer back to the main process for a UI request */
export interface UIResponse {
  /** The ID of the original UIRequest */
  requestId: string
  /** The session this response belongs to */
  sessionId: string
  /** Whether the user confirmed/selected something (true) or cancelled (false) */
  confirmed: boolean
  /** For 'select' type: the selected option value */
  selectedValue?: string
  /** For 'input' type: the entered text */
  inputValue?: string
}

/** Workflow step progress event streamed to renderer */
export interface WorkflowStepEvent {
  /** The session this workflow belongs to */
  sessionId: string
  /** Unique ID for this workflow execution */
  workflowId: string
  /** Human-readable workflow name */
  workflowName: string
  /** The current step index (0-based) */
  stepIndex: number
  /** Total number of steps */
  totalSteps: number
  /** Human-readable step name */
  stepName: string
  /** Step status */
  status: 'running' | 'completed' | 'failed' | 'waiting'
  /** Optional detail text */
  detail?: string
}

/** Payload for loading session history */
export interface SessionLoadHistoryPayload {
  sessionId: string
}

/** Payload for loading session history from disk (no agent creation) */
export interface SessionLoadHistoryDiskPayload {
  sessionId: string
  cwd: string
  /** Max number of recent messages to return (0 = all) */
  limit: number
}

/** Message-level usage data (tokens and cost for a single assistant message) */
export interface MessageUsage {
  inputTokens: number
  outputTokens: number
  totalCost: number
}

/** A chat message suitable for IPC transfer (no circular refs, plain data) */
export interface ChatMessageIPC {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: Array<{ id: string; name: string; args: unknown; result?: unknown; isError?: boolean }>
  timestamp: number
  /** Usage data for assistant messages (undefined for user messages) */
  usage?: MessageUsage
  /** When true, this message contains thinking/reasoning content */
  thinking?: boolean
}

/**
 * Events streamed from main to renderer.
 * These are a simplified subset of the full AgentEvent type --
 * only the fields the renderer needs for display.
 */
export interface UsageData {
  inputTokens: number
  outputTokens: number
  totalCost: number
  contextPercent: number
  contextWindow: number
}

export type SessionStreamEvent =
  | { type: 'agent_start' }
  | { type: 'text_delta'; delta: string }
  | { type: 'thinking_start' }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'thinking_end' }
  | { type: 'tool_call'; toolCallId: string; toolName: string; args: unknown }
  | { type: 'tool_result'; toolCallId: string; toolName: string; result: unknown; isError: boolean }
  | { type: 'usage_update'; usage: UsageData }
  | { type: 'error'; message: string }
  | { type: 'done' }
  | { type: 'user_message'; text: string }
  | { type: 'ui_request'; request: UIRequest }
  | { type: 'workflow_step'; step: WorkflowStepEvent }

/** Display info for a session shown in the sidebar */
export interface SessionInfoDisplay {
  id: string
  firstMessage: string
  created: string
  messageCount: number
}

/** Info about a tracked project */
export interface ProjectInfo {
  id: string
  name: string
  path: string
  sessions: SessionInfoDisplay[]
}

/** Payload for adding a project */
export interface ProjectAddPayload {
  path: string
}

/** Payload for removing a project */
export interface ProjectRemovePayload {
  id: string
}

/** Payload for refreshing project sessions */
export interface ProjectSessionsPayload {
  projectId: string
}

/** Payload for persisting the active session */
export interface WorkspaceSetActivePayload {
  sessionId: string
  projectPath: string
}

/** Result of getting the persisted active session */
export interface WorkspaceActiveResult {
  sessionId: string | null
  projectPath: string | null
}

export interface ModelInfo {
  id: string
  name: string
  provider: string
}

/** Information about an available update */
export interface UpdateAvailableInfo {
  version: string
  releaseDate: string
  releaseNotes?: string
  currentVersion: string
}

/** Download progress for an update */
export interface UpdateProgress {
  percent: number
  bytesPerSecond: number
  transferred: number
  total: number
}

/** Update error info */
export interface UpdateErrorInfo {
  message: string
  code?: string
}

/** API exposed to the renderer via contextBridge */
export interface ZoomInfo {
  factor: number
}

/** Window control API for custom titlebar in frameless mode */
export interface WindowApi {
  minimize: () => Promise<void>
  maximize: () => Promise<void>
  close: () => Promise<void>
  isMaximized: () => Promise<boolean>
  onMaximizedStateChange: (callback: (isMaximized: boolean) => void) => () => void
}

/** Sound key identifier for notification sounds */
export type NotificationSoundKey = 'task-complete' | 'success' | 'error' | 'warning'

/** Payload sent from main to renderer to trigger a sound playback */
export interface NotificationPayload {
  title: string
  body: string
  soundKey: NotificationSoundKey
}

/** Persistent notification settings */
export interface NotificationSettings {
  /** Master toggle for all notifications */
  enabled: boolean
  /** Sound on/off (independent of visual notification) */
  soundEnabled: boolean
  /** Playback volume 0.0 - 1.0 */
  soundVolume: number
  /** false = synthesized sounds, true = user-uploaded MP3s */
  useCustomSounds: boolean
  /** Per-task notification toggles */
  tasks: {
    aiResponseComplete: boolean
    fileOperationComplete: boolean
    extensionOperationComplete: boolean
  }
}

export interface NekoCodeIPC {
  session: {
    create: (cwd: string) => Promise<SessionCreateResult>
    prompt: (sessionId: string, text: string) => Promise<void>
    abort: (sessionId: string) => Promise<void>
    dispose: (sessionId: string) => Promise<void>
  deleteSession: (sessionId: string, cwd: string) => Promise<void>
    reconnect: (sessionId: string, cwd: string) => Promise<SessionReconnectResult>
    loadHistory: (sessionId: string) => Promise<ChatMessageIPC[]>
    loadHistoryFromDisk: (sessionId: string, cwd: string, limit: number) => Promise<ChatMessageIPC[]>
    onEvent: (callback: (payload: { sessionId: string; event: SessionStreamEvent }) => void) => () => void
    getModel: (sessionId: string) => Promise<ModelInfo | null>
    listModels: () => Promise<ModelInfo[]>
    setModel: (sessionId: string, provider: string, modelId: string) => Promise<ModelInfo>
    getCommands: (sessionId: string) => Promise<CommandInfo[]>
    /** Respond to a UI request (select/confirm/input) from an extension or workflow */
    uiRespond: (response: UIResponse) => Promise<void>
    /** Listen for UI requests from extensions/workflows */
    onUIRequest: (callback: (request: UIRequest) => void) => () => void
  }
  dialog: {
    openFolder: () => Promise<string | null>
  }
  project: {
    add: (path: string) => Promise<ProjectInfo>
    remove: (id: string) => Promise<boolean>
    list: () => Promise<ProjectInfo[]>
    sessions: (projectId: string) => Promise<ProjectInfo>
  }
  workspace: {
    setActive: (sessionId: string, projectPath: string) => Promise<void>
    getActive: () => Promise<WorkspaceActiveResult>
  }
  git: {
    getBranch: (cwd: string) => Promise<string | null>
  }
  update: {
    check: () => Promise<UpdateAvailableInfo | null>
    download: () => Promise<void>
    install: () => Promise<void>
    onAvailable: (callback: (info: UpdateAvailableInfo) => void) => () => void
    onNotAvailable: (callback: () => void) => () => void
    onProgress: (callback: (progress: UpdateProgress) => void) => () => void
    onDownloaded: (callback: (info: { version: string }) => void) => () => void
    onError: (callback: (error: UpdateErrorInfo) => void) => () => void
  }
  zoom: {
    get: () => Promise<ZoomInfo>
    set: (factor: number) => Promise<void>
    reset: () => Promise<void>
  }
  notification: {
    getSettings: () => Promise<NotificationSettings>
    updateSettings: (partial: Partial<NotificationSettings>) => Promise<NotificationSettings>
    onPlaySound: (callback: (payload: NotificationPayload) => void) => () => void
  }
    window: WindowApi
}
