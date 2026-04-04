import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { PiSessionManager } from './session-manager'
import { ProjectManager } from './project-manager'
import { registerIpcHandlers, sendEventToRenderer } from './ipc-handlers'
import { createLogger } from './logger'

const logger = createLogger('main')

const sessionManager = new PiSessionManager(sendEventToRenderer)
const projectManager = new ProjectManager()
let isQuitting = false

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  logger.info('BrowserWindow created')

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

function performShutdown(): void {
  if (isQuitting) return
  isQuitting = true

  const count = sessionManager.sessionCount
  logger.info(`Shutting down, disposing ${count} session(s)`)
  try {
    sessionManager.disposeAll()
    logger.info(`Disposed ${count} session(s) successfully`)
  } catch (err) {
    logger.error('Error disposing sessions on quit', err)
  }
}

app.whenReady().then(async () => {
  logger.info('App ready, loading workspace')
  await projectManager.loadWorkspace()
  logger.info(`Workspace loaded, ${projectManager.listProjects().length} project(s)`)
  registerIpcHandlers(sessionManager, projectManager)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      logger.info('activate: creating new window')
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  logger.info('window-all-closed')
  performShutdown()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  performShutdown()
})
