import { describe, it, expect, vi, beforeEach } from 'vitest'

const sdkMocks = vi.hoisted(() => ({
  createAgentSessionMock: vi.fn(),
  loaderReloadMock: vi.fn(async () => {}),
  loaderCtorCalls: [] as Array<{ cwd: string; agentDir: string; settingsManager: unknown; noExtensions?: boolean }>,
  settingsCreateMock: vi.fn(() => ({ kind: 'settings' })),
  getAgentDirMock: vi.fn(() => '/tmp/agent-dir'),
  sessionInMemoryMock: vi.fn(() => ({ kind: 'in-memory' })),
  sessionCreateMock: vi.fn((cwd: string) => ({ kind: 'persisted', cwd })),
  sessionListMock: vi.fn<(cwd: string) => Promise<SessionInfo[]>>(async () => []),
  sessionOpenMock: vi.fn(),
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/test-logs') },
}))

import { PiSessionManager } from '../main/session-manager'
import type { SessionStreamEvent } from '../shared/ipc-types'
import type { SessionInfo } from '@mariozechner/pi-coding-agent'
import type { Message } from '@mariozechner/pi-ai'

function createMockSession(id?: string) {
  const listeners: Array<(event: unknown) => void> = []
  return {
    sessionId: id ?? `sdk-session-${Math.random().toString(36).slice(2, 10)}`,
    messages: [] as Message[],
    subscribe: vi.fn((fn: (event: unknown) => void) => {
      listeners.push(fn)
      return vi.fn(() => {
        const idx = listeners.indexOf(fn)
        if (idx >= 0) listeners.splice(idx, 1)
      })
    }),
    prompt: vi.fn(async () => {}),
    abort: vi.fn(),
    dispose: vi.fn(),
    getActiveToolNames: vi.fn(() => ['read', 'write']),
    setActiveToolsByName: vi.fn(),
  }
}

let lastCreatedMockSession: ReturnType<typeof createMockSession> | null = null

vi.mock('@mariozechner/pi-coding-agent', () => ({
  createAgentSession: sdkMocks.createAgentSessionMock,
  DefaultResourceLoader: class {
    constructor(config: { cwd: string; agentDir: string; settingsManager: unknown; noExtensions?: boolean }) {
      sdkMocks.loaderCtorCalls.push(config)
    }
    reload = sdkMocks.loaderReloadMock
  },
  getAgentDir: sdkMocks.getAgentDirMock,
  SettingsManager: {
    create: sdkMocks.settingsCreateMock,
  },
  SessionManager: {
    inMemory: sdkMocks.sessionInMemoryMock,
    create: sdkMocks.sessionCreateMock,
    list: sdkMocks.sessionListMock,
    open: sdkMocks.sessionOpenMock,
  },
}))

function mockSession() {
  if (!lastCreatedMockSession) throw new Error('No mock session created yet')
  return lastCreatedMockSession
}

