import { describe, expect, it, vi } from 'vitest'
import { AgentEventProcessor, type ManagedSession } from '../main/agent-event-processor'
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'

function managed(): ManagedSession {
  return {
    session: { getContextUsage: () => undefined },
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
    uiContext: {} as ManagedSession['uiContext'],
    awaitingRetrySettlement: false,
  }
}

describe('AgentEventProcessor recent adversarial cases', () => {
  it('robustness policy: normalizes a malformed missing thinking delta to an empty string', () => {
    const emitted: unknown[] = []
    const processor = new AgentEventProcessor((_sessionId, event) => emitted.push(event))
    const state = managed()

    const malformedThinkingDelta = {
      type: 'message_update',
      assistantMessageEvent: { type: 'thinking_delta' },
    } as unknown as AgentSessionEvent
    processor.handleAgentEvent('session-1', malformedThinkingDelta, state)

    expect(emitted).toEqual([{ type: 'thinking_delta', delta: '' }])
    expect(state.currentThinkingContent).toBe('')
  })

  it('emits done only after retry settlement', () => {
    const emitted: unknown[] = []
    const processor = new AgentEventProcessor((_sessionId, event) => emitted.push(event))
    const state = managed()

    processor.handleAgentEvent('session-1', { type: 'agent_end', willRetry: true } as AgentSessionEvent, state)
    expect(emitted).toEqual([])
    expect(state.awaitingRetrySettlement).toBe(true)
    processor.handleAgentEvent('session-1', { type: 'agent_settled' } as AgentSessionEvent, state)
    expect(emitted).toEqual([{ type: 'done' }])
    expect(state.awaitingRetrySettlement).toBe(false)
  })
})
