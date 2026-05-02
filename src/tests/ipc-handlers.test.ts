import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../shared/ipc-channels'
import { registerIpcHandlers, sendEventToRenderer } from '../main/ipc-handlers'
import { createProjectManagerMock, createSessionManagerMock } from './__utils__/test-utils'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
const electronState = {
  windows: [] as Array<{ isDestroyed: () => boolean; webContents: { send: ReturnType<typeof vi.fn> } }>,
  openDialogResult: { canceled: true, filePaths: [] as string[] },
}

vi.mock('electron-updater', () => ({
  autoUpdater: {
    logger: undefined,
    autoDownload: false,
    autoInstallOnAppQuit: true,
    allowDowngrade: false,
    allowPrerelease: false,
    currentVersion: { version: '0.0.0-test' },
    on: vi.fn(),
    checkForUpdates: vi.fn(async () => null),
    checkForUpdatesAndNotify: vi.fn(async () => null),
    downloadUpdate: vi.fn(async () => undefined),
    quitAndInstall: vi.fn(),
  },
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => electronState.windows),
  },
  dialog: {
    showOpenDialog: vi.fn(async () => electronState.openDialogResult),
  },
  app: {
    getPath: vi.fn(() => '/tmp/test-logs'),
  },
}))

describe('ipc handlers', () => {
  type RegisterParams = Parameters<typeof registerIpcHandlers>

  beforeEach(() => {
    handlers.clear()
    electronState.windows = []
    electronState.openDialogResult = { canceled: true, filePaths: [] }
  })

  it('returns extension errors on SESSION_CREATE', async () => {
    const extensionErrors = [{ path: '/tmp/ext.ts', message: 'Failed to load extension: (void 0) is not a function' }]
    const sessionManager = createSessionManagerMock({
      create: vi.fn(async () => 'session-1'),
      getExtensionLoadErrors: vi.fn(() => extensionErrors),
      getExtensionsDisabled: vi.fn(() => false),
    })
    const projectManager = createProjectManagerMock()

    registerIpcHandlers(
      sessionManager as unknown as RegisterParams[0],
      projectManager as unknown as RegisterParams[1],
    )

    const createHandler = handlers.get(IPC_CHANNELS.SESSION_CREATE)
    expect(createHandler).toBeDefined()

    const result = await createHandler!({}, { cwd: '/tmp/project' }) as {
      sessionId: string
      extensionErrors?: Array<{ path: string; message: string }>
      extensionsDisabled?: boolean
    }

    expect(result.sessionId).toBe('session-1')
    expect(result.extensionErrors).toEqual(extensionErrors)
    expect(result.extensionsDisabled).toBe(false)
  })

  it('returns extension errors on SESSION_RECONNECT', async () => {
    const extensionErrors = [{ path: '/tmp/ext.ts', message: 'Failed to load extension: (void 0) is not a function', stack: 'TypeError...' }]
    const sessionManager = createSessionManagerMock({
      reconnect: vi.fn(async () => []),
      getExtensionLoadErrors: vi.fn(() => extensionErrors),
      getExtensionsDisabled: vi.fn(() => true),
    })
    const projectManager = createProjectManagerMock()

    registerIpcHandlers(
      sessionManager as unknown as RegisterParams[0],
      projectManager as unknown as RegisterParams[1],
    )

    const reconnectHandler = handlers.get(IPC_CHANNELS.SESSION_RECONNECT)
    expect(reconnectHandler).toBeDefined()

    const result = await reconnectHandler!({}, { sessionId: 'session-1', cwd: '/tmp/project' }) as {
      sessionId: string
      extensionErrors?: Array<{ path: string; message: string; stack?: string }>
      extensionsDisabled?: boolean
    }

    expect(result.sessionId).toBe('session-1')
    expect(result.extensionErrors).toEqual(extensionErrors)
    expect(result.extensionsDisabled).toBe(true)
  })

  it('routes dialog handler for canceled and selected folder', async () => {
    const sessionManager = createSessionManagerMock()
    const projectManager = createProjectManagerMock()
    registerIpcHandlers(sessionManager as unknown as RegisterParams[0], projectManager as unknown as RegisterParams[1])

    const dialogHandler = handlers.get(IPC_CHANNELS.DIALOG_OPEN_FOLDER)!
    expect(await dialogHandler({}, {})).toBeNull()

    electronState.openDialogResult = { canceled: false, filePaths: ['/tmp/folder'] }
    expect(await dialogHandler({}, {})).toBe('/tmp/folder')
  })

  it('routes update handlers', async () => {
    const sessionManager = createSessionManagerMock()
    const projectManager = createProjectManagerMock()
    registerIpcHandlers(sessionManager as unknown as RegisterParams[0], projectManager as unknown as RegisterParams[1])

    expect(await handlers.get(IPC_CHANNELS.UPDATE_CHECK)!({}, {})).toBeNull()
    await expect(handlers.get(IPC_CHANNELS.UPDATE_DOWNLOAD)!({}, {})).resolves.toBeUndefined()
    await expect(handlers.get(IPC_CHANNELS.UPDATE_INSTALL)!({}, {})).resolves.toBeUndefined()
  })

  it('throws through on session create/project add failures', async () => {
    const sessionManager = createSessionManagerMock({
      create: vi.fn(async () => { throw new Error('create-failed') }),
    })
    const projectManager = createProjectManagerMock({
      addProject: vi.fn(async () => { throw new Error('project-add-failed') }),
    })
    registerIpcHandlers(sessionManager as unknown as RegisterParams[0], projectManager as unknown as RegisterParams[1])

    await expect(handlers.get(IPC_CHANNELS.SESSION_CREATE)!({}, { cwd: '/tmp/project' })).rejects.toThrow('create-failed')
    await expect(handlers.get(IPC_CHANNELS.PROJECT_ADD)!({}, { path: '/tmp/project' })).rejects.toThrow('project-add-failed')
  })

  it('forwards session events only to live windows', () => {
    const sendLive = vi.fn()
    const sendDead = vi.fn()
    electronState.windows = [
      { isDestroyed: () => false, webContents: { send: sendLive } },
      { isDestroyed: () => true, webContents: { send: sendDead } },
    ]

    sendEventToRenderer('s1', { type: 'done' })

    expect(sendLive).toHaveBeenCalledWith(IPC_CHANNELS.SESSION_EVENTS, {
      sessionId: 's1',
      event: { type: 'done' },
    })
    expect(sendDead).not.toHaveBeenCalled()
  })
})