describe('PiSessionManager integration', () => {
  let manager: PiSessionManager
  let events: Array<{ sessionId: string; event: SessionStreamEvent }>

  beforeEach(() => {
    vi.useFakeTimers()
    delete process.env.NEKOCODE_ALLOW_EXTENSION_FALLBACK
    events = []
    lastCreatedMockSession = null
    sdkMocks.loaderReloadMock.mockClear()
    sdkMocks.loaderCtorCalls.length = 0
    sdkMocks.settingsCreateMock.mockClear()
    sdkMocks.getAgentDirMock.mockClear()
    sdkMocks.sessionInMemoryMock.mockClear()
    sdkMocks.sessionCreateMock.mockClear()
    sdkMocks.sessionListMock.mockClear()
    sdkMocks.sessionOpenMock.mockClear()
    sdkMocks.createAgentSessionMock.mockReset()
    sdkMocks.createAgentSessionMock.mockImplementation(async () => {
      const session = createMockSession()
      lastCreatedMockSession = session
      return { session, extensionsResult: { extensions: [], loadedExtensionIds: [], errors: [] } }
    })
    manager = new PiSessionManager((sessionId, event) => {
      events.push({ sessionId, event })
    })
  })

  it('creates a stable SDK session id', async () => {
    const id = await manager.create('/tmp/project')

    expect(id).toBeDefined()
    expect(manager.sessionCount).toBe(1)
    expect(mockSession().subscribe).toHaveBeenCalled()
  })

  it('preserves normalized extension errors for create', async () => {
    sdkMocks.createAgentSessionMock.mockResolvedValueOnce({
      session: createMockSession('session-with-errors'),
      extensionsResult: {
        extensions: [],
        loadedExtensionIds: [],
        errors: [{ path: '/tmp/ext.ts', error: 'Failed to load extension: resolver failed', stack: 'TypeError: ...' }],
      },
    })

    const id = await manager.create('/tmp/project')
    expect(manager.getExtensionLoadErrors(id)).toEqual([
      { path: '/tmp/ext.ts', message: 'Failed to load extension: resolver failed', stack: 'TypeError: ...' },
    ])
    expect(manager.getExtensionsDisabled(id)).toBe(false)
  })

  it('retries create with noExtensions on systemic extension loader errors', async () => {
    process.env.NEKOCODE_ALLOW_EXTENSION_FALLBACK = '1'
    manager = new PiSessionManager((sessionId, event) => {
      events.push({ sessionId, event })
    })

    sdkMocks.createAgentSessionMock
      .mockResolvedValueOnce({
        session: createMockSession('failed-create'),
        extensionsResult: {
          extensions: [],
          loadedExtensionIds: [],
          errors: [
            { path: '/tmp/ext-a.ts', error: 'Failed to load extension: (void 0) is not a function' },
            { path: '/tmp/ext-b.ts', error: 'Failed to load extension: (void 0) is not a function' },
          ],
        },
      })
      .mockResolvedValueOnce({
        session: createMockSession('fallback-create'),
        extensionsResult: {
          extensions: [],
          loadedExtensionIds: [],
          errors: [],
        },
      })

    await manager.create('/tmp/project')

    expect(sdkMocks.createAgentSessionMock).toHaveBeenCalledTimes(2)
    expect(sdkMocks.loaderCtorCalls[1]?.noExtensions).toBe(true)
    expect(manager.getExtensionsDisabled('fallback-create')).toBe(true)
  })

  it('reconnects using SessionManager.list/open and resource loader bootstrap', async () => {
    sdkMocks.sessionListMock.mockResolvedValue([
      {
        id: 'existing-session',
        path: '/tmp/session.json',
        cwd: '/tmp/project',
        created: new Date(),
        modified: new Date(),
        messageCount: 0,
        firstMessage: '',
        allMessagesText: '',
      },
    ])
    sdkMocks.sessionOpenMock.mockReturnValue({ kind: 'opened-manager' })
    sdkMocks.createAgentSessionMock.mockResolvedValueOnce({
      session: createMockSession('stable-reconnected'),
      extensionsResult: { extensions: [], loadedExtensionIds: [], errors: [] },
    })

    await manager.reconnect('existing-session', '/tmp/project')

    expect(sdkMocks.loaderReloadMock).toHaveBeenCalledTimes(1)
    expect(sdkMocks.sessionListMock).toHaveBeenCalledWith('/tmp/project')
    expect(sdkMocks.sessionOpenMock).toHaveBeenCalledWith('/tmp/session.json')
  })

  it('retries reconnect with noExtensions on systemic extension loader errors', async () => {
    process.env.NEKOCODE_ALLOW_EXTENSION_FALLBACK = '1'
    manager = new PiSessionManager((sessionId, event) => {
      events.push({ sessionId, event })
    })

    sdkMocks.sessionListMock.mockResolvedValue([
      {
        id: 'existing-session',
        path: '/tmp/session.json',
        cwd: '/tmp/project',
        created: new Date(),
        modified: new Date(),
        messageCount: 0,
        firstMessage: '',
        allMessagesText: '',
      },
    ])
    sdkMocks.sessionOpenMock
      .mockReturnValueOnce({ kind: 'opened-manager-primary' })
      .mockReturnValueOnce({ kind: 'opened-manager-retry' })

    sdkMocks.createAgentSessionMock
      .mockResolvedValueOnce({
        session: createMockSession('failed-reconnect'),
        extensionsResult: {
          extensions: [],
          loadedExtensionIds: [],
          errors: [
            { path: '/tmp/ext-a.ts', error: 'Failed to load extension: (void 0) is not a function' },
            { path: '/tmp/ext-b.ts', error: 'Failed to load extension: (void 0) is not a function' },
          ],
        },
      })
      .mockResolvedValueOnce({
        session: createMockSession('fallback-reconnect'),
        extensionsResult: {
          extensions: [],
          loadedExtensionIds: [],
          errors: [],
        },
      })

    await manager.reconnect('existing-session', '/tmp/project')

    expect(sdkMocks.createAgentSessionMock).toHaveBeenCalledTimes(2)
    expect(sdkMocks.sessionOpenMock).toHaveBeenCalledTimes(2)
    expect(sdkMocks.loaderCtorCalls[1]?.noExtensions).toBe(true)
    expect(manager.getExtensionsDisabled('fallback-reconnect')).toBe(true)
  })

  it('fails hard when systemic extension errors occur and fallback is disabled', async () => {
    sdkMocks.createAgentSessionMock.mockResolvedValueOnce({
      session: createMockSession('failed-create-hard'),
      extensionsResult: {
        extensions: [],
        loadedExtensionIds: [],
        errors: [
          { path: '/tmp/ext-a.ts', error: 'Failed to load extension: (void 0) is not a function' },
          { path: '/tmp/ext-b.ts', error: 'Failed to load extension: (void 0) is not a function' },
        ],
      },
    })

    await expect(manager.create('/tmp/project')).rejects.toThrow('Systemic extension loader failure')
  })

  it('forwards prompt and abort calls to sdk session', async () => {
    const id = await manager.create('/tmp/project')
    await manager.prompt(id, 'hello')
    manager.abort(id)

    expect(mockSession().prompt).toHaveBeenCalledWith('hello', { streamingBehavior: 'steer' })
    expect(mockSession().abort).toHaveBeenCalled()
  })

  it('disposes sessions and handles unknown session ids', async () => {
    const idA = await manager.create('/tmp/a')
    const idB = await manager.create('/tmp/b')
    expect(manager.sessionCount).toBe(2)

    manager.dispose(idA)
    expect(manager.sessionCount).toBe(1)
    manager.disposeAll()
    expect(manager.sessionCount).toBe(0)

    await expect(manager.prompt('unknown', 'test')).rejects.toThrow('Session not found')
    expect(() => manager.abort('unknown')).toThrow('Session not found')
    expect(() => manager.dispose('unknown')).toThrow('Session not found')

    void idB
  })
})
