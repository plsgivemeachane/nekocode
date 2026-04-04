import type { NekoCodeIPC } from '@/shared/ipc-types'
import type { SessionStreamEvent, ChatMessageIPC, ProjectInfo, SessionCreateResult, SessionReconnectResult, WorkspaceActiveResult } from '@/shared/ipc-types'

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
    reconnect: vi.fn<() => Promise<SessionReconnectResult>>().mockResolvedValue({
      sessionId: 'mock-sdk-session-id',
      stableId: 'mock-stable-id',
    }),
    loadHistory: vi.fn<() => Promise<ChatMessageIPC[]>>().mockResolvedValue([]),
    onEvent: vi.fn<() => () => void>().mockReturnValue(() => {}),
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

export function createMockIPC(): NekoCodeIPC {
  return {
    session: createMockSessionAPI(),
    dialog: createMockDialogAPI(),
    project: createMockProjectAPI(),
    workspace: createMockWorkspaceAPI(),
  }
}

// ── Convenience: set window.nekocode ───────────────────────────────

export function setupMockIPC(mock?: Partial<NekoCodeIPC>): NekoCodeIPC {
  const full = { ...createMockIPC(), ...mock }
  ;(globalThis as any).nekocode = full
  return full
}

export function clearMockIPC(): void {
  delete (globalThis as any).nekocode
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

export function makeToolCallEvent(toolName: string, toolCallId: string, args: Record<string, any>): SessionStreamEvent {
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
