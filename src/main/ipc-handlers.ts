import { ipcMain, BrowserWindow, dialog } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc-channels'
import type {
  SessionCreatePayload,
  SessionCreateResult,
  SessionPromptPayload,
  SessionAbortPayload,
  SessionDisposePayload,
  SessionReconnectPayload,
  SessionReconnectResult,
  SessionLoadHistoryPayload,
  ChatMessageIPC,
  SessionStreamEvent,
  ProjectAddPayload,
  ProjectRemovePayload,
  ProjectSessionsPayload,
  ProjectInfo,
  WorkspaceSetActivePayload,
} from '../shared/ipc-types'
import { PiSessionManager } from './session-manager'
import type { ProjectManager } from './project-manager'

/**
 * Register IPC handlers that bridge the renderer to the session and project managers.
 * Called once from main process startup.
 */
export function registerIpcHandlers(
  sessionManager: PiSessionManager,
  projectManager: ProjectManager,
): void {
  // --- Session handlers ---

  ipcMain.handle(IPC_CHANNELS.SESSION_CREATE, async (_event, payload: SessionCreatePayload): Promise<SessionCreateResult> => {
    const sessionId = await sessionManager.create(payload.cwd)
    return { sessionId, stableId: sessionId }
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

  ipcMain.handle(IPC_CHANNELS.SESSION_RECONNECT, async (_event, payload: SessionReconnectPayload): Promise<SessionReconnectResult> => {
    const history = await sessionManager.reconnect(payload.sessionId, payload.cwd)
    return { sessionId: payload.sessionId, stableId: payload.sessionId, history }
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_LOAD_HISTORY, async (_event, payload: SessionLoadHistoryPayload): Promise<ChatMessageIPC[]> => {
    return sessionManager.getHistory(payload.sessionId)
  })

  // --- Dialog handlers ---

  ipcMain.handle(IPC_CHANNELS.DIALOG_OPEN_FOLDER, async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select project folder',
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
  })

  // --- Project handlers ---

  ipcMain.handle(IPC_CHANNELS.PROJECT_ADD, async (_event, payload: ProjectAddPayload): Promise<ProjectInfo> => {
    return projectManager.addProject(payload.path)
  })

  ipcMain.handle(IPC_CHANNELS.PROJECT_REMOVE, async (_event, payload: ProjectRemovePayload): Promise<boolean> => {
    return projectManager.removeProject(payload.id)
  })

  // --- Workspace handlers ---

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_SET_ACTIVE, async (_event, payload: WorkspaceSetActivePayload): Promise<void> => {
    await projectManager.setActiveSession(payload.sessionId, payload.projectPath)
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_GET_ACTIVE, async (): Promise<{ sessionId: string | null; projectPath: string | null }> => {
    return projectManager.getActiveSession()
  })

  ipcMain.handle(IPC_CHANNELS.PROJECT_LIST, async (): Promise<ProjectInfo[]> => {
    return projectManager.listProjects()
  })

  ipcMain.handle(IPC_CHANNELS.PROJECT_SESSIONS, async (_event, payload: ProjectSessionsPayload): Promise<ProjectInfo | null> => {
    return projectManager.refreshSessions(payload.projectId)
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
