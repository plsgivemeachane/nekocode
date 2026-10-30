import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../shared/ipc-channels'
import { registerIpcHandlers } from '../main/ipc-handlers'
import { ProjectManager } from '../main/project-manager'
import type { ChatMessageIPC, ModelInfo } from '../shared/ipc-types'
import { SessionManager } from '@earendil-works/pi-coding-agent'

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

vi.mock('@earendil-works/pi-coding-agent', () => ({
  SessionManager: {
    list: vi.fn(async () => []),
  },
}))

// Git operations are mocked at the manager level: each method returns a
// distinct sentinel so tests can assert both delegation (called with the
// right args) and result propagation.
vi.mock('../main/git-operations-manager', () => ({
  gitOperationsManager: {
    getBranch: vi.fn(async () => 'mock-branch'),
    getStatus: vi.fn(async () => ({ isRepo: true, staged: [] as string[], files: [] as Array<{ path: string }> })),
    getLog: vi.fn(async () => ({ all: [] as Array<{ hash: string; message: string }>, latest: undefined })),
    getDiff: vi.fn(async () => ({ diff: 'mock-diff' })),
    getDiffSummary: vi.fn(async () => ({ files: [] as Array<{ path: string; insertions: number; deletions: number }>, totalInsertions: 0, totalDeletions: 0 })),
    stage: vi.fn(async () => undefined),
    unstage: vi.fn(async () => undefined),
    stageAll: vi.fn(async () => undefined),
    unstageAll: vi.fn(async () => undefined),
    commit: vi.fn(async () => ({ hash: 'mock-hash', summary: 'mock commit' })),
    push: vi.fn(async () => undefined),
    pull: vi.fn(async () => ({ summary: 'mock pull', changes: 0 })),
    fetch: vi.fn(async () => undefined),
    branchList: vi.fn(async () => ({ all: ['mock-branch'], current: 'mock-branch' })),
    branchCreate: vi.fn(async () => undefined),
    branchSwitch: vi.fn(async () => undefined),
    stash: vi.fn(async () => undefined),
    stashPop: vi.fn(async () => undefined),
    stashList: vi.fn(async () => ({ stashes: [] as string[], total: 0 })),
    getRemoteUrl: vi.fn(async () => 'https://mock.example/repo.git'),
    isGitRepo: vi.fn(async () => true),
  },
}))

import { gitOperationsManager } from '../main/git-operations-manager'

type MockFn = ReturnType<typeof vi.fn>
const mockGit = gitOperationsManager as unknown as Record<string, MockFn>

class StatefulSessionManager {
  private nextId = 1
  private histories = new Map<string, ChatMessageIPC[]>()
  private activeModel = new Map<string, ModelInfo>()
  private extensionErrors = new Map<string, Array<{ path: string; message: string; stack?: string }>>()
  private extensionsDisabled = new Map<string, boolean>()

  readonly prompts: Array<{ sessionId: string; text: string }> = []
  readonly aborted: string[] = []
  readonly disposed: string[] = []
  readonly deleted: Array<{ sessionId: string; cwd: string }> = []
  readonly uiResponses: Array<{ requestId: string; sessionId: string }> = []

  async deleteSession(sessionId: string, cwd: string): Promise<void> {
    this.deleted.push({ sessionId, cwd })
  }

  async loadHistoryFromDisk(sessionId: string, _cwd: string, _limit?: number): Promise<ChatMessageIPC[]> {
    return [{ id: `disk-${sessionId}`, role: 'assistant', content: 'from disk', timestamp: 0 }]
  }

  async getCommands(sessionId: string) {
    return [{ name: `cmd-${sessionId}`, description: 'mock command' }]
  }

  handleUIResponse(payload: { requestId: string; sessionId: string }): void {
    this.uiResponses.push({ requestId: payload.requestId, sessionId: payload.sessionId })
  }

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
    for (const fn of Object.values(mockGit)) {
      fn.mockReset()
    }
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

