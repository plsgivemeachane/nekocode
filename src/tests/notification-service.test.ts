import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Hoisted mock functions (safe for vi.mock factories) ────────────
const {
  mockSend, mockShow, mockOn, MockNotificationConstructor,
  mockIsFocused, mockIsDestroyed, mockIsMinimized, mockRestore, mockFocus,
  mockReadFile, mockWriteFile, mockMkdir,
  notificationShouldThrow,
} = vi.hoisted(() => {
  const mockShow = vi.fn()
  const mockOn = vi.fn()
  const notificationShouldThrow = { value: false }
  return {
    mockSend: vi.fn(),
    mockShow,
    mockOn,
    // Use class keyword for constructor mock to satisfy Vitest best-practice warning.
    // The `shouldThrow` flag allows tests to simulate "Notification not supported" errors.
    MockNotificationConstructor: class MockNotification {
      constructor() {
        if (notificationShouldThrow.value) {
          throw new Error('Notification not supported')
        }
        return { show: mockShow, on: mockOn }
      }
    },
    mockIsFocused: vi.fn(() => true),
    mockIsDestroyed: vi.fn(() => false),
    mockIsMinimized: vi.fn(() => false),
    mockRestore: vi.fn(),
    mockFocus: vi.fn(),
    mockReadFile: vi.fn(),
    mockWriteFile: vi.fn(),
    mockMkdir: vi.fn(),
    notificationShouldThrow,
  }
})

// ── Mock logger ────────────────────────────────────────────────────
vi.mock('../main/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

// ── Mock fs/promises ─────────────────────────────────────────────
vi.mock('fs/promises', () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
}))

// ── Mock path ─────────────────────────────────────────────────────
vi.mock('path', () => ({
  join: (...args: string[]) => args.join('/'),
}))

// ── Mock electron ─────────────────────────────────────────────────
vi.mock('electron', () => ({
  Notification: MockNotificationConstructor,
  BrowserWindow: {
    getFocusedWindow: vi.fn(),
    getAllWindows: vi.fn(() => [
      {
        isDestroyed: mockIsDestroyed,
        isFocused: mockIsFocused,
        webContents: { send: mockSend },
        isMinimized: mockIsMinimized,
        restore: mockRestore,
        focus: mockFocus,
      },
    ]),
  },
  app: {
    getPath: vi.fn(() => '/mock/userdata'),
  },
}))

// Import after mocks
import { NotificationService } from '../main/notification-service'
import { BrowserWindow } from 'electron'

