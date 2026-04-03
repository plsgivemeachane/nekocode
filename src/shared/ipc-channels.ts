/**
 * Shared IPC channel names used by both main and renderer processes.
 * Channel names follow the pattern `namespace:action` for consistency.
 */
export const IPC_CHANNELS = {
  SESSION_CREATE: 'session:create',
  SESSION_PROMPT: 'session:prompt',
  SESSION_EVENTS: 'session:events',
  SESSION_ABORT: 'session:abort',
  SESSION_DISPOSE: 'session:dispose',
  DIALOG_OPEN_FOLDER: 'dialog:openFolder',
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]
