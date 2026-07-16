/**
 * Unit tests for message grouping utility.
 *
 * Tests the pure `groupMessages` function that was extracted from ChatView.
 */

import { describe, it, expect } from 'vitest'
import { groupMessages, type MessageGroup } from '../renderer/src/utils/message-grouping'
import type {
  ChatMessage,
  AssistantTextMessage,
  AssistantToolCallMessage,
  AssistantThinkingMessage,
  UserMessage,
} from '../renderer/src/types/chat'

// ============================================================================
// Test helpers
// ============================================================================

function userMsg(id: string, content: string): UserMessage {
  return { id, role: 'user', content }
}

function assistantMsg(id: string, content: string): AssistantTextMessage {
  return { id, role: 'assistant', type: 'text', content }
}

function toolCallMsg(id: string, toolName: string): AssistantToolCallMessage {
  return {
    id,
    role: 'assistant',
    type: 'tool_call',
    toolName,
    toolId: id,
    args: {},
    status: 'running',
    isError: false,
  }
}

function thinkingMsg(id: string, content: string): AssistantThinkingMessage {
  return { id, role: 'assistant', content, type: 'thinking' }
}

// ============================================================================
// Tests
// ============================================================================

describe('groupMessages', () => {
  it('should return empty array for empty input', () => {
    expect(groupMessages([])).toEqual([])
  })

  it('should group single messages as single groups', () => {
    const messages: ChatMessage[] = [
      userMsg('1', 'Hello'),
      assistantMsg('2', 'Hi there'),
    ]

    const groups = groupMessages(messages)
    expect(groups).toHaveLength(2)
    expect(groups[0].type).toBe('single')
    expect(groups[1].type).toBe('single')
  })

  it('should group consecutive tool_call messages', () => {
    const messages: ChatMessage[] = [
      userMsg('1', 'Write a file'),
      toolCallMsg('2', 'toolcall_write'),
      toolCallMsg('3', 'toolcall_read'),
      assistantMsg('4', 'Done!'),
    ]

    const groups = groupMessages(messages)
    expect(groups).toHaveLength(3) // user + tool-group + assistant
    expect(groups[0].type).toBe('single') // user
    expect(groups[1].type).toBe('tool-group') // tool calls
    expect(groups[2].type).toBe('single') // assistant

    const toolGroup = groups[1] as Extract<MessageGroup, { type: 'tool-group' }>
    expect(toolGroup.msgs).toHaveLength(2)
    expect(toolGroup.key).toBe('tg-2')
  })

  it('should group consecutive thinking messages', () => {
    const messages: ChatMessage[] = [
      userMsg('1', 'Think about this'),
      thinkingMsg('2', 'Hmm...'),
      thinkingMsg('3', 'Let me see...'),
      assistantMsg('4', 'Answer'),
    ]

    const groups = groupMessages(messages)
    expect(groups).toHaveLength(3) // user + thinking-group + assistant
    expect(groups[0].type).toBe('single')
    expect(groups[1].type).toBe('thinking-group')
    expect(groups[2].type).toBe('single')

    const thinkingGroup = groups[1] as Extract<MessageGroup, { type: 'thinking-group' }>
    expect(thinkingGroup.msgs).toHaveLength(2)
    expect(thinkingGroup.key).toBe('th-2')
  })

  it('should handle alternating single and grouped messages', () => {
    const messages: ChatMessage[] = [
      userMsg('1', 'Hello'),
      toolCallMsg('2', 'toolcall_write'),
      toolCallMsg('3', 'toolcall_edit'),
      assistantMsg('4', 'Written'),
      thinkingMsg('5', 'Processing...'),
      assistantMsg('6', 'Final answer'),
    ]

    const groups = groupMessages(messages)
    expect(groups).toHaveLength(5)
    expect(groups[0].type).toBe('single') // user
    expect(groups[1].type).toBe('tool-group') // 2 tool calls
    expect(groups[2].type).toBe('single') // assistant text
    expect(groups[3].type).toBe('thinking-group') // 1 thinking
    expect(groups[4].type).toBe('single') // assistant text
  })

  it('should handle multiple separate tool groups', () => {
    const messages: ChatMessage[] = [
      toolCallMsg('1', 'toolcall_write'),
      assistantMsg('2', 'Writing...'),
      toolCallMsg('3', 'toolcall_edit'),
    ]

    const groups = groupMessages(messages)
    expect(groups).toHaveLength(3)
    expect(groups[0].type).toBe('tool-group') // tool 1
    expect(groups[1].type).toBe('single') // assistant
    // Even a single tool_call gets grouped as a tool-group
    expect(groups[2].type).toBe('tool-group')
    const toolGroup2 = groups[2] as Extract<MessageGroup, { type: 'tool-group' }>
    expect(toolGroup2.msgs).toHaveLength(1)
  })

  it('should use message id as key for single groups', () => {
    const messages: ChatMessage[] = [
      userMsg('my-user-id', 'Hello'),
    ]

    const groups = groupMessages(messages)
    const single = groups[0] as Extract<MessageGroup, { type: 'single' }>
    expect(single.key).toBe('my-user-id')
  })
})