  it('routes all 13 session channels through the router with valid sender', async () => {
    const sessionManager = new StatefulSessionManager()
    const projectManager = new ProjectManager()

    registerIpcHandlers(
      sessionManager as unknown as Parameters<typeof registerIpcHandlers>[0],
      projectManager as Parameters<typeof registerIpcHandlers>[1],
    )

    // SESSION_CREATE
    const created = (await handlers.get(IPC_CHANNELS.SESSION_CREATE)!({}, { cwd: '/tmp/project' })) as {
      sessionId: string
      stableId: string
      extensionErrors: Array<{ path: string; message: string }>
      extensionsDisabled: boolean
    }
    expect(created.sessionId).toBe('session-1')
    expect(created.stableId).toBe('session-1')

    // SESSION_PROMPT
    await handlers.get(IPC_CHANNELS.SESSION_PROMPT)!({}, { sessionId: created.sessionId, text: 'session ticket prompt' })
    expect(sessionManager.prompts).toEqual([{ sessionId: 'session-1', text: 'session ticket prompt' }])

    // SESSION_ABORT / SESSION_DISPOSE / SESSION_DELETE
    await handlers.get(IPC_CHANNELS.SESSION_ABORT)!({}, { sessionId: created.sessionId })
    await handlers.get(IPC_CHANNELS.SESSION_DISPOSE)!({}, { sessionId: created.sessionId })
    await handlers.get(IPC_CHANNELS.SESSION_DELETE)!({}, { sessionId: created.sessionId, cwd: '/tmp/project' })
    expect(sessionManager.aborted).toEqual(['session-1'])
    expect(sessionManager.disposed).toEqual(['session-1'])
    expect(sessionManager.deleted).toEqual([{ sessionId: 'session-1', cwd: '/tmp/project' }])

    // SESSION_RECONNECT
    const reconnect = (await handlers.get(IPC_CHANNELS.SESSION_RECONNECT)!({}, { sessionId: created.sessionId, cwd: '/tmp/project' })) as {
      history: ChatMessageIPC[]
    }
    expect(reconnect.history).toHaveLength(1)

    // SESSION_LOAD_HISTORY
    const history = (await handlers.get(IPC_CHANNELS.SESSION_LOAD_HISTORY)!({}, { sessionId: created.sessionId })) as ChatMessageIPC[]
    expect(history).toHaveLength(1)

    // SESSION_LOAD_HISTORY_DISK
    const diskHistory = (await handlers.get(IPC_CHANNELS.SESSION_LOAD_HISTORY_DISK)!({}, {
      sessionId: created.sessionId,
      cwd: '/tmp/project',
      limit: 50,
    })) as ChatMessageIPC[]
    expect(diskHistory).toEqual([{ id: 'disk-session-1', role: 'assistant', content: 'from disk', timestamp: 0 }])

    // SESSION_GET_MODEL
    const model = (await handlers.get(IPC_CHANNELS.SESSION_GET_MODEL)!({}, { sessionId: created.sessionId })) as ModelInfo
    expect(model.id).toBe('model-1')

    // SESSION_LIST_MODELS
    const models = (await handlers.get(IPC_CHANNELS.SESSION_LIST_MODELS)!({}, {})) as ModelInfo[]
    expect(models).toEqual([{ id: 'model-1', name: 'Model 1', provider: 'mock' }])

    // SESSION_SET_MODEL
    const switched = (await handlers.get(IPC_CHANNELS.SESSION_SET_MODEL)!({}, {
      sessionId: created.sessionId,
      provider: 'acme',
      modelId: 'acme-1',
    })) as ModelInfo
    expect(switched).toEqual({ id: 'acme-1', name: 'ACME-1', provider: 'acme' })

    // SESSION_GET_COMMANDS
    const commands = (await handlers.get(IPC_CHANNELS.SESSION_GET_COMMANDS)!({}, { sessionId: created.sessionId })) as Array<{ name: string }>
    expect(commands).toEqual([{ name: 'cmd-session-1', description: 'mock command' }])

    // SESSION_UI_RESPOND
    await handlers.get(IPC_CHANNELS.SESSION_UI_RESPOND)!({}, { requestId: 'req-1', sessionId: created.sessionId, confirmed: true })
    expect(sessionManager.uiResponses).toEqual([{ requestId: 'req-1', sessionId: 'session-1' }])
  })

