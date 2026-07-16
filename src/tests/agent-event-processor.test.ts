/**
 * Unit tests for AgentEventProcessor.
 *
 * These tests verify the shared event processing logic extracted from
 * session-manager.ts and worker-bootstrap.ts. They test the processor
 * in isolation, verifying that agent events are correctly translated to
 * SessionStreamEvents and ManagedSession state is updated properly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentEventProcessor, type ManagedSession } from '../main/agent-event-processor'
import type { AgentSessionEvent, ContextUsage } from '@earendil-works/pi-coding-agent'
import type { SessionStreamEvent } from '../shared/ipc-types'

// ============================================================================
// Mocks
// ============================================================================

// Mock the logger to suppress output during tests
vi.mock('../main/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

// Mock text-extractor — signature must match the real extractTextContent
// Real signature: (content: string | Array<{ type: string }> | null | undefined) => string
// Note: The real implementation also accesses .text on text blocks, but the
// parameter type only declares { type: string }. Our mock needs .text too.
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

// ============================================================================
// Test helpers
// ============================================================================

/** Create a minimal ManagedSession for testing */
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

/** Create a mock agent event.
 *
 * Uses a constrained generic to ensure the `type` field is a valid
 * AgentSessionEvent type, while still allowing partial event objects
 * for testing (since the full SDK types have many optional fields).
 *
 * The double assertion is necessary because test events only provide
 * the fields relevant to the test, not the complete union type.
 */
function createEvent<T extends AgentSessionEvent['type']>(
  overrides: { type: T } & Record<string, unknown>,
): AgentSessionEvent {
  return overrides as AgentSessionEvent
}

// ============================================================================
// Tests
// ============================================================================

