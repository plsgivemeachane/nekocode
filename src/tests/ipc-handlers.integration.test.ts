import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../shared/ipc-channels'
import { registerIpcHandlers } from '../main/ipc-handlers'
import { ProjectManager } from '../main/project-manager'
import type { ChatMessageIPC, ModelInfo } from '../shared/ipc-types'
import { SessionManager } from '@mariozechner/pi-coding-agent'

const handlers = new Map<string, (...args: unknown[]) => unknown>()

const electronState = {
  openDialogResult: { canceled: true, filePaths: [] as string[] },
}

const fsState = {
  readData: '' as string,
  readError: null as Error | null,
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
    getAllWindows: vi.fn(() => []),
  },
  dialog: {
    showOpenDialog: vi.fn(async () => electronState.openDialogResult),
  },
  app: {
    getPath: vi.fn(() => '/tmp/test-userdata'),
  },
}))

vi.mock('fs/promises', () => ({
  readFile: vi.fn(async () => {
    if (fsState.readError) throw fsState.readError
    return fsState.readData
  }),
  writeFile: vi.fn(async () => undefined),
  mkdir: vi.fn(async () => undefined),
}))

vi.mock('@mariozechner/pi-coding-agent', () => ({
  SessionManager: {
    list: vi.fn(async () => []),
  },
}))

class StatefulSessionManager {
  private nextId = 1
  private histories = new Map<string, ChatMessageIPC[]>()
  private activeModel = new Map<string, ModelInfo>()
  private extensionErrors = new Map<string, Array<{ path: string; message: string; stack?: string }>>()
  private extensionsDisabled = new Map<string, boolean>()

  readonly prompts: Array<{ sessionId: string; text: string }> = []
  readonly aborted: string[] = []
  readonly disposed: string[] = []

  async create(cwd: string): Promise<string> {
    void cwd
    const id = `session-${this.nextId++}`
    this.histories.set(id, [])
    this.activeModel.set(id, { id: 'model-1', name: 'Model 1', provider: 'mock' })
    this.extensionErrors.set(id, [{ path: '/tmp/ext.ts', message: 'extension warning' }])
    this.extensionsDisabled.set(id, false)
    return id
  }

  async prompt(sessionId: string, text: string): Promise<void> {
    this.prompts.push({ sessionId, text })
    const history = this.histories.get(sessionId)
    if (!history) throw new Error(`unknown session ${sessionId}`)
    history.push({ id: `u-${history.length + 1}`, role: 'user', content: text, timestamp: Date.now() })
  }

  abort(sessionId: string): void {
    this.aborted.push(sessionId)
  }

  dispose(sessionId: string): void {
    this.disposed.push(sessionId)
  }

  async reconnect(sessionId: string, cwd: string): Promise<ChatMessageIPC[]> {
    void cwd
    return this.getHistory(sessionId)
  }

  getHistory(sessionId: string): ChatMessageIPC[] {
    return [...(this.histories.get(sessionId) ?? [])]
  }

  getModel(sessionId: string): ModelInfo | null {
    return this.activeModel.get(sessionId) ?? null
  }

  async listModels(): Promise<ModelInfo[]> {
    return [{ id: 'model-1', name: 'Model 1', provider: 'mock' }]
  }

  async setModel(sessionId: string, provider: string, modelId: string): Promise<ModelInfo> {
    const model = { id: modelId, name: modelId.toUpperCase(), provider }
    this.activeModel.set(sessionId, model)
    return model
  }

  getExtensionLoadErrors(sessionId: string): Array<{ path: string; message: string; stack?: string }> {
    return this.extensionErrors.get(sessionId) ?? []
  }

  getExtensionsDisabled(sessionId: string): boolean {
    return this.extensionsDisabled.get(sessionId) ?? false
  }
}

