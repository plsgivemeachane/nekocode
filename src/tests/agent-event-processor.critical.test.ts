/**
 * AgentEventProcessor CRITICAL contract-violation tests.
 *
 * The existing test suite has 25 tests covering basic event processing.
 * These tests probe the CONTRACT boundaries that are NOT covered:
 *
 * Contract: AgentEventProcessor(emit, options?)
 *   .handleAgentEvent(sessionId, event, managed): void
 *   .finalizeAssistantMessage(managed): void
 *   .finalizeThinkingMessage(managed): void
 *
 * Contract assumptions to challenge:
 * - handleAgentEvent is void - errors are swallowed or thrown?
 * - ManagedSession is mutated in place - what if fields are null/undefined?
 * - Event ordering: what if events arrive out of order?
 * - thinking_end without thinking_start? text_delta without prior start?
 * - sessionId is just a string - empty, null?
 * - onBatchableEvent/onFlush: what if they throw?
 * - finalizeAssistantMessage called with no current assistant: silent no-op?
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentEventProcessor, type ManagedSession } from '../main/agent-event-processor'
import type { AgentSessionEvent, ContextUsage } from '@earendil-works/pi-coding-agent'
import type { SessionStreamEvent } from '../shared/ipc-types'

vi.mock('../main/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

vi.mock('../main/text-extractor', () => ({
  extractTextContent: (content: string | Array<{ type: string; text?: string }> | null | undefined) => {
    if (content == null) return ''
    if (typeof content === 'string') return content
    return content
      .filter((block: { type: string; text?: string }) => block.type === 'text')
      .map((block: { text?: string }) => block.text ?? '')
      .join('')
  },
}))

function createManagedSession(overrides?: Partial<ManagedSession>): ManagedSession {
  return {
    session: {
      getContextUsage: vi.fn().mockReturnValue({ percent: 0, contextWindow: 200000 } as ContextUsage),
    },
    unsubscribe: vi.fn(),
    extensionErrors: [],
    extensionsDisabled: false,
    messages: [],
    currentAssistantId: null,
    currentAssistantContent: '',
    currentThinkingId: null,
    currentThinkingContent: '',
    currentToolCallId: null,
    usageTotals: { input: 0, output: 0, totalCost: 0 },
    uiContext: {
      askUser: vi.fn(),
      requestUI: vi.fn(),
    } as unknown as import('../main/electron-ui-context').ElectronUIContext,
    ...overrides,
  }
}

function createEvent<T extends { type: string }>(partial: T): T {
  return { ...partial }
}

describe('AgentEventProcessor - Critical Contract Tests', () => {
  let emitted: Array<{ sessionId: string; event: SessionStreamEvent }>
  let batched: SessionStreamEvent[]
  let _flushed: number
  let processor: AgentEventProcessor

  beforeEach(() => {
    emitted = []
    batched = []
    _flushed = 0
    processor = new AgentEventProcessor(
      (sessionId: string, event: SessionStreamEvent) => { emitted.push({ sessionId, event }) },
      {
        onBatchableEvent: (event) => { batched.push(event) },
        onFlush: () => { _flushed++ },
      },
    )
  })

  // ==========================================================================
  // Category 1: Name vs Reality
  // ==========================================================================

  it('CONTRACT AMBIGUITY: handleAgentEvent returns void - there is no way to know if processing succeeded', () => {
    // The function is void, meaning either it always succeeds (unlikely) or
    // errors are silently swallowed. There is no Result type or error callback.
    const managed = createManagedSession()
    const event = createEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'hello' },
    })

    // Returns void - no indication of success/failure
    const result = processor.handleAgentEvent('session-1', event as AgentSessionEvent, managed)
    expect(result).toBeUndefined()
  })

  it.todo('handleAgentEvent should return Result<void, Error> or accept an onError callback')

  it('CONTRACT VIOLATION: finalizeAssistantMessage silently does nothing when no assistant message exists', () => {
    // "finalize" implies there is something to finalize. But calling it
    // with no current assistant message is a silent no-op. The caller
    // has no way to know if finalization actually happened.
    const managed = createManagedSession()

    // No current assistant message
    expect(managed.currentAssistantId).toBeNull()

    const result = processor.finalizeAssistantMessage(managed)
    expect(result).toBeUndefined()

    // Nothing was emitted or finalized
    expect(emitted).toHaveLength(0)
    expect(batched).toHaveLength(0)
  })

  it('CONTRACT VIOLATION: finalizeThinkingMessage silently does nothing when no thinking message exists', () => {
    const managed = createManagedSession()

    expect(managed.currentThinkingId).toBeNull()

    const result = processor.finalizeThinkingMessage(managed)
    expect(result).toBeUndefined()

    expect(emitted).toHaveLength(0)
    expect(batched).toHaveLength(0)
  })

  it.todo('finalizeAssistantMessage/finalizeThinkingMessage should return boolean indicating whether finalization occurred')

  // ==========================================================================
  // Category 2: Argument Boundary & Assumption Drilling
  // ==========================================================================

  it('CONTRACT AMBIGUITY: empty sessionId is accepted without validation', () => {
    const managed = createManagedSession()
    const event = createEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'test' },
    })

    // Empty string sessionId is valid per the type system
    expect(() => {
      processor.handleAgentEvent('', event as AgentSessionEvent, managed)
    }).not.toThrow()

    // But the emitted event has an empty sessionId - is that useful?
    expect(emitted[0]?.sessionId ?? batched[0]).toBeDefined()
  })

  it.todo('handleAgentEvent should validate sessionId is a non-empty string')

  it('text_delta without prior message_start still creates a message', () => {
    // The processor auto-generates a UUID if currentAssistantId is null.
    // This means out-of-order events (text_delta before message_start)
    // silently create a message. Is this correct or should it be an error?
    const managed = createManagedSession()

    const event = createEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'orphan delta' },
    })

    processor.handleAgentEvent('session-1', event as AgentSessionEvent, managed)

    // A message was auto-created
    expect(managed.currentAssistantId).not.toBeNull()
    expect(managed.currentAssistantContent).toBe('orphan delta')
  })

  it('thinking_delta without thinking_start still creates a thinking message', () => {
    const managed = createManagedSession()

    const event = createEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'thinking_delta', delta: 'orphan thinking' },
    })

    processor.handleAgentEvent('session-1', event as AgentSessionEvent, managed)

    expect(managed.currentThinkingId).not.toBeNull()
    expect(managed.currentThinkingContent).toBe('orphan thinking')
  })

  it.todo('Out-of-order events (delta without start) should be detected and logged as warnings')

  // ==========================================================================
  // Category 3: Abstraction Ambiguity - Callback Failures
  // ==========================================================================

  it('onBatchableEvent that throws is caught — handleAgentEvent continues (CONTRACT FIXED)', () => {
    // Previously, if onBatchableEvent threw, it would crash handleAgentEvent.
    // Now batchable event calls are wrapped in try/catch.
    const failingProcessor = new AgentEventProcessor(
      (sessionId, event) => { emitted.push({ sessionId, event }) },
      {
        onBatchableEvent: () => { throw new Error('batcher exploded') },
      },
    )

    const managed = createManagedSession()
    const event = createEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'test' },
    })

    // The batchable event callback throw is caught
    expect(() => {
      failingProcessor.handleAgentEvent('session-1', event as AgentSessionEvent, managed)
    }).not.toThrow()
  })

  it('emit callback that throws is caught — handleAgentEvent continues (CONTRACT FIXED)', () => {
    // Previously, if the emit callback threw, it would crash handleAgentEvent.
    // Now emit calls are wrapped in try/catch, so event processing continues.
    const failingProcessor = new AgentEventProcessor(
      (_sessionId: string, _event: SessionStreamEvent) => { throw new Error('emit exploded') },
      {},
    )

    const managed = createManagedSession()
    const event = createEvent({
      type: 'tool_execution_start',
      toolName: 'test',
      toolCallId: 'call-1',
    })

    // The emit callback throw is caught — handleAgentEvent does NOT throw
    expect(() => {
      failingProcessor.handleAgentEvent('session-1', event as AgentSessionEvent, managed)
    }).not.toThrow()
  })

  it('onFlush that throws is caught — handleAgentEvent continues (CONTRACT FIXED)', () => {
    // Previously, if onFlush threw, it would crash handleAgentEvent.
    // Now onFlush calls are wrapped in try/catch.
    const failingProcessor = new AgentEventProcessor(
      (sessionId, event) => { emitted.push({ sessionId, event }) },
      {
        onFlush: () => { throw new Error('flush exploded') },
      },
    )

    const managed = createManagedSession()
    // agent_end triggers a flush
    const event = createEvent({
      type: 'agent_end',
    })

    // The onFlush throw is caught — handleAgentEvent does NOT throw
    expect(() => {
      failingProcessor.handleAgentEvent('session-1', event as AgentSessionEvent, managed)
    }).not.toThrow()
  })

  // ==========================================================================
  // Category 4: State & Side-Effect Skepticism
  // ==========================================================================

  it('CONTRACT AMBIGUITY: ManagedSession is mutated in place - no immutability guarantee', () => {
    // handleAgentEvent directly mutates the managed object. This means:
    // - No undo/rollback on error
    // - No change detection for consumers
    // - Race conditions if shared across async contexts
    const managed = createManagedSession()

    const before = managed.currentAssistantContent
    const event = createEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'mutation' },
    })

    processor.handleAgentEvent('session-1', event as AgentSessionEvent, managed)

    // Mutated in place
    expect(managed.currentAssistantContent).toBe('mutation')
    expect(managed.currentAssistantContent).not.toBe(before)
  })

  it('double finalizeAssistantMessage is idempotent - second call is no-op', () => {
    const managed = createManagedSession()
    const event = createEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'test' },
    })

    processor.handleAgentEvent('session-1', event as AgentSessionEvent, managed)
    processor.finalizeAssistantMessage(managed)

    const messageCount = managed.messages.length
    processor.finalizeAssistantMessage(managed)

    // Second finalize does not duplicate the message
    expect(managed.messages.length).toBe(messageCount)
  })

  it('CONTRACT GAP: crypto.randomUUID() is used for ID generation - not deterministic for testing', () => {
    // The processor uses crypto.randomUUID() to generate message IDs.
    // This makes it non-deterministic. Two calls will produce different IDs.
    const managed1 = createManagedSession()
    const managed2 = createManagedSession()

    const event = createEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'test' },
    })

    processor.handleAgentEvent('session-1', event as AgentSessionEvent, managed1)
    processor.handleAgentEvent('session-1', event as AgentSessionEvent, managed2)

    // Both generated IDs, but they are different
    expect(managed1.currentAssistantId).not.toBe(managed2.currentAssistantId)
  })

  it.todo('Consider using a deterministic ID generator injected via options for testability')

  it('multiple text_deltas accumulate content correctly', () => {
    const managed = createManagedSession()

    for (let i = 0; i < 10; i++) {
      const event = createEvent({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: `chunk${i}` },
      })
      processor.handleAgentEvent('session-1', event as AgentSessionEvent, managed)
    }

    expect(managed.currentAssistantContent).toBe('chunk0chunk1chunk2chunk3chunk4chunk5chunk6chunk7chunk8chunk9')
  })

  it('CONTRACT AMBIGUITY: empty delta text is still accumulated', () => {
    const managed = createManagedSession()
    const event = createEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: '' },
    })

    processor.handleAgentEvent('session-1', event as AgentSessionEvent, managed)

    // Empty string is accumulated - content is still empty string
    expect(managed.currentAssistantContent).toBe('')
    // But a message was created
    expect(managed.currentAssistantId).not.toBeNull()
  })

  it('usage accumulation works via message_end, not message_start', () => {
    // Usage is only accumulated in message_end, NOT message_start.
    // This is a contract detail: the name "message_end" implies it's just
    // a lifecycle event, but it actually carries critical data.
    const managed = createManagedSession()

    // message_end with usage
    const endEvent = createEvent({
      type: 'message_end',
      message: {
        role: 'assistant',
        usage: { input: 100, output: 50, cost: { total: 0.001 } },
      },
    })

    processor.handleAgentEvent('session-1', endEvent as AgentSessionEvent, managed)

    expect(managed.usageTotals.input).toBe(100)
    expect(managed.usageTotals.output).toBe(50)
    expect(managed.usageTotals.totalCost).toBe(0.001)
  })

  it('unknown event type is silently ignored', () => {
    // The switch statement has no default case - unknown event types
    // are silently dropped. This means adding a new event type to the
    // SDK but forgetting to handle it here will not cause an error.
    const managed = createManagedSession()
    const unknownEvent = createEvent({
      type: 'future_event_type',
    })

    expect(() => {
      processor.handleAgentEvent('session-1', unknownEvent as AgentSessionEvent, managed)
    }).not.toThrow()

    // Nothing was emitted or batched
    expect(emitted).toHaveLength(0)
    expect(batched).toHaveLength(0)
  })

  it.todo('Unknown event types should be logged as warnings for debuggability')
})