describe('AgentEventProcessor', () => {
  let emittedEvents: Array<{ sessionId: string; event: SessionStreamEvent }>
  let processor: AgentEventProcessor
  let managed: ManagedSession
  const sessionId = 'test-session-1'

  beforeEach(() => {
    emittedEvents = []
    processor = new AgentEventProcessor(
      (sid, event) => { emittedEvents.push({ sessionId: sid, event }) },
    )
    managed = createManagedSession()
  })

  // ── text_delta ──

  it('should emit text_delta events', () => {
    processor.handleAgentEvent(sessionId, createEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'Hello' },
    }), managed)

    // Should allocate an assistant ID
    expect(managed.currentAssistantId).toBeTruthy()
    expect(managed.currentAssistantContent).toBe('Hello')

    // Should emit the text_delta
    expect(emittedEvents).toHaveLength(1)
    expect(emittedEvents[0].event.type).toBe('text_delta')
    expect(emittedEvents[0].event).toHaveProperty('delta', 'Hello')
  })

  it('should accumulate text_delta events', () => {
    processor.handleAgentEvent(sessionId, createEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'Hello' },
    }), managed)
    processor.handleAgentEvent(sessionId, createEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: ' World' },
    }), managed)

    expect(managed.currentAssistantContent).toBe('Hello World')
  })

  // ── thinking events ──

  it('should handle thinking_start/delta/end events', () => {
    processor.handleAgentEvent(sessionId, createEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'thinking_start' },
    }), managed)
    expect(managed.currentThinkingId).toBeTruthy()

    processor.handleAgentEvent(sessionId, createEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'thinking_delta', delta: 'I think...' },
    }), managed)
    expect(managed.currentThinkingContent).toBe('I think...')

    processor.handleAgentEvent(sessionId, createEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'thinking_end' },
    }), managed)
    // Thinking message should be finalized and added to history
    expect(managed.currentThinkingId).toBeNull()
    expect(managed.messages).toHaveLength(1)
    expect(managed.messages[0].thinking).toBe(true)
    expect(managed.messages[0].content).toBe('I think...')
  })

  // ── message_start (user) ──

  it('should record user messages on message_start', () => {
    processor.handleAgentEvent(sessionId, createEvent({
      type: 'message_start',
      message: { role: 'user', content: 'Hello agent' },
    }), managed)

    expect(managed.messages).toHaveLength(1)
    expect(managed.messages[0].role).toBe('user')
    expect(managed.messages[0].content).toBe('Hello agent')
  })

  it('should finalize pending assistant message when user message starts', () => {
    // Start streaming an assistant message
    processor.handleAgentEvent(sessionId, createEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'Partial response' },
    }), managed)
    expect(managed.currentAssistantId).toBeTruthy()

    // User message starts — should finalize the pending assistant message
    processor.handleAgentEvent(sessionId, createEvent({
      type: 'message_start',
      message: { role: 'user', content: 'Next prompt' },
    }), managed)

    // The assistant message should be finalized
    expect(managed.currentAssistantId).toBeNull()
    expect(managed.messages).toHaveLength(2) // assistant + user
    expect(managed.messages[0].role).toBe('assistant')
    expect(managed.messages[0].content).toBe('Partial response')
  })

  // ── message_end (usage) ──

  it('should track usage on message_end', () => {
    // First, finalize an assistant message
    processor.handleAgentEvent(sessionId, createEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'Response' },
    }), managed)
    processor.handleAgentEvent(sessionId, createEvent({
      type: 'message_end',
      message: {
        role: 'assistant',
        usage: { input: 100, output: 50, cost: { total: 0.01 } },
      },
    }), managed)

    // Usage should be tracked
    expect(managed.usageTotals.input).toBe(100)
    expect(managed.usageTotals.output).toBe(50)
    expect(managed.usageTotals.totalCost).toBe(0.01)

    // Should emit usage_update
    const usageEvent = emittedEvents.find(e => e.event.type === 'usage_update')
    expect(usageEvent).toBeTruthy()
  })

  // ── tool_execution_start ──

  it('should emit tool_call event on tool_execution_start', () => {
    processor.handleAgentEvent(sessionId, createEvent({
      type: 'tool_execution_start',
      toolName: 'toolcall_write',
      toolCallId: 'tc-1',
      args: { path: '/tmp/test.txt', content: 'hello' },
    }), managed)

    // Should emit tool_call event
    expect(emittedEvents.some(e => e.event.type === 'tool_call')).toBe(true)
    expect(managed.currentToolCallId).toBe('tc-1')

    // Should add tool call to messages
    const lastMsg = managed.messages[managed.messages.length - 1]
    expect(lastMsg.toolCalls).toHaveLength(1)
    expect(lastMsg.toolCalls![0].name).toBe('toolcall_write')
  })

  // ── tool_execution_end ──

  it('should emit tool_result event on tool_execution_end', () => {
    // Start a tool execution first
    processor.handleAgentEvent(sessionId, createEvent({
      type: 'tool_execution_start',
      toolName: 'toolcall_read',
      toolCallId: 'tc-2',
      args: { path: '/tmp/test.txt' },
    }), managed)

    processor.handleAgentEvent(sessionId, createEvent({
      type: 'tool_execution_end',
      toolName: 'toolcall_read',
      toolCallId: 'tc-2',
      result: 'file content here',
      isError: false,
    }), managed)

    // Should emit tool_result
    const resultEvent = emittedEvents.find(e => e.event.type === 'tool_result')
    expect(resultEvent).toBeTruthy()
    expect(managed.currentToolCallId).toBeNull()
  })

  // ── agent_end ──

  it('should finalize messages and emit done on agent_end', () => {
    processor.handleAgentEvent(sessionId, createEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'Final response' },
    }), managed)

    processor.handleAgentEvent(sessionId, createEvent({
      type: 'agent_end',
    }), managed)

    // Should finalize the pending assistant message
    expect(managed.currentAssistantId).toBeNull()
    expect(managed.messages).toHaveLength(1)
    expect(managed.messages[0].content).toBe('Final response')

    // Should emit done
    expect(emittedEvents.some(e => e.event.type === 'done')).toBe(true)
  })

  // ── agent_start ──

  it('should emit agent_start event', () => {
    processor.handleAgentEvent(sessionId, createEvent({
      type: 'agent_start',
    }), managed)

    expect(emittedEvents.some(e => e.event.type === 'agent_start')).toBe(true)
  })

  // ── turn_start ──

  it('should emit agent_start on turn_start', () => {
    processor.handleAgentEvent(sessionId, createEvent({
      type: 'turn_start',
    }), managed)

    // turn_start should emit agent_start for renderer status updates
    expect(emittedEvents.some(e => e.event.type === 'agent_start')).toBe(true)
  })

  // ── Options: emitUserMessage ──

  it('should emit user_message event when emitUserMessage is true', () => {
    const userProcessor = new AgentEventProcessor(
      (sid, event) => { emittedEvents.push({ sessionId: sid, event }) },
      { emitUserMessage: true },
    )

    userProcessor.handleAgentEvent(sessionId, createEvent({
      type: 'message_start',
      message: { role: 'user', content: 'Hello' },
    }), managed)

    expect(emittedEvents.some(e => e.event.type === 'user_message')).toBe(true)
  })

  it('should NOT emit user_message event when emitUserMessage is false (default)', () => {
    processor.handleAgentEvent(sessionId, createEvent({
      type: 'message_start',
      message: { role: 'user', content: 'Hello' },
    }), managed)

    expect(emittedEvents.some(e => e.event.type === 'user_message')).toBe(false)
  })

  // ── Options: onBatchableEvent ──

  it('should route batchable events through onBatchableEvent', () => {
    const batchableEvents: SessionStreamEvent[] = []
    const batchProcessor = new AgentEventProcessor(
      (sid, event) => { emittedEvents.push({ sessionId: sid, event }) },
      {
        onBatchableEvent: (event) => { batchableEvents.push(event) },
      },
    )

    batchProcessor.handleAgentEvent(sessionId, createEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'Hello' },
    }), managed)

    // text_delta is batchable — should go to onBatchableEvent, NOT to emit
    expect(batchableEvents).toHaveLength(1)
    expect(batchableEvents[0].type).toBe('text_delta')
    // The emit callback should NOT have been called for batchable events
    expect(emittedEvents.filter(e => e.event.type === 'text_delta')).toHaveLength(0)
  })

  // ── Options: onFlush ──

  it('should call onFlush before tool_execution_start', () => {
    let flushCount = 0
    const flushProcessor = new AgentEventProcessor(
      (sid, event) => { emittedEvents.push({ sessionId: sid, event }) },
      { onFlush: () => { flushCount++ } },
    )

    flushProcessor.handleAgentEvent(sessionId, createEvent({
      type: 'tool_execution_start',
      toolName: 'toolcall_write',
      toolCallId: 'tc-3',
      args: {},
    }), managed)

    expect(flushCount).toBe(1)
  })

  // ── finalizeAssistantMessage ──

  it('finalizeAssistantMessage should push assistant message to history', () => {
    managed.currentAssistantId = 'asst-1'
    managed.currentAssistantContent = 'Hello world'

    processor.finalizeAssistantMessage(managed)

    expect(managed.messages).toHaveLength(1)
    expect(managed.messages[0].id).toBe('asst-1')
    expect(managed.messages[0].content).toBe('Hello world')
    expect(managed.currentAssistantId).toBeNull()
    expect(managed.currentAssistantContent).toBe('')
  })

  it('finalizeAssistantMessage should be no-op when no assistant message is pending', () => {
    processor.finalizeAssistantMessage(managed)
    expect(managed.messages).toHaveLength(0)
  })

  // ── finalizeThinkingMessage ──

  it('finalizeThinkingMessage should push thinking message to history', () => {
    managed.currentThinkingId = 'think-1'
    managed.currentThinkingContent = 'Deep thoughts'

    processor.finalizeThinkingMessage(managed)

    expect(managed.messages).toHaveLength(1)
    expect(managed.messages[0].thinking).toBe(true)
    expect(managed.messages[0].content).toBe('Deep thoughts')
    expect(managed.currentThinkingId).toBeNull()
  })

  // ── Full conversation flow ──

  it('should handle a full conversation flow', () => {
    // User sends a message
    processor.handleAgentEvent(sessionId, createEvent({
      type: 'message_start',
      message: { role: 'user', content: 'Write hello world' },
    }), managed)

    // Agent starts
    processor.handleAgentEvent(sessionId, createEvent({
      type: 'agent_start',
    }), managed)

    // Agent streams text
    processor.handleAgentEvent(sessionId, createEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'I will write' },
    }), managed)
    processor.handleAgentEvent(sessionId, createEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: ' hello world' },
    }), managed)

    // Agent calls a tool
    processor.handleAgentEvent(sessionId, createEvent({
      type: 'tool_execution_start',
      toolName: 'toolcall_write',
      toolCallId: 'tc-flow',
      args: { path: '/tmp/hello.txt', content: 'hello world' },
    }), managed)

    processor.handleAgentEvent(sessionId, createEvent({
      type: 'tool_execution_end',
      toolName: 'toolcall_write',
      toolCallId: 'tc-flow',
      result: 'File written',
      isError: false,
    }), managed)

    // Agent ends
    processor.handleAgentEvent(sessionId, createEvent({
      type: 'agent_end',
    }), managed)

    // Verify final state
    expect(managed.messages.length).toBeGreaterThanOrEqual(2) // user + assistant text
    expect(emittedEvents.some(e => e.event.type === 'done')).toBe(true)
    expect(emittedEvents.some(e => e.event.type === 'tool_call')).toBe(true)
    expect(emittedEvents.some(e => e.event.type === 'tool_result')).toBe(true)
  })

  // ── Edge cases ──

  it('should handle text_delta without a prior message_start (orphan delta)', () => {
    // An orphan text_delta should still allocate an assistant ID
    processor.handleAgentEvent(sessionId, createEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'Orphan' },
    }), managed)

    expect(managed.currentAssistantId).toBeTruthy()
    expect(managed.currentAssistantContent).toBe('Orphan')
  })

  it('should handle thinking_delta without thinking_start (orphan)', () => {
    processor.handleAgentEvent(sessionId, createEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'thinking_delta', delta: 'Orphan thought' },
    }), managed)

    // Should still accumulate content
    expect(managed.currentThinkingContent).toBe('Orphan thought')
  })

  it('should handle tool_execution_end without matching start (orphan)', () => {
    // End without start — should not crash
    processor.handleAgentEvent(sessionId, createEvent({
      type: 'tool_execution_end',
      toolName: 'toolcall_read',
      toolCallId: 'tc-orphan',
      result: 'content',
      isError: false,
    }), managed)

    // Should not throw, and currentToolCallId should be cleared
    expect(managed.currentToolCallId).toBeNull()
  })

  it('should handle multiple agent_start events without intermediate agent_end', () => {
    processor.handleAgentEvent(sessionId, createEvent({
      type: 'agent_start',
    }), managed)
    processor.handleAgentEvent(sessionId, createEvent({
      type: 'agent_start',
    }), managed)

    // Should emit two agent_start events
    const startEvents = emittedEvents.filter(e => e.event.type === 'agent_start')
    expect(startEvents).toHaveLength(2)
  })

  it('should handle agent_end without any prior messages', () => {
    processor.handleAgentEvent(sessionId, createEvent({
      type: 'agent_end',
    }), managed)

    // Should emit done even with no messages
    expect(emittedEvents.some(e => e.event.type === 'done')).toBe(true)
    expect(managed.currentAssistantId).toBeNull()
  })

  it('should accumulate usage across multiple message_end events', () => {
    // First message
    processor.handleAgentEvent(sessionId, createEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'First' },
    }), managed)
    processor.handleAgentEvent(sessionId, createEvent({
      type: 'message_end',
      message: {
        role: 'assistant',
        usage: { input: 100, output: 50, cost: { total: 0.01 } },
      },
    }), managed)

    // Second message
    processor.handleAgentEvent(sessionId, createEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'Second' },
    }), managed)
    processor.handleAgentEvent(sessionId, createEvent({
      type: 'message_end',
      message: {
        role: 'assistant',
        usage: { input: 200, output: 100, cost: { total: 0.02 } },
      },
    }), managed)

    // Usage should be cumulative
    expect(managed.usageTotals.input).toBe(300)
    expect(managed.usageTotals.output).toBe(150)
    expect(managed.usageTotals.totalCost).toBeCloseTo(0.03)
  })
})