  it('rejects session handlers called from an untrusted sender', async () => {
    const sessionManager = new StatefulSessionManager()
    const projectManager = new ProjectManager()

    registerIpcHandlers(
      sessionManager as unknown as Parameters<typeof registerIpcHandlers>[0],
      projectManager as Parameters<typeof registerIpcHandlers>[1],
    )

    const untrusted = { senderFrame: { url: 'http://attacker.example' } }

    // Sender from a foreign origin must be rejected on every session channel
    await expect(
      handlers.get(IPC_CHANNELS.SESSION_CREATE)!(untrusted as never, { cwd: '/tmp/project' }),
    ).rejects.toThrow('Unauthorized IPC call')
    await expect(
      handlers.get(IPC_CHANNELS.SESSION_GET_MODEL)!(untrusted as never, { sessionId: 'session-1' }),
    ).rejects.toThrow('Unauthorized IPC call')
    await expect(
      handlers.get(IPC_CHANNELS.SESSION_LIST_MODELS)!(untrusted as never, {}),
    ).rejects.toThrow('Unauthorized IPC call')
    await expect(
      handlers.get(IPC_CHANNELS.SESSION_GET_COMMANDS)!(untrusted as never, { sessionId: 'session-1' }),
    ).rejects.toThrow('Unauthorized IPC call')
    await expect(
      handlers.get(IPC_CHANNELS.SESSION_LOAD_HISTORY_DISK)!(untrusted as never, { sessionId: 'session-1', cwd: '/tmp/project' }),
    ).rejects.toThrow('Unauthorized IPC call')
    // No manager delegation happened for the blocked calls
    expect(sessionManager.deleted).toHaveLength(0)
    expect(sessionManager.uiResponses).toHaveLength(0)
  })

  it('propagates session manager errors to the IPC caller', async () => {
    const sessionManager = new StatefulSessionManager()
    const projectManager = new ProjectManager()

    registerIpcHandlers(
      sessionManager as unknown as Parameters<typeof registerIpcHandlers>[0],
      projectManager as Parameters<typeof registerIpcHandlers>[1],
    )

    // prompt() throws for unknown sessions — the router error boundary must
    // surface the rejection to the caller instead of resolving silently
    await expect(
      handlers.get(IPC_CHANNELS.SESSION_PROMPT)!({}, { sessionId: 'nope', text: 'x' }),
    ).rejects.toThrow('unknown session nope')
  })

  it('routes dialog, project, workspace, and update channels through the router with valid sender', async () => {
    mockedList.mockResolvedValue([])
    const sessionManager = new StatefulSessionManager()
    const projectManager = new ProjectManager()

    registerIpcHandlers(
      sessionManager as unknown as Parameters<typeof registerIpcHandlers>[0],
      projectManager as Parameters<typeof registerIpcHandlers>[1],
    )

    const untrusted = { senderFrame: { url: 'http://attacker.example' } }

    // DIALOG_OPEN_FOLDER — cancellation and selection
    expect(await handlers.get(IPC_CHANNELS.DIALOG_OPEN_FOLDER)!({}, {})).toBeNull()
    electronState.openDialogResult = { canceled: false, filePaths: ['/tmp/dialog-chosen'] }
    expect(await handlers.get(IPC_CHANNELS.DIALOG_OPEN_FOLDER)!({}, {})).toBe('/tmp/dialog-chosen')

    // PROJECT_ADD / PROJECT_LIST / PROJECT_SESSIONS / PROJECT_REMOVE
    electronState.openDialogResult = { canceled: true, filePaths: [] as string[] }
    const added = (await handlers.get(IPC_CHANNELS.PROJECT_ADD)!({}, { path: '/tmp/project' })) as { id: string }
    expect(added.id).toBeDefined()
    const listed = (await handlers.get(IPC_CHANNELS.PROJECT_LIST)!({}, {})) as Array<{ id: string }>
    expect(listed.map(p => p.id)).toContain(added.id)
    const refreshed = (await handlers.get(IPC_CHANNELS.PROJECT_SESSIONS)!({}, { projectId: added.id })) as { id: string }
    expect(refreshed.id).toBe(added.id)
    const removed = await handlers.get(IPC_CHANNELS.PROJECT_REMOVE)!({}, { id: added.id })
    expect(removed).toBe(true)

    // WORKSPACE_SET_ACTIVE / WORKSPACE_GET_ACTIVE
    await handlers.get(IPC_CHANNELS.WORKSPACE_SET_ACTIVE)!({}, { sessionId: 'sess-x', projectPath: '/tmp/project' })
    const active = (await handlers.get(IPC_CHANNELS.WORKSPACE_GET_ACTIVE)!({}, {})) as { sessionId: string | null; projectPath: string | null }
    expect(active).toEqual({ sessionId: 'sess-x', projectPath: '/tmp/project' })

    // UPDATE_CHECK / UPDATE_DOWNLOAD / UPDATE_INSTALL (mocked autoUpdater)
    expect(await handlers.get(IPC_CHANNELS.UPDATE_CHECK)!({}, {})).toBeNull()
    await handlers.get(IPC_CHANNELS.UPDATE_DOWNLOAD)!({}, {})
    await handlers.get(IPC_CHANNELS.UPDATE_INSTALL)!({}, {})

    // Untrusted sender is rejected on this group
    await expect(
      handlers.get(IPC_CHANNELS.PROJECT_ADD)!(untrusted as never, { path: '/tmp/project' }),
    ).rejects.toThrow('Unauthorized IPC call')
    await expect(
      handlers.get(IPC_CHANNELS.UPDATE_CHECK)!(untrusted as never, {}),
    ).rejects.toThrow('Unauthorized IPC call')
    await expect(
      handlers.get(IPC_CHANNELS.WORKSPACE_GET_ACTIVE)!(untrusted as never, {}),
    ).rejects.toThrow('Unauthorized IPC call')
  })

