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

/** Payload for loading session history */
export interface SessionLoadHistoryPayload {
  sessionId: string
}

/** A chat message suitable for IPC transfer (no circular refs, plain data) */
export interface ChatMessageIPC {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: Array<{ id: string; name: string; args: unknown; result?: unknown; isError?: boolean }>
  timestamp: number
}

/**
 * Events streamed from main to renderer.
 * These are a simplified subset of the full AgentEvent type --
 * only the fields the renderer needs for display.
 */
export type SessionStreamEvent =
  | { type: 'agent_start' }
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_call'; toolCallId: string; toolName: string; args: unknown }
  | { type: 'tool_result'; toolCallId: string; toolName: string; result: unknown; isError: boolean }
  | { type: 'error'; message: string }
  | { type: 'done' }
  | { type: 'user_message'; text: string }

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

/** API exposed to the renderer via contextBridge */
export interface NekoCodeIPC {
  session: {
    create: (cwd: string) => Promise<SessionCreateResult>
    prompt: (sessionId: string, text: string) => Promise<void>
    abort: (sessionId: string) => Promise<void>
    dispose: (sessionId: string) => Promise<void>
    reconnect: (sessionId: string, cwd: string) => Promise<SessionReconnectResult>
    loadHistory: (sessionId: string) => Promise<ChatMessageIPC[]>
    onEvent: (callback: (payload: { sessionId: string; event: SessionStreamEvent }) => void) => () => void
    getModel: (sessionId: string) => Promise<ModelInfo | null>
    listModels: () => Promise<ModelInfo[]>
    setModel: (sessionId: string, provider: string, modelId: string) => Promise<ModelInfo>
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
}
