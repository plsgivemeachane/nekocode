import { autoUpdater } from 'electron-updater'
import log from 'electron-log'
import { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc-channels'
import type { UpdateAvailableInfo, UpdateProgress, UpdateErrorInfo } from '../shared/ipc-types'
import { createLogger } from './logger'

const logger = createLogger('updater')

// Configure electron-updater logger
autoUpdater.logger = log
log.transports.file.level = 'info'

autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true
autoUpdater.allowDowngrade = false
autoUpdater.allowPrerelease = false

function sendToRenderer(channel: string, ...args: unknown[]): void {
  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, ...args)
    }
  }
}

autoUpdater.on('checking-for-update', () => {
  logger.info('Checking for update...')
})

autoUpdater.on('update-available', (info) => {
  const payload: UpdateAvailableInfo = {
    version: info.version,
    releaseDate: info.releaseDate ?? new Date().toISOString(),
    releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
    currentVersion: autoUpdater.currentVersion.version,
  }
  logger.info(`Update available: ${info.version}`)
  sendToRenderer(IPC_CHANNELS.UPDATE_AVAILABLE, payload)
})

autoUpdater.on('update-not-available', (info) => {
  logger.info(`Update not available. Current: ${info.version}`)
  sendToRenderer(IPC_CHANNELS.UPDATE_NOT_AVAILABLE)
})

autoUpdater.on('download-progress', (progressObj) => {
  const payload: UpdateProgress = {
    percent: progressObj.percent,
    bytesPerSecond: progressObj.bytesPerSecond,
    transferred: progressObj.transferred,
    total: progressObj.total,
  }
  sendToRenderer(IPC_CHANNELS.UPDATE_PROGRESS, payload)
})

autoUpdater.on('update-downloaded', (info) => {
  logger.info(`Update downloaded: ${info.version}`)
  sendToRenderer(IPC_CHANNELS.UPDATE_DOWNLOADED, { version: info.version })
})

autoUpdater.on('error', (err) => {
  const payload: UpdateErrorInfo = {
    message: err.message,
    code: (err as Error & { code?: string }).code,
  }
  logger.error('Auto-updater error:', err)
  sendToRenderer(IPC_CHANNELS.UPDATE_ERROR, payload)
})

/**
 * Check for updates. Returns update info if available, null otherwise.
 */
export async function checkForUpdate(): Promise<UpdateAvailableInfo | null> {
  try {
    const result = await autoUpdater.checkForUpdates()
    if (result?.updateInfo && result.downloadPromise) {
      return {
        version: result.updateInfo.version,
        releaseDate: result.updateInfo.releaseDate ?? new Date().toISOString(),
        releaseNotes: typeof result.updateInfo.releaseNotes === 'string' ? result.updateInfo.releaseNotes : undefined,
        currentVersion: autoUpdater.currentVersion.version,
      }
    }
    return null
  } catch (err) {
    logger.error('Failed to check for updates:', err)
    return null
  }
}

/**
 * Start downloading the available update.
 */
export async function downloadUpdate(): Promise<void> {
  await autoUpdater.downloadUpdate()
}

/**
 * Quit and install the downloaded update.
 */
export function quitAndInstall(): void {
  autoUpdater.quitAndInstall(false, true)
}

/**
 * Initialize auto-updater: check on first window ready.
 * Should be called after app.whenReady().
 */
export function initAutoUpdater(getMainWindow: () => BrowserWindow | null): void {
  const mainWindow = getMainWindow()
  if (!mainWindow) return

  mainWindow.once('ready-to-show', () => {
    // Delay initial check slightly to avoid blocking app startup
    setTimeout(() => {
      autoUpdater.checkForUpdatesAndNotify().catch((err) => {
        logger.error('Initial update check failed:', err)
      })
    }, 3000)
  })
}