  it('routes all 21 git channels through the router with valid sender', async () => {
    const sessionManager = new StatefulSessionManager()
    const projectManager = new ProjectManager()

    registerIpcHandlers(
      sessionManager as unknown as Parameters<typeof registerIpcHandlers>[0],
      projectManager as Parameters<typeof registerIpcHandlers>[1],
    )

    // Read-only channels — assert delegation and result propagation
    expect(await handlers.get(IPC_CHANNELS.GIT_GET_BRANCH)!({}, { cwd: '/tmp/repo' })).toBe('mock-branch')
    expect(mockGit.getBranch).toHaveBeenCalledWith('/tmp/repo')

    expect(await handlers.get(IPC_CHANNELS.GIT_STATUS)!({}, { cwd: '/tmp/repo' })).toEqual({ isRepo: true, staged: [], files: [] })
    expect(mockGit.getStatus).toHaveBeenCalledWith('/tmp/repo')

    expect(await handlers.get(IPC_CHANNELS.GIT_LOG)!({}, { cwd: '/tmp/repo', maxCount: 5 })).toEqual({ all: [], latest: undefined })
    expect(mockGit.getLog).toHaveBeenCalledWith('/tmp/repo', 5)

    expect(await handlers.get(IPC_CHANNELS.GIT_DIFF)!({}, { cwd: '/tmp/repo', filePath: 'a.ts', staged: true })).toEqual({ diff: 'mock-diff' })
    expect(mockGit.getDiff).toHaveBeenCalledWith('/tmp/repo', 'a.ts', true)

    expect(await handlers.get(IPC_CHANNELS.GIT_DIFF_SUMMARY)!({}, { cwd: '/tmp/repo', staged: false })).toEqual({
      files: [],
      totalInsertions: 0,
      totalDeletions: 0,
    })
    expect(mockGit.getDiffSummary).toHaveBeenCalledWith('/tmp/repo', false)

    expect(await handlers.get(IPC_CHANNELS.GIT_BRANCH_LIST)!({}, { cwd: '/tmp/repo' })).toEqual({ all: ['mock-branch'], current: 'mock-branch' })
    expect(mockGit.branchList).toHaveBeenCalledWith('/tmp/repo')

    expect(await handlers.get(IPC_CHANNELS.GIT_STASH_LIST)!({}, { cwd: '/tmp/repo' })).toEqual({ stashes: [], total: 0 })
    expect(mockGit.stashList).toHaveBeenCalledWith('/tmp/repo')

    expect(await handlers.get(IPC_CHANNELS.GIT_REMOTE_URL)!({}, { cwd: '/tmp/repo', remote: 'origin' })).toBe('https://mock.example/repo.git')
    expect(mockGit.getRemoteUrl).toHaveBeenCalledWith('/tmp/repo', 'origin')

    expect(await handlers.get(IPC_CHANNELS.GIT_IS_REPO)!({}, { cwd: '/tmp/repo' })).toBe(true)
    expect(mockGit.isGitRepo).toHaveBeenCalledWith('/tmp/repo')

    expect(await handlers.get(IPC_CHANNELS.GIT_COMMIT)!({}, { cwd: '/tmp/repo', message: 'mock commit' })).toEqual({
      hash: 'mock-hash',
      summary: 'mock commit',
    })
    expect(mockGit.commit).toHaveBeenCalledWith('/tmp/repo', 'mock commit')

    expect(await handlers.get(IPC_CHANNELS.GIT_PULL)!({}, { cwd: '/tmp/repo', remote: 'origin', branch: 'main' })).toEqual({
      summary: 'mock pull',
      changes: 0,
    })
    expect(mockGit.pull).toHaveBeenCalledWith('/tmp/repo', 'origin', 'main')

    // Write channels (void results) — assert delegation
    await handlers.get(IPC_CHANNELS.GIT_STAGE)!({}, { cwd: '/tmp/repo', filePath: 'a.ts' })
    expect(mockGit.stage).toHaveBeenCalledWith('/tmp/repo', 'a.ts')

    await handlers.get(IPC_CHANNELS.GIT_UNSTAGE)!({}, { cwd: '/tmp/repo', filePath: 'a.ts' })
    expect(mockGit.unstage).toHaveBeenCalledWith('/tmp/repo', 'a.ts')

    await handlers.get(IPC_CHANNELS.GIT_STAGE_ALL)!({}, { cwd: '/tmp/repo' })
    expect(mockGit.stageAll).toHaveBeenCalledWith('/tmp/repo')

    await handlers.get(IPC_CHANNELS.GIT_UNSTAGE_ALL)!({}, { cwd: '/tmp/repo' })
    expect(mockGit.unstageAll).toHaveBeenCalledWith('/tmp/repo')

    await handlers.get(IPC_CHANNELS.GIT_PUSH)!({}, { cwd: '/tmp/repo', remote: 'origin', branch: 'main' })
    expect(mockGit.push).toHaveBeenCalledWith('/tmp/repo', 'origin', 'main')

    await handlers.get(IPC_CHANNELS.GIT_FETCH)!({}, { cwd: '/tmp/repo', remote: 'origin' })
    expect(mockGit.fetch).toHaveBeenCalledWith('/tmp/repo', 'origin')

    await handlers.get(IPC_CHANNELS.GIT_BRANCH_CREATE)!({}, { cwd: '/tmp/repo', name: 'feat-x', checkout: true })
    expect(mockGit.branchCreate).toHaveBeenCalledWith('/tmp/repo', 'feat-x', true)

    await handlers.get(IPC_CHANNELS.GIT_BRANCH_SWITCH)!({}, { cwd: '/tmp/repo', name: 'feat-x' })
    expect(mockGit.branchSwitch).toHaveBeenCalledWith('/tmp/repo', 'feat-x')

    await handlers.get(IPC_CHANNELS.GIT_STASH)!({}, { cwd: '/tmp/repo', message: 'wip' })
    expect(mockGit.stash).toHaveBeenCalledWith('/tmp/repo', 'wip')

    await handlers.get(IPC_CHANNELS.GIT_STASH_POP)!({}, { cwd: '/tmp/repo' })
    expect(mockGit.stashPop).toHaveBeenCalledWith('/tmp/repo')
  })

