import { ipcMain, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc-channels'
import type {
  SessionCreatePayload,
  SessionCreateResult,
  SessionPromptPayload,
  SessionAbortPayload,
  SessionDisposePayload,
  SessionStreamEvent,
} from '../shared/ipc-types'
import { PiSessionManager } from './session-manager'

/**
 * Register IPC handlers that bridge the renderer to the session manager.
 * Called once from main process startup.
 */
export function registerIpcHandlers(sessionManager: PiSessionManager): void {
  ipcMain.handle(IPC_CHANNELS.SESSION_CREATE, async (_event, payload: SessionCreatePayload): Promise<SessionCreateResult> => {
    const sessionId = await sessionManager.create(payload.cwd)
    return { sessionId }
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_PROMPT, async (_event, payload: SessionPromptPayload): Promise<void> => {
    await sessionManager.prompt(payload.sessionId, payload.text)
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_ABORT, async (_event, payload: SessionAbortPayload): Promise<void> => {
    sessionManager.abort(payload.sessionId)
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_DISPOSE, async (_event, payload: SessionDisposePayload): Promise<void> => {
    sessionManager.dispose(payload.sessionId)
  })
}

/**
 * Forward a session stream event to all renderer windows.
 * Called by PiSessionManager's event callback.
 */
export function sendEventToRenderer(sessionId: string, event: SessionStreamEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.SESSION_EVENTS, { sessionId, event })
    }
  }
}
