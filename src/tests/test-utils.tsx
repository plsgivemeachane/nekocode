import type { NekoCodeIPC } from '@/shared/ipc-types'
import type { SessionStreamEvent, ChatMessageIPC, ProjectInfo, SessionCreateResult, SessionReconnectResult, WorkspaceActiveResult, ModelInfo, UpdateAvailableInfo } from '@/shared/ipc-types'
import type { PiSessionManager } from '../main/session-manager'
import type { ProjectManager } from '../main/project-manager'

// ── Mock IPC factory ──────────────────────────────────────────────

function createMockSessionAPI(): NekoCodeIPC['session'] {
  return {
    create: vi.fn<() => Promise<SessionCreateResult>>().mockResolvedValue({
      sessionId: 'mock-sdk-session-id',
      stableId: 'mock-stable-id',
    }),
    prompt: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    abort: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    dispose: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    deleteSession: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    reconnect: vi.fn<() => Promise<SessionReconnectResult>>().mockResolvedValue({
      sessionId: 'mock-sdk-session-id',
      stableId: 'mock-stable-id',
      history: [],
    }),
    loadHistory: vi.fn<() => Promise<ChatMessageIPC[]>>().mockResolvedValue([]),
    loadHistoryFromDisk: vi.fn<(sessionId: string, cwd: string, limit: number) => Promise<ChatMessageIPC[]>>().mockResolvedValue([]),
    onEvent: vi.fn<() => () => void>().mockReturnValue(() => {}),
    getModel: vi.fn<(sessionId: string) => Promise<ModelInfo | null>>().mockResolvedValue(null),
    listModels: vi.fn<() => Promise<ModelInfo[]>>().mockResolvedValue([]),
    setModel: vi.fn<(sessionId: string, provider: string, modelId: string) => Promise<ModelInfo>>().mockResolvedValue({ id: 'mock-model', name: 'Mock Model', provider: 'mock-provider' }),
  }
}

function createMockDialogAPI(): NekoCodeIPC['dialog'] {
  return {
    openFolder: vi.fn<() => Promise<string | null>>().mockResolvedValue(null),
  }
}

function createMockProjectAPI(): NekoCodeIPC['project'] {
  return {
    add: vi.fn<() => Promise<ProjectInfo>>().mockResolvedValue({
      id: 'mock-project-id',
      name: 'mock-project',
      path: '/mock/path',
      sessions: [],
    }),
    remove: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
    list: vi.fn<() => Promise<ProjectInfo[]>>().mockResolvedValue([]),
    sessions: vi.fn<() => Promise<ProjectInfo>>().mockResolvedValue({
      id: 'mock-project-id',
      name: 'mock-project',
      path: '/mock/path',
      sessions: [],
    }),
  }
}

function createMockWorkspaceAPI(): NekoCodeIPC['workspace'] {
  return {
    setActive: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    getActive: vi.fn<() => Promise<WorkspaceActiveResult>>().mockResolvedValue({
      sessionId: null,
      projectPath: null,
    }),
  }
}

function createMockUpdateAPI(): NekoCodeIPC['update'] {
  return {
    check: vi.fn<() => Promise<UpdateAvailableInfo | null>>().mockResolvedValue(null),
    download: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    install: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    onAvailable: vi.fn<() => () => void>().mockReturnValue(() => {}),
    onNotAvailable: vi.fn<() => () => void>().mockReturnValue(() => {}),
    onProgress: vi.fn<() => () => void>().mockReturnValue(() => {}),
    onDownloaded: vi.fn<() => () => void>().mockReturnValue(() => {}),
    onError: vi.fn<() => () => void>().mockReturnValue(() => {}),
  }
}

export function createMockIPC(): NekoCodeIPC {
  return {
    session: createMockSessionAPI(),
    dialog: createMockDialogAPI(),
    project: createMockProjectAPI(),
    workspace: createMockWorkspaceAPI(),
    update: createMockUpdateAPI(),
  }
}

