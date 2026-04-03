import { app, BrowserWindow, shell } from 'electron'
if (process.env.NODE_ENV === 'development') require('react-devtools')
import { join } from 'path'
import { PiSessionManager } from './session-manager'
import { registerIpcHandlers, sendEventToRenderer } from './ipc-handlers'

const sessionManager = new PiSessionManager(sendEventToRenderer)
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

  console.log('[main] BrowserWindow created')

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
  console.log(`[main] shutting down, disposing ${count} session(s)`)
  try {
    sessionManager.disposeAll()
    console.log(`[main] disposed ${count} session(s) successfully`)
  } catch (err) {
    console.error('[main] error disposing sessions on quit:', err)
  }
}

app.whenReady().then(() => {
  registerIpcHandlers(sessionManager)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  performShutdown()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  performShutdown()
})