describe('NotificationService', () => {
  let service: NotificationService

  beforeEach(() => {
    vi.clearAllMocks()
    mockIsFocused.mockReturnValue(true)
    mockIsDestroyed.mockReturnValue(false)
    mockIsMinimized.mockReturnValue(false)
    notificationShouldThrow.value = false
    service = new NotificationService()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('constructor', () => {
    it('should initialize with default settings', () => {
      const settings = service.getSettings()
      expect(settings.enabled).toBe(true)
      expect(settings.soundEnabled).toBe(true)
      expect(settings.soundVolume).toBe(0.5)
      expect(settings.useCustomSounds).toBe(false)
      expect(settings.tasks.aiResponseComplete).toBe(true)
      expect(settings.tasks.fileOperationComplete).toBe(true)
      expect(settings.tasks.extensionOperationComplete).toBe(true)
    })
  })

  describe('loadSettings', () => {
    it('should load settings from disk on first call', async () => {
      const persisted = {
        enabled: false,
        soundVolume: 0.8,
        tasks: { aiResponseComplete: false },
      }
      mockReadFile.mockResolvedValue(JSON.stringify(persisted))

      await service.loadSettings()
      const settings = service.getSettings()

      expect(settings.enabled).toBe(false)
      expect(settings.soundVolume).toBe(0.8)
      expect(settings.tasks.aiResponseComplete).toBe(false)
      expect(settings.tasks.fileOperationComplete).toBe(true)
      expect(mockReadFile).toHaveBeenCalled()
    })

    it('should be idempotent — skip on second call', async () => {
      mockReadFile.mockResolvedValue('{}')
      await service.loadSettings()
      await service.loadSettings()
      expect(mockReadFile).toHaveBeenCalledTimes(1)
    })

    it('should use defaults when file does not exist (ENOENT)', async () => {
      const enoentErr = new Error('not found') as NodeJS.ErrnoException
      enoentErr.code = 'ENOENT'
      mockReadFile.mockRejectedValue(enoentErr)

      await service.loadSettings()
      const settings = service.getSettings()

      expect(settings.enabled).toBe(true)
      expect(settings.soundVolume).toBe(0.5)
    })

    it('should use defaults and log warning on other read errors', async () => {
      mockReadFile.mockRejectedValue(new Error('permission denied'))

      await service.loadSettings()
      const settings = service.getSettings()

      expect(settings.enabled).toBe(true)
    })
  })

  describe('notify', () => {
    const payload = {
      title: 'Test Notification',
      body: 'Test body',
      soundKey: 'task-complete' as const,
    }

    it('should skip notification when disabled', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ enabled: false }))
      await service.loadSettings()

      service.notify(payload)
      expect(mockShow).not.toHaveBeenCalled()
      expect(mockSend).not.toHaveBeenCalled()
    })

    it('should only send sound IPC when app is focused', async () => {
      mockReadFile.mockResolvedValue('{}')
      await service.loadSettings()
      vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue({
        isDestroyed: mockIsDestroyed,
        isFocused: mockIsFocused,
      } as unknown as Electron.BrowserWindow)
      mockIsFocused.mockReturnValue(true)

      service.notify(payload)

      expect(mockShow).not.toHaveBeenCalled()
      expect(mockSend).toHaveBeenCalledWith('notification:play-sound', payload)
    })

    it('should show OS notification and send sound when app is not focused', async () => {
      mockReadFile.mockResolvedValue('{}')
      await service.loadSettings()
      vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(null)

      service.notify(payload)

      expect(mockShow).toHaveBeenCalled()
      expect(mockSend).toHaveBeenCalledWith('notification:play-sound', payload)
    })

    it('should debounce rapid notifications within 2s', async () => {
      mockReadFile.mockResolvedValue('{}')
      await service.loadSettings()
      vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(null)

      service.notify(payload)
      service.notify({ ...payload, title: 'Second' })

      expect(mockShow).toHaveBeenCalledTimes(1)
    })

    it('should allow notification after debounce window passes', async () => {
      mockReadFile.mockResolvedValue('{}')
      await service.loadSettings()
      vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(null)

      service.notify(payload)

      // Debounce uses Date.now(), not timers — mock it directly
      const realNow = Date.now
      const firstCallTime = Date.now()
      Date.now = vi.fn(() => firstCallTime + 2100)

      service.notify({ ...payload, title: 'Second' })
      expect(mockShow).toHaveBeenCalledTimes(2)

      Date.now = realNow
    })

    it('should not send sound when soundEnabled is false and app is focused', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ soundEnabled: false }))
      await service.loadSettings()
      vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue({
        isDestroyed: mockIsDestroyed,
        isFocused: mockIsFocused,
      } as unknown as Electron.BrowserWindow)
      mockIsFocused.mockReturnValue(true)

      service.notify(payload)
      expect(mockSend).not.toHaveBeenCalled()
    })

    it('should skip entirely when soundEnabled is false and app is backgrounded', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ soundEnabled: false }))
      await service.loadSettings()
      vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(null)

      service.notify(payload)
      expect(mockShow).not.toHaveBeenCalled()
      expect(mockSend).not.toHaveBeenCalled()
    })
  })

  describe('updateSettings', () => {
    it('should merge partial top-level settings', async () => {
      mockReadFile.mockResolvedValue('{}')
      await service.loadSettings()
      mockWriteFile.mockResolvedValue(undefined)
      mockMkdir.mockResolvedValue(undefined)

      const result = await service.updateSettings({ soundVolume: 0.9 })
      expect(result.soundVolume).toBe(0.9)
      expect(result.enabled).toBe(true)
    })

    it('should merge partial task settings', async () => {
      mockReadFile.mockResolvedValue('{}')
      await service.loadSettings()
      mockWriteFile.mockResolvedValue(undefined)
      mockMkdir.mockResolvedValue(undefined)

      const result = await service.updateSettings({
        tasks: { aiResponseComplete: false, fileOperationComplete: true, extensionOperationComplete: true },
      })
      expect(result.tasks.aiResponseComplete).toBe(false)
      expect(result.tasks.fileOperationComplete).toBe(true)
    })

    it('should persist settings to disk', async () => {
      mockReadFile.mockResolvedValue('{}')
      await service.loadSettings()
      mockWriteFile.mockResolvedValue(undefined)
      mockMkdir.mockResolvedValue(undefined)

      await service.updateSettings({ enabled: false })
      expect(mockWriteFile).toHaveBeenCalled()
    })

    it('should return a copy of settings (not a reference)', async () => {
      mockReadFile.mockResolvedValue('{}')
      await service.loadSettings()

      const s1 = service.getSettings()
      const s2 = service.getSettings()
      expect(s1).not.toBe(s2)
      expect(s1).toEqual(s2)
    })
  })

  describe('showOsNotification', () => {
    it('should handle notification click by focusing window', async () => {
      mockReadFile.mockResolvedValue('{}')
      await service.loadSettings()
      vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(null)

      let clickHandler: (() => void) | undefined
      mockOn.mockImplementation((event: string, cb: () => void) => {
        if (event === 'click') clickHandler = cb
      })

      service.notify({ title: 'Click Test', body: 'body', soundKey: 'task-complete' })
      clickHandler?.()
      expect(mockFocus).toHaveBeenCalled()
    })

    it('should restore minimized window on click', async () => {
      mockReadFile.mockResolvedValue('{}')
      await service.loadSettings()
      vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(null)
      mockIsMinimized.mockReturnValue(true)

      let clickHandler: (() => void) | undefined
      mockOn.mockImplementation((event: string, cb: () => void) => {
        if (event === 'click') clickHandler = cb
      })

      service.notify({ title: 'Min Test', body: 'body', soundKey: 'task-complete' })
      clickHandler?.()
      expect(mockRestore).toHaveBeenCalled()
    })

    it('should handle Notification constructor errors gracefully', async () => {
      mockReadFile.mockResolvedValue('{}')
      await service.loadSettings()
      vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(null)

      // Use the class-level shouldThrow flag to simulate "Notification not supported"
      notificationShouldThrow.value = true

      expect(() =>
        service.notify({ title: 'Err', body: 'body', soundKey: 'task-complete' }),
      ).not.toThrow()
    })
  })

  describe('sendPlaySound', () => {
    it('should not send to destroyed windows', async () => {
      mockReadFile.mockResolvedValue('{}')
      await service.loadSettings()
      vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(null)
      mockIsDestroyed.mockReturnValue(true)

      service.notify({ title: 'Test', body: 'body', soundKey: 'task-complete' })
      expect(mockSend).not.toHaveBeenCalled()
    })
  })
})