// ── Main-process manager mock helpers ─────────────────────────────

type SessionManagerMock = {
  [K in 'create' | 'prompt' | 'abort' | 'dispose' | 'reconnect' | 'getHistory' | 'getModel' | 'listModels' | 'setModel' | 'getExtensionLoadErrors' | 'getExtensionsDisabled']: PiSessionManager[K]
}

type ProjectManagerMock = {
  [K in 'addProject' | 'removeProject' | 'setActiveSession' | 'getActiveSession' | 'listProjects' | 'refreshSessions' | 'loadWorkspace']: ProjectManager[K]
}

export function createSessionManagerMock(
  overrides: Partial<SessionManagerMock> = {},
): SessionManagerMock {
  return {
    create: vi.fn(async () => 'session-1'),
    prompt: vi.fn(async () => undefined),
    abort: vi.fn(() => undefined),
    dispose: vi.fn(() => undefined),
    reconnect: vi.fn(async () => []),
    getHistory: vi.fn(() => []),
    getModel: vi.fn(() => null),
    listModels: vi.fn(async () => []),
    setModel: vi.fn(async () => ({ id: 'model-1', name: 'Model 1', provider: 'mock' })),
    getExtensionLoadErrors: vi.fn(() => []),
    getExtensionsDisabled: vi.fn(() => false),
    ...overrides,
  }
}

export function createProjectManagerMock(
  overrides: Partial<ProjectManagerMock> = {},
): ProjectManagerMock {
  return {
    addProject: vi.fn(async () => ({ id: 'project-1', path: '/tmp/project', name: 'project', sessions: [] })),
    removeProject: vi.fn(async () => true),
    setActiveSession: vi.fn(async () => undefined),
    getActiveSession: vi.fn(() => ({ sessionId: null, projectPath: null })),
    listProjects: vi.fn(() => []),
    refreshSessions: vi.fn(async () => ({ id: 'project-1', path: '/tmp/project', name: 'project', sessions: [] })),
    loadWorkspace: vi.fn(async () => undefined),
    ...overrides,
  }
}

// ── Convenience: set window.nekocode ───────────────────────────────

export function setupMockIPC(mock?: Partial<NekoCodeIPC>): NekoCodeIPC {
  const full = { ...createMockIPC(), ...mock }
  ;(globalThis as unknown as Record<string, NekoCodeIPC>).nekocode = full
  return full
}

export function clearMockIPC(): void {
  delete (globalThis as unknown as Record<string, NekoCodeIPC>).nekocode
}

// ── Event emitter helper for onEvent tests ────────────────────────

export function createEventEmitter() {
  let listeners: Array<(payload: { sessionId: string; event: SessionStreamEvent }) => void> = []
  return {
    subscribe: (cb: (payload: { sessionId: string; event: SessionStreamEvent }) => void) => {
      listeners.push(cb)
      return () => { listeners = listeners.filter(l => l !== cb) }
    },
    emit: (payload: { sessionId: string; event: SessionStreamEvent }) => {
      listeners.forEach(l => l(payload))
    },
    getListenerCount: () => listeners.length,
  }
}

// ── Factory helpers for test data ──────────────────────────────────

export function makeTextDeltaEvent(delta: string): SessionStreamEvent {
  return { type: 'text_delta', delta }
}

export function makeToolCallEvent(toolName: string, toolCallId: string, args: Record<string, unknown>): SessionStreamEvent {
  return { type: 'tool_call', toolName, toolCallId, args }
}

export function makeToolResultEvent(toolName: string, toolCallId: string, result: string, isError = false): SessionStreamEvent {
  return { type: 'tool_result', toolName, toolCallId, result, isError }
}

export function makeDoneEvent(): SessionStreamEvent {
  return { type: 'done' }
}

export function makeUserMessageEvent(text: string): SessionStreamEvent {
  return { type: 'user_message', text }
}
