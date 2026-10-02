/**
 * message-grouping CRITICAL contract-violation tests.
 *
 * The existing tests cover basic grouping scenarios but miss:
 * - Category 1: Name vs Reality (groupMessages name implies grouping, but single tool_call
 *   becomes a "group" of 1 - is that really a "group"?)
 * - Category 2: Argument Boundary (messages with duplicate IDs, extremely long arrays)
 * - Category 3: Abstraction Ambiguity (UIDialogGroup/WorkflowStepGroup are exported but
 *   never produced by groupMessages - dead types in the union)
 * - Category 4: State & ordering assumptions
 */

import { describe, it, expect } from 'vitest'
import {
  groupMessages,
  type SingleGroup,
  type ToolGroup,
  type ThinkingGroup,
  type UIDialogGroup,
  type WorkflowStepGroup,
} from '../renderer/src/utils/message-grouping'
import type {
  ChatMessage,
  AssistantToolCallMessage,
  AssistantThinkingMessage,
  UserMessage,
  AssistantTextMessage,
} from '../renderer/src/types/chat'

function userMsg(id: string, content: string): UserMessage {
  return { id, role: 'user', content }
}

function assistantMsg(id: string, content: string): AssistantTextMessage {
  return { id, role: 'assistant', type: 'text', content }
}

function toolCallMsg(id: string, toolName: string, status: 'running' | 'done' = 'running'): AssistantToolCallMessage {
  return {
    id,
    role: 'assistant',
    type: 'tool_call',
    toolName,
    toolId: id,
    args: {},
    status,
    isError: false,
  }
}

function thinkingMsg(id: string, content: string): AssistantThinkingMessage {
  return { id, role: 'assistant', content, type: 'thinking' }
}

