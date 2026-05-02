import { app, BrowserWindow, Menu, shell } from 'electron'
import { join } from 'path'
import { ProjectManager } from './project-manager'
import { registerIpcHandlers, sendEventToRenderer } from './ipc-handlers'
import { createLogger } from './logger'
import { initAutoUpdater } from './updater'
import { ThreadOperationQueue } from './threading'
import { ThreadedProjectManager } from './threading/threaded-project-manager'
import { ThreadedSessionManager } from './threading/threaded-session-manager'
import type { SessionStreamEvent } from '../shared/ipc-types'

const logger = createLogger('main')

// Event callback for session events from worker threads
const onSessionEvent = (sessionId: string, event: SessionStreamEvent): void => {
  sendEventToRenderer(sessionId, event)
}

// Initialize thread pool for offloading CPU-intensive operations
const operationQueue = new ThreadOperationQueue(
  {
    minThreads: 2,
    maxThreads: 4,
  },
  onSessionEvent
)

// Core project manager (stays on main thread for state management)
const coreProjectManager = new ProjectManager()

// Threaded wrappers for better performance
const sessionManager = new ThreadedSessionManager(operationQueue, onSessionEvent)
const projectManager = new ThreadedProjectManager(operationQueue, coreProjectManager)
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

  // Keyboard shortcuts for zoom
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control || input.meta) {
      if (input.key === '=' || input.key === '+') {
        event.preventDefault()
        const currentZoom = mainWindow.webContents.getZoomFactor()
        mainWindow.webContents.setZoomFactor(Math.min(2.0, currentZoom + 0.1))
      } else if (input.key === '-') {
        event.preventDefault()
        const currentZoom = mainWindow.webContents.getZoomFactor()
        mainWindow.webContents.setZoomFactor(Math.max(0.5, currentZoom - 0.1))
      } else if (input.key === '0') {
        event.preventDefault()
        mainWindow.webContents.setZoomFactor(1.0)
      }
    }
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

async function performShutdown(): Promise<void> {
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

  // Shutdown thread pool
  logger.info('Shutting down thread pool')
  try {
    await operationQueue.shutdown()
    logger.info('Thread pool shutdown complete')
  } catch (err) {
    logger.error('Error shutting down thread pool', err)
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
