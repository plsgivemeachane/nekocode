import { app, BrowserWindow, Menu, shell } from 'electron'
import { join } from 'path'
import { PiSessionManager } from './session-manager'
import { ProjectManager } from './project-manager'
import { registerIpcHandlers, sendEventToRenderer } from './ipc-handlers'
import { createLogger } from './logger'
import { initAutoUpdater } from './updater'

const logger = createLogger('main')

const sessionManager = new PiSessionManager(sendEventToRenderer)
const projectManager = new ProjectManager()
let isQuitting = false
let mainWindowRef: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: join(__dirname, '../../resources/icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.setMenuBarVisibility(false)

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  logger.info('BrowserWindow created')
  mainWindowRef = mainWindow
  logger.debug(`preload path: ${join(__dirname, '../preload/index.js')}`)
  logger.debug(`icon path: ${join(__dirname, '../../resources/icon.ico')}`)

  if (process.env.ELECTRON_RENDERER_URL) {
    logger.info(`Loading dev URL: ${process.env.ELECTRON_RENDERER_URL}`)
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    const indexPath = join(__dirname, '../renderer/index.html')
    logger.info(`Loading production file: ${indexPath}`)
    mainWindow.loadFile(indexPath)
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
  Menu.setApplicationMenu(null)
  await projectManager.loadWorkspace()
  logger.info(`Workspace loaded, ${projectManager.listProjects().length} project(s)`)
  registerIpcHandlers(sessionManager, projectManager)
  createWindow()
  initAutoUpdater(() => mainWindowRef)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      logger.info('activate: creating new window')
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  logger.info(`window-all-closed (platform=${process.platform})`)
  performShutdown()
  if (process.platform !== 'darwin') {
    logger.info('Quitting app (non-macOS)')
    app.quit()
  } else {
    logger.info('Keeping app alive (macOS)')
  }
})

app.on('before-quit', () => {
  performShutdown()
})
