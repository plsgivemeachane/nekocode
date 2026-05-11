import { Notification, BrowserWindow, app } from 'electron'
import { join } from 'path'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { IPC_CHANNELS } from '../shared/ipc-channels'
import type { NotificationPayload, NotificationSettings } from '../shared/ipc-types'
import { createLogger } from './logger'

const logger = createLogger('notification')

const DEFAULT_SETTINGS: NotificationSettings = {
  enabled: true,
  soundEnabled: true,
  soundVolume: 0.5,
  useCustomSounds: false,
  tasks: {
    aiResponseComplete: true,
    fileOperationComplete: true,
    extensionOperationComplete: true,
  },
}

/**
 * Focus-aware notification service.
 *
 * - App focused  -> play sound only (no OS notification)
 * - App backgrounded -> OS notification + sound
 * - Debounce: replaces previous notification within 2s cooldown
 *
 * Persists settings to `<userData>/notification-settings.json`.
 */
export class NotificationService {
  private settings: NotificationSettings
  private settingsPath: string
  private lastNotificationTime = 0
  private lastNotificationId: string | null = null
  private DEBOUNCE_MS = 2000
  private loaded = false

  constructor() {
    this.settings = { ...DEFAULT_SETTINGS }
    this.settingsPath = join(app.getPath('userData'), 'notification-settings.json')
  }

  /**
   * Load persisted settings from disk.
   * Call once during app startup before any notifications fire.
   */
  async loadSettings(): Promise<void> {
    if (this.loaded) return
    try {
      const data = await readFile(this.settingsPath, 'utf-8')
      const parsed = JSON.parse(data)
      this.settings = { ...DEFAULT_SETTINGS, ...parsed, tasks: { ...DEFAULT_SETTINGS.tasks, ...parsed.tasks } }
      logger.info('Notification settings loaded')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('Failed to load notification settings, using defaults', err)
      }
    }
    this.loaded = true
  }

  /**
   * Main entry point -- called by session-manager, project-manager, etc.
   *
   * 1. Check if notifications are enabled
   * 2. Check if the specific task type is enabled
   * 3. Check if app is focused
   *    - Focused: only send IPC play-sound to renderer
   *    - Backgrounded: show Electron.Notification + send IPC play-sound
   * 4. Debounce: if previous notification < 2s ago, skip
   */
  notify(payload: NotificationPayload): void {
    if (!this.settings.enabled) return
    if (!this.settings.soundEnabled && !this.isAppFocused()) return

    const now = Date.now()
    if (now - this.lastNotificationTime < this.DEBOUNCE_MS) {
      logger.debug(`Debounced notification: ${payload.title}`)
      return
    }
    this.lastNotificationTime = now

    const focused = this.isAppFocused()

    if (focused) {
      logger.debug(`App focused, sound-only: ${payload.title}`)
    } else {
      logger.info(`Showing OS notification: ${payload.title}`)
      this.showOsNotification(payload)
    }

    this.sendPlaySound(payload)
  }

  getSettings(): NotificationSettings {
    return { ...this.settings }
  }

  async updateSettings(partial: Partial<NotificationSettings>): Promise<NotificationSettings> {
    if (partial.tasks) {
      this.settings.tasks = { ...this.settings.tasks, ...partial.tasks }
      partial = { ...partial }
      delete partial.tasks
    }
    Object.assign(this.settings, partial)
    await this.persistSettings()
    logger.info('Notification settings updated')
    return this.getSettings()
  }

  private isAppFocused(): boolean {
    const win = BrowserWindow.getFocusedWindow()
    return win !== null && win !== undefined && !win.isDestroyed() && win.isFocused()
  }

  private showOsNotification(payload: NotificationPayload): void {
    try {
      const notification = new Notification({
        title: payload.title,
        body: payload.body,
        silent: true,
      })

      notification.on('failed', () => {
        logger.warn('OS notification failed (unsigned build on macOS?)')
      })

      notification.on('click', () => {
        const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed())
        if (win) {
          if (win.isMinimized()) win.restore()
          win.focus()
        }
      })

      notification.show()
      this.lastNotificationId = payload.soundKey
    } catch (err) {
      logger.warn('Failed to show OS notification', err)
    }
  }

  private sendPlaySound(payload: NotificationPayload): void {
    if (!this.settings.soundEnabled) return
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.NOTIFICATION_PLAY_SOUND, payload)
      }
    }
  }

  private async persistSettings(): Promise<void> {
    try {
      const dir = join(this.settingsPath, '..')
      await mkdir(dir, { recursive: true })
      await writeFile(this.settingsPath, JSON.stringify(this.settings, null, 2), 'utf-8')
    } catch (err) {
      logger.error('Failed to persist notification settings', err)
    }
  }
}
