import { app, BrowserWindow, Menu, shell, session } from 'electron'
import { join } from 'path'
import { ProjectManager } from './project-manager'
import { registerIpcHandlers, sendEventToRenderer } from './ipc-handlers'
import { createLogger } from './logger'
import { initAutoUpdater } from './updater'
import { ThreadOperationQueue } from './threading'
import { ThreadedProjectManager } from './threading/threaded-project-manager'
import { ThreadedSessionManager } from './threading/threaded-session-manager'
import { NotificationService } from './notification-service'
import type { SessionStreamEvent } from '../shared/ipc-types'
import { IPC_CHANNELS } from '../shared/ipc-channels'

const logger = createLogger('main')

// Set app user model ID for Windows notifications (required for toast notifications in dev)
if (process.platform === 'win32') {
  app.setAppUserModelId(process.execPath)
}

// Notification service for OS notifications and sound triggers
const notificationService = new NotificationService()

// Event callback for session events from worker threads
const onSessionEvent = (sessionId: string, event: SessionStreamEvent): void => {
  sendEventToRenderer(sessionId, event)

  // Trigger notification when AI response completes
  if (event.type === 'done') {
    notificationService.notify({
      title: 'AI Response Ready',
      body: `Session: ${sessionId.slice(0, 8)}`,
      soundKey: 'task-complete',
    })
  }
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
    frame: false,
    icon: join(__dirname, '../../resources/icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true
    }
  })

  // Security: Set Content Security Policy to prevent XSS, data exfiltration,
  // and unauthorized script execution.
  // - script-src 'self': Only load scripts from the app's own origin
  // - style-src 'self' 'unsafe-inline': Tailwind CSS requires inline styles
  // - connect-src 'self': API calls only to same origin (renderer->main via IPC)
  //   Plus specific AI provider endpoints for direct streaming if needed
  // - img-src 'self' data: https:: Images from app, data URIs, and HTTPS
  // - font-src 'self': Fonts only from app origin
  // - default-src 'self': Fallback - only same-origin resources
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; " +
          "script-src 'self'; " +
          "style-src 'self' 'unsafe-inline'; " +
          "connect-src 'self' https://api.anthropic.com https://api.openai.com https://generativelanguage.googleapis.com https://*.gitlab.com; " +
          "img-src 'self' data: https:; " +
          "font-src 'self'"
        ]
      }
    })
    })

  // Forward maximize/unmaximize state changes to renderer for custom titlebar
  mainWindow.on('maximize', () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.WINDOW_MAXIMIZED_STATE, true)
    }
  })

  mainWindow.on('unmaximize', () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.WINDOW_MAXIMIZED_STATE, false)
    }
  })

  mainWindow.setMenuBarVisibility(false)

  // Security: Only allow http: and https: URLs to be opened externally.
  // Block file://, javascript:, and custom scheme URLs that could be used
  // for local file access, XSS, or protocol handler abuse.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        shell.openExternal(url)
      } else {
        logger.warn(`Blocked openExternal for non-HTTP URL: ${url}`)
      }
    } catch {
      logger.warn(`Blocked invalid URL in setWindowOpenHandler: ${url}`)
    }
    return { action: 'deny' }
  })

  // Keyboard shortcuts for zoom and DevTools
  mainWindow.webContents.on('before-input-event', (event, input) => {
    // Security: Only allow DevTools toggle in development mode.
    // Disabling in production prevents exposure of sensitive state and API keys.
    if (input.key === 'F12' && !input.control && !input.meta && !input.alt && !input.shift) {
      event.preventDefault()
      if (!app.isPackaged) {
        mainWindow.webContents.toggleDevTools()
      }
      return
    }

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
  await notificationService.loadSettings()
  await projectManager.loadWorkspace()
  logger.info(`Workspace loaded, ${projectManager.listProjects().length} project(s)`)
  registerIpcHandlers(sessionManager, projectManager, notificationService)
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