  it('rejects git handlers called from an untrusted sender', async () => {
    const sessionManager = new StatefulSessionManager()
    const projectManager = new ProjectManager()

    registerIpcHandlers(
      sessionManager as unknown as Parameters<typeof registerIpcHandlers>[0],
      projectManager as Parameters<typeof registerIpcHandlers>[1],
    )

    const untrusted = { senderFrame: { url: 'http://attacker.example' } }

    await expect(
      handlers.get(IPC_CHANNELS.GIT_STATUS)!(untrusted as never, { cwd: '/tmp/repo' }),
    ).rejects.toThrow('Unauthorized IPC call')
    await expect(
      handlers.get(IPC_CHANNELS.GIT_PUSH)!(untrusted as never, { cwd: '/tmp/repo' }),
    ).rejects.toThrow('Unauthorized IPC call')
    await expect(
      handlers.get(IPC_CHANNELS.GIT_STAGE)!(untrusted as never, { cwd: '/tmp/repo', filePath: 'a.ts' }),
    ).rejects.toThrow('Unauthorized IPC call')
    // No git delegation happened for the blocked calls
    expect(mockGit.getStatus).not.toHaveBeenCalled()
    expect(mockGit.push).not.toHaveBeenCalled()
    expect(mockGit.stage).not.toHaveBeenCalled()
  })

  it('rejects stage/unstage paths that escape the project directory', async () => {
    const sessionManager = new StatefulSessionManager()
    const projectManager = new ProjectManager()

    registerIpcHandlers(
      sessionManager as unknown as Parameters<typeof registerIpcHandlers>[0],
      projectManager as Parameters<typeof registerIpcHandlers>[1],
    )

    // The path-within-project validation must run after sender validation
    // and before git delegation
    await expect(
      handlers.get(IPC_CHANNELS.GIT_STAGE)!({}, { cwd: '/tmp/repo', filePath: '../../etc/passwd' }),
    ).rejects.toThrow('Path traversal detected')
    expect(mockGit.stage).not.toHaveBeenCalled()

    await expect(
      handlers.get(IPC_CHANNELS.GIT_UNSTAGE)!({}, { cwd: '/tmp/repo', filePath: '/tmp/repo/../sibling' }),
    ).rejects.toThrow('Path traversal detected')
    expect(mockGit.unstage).not.toHaveBeenCalled()
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
