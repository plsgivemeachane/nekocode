import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PiSessionManager } from '../main/session-manager'
import type { SessionStreamEvent } from '../shared/ipc-types'

/** Create a mock AgentSession with controllable subscribe/prompt/abort/dispose */
function createMockSession() {
  const listeners: Array<(event: any) => void> = []
  return {
    subscribe: vi.fn((fn: (event: any) => void) => {
      listeners.push(fn)
      return vi.fn(() => {
        const idx = listeners.indexOf(fn)
        if (idx >= 0) listeners.splice(idx, 1)
      })
    }),
    prompt: vi.fn(async () => {}),
    abort: vi.fn(),
    dispose: vi.fn(),
    /** Simulate the SDK emitting an event */
    emit(event: any) {
      for (const fn of listeners) fn(event)
    },
  }
}

/** Reference to the last mock session created by createAgentSession */
let lastCreatedMockSession: ReturnType<typeof createMockSession> | null = null

// Mock the SDK module so tests run without a real pi installation
vi.mock('@mariozechner/pi-coding-agent', () => ({
  createAgentSession: vi.fn(async ({ cwd }: { cwd: string }) => {
    const session = createMockSession()
    lastCreatedMockSession = session
    return { session, extensionsResult: { extensions: [], loadedExtensionIds: [], errors: [] } }
  }),
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
    events = []
    lastCreatedMockSession = null
    manager = new PiSessionManager((sessionId, event) => {
      events.push({ sessionId, event })
    })
  })

  it('should create a session and return an ID', async () => {
    const id = await manager.create('/tmp/project')
    expect(id).toMatch(/^session-\d+$/)
    expect(manager.sessionCount).toBe(1)
  })

  it('should assign incrementing session IDs', async () => {
    const id1 = await manager.create('/tmp/a')
    const id2 = await manager.create('/tmp/b')
    expect(id2).not.toBe(id1)
    expect(manager.sessionCount).toBe(2)
  })

  it('should subscribe to session events on create', async () => {
    await manager.create('/tmp/project')
    expect(mockSession().subscribe).toHaveBeenCalled()
  })

  it('should translate text_delta events through the batcher', async () => {
    await manager.create('/tmp/project')

    mockSession().emit({
      type: 'message_update',
      message: {},
      assistantMessageEvent: { type: 'text_delta', delta: 'hi', contentIndex: 0, partial: {} },
    })
    mockSession().emit({
      type: 'message_update',
      message: {},
      assistantMessageEvent: { type: 'text_delta', delta: ' there', contentIndex: 0, partial: {} },
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
    expect(events[0].event).toEqual({ type: 'tool_call', toolName: 'bash', args: { command: 'ls' } })
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
      toolName: 'bash',
      result: 'file1.txt\nfile2.txt',
      isError: false,
    })
  })

  it('should emit done on agent_end and flush pending text', async () => {
    await manager.create('/tmp/project')

    mockSession().emit({
      type: 'message_update',
      message: {},
      assistantMessageEvent: { type: 'text_delta', delta: 'final', contentIndex: 0, partial: {} },
    })
    mockSession().emit({ type: 'agent_end', messages: [] })

    // Pending text should be flushed, then done
    expect(events).toHaveLength(2)
    expect(events[0].event).toEqual({ type: 'text_delta', delta: 'final' })
    expect(events[1].event).toEqual({ type: 'done' })
  })

  it('should ignore internal bookkeeping events', async () => {
    await manager.create('/tmp/project')

    const internalTypes = ['agent_start', 'turn_start', 'message_start', 'message_end', 'turn_end']
    for (const type of internalTypes) {
      mockSession().emit({ type, message: {}, toolResults: [] })
    }

    expect(events).toHaveLength(0)
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
      message: {},
      assistantMessageEvent: { type: 'text_delta', delta: 'before tool', contentIndex: 0, partial: {} },
    })
    mockSession().emit({
      type: 'tool_execution_start',
      toolCallId: 'tc-1',
      toolName: 'read',
      args: { path: 'file.txt' },
    })

    expect(events).toHaveLength(2)
    expect(events[0].event).toEqual({ type: 'text_delta', delta: 'before tool' })
    expect(events[1].event).toEqual({ type: 'tool_call', toolName: 'read', args: { path: 'file.txt' } })
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
      message: {},
      assistantMessageEvent: { type: 'text_delta', delta: 'response B', contentIndex: 0, partial: {} },
    })
    vi.advanceTimersByTime(16)

    // The event from session B should arrive with session B's ID
    expect(events.length).toBeGreaterThanOrEqual(1)
    const bEvents = events.filter(e => e.sessionId === idB)
    expect(bEvents).toHaveLength(1)
    expect(bEvents[0].event).toEqual({ type: 'text_delta', delta: 'response B' })

    // Session A should have no events (we only emitted to session B)
    const aEvents = events.filter(e => e.sessionId === idA)
    expect(aEvents).toHaveLength(0)

    // Both sessions should still be alive and independently operable
    manager.abort(idA)
    manager.abort(idB)
    expect(manager.sessionCount).toBe(2)
  })
})
