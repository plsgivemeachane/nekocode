import { describe, it, expect } from 'vitest'
import type { SessionStreamEvent } from '@/shared/ipc-types'
import { generateId } from '@/renderer/src/types/chat'

/**
 * useSession hook tests — lightweight approach.
 *
 * The hook itself requires React rendering to test properly.
 * Instead, we test the core event-to-message transformation logic
 * that the hook implements, matching its exact behavior.
 *
 * If the hook is refactored to extract these as pure functions,
 * replace these inline copies with direct imports.
 */

// ── Inline copies of the hook's message transformation logic ─────

interface ChatMessage {
  role: string
  type: string
  content?: string
  toolName?: string
  toolId?: string
  args?: unknown
  status?: string
  result?: string
  isError?: boolean
  id: string
}

function handleTextDelta(messages: ChatMessage[], delta: string): ChatMessage[] {
  const msgs = [...messages]
  const last = msgs[msgs.length - 1]
  if (last && last.role === 'assistant' && last.type === 'text') {
    msgs[msgs.length - 1] = { ...last, content: last.content! + delta }
  } else {
    msgs.push({ role: 'assistant', type: 'text', content: delta, id: generateId() })
  }
  return msgs
}

function handleToolCall(messages: ChatMessage[], event: SessionStreamEvent & { type: 'tool_call' }): ChatMessage[] {
  return [...messages, {
    role: 'assistant',
    type: 'tool_call',
    toolName: event.toolName,
    toolId: event.toolCallId,
    args: event.args,
    status: 'running',
    id: generateId(),
  }]
}

function handleToolResult(messages: ChatMessage[], event: SessionStreamEvent & { type: 'tool_result' }): ChatMessage[] {
  const msgs = [...messages]
  for (let i = msgs.length - 1; i >= 0; i--) {
    const msg = msgs[i]
    if (
      msg.role === 'assistant' &&
      msg.type === 'tool_call' &&
      msg.toolId === event.toolCallId &&
      msg.status === 'running'
    ) {
      msgs[i] = { ...msg, status: 'done', result: typeof event.result === 'string' ? event.result : undefined, isError: event.isError }
      return msgs
    }
  }
  // No match — return unchanged (hook logs a warning in this case)
  return msgs
}

// ── Tests ──────────────────────────────────────────────────────────

