import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../shared/ipc-channels'
import { registerIpcHandlers } from '../main/ipc-handlers'

const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
  dialog: {
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
  },
  app: {
    getPath: vi.fn(() => '/tmp/test-logs'),
  },
}))

describe('registerIpcHandlers extension diagnostics', () => {
  type RegisterParams = Parameters<typeof registerIpcHandlers>

  beforeEach(() => {
    handlers.clear()
  })

  it('returns extension errors on SESSION_CREATE', async () => {
    const extensionErrors = [{ path: '/tmp/ext.ts', message: 'Failed to load extension: (void 0) is not a function' }]
    const sessionManager = {
      create: vi.fn(async () => 'session-1'),
      getExtensionLoadErrors: vi.fn(() => extensionErrors),
      getExtensionsDisabled: vi.fn(() => false),
    }
    const projectManager = {
      addProject: vi.fn(),
      removeProject: vi.fn(),
      setActiveSession: vi.fn(),
      getActiveSession: vi.fn(() => ({ sessionId: null, projectPath: null })),
      listProjects: vi.fn(() => []),
      refreshSessions: vi.fn(),
    }

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
    const sessionManager = {
      reconnect: vi.fn(async () => []),
      getExtensionLoadErrors: vi.fn(() => extensionErrors),
      getExtensionsDisabled: vi.fn(() => true),
    }
    const projectManager = {
      addProject: vi.fn(),
      removeProject: vi.fn(),
      setActiveSession: vi.fn(),
      getActiveSession: vi.fn(() => ({ sessionId: null, projectPath: null })),
      listProjects: vi.fn(() => []),
      refreshSessions: vi.fn(),
    }

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
})