describe('ipc handlers integration', () => {
  const mockedList = vi.mocked(SessionManager.list)

  beforeEach(() => {
    handlers.clear()
    electronState.openDialogResult = { canceled: true, filePaths: [] }
    fsState.readData = ''
    fsState.readError = null
    mockedList.mockReset()
    mockedList.mockResolvedValue([])
  })

  it('bridges session lifecycle behavior through IPC handlers', async () => {
    const sessionManager = new StatefulSessionManager()
    const projectManager = new ProjectManager()

    registerIpcHandlers(
      sessionManager as unknown as Parameters<typeof registerIpcHandlers>[0],
      projectManager as Parameters<typeof registerIpcHandlers>[1],
    )

    const created = await handlers.get(IPC_CHANNELS.SESSION_CREATE)!({}, { cwd: '/tmp/project' }) as {
      sessionId: string
      extensionErrors?: Array<{ path: string; message: string }>
      extensionsDisabled?: boolean
    }

    await handlers.get(IPC_CHANNELS.SESSION_PROMPT)!({}, { sessionId: created.sessionId, text: 'hello integration' })
    const history = await handlers.get(IPC_CHANNELS.SESSION_LOAD_HISTORY)!({}, { sessionId: created.sessionId }) as ChatMessageIPC[]
    const reconnect = await handlers.get(IPC_CHANNELS.SESSION_RECONNECT)!({}, { sessionId: created.sessionId, cwd: '/tmp/project' }) as {
      sessionId: string
      history: ChatMessageIPC[]
      extensionErrors?: Array<{ path: string; message: string }>
      extensionsDisabled?: boolean
    }
    await handlers.get(IPC_CHANNELS.SESSION_ABORT)!({}, { sessionId: created.sessionId })
    await handlers.get(IPC_CHANNELS.SESSION_DISPOSE)!({}, { sessionId: created.sessionId })

    expect(created.sessionId).toBe('session-1')
    expect(created.extensionErrors).toEqual([{ path: '/tmp/ext.ts', message: 'extension warning' }])
    expect(created.extensionsDisabled).toBe(false)
    expect(history).toHaveLength(1)
    expect(history[0]?.content).toBe('hello integration')
    expect(reconnect.history).toHaveLength(1)
    expect(sessionManager.prompts).toEqual([{ sessionId: 'session-1', text: 'hello integration' }])
    expect(sessionManager.aborted).toEqual(['session-1'])
    expect(sessionManager.disposed).toEqual(['session-1'])
  })

  it('bridges project and workspace behavior with real ProjectManager', async () => {
    mockedList.mockResolvedValue([
      {
        path: '/tmp/project/session-1.json',
        id: 'sess-1',
        cwd: '/tmp/project',
        created: new Date('2026-01-01T00:00:00.000Z'),
        modified: new Date('2026-01-01T00:00:00.000Z'),
        messageCount: 1,
        firstMessage: 'hello',
        allMessagesText: 'hello',
      },
    ])

    const sessionManager = new StatefulSessionManager()
    const projectManager = new ProjectManager()

    registerIpcHandlers(
      sessionManager as unknown as Parameters<typeof registerIpcHandlers>[0],
      projectManager as Parameters<typeof registerIpcHandlers>[1],
    )

    const added = await handlers.get(IPC_CHANNELS.PROJECT_ADD)!({}, { path: '/tmp/project' }) as { id: string; sessions: unknown[] }
    const listed = await handlers.get(IPC_CHANNELS.PROJECT_LIST)!({}, {}) as Array<{ id: string; path: string; sessions: unknown[] }>
    const refreshed = await handlers.get(IPC_CHANNELS.PROJECT_SESSIONS)!({}, { projectId: added.id }) as { id: string; sessions: unknown[] }

    await handlers.get(IPC_CHANNELS.WORKSPACE_SET_ACTIVE)!({}, { sessionId: 'sess-1', projectPath: '/tmp/project' })
    const active = await handlers.get(IPC_CHANNELS.WORKSPACE_GET_ACTIVE)!({}, {}) as { sessionId: string | null; projectPath: string | null }

    expect(added.id).toBeDefined()
    expect(added.sessions).toHaveLength(1)
    expect(listed).toHaveLength(1)
    expect(listed[0]?.path).toBe('/tmp/project')
    expect(refreshed.id).toBe(added.id)
    expect(refreshed.sessions).toHaveLength(1)
    expect(active).toEqual({ sessionId: 'sess-1', projectPath: '/tmp/project' })
  })

  it('returns selected folder from dialog handler', async () => {
    const sessionManager = new StatefulSessionManager()
    const projectManager = new ProjectManager()

    registerIpcHandlers(
      sessionManager as unknown as Parameters<typeof registerIpcHandlers>[0],
      projectManager as Parameters<typeof registerIpcHandlers>[1],
    )

    const openFolder = handlers.get(IPC_CHANNELS.DIALOG_OPEN_FOLDER)!
    expect(await openFolder({}, {})).toBeNull()

    electronState.openDialogResult = { canceled: false, filePaths: ['/tmp/chosen'] }
    expect(await openFolder({}, {})).toBe('/tmp/chosen')
  })
})
