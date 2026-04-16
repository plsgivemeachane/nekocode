import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../shared/ipc-channels'
import { registerIpcHandlers, sendEventToRenderer } from '../main/ipc-handlers'
import { createProjectManagerMock, createSessionManagerMock } from './test-utils'

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

  it('routes prompt/abort/dispose/load-history/model handlers', async () => {
    const sessionState = {
      prompts: [] as Array<{ sessionId: string; text: string }>,
      aborted: [] as string[],
      disposed: [] as string[],
    }

    const sessionManager = createSessionManagerMock({
      prompt: vi.fn(async (sessionId: string, text: string) => {
        sessionState.prompts.push({ sessionId, text })
      }),
      abort: vi.fn((sessionId: string) => {
        sessionState.aborted.push(sessionId)
      }),
      dispose: vi.fn((sessionId: string) => {
        sessionState.disposed.push(sessionId)
      }),
      getHistory: vi.fn(() => [{ id: 'm1', role: 'user' as const, content: 'hi', timestamp: 1 }]),
      getModel: vi.fn(() => ({ id: 'm1', name: 'Model', provider: 'mock' })),
      listModels: vi.fn(async () => [{ id: 'm1', name: 'Model', provider: 'mock' }]),
    })
    const projectManager = createProjectManagerMock()
    registerIpcHandlers(sessionManager as unknown as RegisterParams[0], projectManager as unknown as RegisterParams[1])

    await handlers.get(IPC_CHANNELS.SESSION_PROMPT)!({}, { sessionId: 's1', text: 'hello' })
    await handlers.get(IPC_CHANNELS.SESSION_ABORT)!({}, { sessionId: 's1' })
    await handlers.get(IPC_CHANNELS.SESSION_DISPOSE)!({}, { sessionId: 's1' })
    const history = await handlers.get(IPC_CHANNELS.SESSION_LOAD_HISTORY)!({}, { sessionId: 's1' })
    const model = await handlers.get(IPC_CHANNELS.SESSION_GET_MODEL)!({}, { sessionId: 's1' })
    const models = await handlers.get(IPC_CHANNELS.SESSION_LIST_MODELS)!({})
    const updatedModel = await handlers.get(IPC_CHANNELS.SESSION_SET_MODEL)!({}, { sessionId: 's1', provider: 'mock', modelId: 'm1' })

    expect(sessionState.prompts).toEqual([{ sessionId: 's1', text: 'hello' }])
    expect(sessionState.aborted).toEqual(['s1'])
    expect(sessionState.disposed).toEqual(['s1'])
    expect(history).toEqual([{ id: 'm1', role: 'user', content: 'hi', timestamp: 1 }])
    expect(model).toEqual({ id: 'm1', name: 'Model', provider: 'mock' })
    expect(models).toEqual([{ id: 'm1', name: 'Model', provider: 'mock' }])
    expect(updatedModel).toEqual({ id: 'model-1', name: 'Model 1', provider: 'mock' })
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

  it('routes project and workspace handlers', async () => {
    const sessionManager = createSessionManagerMock()
    const workspaceState = { sessionId: null as string | null, projectPath: null as string | null }
    const projectManager = createProjectManagerMock({
      listProjects: vi.fn(() => [{ id: 'project-1', path: '/tmp/project', name: 'project', sessions: [] }]),
      setActiveSession: vi.fn(async (sessionId: string | null, projectPath: string | null) => {
        workspaceState.sessionId = sessionId
        workspaceState.projectPath = projectPath
      }),
      getActiveSession: vi.fn(() => ({ sessionId: workspaceState.sessionId, projectPath: workspaceState.projectPath })),
    })
    registerIpcHandlers(sessionManager as unknown as RegisterParams[0], projectManager as unknown as RegisterParams[1])

    const addResult = await handlers.get(IPC_CHANNELS.PROJECT_ADD)!({}, { path: '/tmp/project' })
    const removeResult = await handlers.get(IPC_CHANNELS.PROJECT_REMOVE)!({}, { id: 'project-1' })
    const listResult = await handlers.get(IPC_CHANNELS.PROJECT_LIST)!({}, {})
    const sessionsResult = await handlers.get(IPC_CHANNELS.PROJECT_SESSIONS)!({}, { projectId: 'project-1' })
    await handlers.get(IPC_CHANNELS.WORKSPACE_SET_ACTIVE)!({}, { sessionId: 's1', projectPath: '/tmp/project' })
    const active = await handlers.get(IPC_CHANNELS.WORKSPACE_GET_ACTIVE)!({}, {})

    expect(addResult).toEqual({ id: 'project-1', path: '/tmp/project', name: 'project', sessions: [] })
    expect(removeResult).toBe(true)
    expect(listResult).toEqual([{ id: 'project-1', path: '/tmp/project', name: 'project', sessions: [] }])
    expect(sessionsResult).toEqual({ id: 'project-1', path: '/tmp/project', name: 'project', sessions: [] })
    expect(active).toEqual({ sessionId: 's1', projectPath: '/tmp/project' })
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
