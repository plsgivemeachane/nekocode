import { ipcMain, BrowserWindow, dialog, shell } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { IPC_CHANNELS } from '../shared/ipc-channels'
import type {
  SessionCreatePayload,
  SessionCreateResult,
  SessionPromptPayload,
  SessionAbortPayload,
  SessionDisposePayload,
  SessionDeletePayload,
  SessionReconnectPayload,
  SessionReconnectResult,
  SessionLoadHistoryPayload,
  SessionLoadHistoryDiskPayload,
  ChatMessageIPC,
  SessionStreamEvent,
  ProjectAddPayload,
  ProjectRemovePayload,
  ProjectSessionsPayload,
  ProjectInfo,
  WorkspaceSetActivePayload,
  CommandInfo,
  ModelInfo,
  UpdateAvailableInfo,
  NotificationSettings,
} from '../shared/ipc-types'
import type { ISessionManager, IProjectManager } from './manager-types'
import type { NotificationService } from './notification-service'
import { createLogger } from './logger'
import { checkForUpdate, downloadUpdate, quitAndInstall } from './updater'

const logger = createLogger('ipc-handlers')
const execFileAsync = promisify(execFile)

/**
 * Register IPC handlers that bridge the renderer to the session and project managers.
 * Called once from main process startup.
 */
