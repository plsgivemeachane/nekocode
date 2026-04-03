import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { PiSessionManager } from './session-manager'
import { registerIpcHandlers, sendEventToRenderer } from './ipc-handlers'

const sessionManager = new PiSessionManager(sendEventToRenderer)

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
  if (process.platform !== 'darwin') {
    sessionManager.disposeAll()
    app.quit()
  }
})

app.on('before-quit', () => {
  sessionManager.disposeAll()
})
