import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@/shared/ipc-channels'

const { updaterHandlers, updaterState, autoUpdaterMock } = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => void>()
  const state = {
    windows: [] as Array<{ isDestroyed: () => boolean; webContents: { send: ReturnType<typeof vi.fn> } }>,
    checkForUpdatesResult: null as null | { updateInfo?: { version: string; releaseDate?: string; releaseNotes?: unknown }; downloadPromise?: Promise<void> },
    checkForUpdatesReject: null as null | Error,
    checkForUpdatesAndNotifyReject: null as null | Error,
  }

  const updater = {
    logger: undefined as unknown,
    autoDownload: true,
    autoInstallOnAppQuit: false,
    allowDowngrade: true,
    allowPrerelease: true,
    currentVersion: { version: '1.0.0' },
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      handlers.set(event, cb)
    }),
    checkForUpdates: vi.fn(async () => {
      if (state.checkForUpdatesReject) {
        throw state.checkForUpdatesReject
      }
      return state.checkForUpdatesResult
    }),
    checkForUpdatesAndNotify: vi.fn(async () => {
      if (state.checkForUpdatesAndNotifyReject) {
        throw state.checkForUpdatesAndNotifyReject
      }
      return null
    }),
    downloadUpdate: vi.fn(async () => undefined),
    quitAndInstall: vi.fn(),
  }

  return {
    updaterHandlers: handlers,
    updaterState: state,
    autoUpdaterMock: updater,
  }
})

vi.mock('electron-updater', () => ({
  autoUpdater: autoUpdaterMock,
}))

vi.mock('electron-log', () => ({
  default: {
    transports: {
      file: {
        level: 'debug',
      },
    },
  },
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => updaterState.windows),
  },
  app: {
    getPath: vi.fn(() => '/tmp/test-logs'),
  },
}))

import { checkForUpdate, downloadUpdate, initAutoUpdater, quitAndInstall } from '@/main/updater'

describe('updater', () => {
  beforeEach(() => {
    updaterState.windows = []
    updaterState.checkForUpdatesResult = null
    updaterState.checkForUpdatesReject = null
    updaterState.checkForUpdatesAndNotifyReject = null
    vi.clearAllMocks()
  })

  it('configures autoUpdater defaults at module init', () => {
    expect(autoUpdaterMock.autoDownload).toBe(false)
    expect(autoUpdaterMock.autoInstallOnAppQuit).toBe(true)
    expect(autoUpdaterMock.allowDowngrade).toBe(false)
    expect(autoUpdaterMock.allowPrerelease).toBe(false)
  })

  it('returns null when no downloadable update exists', async () => {
    updaterState.checkForUpdatesResult = { updateInfo: { version: '1.2.0' } }
    await expect(checkForUpdate()).resolves.toBeNull()
  })

  it('returns update payload when update and downloadPromise exist', async () => {
    updaterState.checkForUpdatesResult = {
      updateInfo: {
        version: '1.2.0',
        releaseDate: '2026-04-16T00:00:00.000Z',
        releaseNotes: 'fixes',
      },
      downloadPromise: Promise.resolve(),
    }

    await expect(checkForUpdate()).resolves.toEqual({
      version: '1.2.0',
      releaseDate: '2026-04-16T00:00:00.000Z',
      releaseNotes: 'fixes',
      currentVersion: '1.0.0',
    })
  })

  it('returns null on checkForUpdates error', async () => {
    updaterState.checkForUpdatesReject = new Error('network-error')
    await expect(checkForUpdate()).resolves.toBeNull()
  })

  it('delegates download and install', async () => {
    await downloadUpdate()
    quitAndInstall()

    expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledTimes(1)
    expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalledWith(false, true)
  })

  it('initAutoUpdater no-ops without a main window', () => {
    expect(() => initAutoUpdater(() => null)).not.toThrow()
  })

  it('initAutoUpdater schedules check and catches notify error', async () => {
    vi.useFakeTimers()
    updaterState.checkForUpdatesAndNotifyReject = new Error('notify-fail')
    const once = vi.fn((event: string, cb: () => void) => {
      if (event === 'ready-to-show') cb()
    })
    const fakeWindow = { once }

    initAutoUpdater(() => fakeWindow as never)

    vi.advanceTimersByTime(3000)
    await Promise.resolve()

    expect(autoUpdaterMock.checkForUpdatesAndNotify).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('forwards updater events to non-destroyed renderer windows', () => {
    const sendLive = vi.fn()
    const sendDead = vi.fn()
    updaterState.windows = [
      { isDestroyed: () => false, webContents: { send: sendLive } },
      { isDestroyed: () => true, webContents: { send: sendDead } },
    ]

    updaterHandlers.get('update-available')?.({ version: '1.2.0', releaseDate: '2026-04-16T00:00:00.000Z', releaseNotes: ['ignored'] })
    updaterHandlers.get('update-not-available')?.({ version: '1.0.0' })
    updaterHandlers.get('download-progress')?.({ percent: 50, bytesPerSecond: 1000, transferred: 10, total: 20 })
    updaterHandlers.get('update-downloaded')?.({ version: '1.2.0' })
    updaterHandlers.get('error')?.({ message: 'oops', code: 'E_FAIL' })

    expect(sendLive).toHaveBeenCalledWith(IPC_CHANNELS.UPDATE_AVAILABLE, {
      version: '1.2.0',
      releaseDate: '2026-04-16T00:00:00.000Z',
      releaseNotes: undefined,
      currentVersion: '1.0.0',
    })
    expect(sendLive).toHaveBeenCalledWith(IPC_CHANNELS.UPDATE_NOT_AVAILABLE)
    expect(sendLive).toHaveBeenCalledWith(IPC_CHANNELS.UPDATE_PROGRESS, {
      percent: 50,
      bytesPerSecond: 1000,
      transferred: 10,
      total: 20,
    })
    expect(sendLive).toHaveBeenCalledWith(IPC_CHANNELS.UPDATE_DOWNLOADED, { version: '1.2.0' })
    expect(sendLive).toHaveBeenCalledWith(IPC_CHANNELS.UPDATE_ERROR, { message: 'oops', code: 'E_FAIL' })
    expect(sendDead).not.toHaveBeenCalled()
  })
})