export function registerIpcHandlers(
  sessionManager: ISessionManager,
  projectManager: IProjectManager,
  notificationService?: NotificationService,
): void {
  // --- Session handlers ---

  ipcMain.handle(IPC_CHANNELS.SESSION_CREATE, async (_event, payload: SessionCreatePayload): Promise<SessionCreateResult> => {
    logger.info(`SESSION_CREATE cwd=${payload.cwd}`)
    try {
      const sessionId = await sessionManager.create(payload.cwd)
      const extensionErrors = sessionManager.getExtensionLoadErrors(sessionId)
      const extensionsDisabled = sessionManager.getExtensionsDisabled(sessionId)

      return { sessionId, stableId: sessionId, extensionErrors, extensionsDisabled }
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

  ipcMain.handle(IPC_CHANNELS.SESSION_DELETE, async (_event, payload: SessionDeletePayload): Promise<void> => {
    logger.info(`SESSION_DELETE sessionId=${payload.sessionId} cwd=${payload.cwd}`)
    await sessionManager.deleteSession(payload.sessionId, payload.cwd)
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_RECONNECT, async (_event, payload: SessionReconnectPayload): Promise<SessionReconnectResult> => {
    logger.info(`SESSION_RECONNECT sessionId=${payload.sessionId} cwd=${payload.cwd}`)
    try {
      const history = await sessionManager.reconnect(payload.sessionId, payload.cwd)
      const extensionErrors = sessionManager.getExtensionLoadErrors(payload.sessionId)
      const extensionsDisabled = sessionManager.getExtensionsDisabled(payload.sessionId)
      logger.info(`SESSION_RECONNECT OK sessionId=${payload.sessionId} history=${history.length} messages`)
      return { sessionId: payload.sessionId, stableId: payload.sessionId, history, extensionErrors, extensionsDisabled }
    } catch (err) {
      logger.error(`SESSION_RECONNECT failed sessionId=${payload.sessionId}`, err)
      throw err
    }
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_LOAD_HISTORY, async (_event, payload: SessionLoadHistoryPayload): Promise<ChatMessageIPC[]> => {
    logger.debug(`SESSION_LOAD_HISTORY sessionId=${payload.sessionId}`)
    return await sessionManager.getHistory(payload.sessionId)
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_LOAD_HISTORY_DISK, async (_event, payload: SessionLoadHistoryDiskPayload): Promise<ChatMessageIPC[]> => {
    logger.debug(`SESSION_LOAD_HISTORY_DISK sessionId=${payload.sessionId} cwd=${payload.cwd} limit=${payload.limit}`)
    return sessionManager.loadHistoryFromDisk(payload.sessionId, payload.cwd, payload.limit)
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

  // --- Model handlers ---

  ipcMain.handle(IPC_CHANNELS.SESSION_GET_MODEL, async (_event, payload: { sessionId: string }): Promise<ModelInfo | null> => {
    logger.debug(`SESSION_GET_MODEL sessionId=${payload.sessionId}`)
    return sessionManager.getModel(payload.sessionId)
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_LIST_MODELS, async (): Promise<ModelInfo[]> => {
    logger.debug('SESSION_LIST_MODELS')
    return sessionManager.listModels()
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_SET_MODEL, async (_event, payload: { sessionId: string; provider: string; modelId: string }): Promise<ModelInfo> => {
    logger.debug(`SESSION_SET_MODEL sessionId=${payload.sessionId} provider=${payload.provider} modelId=${payload.modelId}`)
    return sessionManager.setModel(payload.sessionId, payload.provider, payload.modelId)
  })

  // --- Command discovery handlers ---

  ipcMain.handle(IPC_CHANNELS.SESSION_GET_COMMANDS, async (_event, payload: { sessionId: string }): Promise<CommandInfo[]> => {
    logger.debug(`SESSION_GET_COMMANDS sessionId=${payload.sessionId}`)
    return sessionManager.getCommands(payload.sessionId)
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_UI_RESPOND, async (_event, payload: import('../shared/ipc-types').UIResponse): Promise<void> => {
    logger.debug(`SESSION_UI_RESPOND requestId=${payload.requestId} sessionId=${payload.sessionId}`)
    sessionManager.handleUIResponse(payload)
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

  // --- Update handlers ---

  ipcMain.handle(IPC_CHANNELS.UPDATE_CHECK, async (): Promise<UpdateAvailableInfo | null> => {
    logger.info('UPDATE_CHECK')
    try {
      return await checkForUpdate()
    } catch (err) {
      logger.error('UPDATE_CHECK failed', err)
      throw err
    }
  })

  ipcMain.handle(IPC_CHANNELS.UPDATE_DOWNLOAD, async (): Promise<void> => {
    logger.info('UPDATE_DOWNLOAD')
    try {
      await downloadUpdate()
    } catch (err) {
      logger.error('UPDATE_DOWNLOAD failed', err)
      throw err
    }
  })

  ipcMain.handle(IPC_CHANNELS.UPDATE_INSTALL, async (): Promise<void> => {
    logger.info('UPDATE_INSTALL')
    quitAndInstall()
  })

  // --- Git handlers ---

  ipcMain.handle(IPC_CHANNELS.GIT_GET_BRANCH, async (_event, payload: { cwd: string }): Promise<string | null> => {
    try {
      const { stdout } = await execFileAsync('git', ['branch', '--show-current'], { cwd: payload.cwd })
      return stdout.trim() || null
    } catch {
      return null
    }
  })

  // --- Zoom handlers ---

  ipcMain.handle(IPC_CHANNELS.ZOOM_GET, async (): Promise<{ factor: number }> => {
    const win = BrowserWindow.getFocusedWindow()
    if (win && !win.isDestroyed()) {
      const factor = win.webContents.getZoomFactor()
      return { factor }
    }
    return { factor: 1.0 }
  })

  ipcMain.handle(IPC_CHANNELS.ZOOM_SET, async (_event, payload: { factor: number }): Promise<void> => {
    const win = BrowserWindow.getFocusedWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.setZoomFactor(payload.factor)
    }
  })

  ipcMain.handle(IPC_CHANNELS.ZOOM_RESET, async (): Promise<void> => {
    const win = BrowserWindow.getFocusedWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.setZoomFactor(1.0)
    }
  })

  // --- Window control handlers ---

  ipcMain.handle(IPC_CHANNELS.WINDOW_MINIMIZE, async (): Promise<void> => {
    const win = BrowserWindow.getFocusedWindow()
    if (win && !win.isDestroyed()) {
      win.minimize()
    }
  })

  ipcMain.handle(IPC_CHANNELS.WINDOW_MAXIMIZE, async (): Promise<void> => {
    const win = BrowserWindow.getFocusedWindow()
    if (win && !win.isDestroyed()) {
      if (win.isMaximized()) {
        win.unmaximize()
      } else {
        win.maximize()
      }
    }
  })

  ipcMain.handle(IPC_CHANNELS.WINDOW_CLOSE, async (): Promise<void> => {
    const win = BrowserWindow.getFocusedWindow()
    if (win && !win.isDestroyed()) {
      win.close()
    }
  })

  ipcMain.handle(IPC_CHANNELS.WINDOW_IS_MAXIMIZED, async (): Promise<boolean> => {
    const win = BrowserWindow.getFocusedWindow()
    if (win && !win.isDestroyed()) {
      return win.isMaximized()
    }
    return false
  })

  // --- Shell handlers ---

  /** Open a path in VS Code. Uses URI scheme first (instant), then CLI fallback. */
  ipcMain.handle(IPC_CHANNELS.SHELL_OPEN_IN_VSCODE, async (_event, { path: targetPath }: { path: string }): Promise<boolean> => {
    logger.debug(`SHELL_OPEN_IN_VSCODE path=${targetPath}`)

    // Normalize Windows backslashes to forward slashes for URI compatibility.
    // encodeURIComponent encodes : and \ which breaks vscode:// URIs on Windows,
    // producing broken URIs like vscode://file/C%3A%5CUsers... instead of
    // vscode://file/C:/Users/...
    const normalizedPath = targetPath.replace(/\\/g, '/')
    const vscodeUri = `vscode://file/${encodeURI(normalizedPath)}/`

    // Strategy: URI-first. The vscode:// URI scheme is registered by VS Code
    // on all platforms and opens instantly. CLI `code` command can have a
    // 10+ second timeout on Windows when code is not in PATH, so we only
    // use it as a fallback.
    try {
      await shell.openExternal(vscodeUri)
      logger.info(`Opened via vscode:// URI handler: ${vscodeUri}`)
      return true
    } catch {
      logger.debug('vscode:// URI handler failed, trying CLI fallback')
    }

    // CLI fallback: try `code` then `code-insiders`
    const commands = ['code', 'code-insiders']
    for (const cmd of commands) {
      try {
        await execFileAsync(cmd, [targetPath], { timeout: 5000 })
        logger.info(`Opened in VS Code via '${cmd}': ${targetPath}`)
        return true
      } catch {
        // Command not found or failed — try next
        continue
      }
    }

    logger.warn(`Failed to open in VS Code: ${targetPath}`)
    return false
  })

  /** Open a folder in the system file explorer (Explorer on Windows, Finder on macOS). */
  ipcMain.handle(IPC_CHANNELS.SHELL_OPEN_IN_EXPLORER, async (_event, { path: targetPath }: { path: string }): Promise<boolean> => {
    logger.debug(`SHELL_OPEN_IN_EXPLORER path=${targetPath}`)
    try {
      // shell.openPath() returns an empty string on success, or an error message on failure.
      // Ignoring the return value means failures are reported as success to the renderer.
      const errorMsg = await shell.openPath(targetPath)
      if (errorMsg) {
        logger.warn(`Failed to open in Explorer: ${targetPath} — ${errorMsg}`)
        return false
      }
      return true
    } catch (err) {
      logger.warn(`Failed to open in Explorer: ${targetPath}`, err)
      return false
    }
  })

  /** Check if VS Code is available on the system (via CLI or URI scheme). */
  ipcMain.handle(IPC_CHANNELS.SHELL_CHECK_VSCODE_AVAILABLE, async (): Promise<{ available: boolean; command: string | null; method: 'cli' | 'uri' | null }> => {
    logger.debug('SHELL_CHECK_VSCODE_AVAILABLE')
    const commands = ['code', 'code-insiders']
    for (const cmd of commands) {
      try {
        await execFileAsync(cmd, ['--version'], { timeout: 5000 })
        logger.info(`VS Code available via '${cmd}'`)
        return { available: true, command: cmd, method: 'cli' }
      } catch {
        continue
      }
    }
    // Even without the CLI, VS Code may be installed and registered as a
    // vscode:// URI handler. This is the common case on Windows where `code`
    // is not in PATH. We report URI availability so the button is not
    // incorrectly grayed out.
    logger.info('VS Code CLI not found, but URI scheme may still be available')
    return { available: true, command: null, method: 'uri' }
  })

  // --- Notification handlers ---

  if (notificationService) {
    ipcMain.handle(IPC_CHANNELS.NOTIFICATION_SETTINGS_GET, async (): Promise<NotificationSettings> => {
      logger.debug('NOTIFICATION_SETTINGS_GET')
      return notificationService.getSettings()
    })

    ipcMain.handle(IPC_CHANNELS.NOTIFICATION_SETTINGS_SET, async (_event, partial: Partial<NotificationSettings>): Promise<NotificationSettings> => {
      logger.debug('NOTIFICATION_SETTINGS_SET')
      return notificationService.updateSettings(partial)
    })
  }

}

/**
 * Forward a session stream event to all renderer windows.
 * Called by PiSessionManager's event callback.
 */
export function sendEventToRenderer(sessionId: string, event: SessionStreamEvent): void {
  const eventType = (event as { type: string }).type
  logger.debug(`sendEventToRenderer sessionId=${sessionId} type=${eventType}`)
  // Log ui_request events at info level for easier debugging of the ask_user flow
  if (eventType === 'ui_request') {
    logger.info(
      `sendEventToRenderer: forwarding ui_request for session ${sessionId} to renderer`
    )
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.SESSION_EVENTS, { sessionId, event })
    }
  }
}
