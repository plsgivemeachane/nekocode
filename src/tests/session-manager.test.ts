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
import type { AgentSessionEvent, SessionInfo } from '@mariozechner/pi-coding-agent'
import type { Message, AssistantMessage } from '@mariozechner/pi-ai'

/** Create a minimal mock AssistantMessage for SDK events */
function mockAssistantMessage(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: {} as AssistantMessage['api'],
    provider: {} as AssistantMessage['provider'],
    model: 'test-model',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop',
    timestamp: Date.now(),
    ...overrides,
  }
}

/** Create a mock AgentSession with controllable subscribe/prompt/abort/dispose */
function createMockSession(id?: string, initialActiveTools: string[] = ['read', 'write']) {
  const listeners: Array<(event: AgentSessionEvent) => void> = []
  let activeTools = [...initialActiveTools]
  return {
    sessionId: id ?? `sdk-session-${Math.random().toString(36).slice(2, 10)}`,
    messages: [] as Message[],
    subscribe: vi.fn((fn: (event: AgentSessionEvent) => void) => {
      listeners.push(fn)
      return vi.fn(() => {
        const idx = listeners.indexOf(fn)
        if (idx >= 0) listeners.splice(idx, 1)
      })
    }),
    prompt: vi.fn(async () => {}),
    abort: vi.fn(),
    dispose: vi.fn(),
    getActiveToolNames: vi.fn(() => [...activeTools]),
    setActiveToolsByName: vi.fn((toolNames: string[]) => {
      activeTools = [...toolNames]
    }),
    /** Simulate the SDK emitting an event */
    emit(event: AgentSessionEvent) {
      for (const fn of listeners) fn(event)
    },
  }
}

/** Reference to the last mock session created by createAgentSession */
let lastCreatedMockSession: ReturnType<typeof createMockSession> | null = null

// Mock the SDK module so tests run without a real pi installation
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

/** Helper: get the last created mock session, asserting it exists */
function mockSession() {
  if (!lastCreatedMockSession) throw new Error('No mock session created yet')
  return lastCreatedMockSession
}