describe('useSession message transformation logic', () => {
  describe('text_delta handling', () => {
    it('appends new assistant text message when no previous assistant message', () => {
      const msgs = handleTextDelta([], 'Hello')
      expect(msgs).toHaveLength(1)
      expect(msgs[0].role).toBe('assistant')
      expect(msgs[0].type).toBe('text')
      expect(msgs[0].content).toBe('Hello')
    })

    it('appends to existing assistant text message', () => {
      let msgs = handleTextDelta([], 'Hello')
      msgs = handleTextDelta(msgs, ' world')
      expect(msgs).toHaveLength(1)
      expect(msgs[0].content).toBe('Hello world')
    })

    it('creates new assistant text after a user message', () => {
      const userMsg: ChatMessage = { role: 'user', type: 'text', content: 'hi', id: 'u1' }
      const msgs = handleTextDelta([userMsg], 'Hey there')
      expect(msgs).toHaveLength(2)
      expect(msgs[1].content).toBe('Hey there')
    })

    it('creates new assistant text after a tool_call', () => {
      const toolMsg: ChatMessage = { role: 'assistant', type: 'tool_call', toolName: 'bash', toolId: 'tc-1', args: {}, status: 'done', id: 't1' }
      const msgs = handleTextDelta([toolMsg], 'Result:')
      expect(msgs).toHaveLength(2)
      expect(msgs[1].type).toBe('text')
      expect(msgs[1].content).toBe('Result:')
    })

    it('accumulates many deltas into one message', () => {
      let msgs: ChatMessage[] = []
      for (const ch of 'Hello world!') {
        msgs = handleTextDelta(msgs, ch)
      }
      expect(msgs).toHaveLength(1)
      expect(msgs[0].content).toBe('Hello world!')
    })
  })

  describe('tool_call handling', () => {
    it('adds a running tool_call message', () => {
      const msgs = handleToolCall([], {
        type: 'tool_call',
        toolName: 'bash',
        toolCallId: 'tc-1',
        args: { command: 'ls' },
      })
      expect(msgs).toHaveLength(1)
      expect(msgs[0].type).toBe('tool_call')
      expect(msgs[0].status).toBe('running')
      expect(msgs[0].toolName).toBe('bash')
    })

    it('preserves existing messages', () => {
      const existing: ChatMessage = { role: 'assistant', type: 'text', content: 'Let me check', id: 'a1' }
      const msgs = handleToolCall([existing], {
        type: 'tool_call',
        toolName: 'read',
        toolCallId: 'tc-2',
        args: { path: '/f' },
      })
      expect(msgs).toHaveLength(2)
      expect(msgs[0].content).toBe('Let me check')
      expect(msgs[1].type).toBe('tool_call')
    })
  })

  describe('tool_result handling', () => {
    it('updates matching running tool_call to done', () => {
      const toolMsg: ChatMessage = {
        role: 'assistant', type: 'tool_call',
        toolName: 'bash', toolId: 'tc-1',
        args: {}, status: 'running', id: 't1',
      }
      const msgs = handleToolResult([toolMsg], {
        type: 'tool_result',
        toolName: 'bash',
        toolCallId: 'tc-1',
        result: 'file.txt',
        isError: false,
      })
      expect(msgs).toHaveLength(1)
      expect(msgs[0].status).toBe('done')
      expect(msgs[0].result).toBe('file.txt')
      expect(msgs[0].isError).toBe(false)
    })

    it('matches the most recent running tool_call by toolId', () => {
      const tc1: ChatMessage = { role: 'assistant', type: 'tool_call', toolName: 'bash', toolId: 'tc-1', args: {}, status: 'done', id: 't1' }
      const tc2: ChatMessage = { role: 'assistant', type: 'tool_call', toolName: 'read', toolId: 'tc-2', args: {}, status: 'running', id: 't2' }
      const msgs = handleToolResult([tc1, tc2], {
        type: 'tool_result',
        toolName: 'read',
        toolCallId: 'tc-2',
        result: 'contents',
        isError: false,
      })
      // tc1 unchanged
      expect(msgs[0].status).toBe('done')
      // tc2 updated
      expect(msgs[1].status).toBe('done')
      expect(msgs[1].result).toBe('contents')
    })

    it('sets isError on tool_result', () => {
      const tc: ChatMessage = { role: 'assistant', type: 'tool_call', toolName: 'bash', toolId: 'tc-err', args: {}, status: 'running', id: 't1' }
      const msgs = handleToolResult([tc], {
        type: 'tool_result',
        toolName: 'bash',
        toolCallId: 'tc-err',
        result: 'command not found',
        isError: true,
      })
      expect(msgs[0].status).toBe('done')
      expect(msgs[0].isError).toBe(true)
      expect(msgs[0].result).toBe('command not found')
    })

    it('returns unchanged when no matching tool_call found', () => {
      const textMsg: ChatMessage = { role: 'assistant', type: 'text', content: 'hi', id: 'a1' }
      const msgs = handleToolResult([textMsg], {
        type: 'tool_result',
        toolName: 'bash',
        toolCallId: 'tc-missing',
        result: 'ok',
        isError: false,
      })
      expect(msgs).toHaveLength(1)
      expect(msgs[0].type).toBe('text')
      expect(msgs[0].content).toBe('hi')
    })

    it('does not match already-completed tool_calls', () => {
      const tc: ChatMessage = { role: 'assistant', type: 'tool_call', toolName: 'bash', toolId: 'tc-1', args: {}, status: 'done', id: 't1' }
      const msgs = handleToolResult([tc], {
        type: 'tool_result',
        toolName: 'bash',
        toolCallId: 'tc-1',
        result: 'should not match',
        isError: false,
      })
      expect(msgs[0].status).toBe('done')
      expect(msgs[0].result).toBeUndefined()
    })
  })

  describe('full streaming sequence', () => {
    it('handles text -> tool_call -> tool_result -> text -> done', () => {
      let msgs: ChatMessage[] = []

      // Assistant starts typing
      msgs = handleTextDelta(msgs, 'Let me read ')
      msgs = handleTextDelta(msgs, 'that file.')
      expect(msgs).toHaveLength(1)
      expect(msgs[0].content).toBe('Let me read that file.')

      // Tool call
      msgs = handleToolCall(msgs, {
        type: 'tool_call', toolName: 'read', toolCallId: 'tc-1', args: { path: '/f' },
      })
      expect(msgs).toHaveLength(2)
      expect(msgs[1].status).toBe('running')

      // Tool result
      msgs = handleToolResult(msgs, {
        type: 'tool_result', toolName: 'read', toolCallId: 'tc-1', result: 'file contents here', isError: false,
      })
      expect(msgs).toHaveLength(2)
      expect(msgs[1].status).toBe('done')
      expect(msgs[1].result).toBe('file contents here')

      // More text after tool
      msgs = handleTextDelta(msgs, 'The file says: ')
      msgs = handleTextDelta(msgs, 'file contents here')
      expect(msgs).toHaveLength(3)
      expect(msgs[2].content).toBe('The file says: file contents here')

      // done is a no-op for messages (just sets isStreaming=false in hook)
      expect(msgs).toHaveLength(3)
    })

    it('handles multiple tool calls in sequence', () => {
      let msgs: ChatMessage[] = []

      msgs = handleToolCall(msgs, { type: 'tool_call', toolName: 'read', toolCallId: 'tc-1', args: {} })
      msgs = handleToolResult(msgs, { type: 'tool_result', toolName: 'read', toolCallId: 'tc-1', result: 'a', isError: false })

      msgs = handleToolCall(msgs, { type: 'tool_call', toolName: 'bash', toolCallId: 'tc-2', args: {} })
      msgs = handleToolResult(msgs, { type: 'tool_result', toolName: 'bash', toolCallId: 'tc-2', result: 'b', isError: false })

      expect(msgs).toHaveLength(2)
      expect(msgs[0].toolName).toBe('read')
      expect(msgs[0].status).toBe('done')
      expect(msgs[1].toolName).toBe('bash')
      expect(msgs[1].status).toBe('done')
    })
  })
})
