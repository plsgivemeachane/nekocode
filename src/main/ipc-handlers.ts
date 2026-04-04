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
import { createLogger } from './logger'

const logger = createLogger('ipc-handlers')

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
    logger.info(`SESSION_CREATE cwd=${payload.cwd}`)
    try {
      const sessionId = await sessionManager.create(payload.cwd)
      logger.info(`SESSION_CREATE OK sessionId=${sessionId}`)
      return { sessionId, stableId: sessionId }
    } catch (err) {
      logger.error('SESSION_CREATE failed', err)
      throw err
    }
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_PROMPT, async (_event, payload: SessionPromptPayload): Promise<void> => {
    logger.info(`SESSION_PROMPT sessionId=${payload.sessionId} text=${payload.text.slice(0, 80)}`)
    try {
      await sessionManager.prompt(payload.sessionId, payload.text)
    } catch (err) {
      logger.error(`SESSION_PROMPT failed sessionId=${payload.sessionId}`, err)
      throw err
    }
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_ABORT, async (_event, payload: SessionAbortPayload): Promise<void> => {
    logger.info(`SESSION_ABORT sessionId=${payload.sessionId}`)
    sessionManager.abort(payload.sessionId)
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_DISPOSE, async (_event, payload: SessionDisposePayload): Promise<void> => {
    logger.info(`SESSION_DISPOSE sessionId=${payload.sessionId}`)
    sessionManager.dispose(payload.sessionId)
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_RECONNECT, async (_event, payload: SessionReconnectPayload): Promise<SessionReconnectResult> => {
    logger.info(`SESSION_RECONNECT sessionId=${payload.sessionId} cwd=${payload.cwd}`)
    try {
      const history = await sessionManager.reconnect(payload.sessionId, payload.cwd)
      logger.info(`SESSION_RECONNECT OK sessionId=${payload.sessionId} history=${history.length} messages`)
      return { sessionId: payload.sessionId, stableId: payload.sessionId, history }
    } catch (err) {
      logger.error(`SESSION_RECONNECT failed sessionId=${payload.sessionId}`, err)
      throw err
    }
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_LOAD_HISTORY, async (_event, payload: SessionLoadHistoryPayload): Promise<ChatMessageIPC[]> => {
    logger.debug(`SESSION_LOAD_HISTORY sessionId=${payload.sessionId}`)
    return sessionManager.getHistory(payload.sessionId)
  })

  // --- Dialog handlers ---

  ipcMain.handle(IPC_CHANNELS.DIALOG_OPEN_FOLDER, async (): Promise<string | null> => {
    logger.debug('DIALOG_OPEN_FOLDER')
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select project folder',
    })
    if (result.canceled || result.filePaths.length === 0) {
      logger.debug('DIALOG_OPEN_FOLDER cancelled')
      return null
    }
    logger.info(`DIALOG_OPEN_FOLDER selected=${result.filePaths[0]}`)
    return result.filePaths[0]
  })

  // --- Project handlers ---

  ipcMain.handle(IPC_CHANNELS.PROJECT_ADD, async (_event, payload: ProjectAddPayload): Promise<ProjectInfo> => {
    logger.info(`PROJECT_ADD path=${payload.path}`)
    try {
      return await projectManager.addProject(payload.path)
    } catch (err) {
      logger.error(`PROJECT_ADD failed path=${payload.path}`, err)
      throw err
    }
  })

  ipcMain.handle(IPC_CHANNELS.PROJECT_REMOVE, async (_event, payload: ProjectRemovePayload): Promise<boolean> => {
    logger.info(`PROJECT_REMOVE id=${payload.id}`)
    try {
      return await projectManager.removeProject(payload.id)
    } catch (err) {
      logger.error(`PROJECT_REMOVE failed id=${payload.id}`, err)
      throw err
    }
  })

  // --- Workspace handlers ---

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_SET_ACTIVE, async (_event, payload: WorkspaceSetActivePayload): Promise<void> => {
    logger.debug(`WORKSPACE_SET_ACTIVE sessionId=${payload.sessionId} projectPath=${payload.projectPath}`)
    await projectManager.setActiveSession(payload.sessionId, payload.projectPath)
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_GET_ACTIVE, async (): Promise<{ sessionId: string | null; projectPath: string | null }> => {
    logger.debug('WORKSPACE_GET_ACTIVE')
    return projectManager.getActiveSession()
  })

  ipcMain.handle(IPC_CHANNELS.PROJECT_LIST, async (): Promise<ProjectInfo[]> => {
    logger.debug('PROJECT_LIST')
    return projectManager.listProjects()
  })

  ipcMain.handle(IPC_CHANNELS.PROJECT_SESSIONS, async (_event, payload: ProjectSessionsPayload): Promise<ProjectInfo | null> => {
    logger.info(`PROJECT_SESSIONS projectId=${payload.projectId}`)
    try {
      return await projectManager.refreshSessions(payload.projectId)
    } catch (err) {
      logger.error(`PROJECT_SESSIONS failed projectId=${payload.projectId}`, err)
      throw err
    }
  })
}

/**
 * Forward a session stream event to all renderer windows.
 * Called by PiSessionManager's event callback.
 */
export function sendEventToRenderer(sessionId: string, event: SessionStreamEvent): void {
  logger.debug(`sendEventToRenderer sessionId=${sessionId} type=${event.type}`)
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.SESSION_EVENTS, { sessionId, event })
    }
  }
}