describe('groupMessages - Critical Contract Tests', () => {
  // ==========================================================================
  // Category 1: Name vs Reality
  // ==========================================================================

  it('CONTRACT AMBIGUITY: single tool_call is a "group" of 1, not a "single" message', () => {
    // The function is called "groupMessages" and produces "ToolGroup".
    // A single tool_call becomes a ToolGroup with msgs.length=1.
    // Is a group of 1 really a "group"? The name "group" implies multiple.
    // This matters for UI rendering: tool-groups get different layout.
    const messages: ChatMessage[] = [toolCallMsg('1', 'toolcall_write')]

    const groups = groupMessages(messages)
    expect(groups).toHaveLength(1)
    expect(groups[0].type).toBe('tool-group')
    const toolGroup = groups[0] as ToolGroup
    expect(toolGroup.msgs).toHaveLength(1)
  })

  it('CONTRACT AMBIGUITY: single thinking message is a "group" of 1', () => {
    const messages: ChatMessage[] = [thinkingMsg('1', 'hmm')]

    const groups = groupMessages(messages)
    expect(groups).toHaveLength(1)
    expect(groups[0].type).toBe('thinking-group')
    const thinkingGroup = groups[0] as ThinkingGroup
    expect(thinkingGroup.msgs).toHaveLength(1)
  })

  it.todo('Consider: should single tool_call/thinking be a "single" group instead of a "tool-group"/"thinking-group"?')

  // ==========================================================================
  // Category 2: Argument Boundary & Assumption Drilling
  // ==========================================================================

  it('messages with duplicate IDs still get grouped correctly', () => {
    // The contract doesn't say IDs must be unique. What happens with dupes?
    const messages: ChatMessage[] = [
      toolCallMsg('dup', 'toolcall_write'),
      toolCallMsg('dup', 'toolcall_read'),
    ]

    const groups = groupMessages(messages)
    expect(groups).toHaveLength(1)
    expect(groups[0].type).toBe('tool-group')

    // The key uses the first message's ID: "tg-dup"
    const toolGroup = groups[0] as ToolGroup
    expect(toolGroup.key).toBe('tg-dup')
  })

  it('duplicate IDs across different message types produce different keys', () => {
    const messages: ChatMessage[] = [
      toolCallMsg('shared-id', 'toolcall_write'),
      thinkingMsg('shared-id', 'hmm'),
    ]

    const groups = groupMessages(messages)
    expect(groups).toHaveLength(2)
    expect(groups[0].type).toBe('tool-group')
    expect(groups[1].type).toBe('thinking-group')

    // Keys are different prefixes: "tg-" vs "th-"
    expect((groups[0] as ToolGroup).key).toBe('tg-shared-id')
    expect((groups[1] as ThinkingGroup).key).toBe('th-shared-id')
  })

  it('large number of messages (1000+) works without stack overflow', () => {
    const messages: ChatMessage[] = []
    for (let i = 0; i < 1000; i++) {
      messages.push(userMsg(`msg-${i}`, `Message ${i}`))
    }

    // Should not throw - the while loop is iterative, not recursive
    expect(() => groupMessages(messages)).not.toThrow()
    const groups = groupMessages(messages)
    expect(groups).toHaveLength(1000)
  })

  it('alternating tool and thinking messages create separate groups for each', () => {
    const messages: ChatMessage[] = [
      toolCallMsg('1', 'tool1'),
      thinkingMsg('2', 'think1'),
      toolCallMsg('3', 'tool2'),
      thinkingMsg('4', 'think2'),
    ]

    const groups = groupMessages(messages)
    expect(groups).toHaveLength(4)
    expect(groups[0].type).toBe('tool-group')
    expect(groups[1].type).toBe('thinking-group')
    expect(groups[2].type).toBe('tool-group')
    expect(groups[3].type).toBe('thinking-group')
  })

  it('messages with empty content are still grouped', () => {
    const messages: ChatMessage[] = [
      userMsg('1', ''),
      assistantMsg('2', ''),
    ]

    const groups = groupMessages(messages)
    expect(groups).toHaveLength(2)
    expect(groups[0].type).toBe('single')
    expect(groups[1].type).toBe('single')
  })

  it('tool_call with done status is still grouped with running', () => {
    // Status (running vs done) does not affect grouping - only type matters
    const messages: ChatMessage[] = [
      toolCallMsg('1', 'tool1', 'running'),
      toolCallMsg('2', 'tool2', 'done'),
    ]

    const groups = groupMessages(messages)
    expect(groups).toHaveLength(1)
    expect(groups[0].type).toBe('tool-group')
  })

  // ==========================================================================
  // Category 3: Abstraction Ambiguity - Dead Types in Union
  // ==========================================================================

  it('CONTRACT VIOLATION: UIDialogGroup and WorkflowStepGroup are NEVER produced by groupMessages', () => {
    // The MessageGroup union type includes UIDialogGroup and WorkflowStepGroup.
    // But groupMessages() NEVER produces these types. They are "dead" members
    // of the union. This means any consumer doing exhaustive pattern matching
    // on MessageGroup.type will have unreachable cases.
    const messages: ChatMessage[] = [
      userMsg('1', 'Hello'),
      assistantMsg('2', 'Hi'),
      toolCallMsg('3', 'tool'),
      thinkingMsg('4', 'hmm'),
    ]

    const groups = groupMessages(messages)
    const types = groups.map((g) => g.type)

    // Only these types are ever produced
    expect(types.every((t) => ['single', 'tool-group', 'thinking-group'].includes(t))).toBe(true)

    // These types are NEVER produced by groupMessages
    expect(types.includes('ui-dialog')).toBe(false)
    expect(types.includes('workflow-step')).toBe(false)
  })

  it.todo('UIDialogGroup and WorkflowStepGroup should either be produced by groupMessages or removed from the MessageGroup union to avoid false exhaustiveness')

  it('UIDialogGroup type is constructable but has no factory function', () => {
    // These types exist in the module but can only be created manually.
    // ChatView pushes them directly to the messageGroups array.
    const uiDialog: UIDialogGroup = { key: 'uid-1', type: 'ui-dialog' }
    expect(uiDialog.type).toBe('ui-dialog')

    const workflow: WorkflowStepGroup = { key: 'wf-1', type: 'workflow-step', workflowId: 'wf-1' }
    expect(workflow.type).toBe('workflow-step')
  })

  // ==========================================================================
  // Category 4: State & Ordering
  // ==========================================================================

  it('group key format is deterministic and based on first message in group', () => {
    const messages: ChatMessage[] = [
      toolCallMsg('first-id', 'tool1'),
      toolCallMsg('second-id', 'tool2'),
      toolCallMsg('third-id', 'tool3'),
    ]

    const groups = groupMessages(messages)
    const toolGroup = groups[0] as ToolGroup

    // Key uses FIRST message's ID, not a composite
    expect(toolGroup.key).toBe('tg-first-id')
  })

  it('thinking group key format is deterministic', () => {
    const messages: ChatMessage[] = [
      thinkingMsg('first-think', 'hmm'),
      thinkingMsg('second-think', 'ah'),
    ]

    const groups = groupMessages(messages)
    const thinkingGroup = groups[0] as ThinkingGroup

    expect(thinkingGroup.key).toBe('th-first-think')
  })

  it('single message key is the message id directly (no prefix)', () => {
    const messages: ChatMessage[] = [userMsg('my-msg-id', 'Hello')]

    const groups = groupMessages(messages)
    const singleGroup = groups[0] as SingleGroup

    // No prefix like "single-" - just the raw ID
    expect(singleGroup.key).toBe('my-msg-id')
  })

  it('CONTRACT AMBIGUITY: key naming convention is inconsistent (single=raw, tools=tg-, thinking=th-)', () => {
    // Single groups use raw message IDs as keys.
    // Tool groups prefix with "tg-".
    // Thinking groups prefix with "th-".
    // This inconsistency means consumers cannot reliably parse keys.
    const messages: ChatMessage[] = [
      userMsg('1', 'Hello'),
      toolCallMsg('1', 'tool1'),
      thinkingMsg('1', 'hmm'),
    ]

    const groups = groupMessages(messages)
    expect((groups[0] as SingleGroup).key).toBe('1') // No prefix
    expect((groups[1] as ToolGroup).key).toBe('tg-1') // Prefix
    expect((groups[2] as ThinkingGroup).key).toBe('th-1') // Prefix
  })

  it.todo('Consider normalizing key format for all group types (e.g., "s-1", "tg-1", "th-1")')

  it('groups preserve insertion order (not sorted)', () => {
    const messages: ChatMessage[] = [
      assistantMsg('3', 'Third'),
      userMsg('1', 'First'),
      toolCallMsg('2', 'tool'),
    ]

    const groups = groupMessages(messages)
    expect(groups[0].type).toBe('single') // assistant text
    expect(groups[1].type).toBe('single') // user
    expect(groups[2].type).toBe('tool-group') // tool
  })

  it('groupMessages is a pure function - calling twice with same input gives same output', () => {
    const messages: ChatMessage[] = [
      userMsg('1', 'Hello'),
      toolCallMsg('2', 'tool'),
    ]

    const result1 = groupMessages(messages)
    const result2 = groupMessages(messages)

    expect(result1).toEqual(result2)
  })

  it('groupMessages does not mutate the input array', () => {
    const messages: ChatMessage[] = [
      userMsg('1', 'Hello'),
      toolCallMsg('2', 'tool'),
    ]
    const originalLength = messages.length

    groupMessages(messages)

    expect(messages).toHaveLength(originalLength)
  })
})
