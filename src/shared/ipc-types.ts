/**
 * Shared IPC types for session management.
 * These types are used by both main and renderer processes.
 */

/** Payload for creating a new session */
export interface SessionCreatePayload {
  cwd: string
}

/** Result of session creation */
export interface SessionCreateResult {
  sessionId: string
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

/**
 * Events streamed from main to renderer.
 * These are a simplified subset of the full AgentEvent type --
 * only the fields the renderer needs for display.
 */
export type SessionStreamEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_call'; toolName: string; args: unknown }
  | { type: 'tool_result'; toolName: string; result: unknown; isError: boolean }
  | { type: 'error'; message: string }
  | { type: 'done' }

/** API exposed to the renderer via contextBridge */
export interface NekoCodeIPC {
  session: {
    create: (cwd: string) => Promise<SessionCreateResult>
    prompt: (sessionId: string, text: string) => Promise<void>
    abort: (sessionId: string) => Promise<void>
    dispose: (sessionId: string) => Promise<void>
    onEvent: (callback: (event: SessionStreamEvent) => void) => () => void
  }
  dialog: {
    openFolder: () => Promise<string | null>
  }
}