describe('PiSessionManager', () => {
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

  it('should create a session and return a stable ID from the SDK', async () => {
    const id = await manager.create('/tmp/project')
    expect(id).toBeDefined()
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
    expect(manager.sessionCount).toBe(1)
  })

  it('should assign unique stable session IDs', async () => {
    const id1 = await manager.create('/tmp/a')
    const id2 = await manager.create('/tmp/b')
    expect(id2).not.toBe(id1)
    expect(manager.sessionCount).toBe(2)
  })

  it('should preserve normalized extension load errors for created sessions', async () => {
    sdkMocks.createAgentSessionMock.mockResolvedValueOnce({
      session: createMockSession('session-with-errors'),
      extensionsResult: {
        extensions: [],
        loadedExtensionIds: [],
        errors: [
          { path: '/tmp/ext.ts', error: 'Failed to load extension: resolver failed', stack: 'TypeError: ...' },
        ],
      },
    })

    const id = await manager.create('/tmp/project')
    const errors = manager.getExtensionLoadErrors(id)

    expect(errors).toHaveLength(1)
    expect(errors[0]).toEqual({
      path: '/tmp/ext.ts',
      message: 'Failed to load extension: resolver failed',
      stack: 'TypeError: ...',
    })
    expect(manager.getExtensionsDisabled(id)).toBe(false)
  })

  it('should retry create with noExtensions on uniform systemic extension errors', async () => {
    process.env.NEKOCODE_ALLOW_EXTENSION_FALLBACK = '1'
    manager = new PiSessionManager((sessionId, event) => {
      events.push({ sessionId, event })
    })
    const failedSession = createMockSession('failed-create')
    const fallbackSession = createMockSession('fallback-create')
    sdkMocks.createAgentSessionMock
      .mockResolvedValueOnce({
        session: failedSession,
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
        session: fallbackSession,
        extensionsResult: {
          extensions: [],
          loadedExtensionIds: [],
          errors: [],
        },
      })

    const id = await manager.create('/tmp/project')

    expect(id).toBe('fallback-create')
    expect(sdkMocks.createAgentSessionMock).toHaveBeenCalledTimes(2)
    expect(sdkMocks.loaderCtorCalls[0]?.noExtensions).toBeUndefined()
    expect(sdkMocks.loaderCtorCalls[1]?.noExtensions).toBe(true)
    expect(manager.getExtensionsDisabled('fallback-create')).toBe(true)
    const errors = manager.getExtensionLoadErrors('fallback-create')
    expect(errors.some(error => error.path === '__create__')).toBe(true)
  })

  it('should subscribe to session events on create', async () => {
    await manager.create('/tmp/project')
    expect(mockSession().subscribe).toHaveBeenCalled()
  })

  it('should use resourceLoader bootstrap on reconnect', async () => {
    const reconnectSession = createMockSession('stable-reconnected')
    sdkMocks.sessionListMock.mockResolvedValue([{ id: 'existing-session', path: '/tmp/session.json', cwd: '/tmp/project', created: new Date(), modified: new Date(), messageCount: 0, firstMessage: '', allMessagesText: '' }])
    sdkMocks.sessionOpenMock.mockReturnValue({ kind: 'opened-manager' })
    sdkMocks.createAgentSessionMock.mockResolvedValueOnce({
      session: reconnectSession,
      extensionsResult: { extensions: [], loadedExtensionIds: [], errors: [] },
    })

    await manager.reconnect('existing-session', '/tmp/project')

    expect(sdkMocks.loaderReloadMock).toHaveBeenCalledTimes(1)
    expect(sdkMocks.loaderCtorCalls[0]?.cwd).toBe('/tmp/project')
    expect(sdkMocks.sessionListMock).toHaveBeenCalledWith('/tmp/project')
    expect(sdkMocks.sessionOpenMock).toHaveBeenCalledWith('/tmp/session.json')
    expect(sdkMocks.createAgentSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceLoader: expect.any(Object),
        sessionManager: { kind: 'opened-manager' },
      }),
    )
    expect(manager.getExtensionsDisabled('stable-reconnected')).toBe(false)
  })

  it('should retry reconnect with noExtensions on uniform systemic extension errors', async () => {
    process.env.NEKOCODE_ALLOW_EXTENSION_FALLBACK = '1'
    manager = new PiSessionManager((sessionId, event) => {
      events.push({ sessionId, event })
    })
    const failedSession = createMockSession('failed-reconnect')
    const fallbackSession = createMockSession('fallback-reconnect')
    sdkMocks.sessionListMock.mockResolvedValue([{ id: 'existing-session', path: '/tmp/session.json', cwd: '/tmp/project', created: new Date(), modified: new Date(), messageCount: 0, firstMessage: '', allMessagesText: '' }])
    sdkMocks.sessionOpenMock
      .mockReturnValueOnce({ kind: 'opened-manager-primary' })
      .mockReturnValueOnce({ kind: 'opened-manager-retry' })
    sdkMocks.createAgentSessionMock
      .mockResolvedValueOnce({
        session: failedSession,
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
        session: fallbackSession,
        extensionsResult: {
          extensions: [],
          loadedExtensionIds: [],
          errors: [],
        },
      })

    await manager.reconnect('existing-session', '/tmp/project')

    expect(sdkMocks.createAgentSessionMock).toHaveBeenCalledTimes(2)
    expect(sdkMocks.sessionOpenMock).toHaveBeenCalledTimes(2)
    expect(sdkMocks.loaderCtorCalls[0]?.noExtensions).toBeUndefined()
    expect(sdkMocks.loaderCtorCalls[1]?.noExtensions).toBe(true)
    const errors = manager.getExtensionLoadErrors('fallback-reconnect')
    expect(errors.some(error => error.path === '__reconnect__')).toBe(true)
    expect(manager.getExtensionsDisabled('fallback-reconnect')).toBe(true)
  })

  it('should fail hard on systemic extension errors when fallback is disabled', async () => {
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

  it('should translate text_delta events through the batcher', async () => {
    await manager.create('/tmp/project')

    mockSession().emit({
      type: 'message_update',
      message: mockAssistantMessage(),
      assistantMessageEvent: { type: 'text_delta', delta: 'hi', contentIndex: 0, partial: mockAssistantMessage() },
    })
    mockSession().emit({
      type: 'message_update',
      message: mockAssistantMessage(),
      assistantMessageEvent: { type: 'text_delta', delta: ' there', contentIndex: 0, partial: mockAssistantMessage() },
    })

    // Not flushed yet (16ms batcher)
    expect(events).toHaveLength(0)

    vi.advanceTimersByTime(16)

    expect(events).toHaveLength(1)
    expect(events[0].event).toEqual({ type: 'text_delta', delta: 'hi there' })
  })

  it('should pass tool_call events through immediately', async () => {
    await manager.create('/tmp/project')

    mockSession().emit({
      type: 'tool_execution_start',
      toolCallId: 'tc-1',
      toolName: 'bash',
      args: { command: 'ls' },
    })

    expect(events).toHaveLength(1)
    expect(events[0].event).toEqual({ type: 'tool_call', toolCallId: 'tc-1', toolName: 'bash', args: { command: 'ls' } })
  })

  it('should pass tool_result events through immediately', async () => {
    await manager.create('/tmp/project')

    mockSession().emit({
      type: 'tool_execution_end',
      toolCallId: 'tc-1',
      toolName: 'bash',
      result: 'file1.txt\nfile2.txt',
      isError: false,
    })

    expect(events).toHaveLength(1)
    expect(events[0].event).toEqual({
      type: 'tool_result',
      toolCallId: 'tc-1',
      toolName: 'bash',
      result: 'file1.txt\nfile2.txt',
      isError: false,
    })
  })

  it('should emit done on agent_end and flush pending text', async () => {
    await manager.create('/tmp/project')

    mockSession().emit({
      type: 'message_update',
      message: mockAssistantMessage(),
      assistantMessageEvent: { type: 'text_delta', delta: 'final', contentIndex: 0, partial: mockAssistantMessage() },
    })
    mockSession().emit({ type: 'agent_end', messages: [] })

    // Pending text should be flushed, then done
    expect(events).toHaveLength(2)
    expect(events[0].event).toEqual({ type: 'text_delta', delta: 'final' })
    expect(events[1].event).toEqual({ type: 'done' })
  })

  it('should ignore purely internal bookkeeping events', async () => {
    await manager.create('/tmp/project')

    const internalTypes = ['turn_start', 'turn_end'] as const
    for (const type of internalTypes) {
      mockSession().emit({ type } as AgentSessionEvent)
    }
    // tool_execution_update requires specific properties
    mockSession().emit({ type: 'tool_execution_update', toolCallId: 'tc-1', toolName: 'bash', args: {}, partialResult: null } as AgentSessionEvent)

    expect(events).toHaveLength(0)
  })

  it('should record user messages on message_start', async () => {
    const id = await manager.create('/tmp/project')
    mockSession().emit({
      type: 'message_start',
      message: { role: 'user', content: 'hello world', timestamp: Date.now() },
    })

    const history = manager.getHistory(id)
    expect(history).toHaveLength(1)
    expect(history[0].role).toBe('user')
    expect(history[0].content).toBe('hello world')
  })

  it('should accumulate assistant messages and finalize on agent_end', async () => {
    const id = await manager.create('/tmp/project')

    mockSession().emit({
      type: 'message_update',
      message: mockAssistantMessage(),
      assistantMessageEvent: { type: 'text_delta', delta: 'Hello', contentIndex: 0, partial: mockAssistantMessage() },
    })
    mockSession().emit({
      type: 'message_update',
      message: mockAssistantMessage(),
      assistantMessageEvent: { type: 'text_delta', delta: ' world', contentIndex: 0, partial: mockAssistantMessage() },
    })
    mockSession().emit({ type: 'agent_end', messages: [] })

    const history = manager.getHistory(id)
    expect(history).toHaveLength(1)
    expect(history[0].role).toBe('assistant')
    expect(history[0].content).toBe('Hello world')
  })

  it('should record tool calls and results in history', async () => {
    const id = await manager.create('/tmp/project')

    // Start assistant message
    mockSession().emit({
      type: 'message_update',
      message: mockAssistantMessage(),
      assistantMessageEvent: { type: 'text_delta', delta: 'Let me read that.', contentIndex: 0, partial: mockAssistantMessage() },
    })
    // Tool call
    mockSession().emit({
      type: 'tool_execution_start',
      toolCallId: 'tc-1',
      toolName: 'read',
      args: { path: 'file.txt' },
    })
    // Tool result
    mockSession().emit({
      type: 'tool_execution_end',
      toolCallId: 'tc-1',
      toolName: 'read',
      result: 'file contents',
      isError: false,
    })
    mockSession().emit({ type: 'agent_end', messages: [] })

    const history = manager.getHistory(id)
    expect(history).toHaveLength(1)
    expect(history[0].role).toBe('assistant')
    expect(history[0].content).toBe('Let me read that.')
    expect(history[0].toolCalls).toHaveLength(1)
    expect(history[0].toolCalls![0].name).toBe('read')
    expect(history[0].toolCalls![0].result).toBe('file contents')
  })

  it('should return empty history for a new session', async () => {
    const id = await manager.create('/tmp/project')
    const history = manager.getHistory(id)
    expect(history).toEqual([])
  })

  it('should forward prompt calls to the SDK session', async () => {
    const id = await manager.create('/tmp/project')
    await manager.prompt(id, 'hello')

    expect(mockSession().prompt).toHaveBeenCalledWith('hello', { streamingBehavior: 'steer' })
  })

  it('should forward abort calls to the SDK session', async () => {
    const id = await manager.create('/tmp/project')
    manager.abort(id)

    expect(mockSession().abort).toHaveBeenCalled()
  })

  it('should dispose session and clean up resources', async () => {
    const id = await manager.create('/tmp/project')
    manager.dispose(id)

    expect(manager.sessionCount).toBe(0)
    expect(mockSession().dispose).toHaveBeenCalled()
  })

  it('should throw on operations with unknown session ID', async () => {
    await expect(manager.prompt('nonexistent', 'test')).rejects.toThrow('Session not found')
    expect(() => manager.abort('nonexistent')).toThrow('Session not found')
    expect(() => manager.dispose('nonexistent')).toThrow('Session not found')
  })

  it('should dispose all sessions on disposeAll', async () => {
    await manager.create('/tmp/a')
    await manager.create('/tmp/b')
    expect(manager.sessionCount).toBe(2)

    manager.disposeAll()
    expect(manager.sessionCount).toBe(0)
  })

  it('should flush pending text before tool_call events', async () => {
    await manager.create('/tmp/project')

    mockSession().emit({
      type: 'message_update',
      message: mockAssistantMessage(),
      assistantMessageEvent: { type: 'text_delta', delta: 'before tool', contentIndex: 0, partial: mockAssistantMessage() },
    })
    mockSession().emit({
      type: 'tool_execution_start',
      toolCallId: 'tc-1',
      toolName: 'read',
      args: { path: 'file.txt' },
    })

    expect(events).toHaveLength(2)
    expect(events[0].event).toEqual({ type: 'text_delta', delta: 'before tool' })
    expect(events[1].event).toEqual({ type: 'tool_call', toolCallId: 'tc-1', toolName: 'read', args: { path: 'file.txt' } })
  })

  it('should support concurrent sessions with independent event streams', async () => {
    const idA = await manager.create('/tmp/project-a')
    const idB = await manager.create('/tmp/project-b')

    expect(manager.sessionCount).toBe(2)
    expect(idA).not.toBe(idB)

    // Prompt both sessions concurrently
    const promiseA = manager.prompt(idA, 'prompt for A')
    const promiseB = manager.prompt(idB, 'prompt for B')

    // Both prompts should have been forwarded to their respective SDK sessions
    expect(mockSession().prompt).toHaveBeenCalledWith('prompt for B', { streamingBehavior: 'steer' })
    // Session A was created first but session B is the "last created mock"
    // Verify session count is still 2
    expect(manager.sessionCount).toBe(2)

    await Promise.all([promiseA, promiseB])

    // Emit events to session B (the current lastCreatedMockSession)
    mockSession().emit({
      type: 'message_update',
      message: mockAssistantMessage(),
      assistantMessageEvent: { type: 'text_delta', delta: 'response B', contentIndex: 0, partial: mockAssistantMessage() },
    })
    vi.advanceTimersByTime(16)

    // user_message events are emitted on first prompt; assert only text stream isolation here
    expect(events.length).toBeGreaterThanOrEqual(1)
    const bTextEvents = events.filter(e => e.sessionId === idB && e.event.type === 'text_delta')
    expect(bTextEvents).toHaveLength(1)
    expect(bTextEvents[0].event).toEqual({ type: 'text_delta', delta: 'response B' })

    // Session A should have no text delta events (we only emitted to session B)
    const aTextEvents = events.filter(e => e.sessionId === idA && e.event.type === 'text_delta')
    expect(aTextEvents).toHaveLength(0)

    // Both sessions should still be alive and independently operable
    manager.abort(idA)
    manager.abort(idB)
    expect(manager.sessionCount).toBe(2)
  })

  it('should handle dispose during active streaming without errors', async () => {
    const id = await manager.create('/tmp/project')

    // Start streaming text
    mockSession().emit({
      type: 'message_update',
      message: mockAssistantMessage(),
      assistantMessageEvent: { type: 'text_delta', delta: 'streaming...', contentIndex: 0, partial: mockAssistantMessage() },
    })

    // Dispose while streaming — should flush pending text
    manager.dispose(id)

    // Should have flushed the pending text
    expect(events).toHaveLength(1)
    expect(events[0].event).toEqual({ type: 'text_delta', delta: 'streaming...' })
    expect(manager.sessionCount).toBe(0)
  })

  it('should handle tool errors correctly in history', async () => {
    const id = await manager.create('/tmp/project')

    mockSession().emit({
      type: 'message_update',
      message: mockAssistantMessage(),
      assistantMessageEvent: { type: 'text_delta', delta: 'Trying...', contentIndex: 0, partial: mockAssistantMessage() },
    })
    mockSession().emit({
      type: 'tool_execution_start',
      toolCallId: 'tc-err',
      toolName: 'bash',
      args: { command: 'bad_command' },
    })
    mockSession().emit({
      type: 'tool_execution_end',
      toolCallId: 'tc-err',
      toolName: 'bash',
      result: 'command not found: bad_command',
      isError: true,
    })
    mockSession().emit({ type: 'agent_end', messages: [] })

    const history = manager.getHistory(id)
    expect(history).toHaveLength(1)
    expect(history[0].toolCalls).toHaveLength(1)
    expect(history[0].toolCalls![0].isError).toBe(true)
    expect(history[0].toolCalls![0].result).toBe('command not found: bad_command')
  })
})


