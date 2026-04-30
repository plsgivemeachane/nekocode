import { describe, it, expect } from 'vitest'
import type { ChatMessage } from '@/renderer/src/types/chat'
import { handleTextDelta, handleToolCall, handleToolResult } from '@/renderer/src/utils/message-transforms'

/**
 * useSession hook tests — lightweight approach.
 *
 * The hook itself requires React rendering to test properly.
 * We test the core event-to-message transformation logic
 * that the hook delegates to message-transforms.ts.
 */

// ── Helpers ─────────────────────────────────────────────────────

const userMsg = (content: string, id = 'u1'): ChatMessage => ({ role: 'user', content, id })
const textMsg = (content: string, id = 'a1'): ChatMessage => ({ role: 'assistant', type: 'text', content, id })
const toolMsg = (overrides: { toolName: string; toolId: string; status?: 'running' | 'done'; result?: unknown; isError?: boolean; id?: string }): ChatMessage => ({
  role: 'assistant',
  type: 'tool_call',
  toolName: overrides.toolName,
  toolId: overrides.toolId,
  args: {},
  status: overrides.status ?? 'running',
  result: overrides.result,
  isError: overrides.isError,
  id: overrides.id ?? 't1',
})

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
      const msgs = handleTextDelta([userMsg('hi')], 'Hey there')
      expect(msgs).toHaveLength(2)
      expect(msgs[1].content).toBe('Hey there')
    })

    it('creates new assistant text after a tool_call', () => {
      const msgs = handleTextDelta([toolMsg({ toolName: 'bash', toolId: 'tc-1', status: 'done' })], 'Result:')
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
      const msgs = handleToolCall([textMsg('Let me check')], {
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
      const msgs = handleToolResult([toolMsg({ toolName: 'bash', toolId: 'tc-1' })], {
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
      const msgs = handleToolResult(
        [toolMsg({ toolName: 'bash', toolId: 'tc-1', status: 'done', id: 't1' }), toolMsg({ toolName: 'read', toolId: 'tc-2', id: 't2' })],
        { type: 'tool_result', toolName: 'read', toolCallId: 'tc-2', result: 'contents', isError: false },
      )
      expect(msgs[0].status).toBe('done')
      expect(msgs[1].status).toBe('done')
      expect(msgs[1].result).toBe('contents')
    })

    it('sets isError on tool_result', () => {
      const msgs = handleToolResult([toolMsg({ toolName: 'bash', toolId: 'tc-err' })], {
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
      const msgs = handleToolResult([textMsg('hi')], {
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
      const msgs = handleToolResult([toolMsg({ toolName: 'bash', toolId: 'tc-1', status: 'done' })], {
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

      msgs = handleTextDelta(msgs, 'Let me read ')
      msgs = handleTextDelta(msgs, 'that file.')
      expect(msgs).toHaveLength(1)
      expect(msgs[0].content).toBe('Let me read that file.')

      msgs = handleToolCall(msgs, {
        type: 'tool_call', toolName: 'read', toolCallId: 'tc-1', args: { path: '/f' },
      })
      expect(msgs).toHaveLength(2)
      expect(msgs[1].status).toBe('running')

      msgs = handleToolResult(msgs, {
        type: 'tool_result', toolName: 'read', toolCallId: 'tc-1', result: 'file contents here', isError: false,
      })
      expect(msgs).toHaveLength(2)
      expect(msgs[1].status).toBe('done')
      expect(msgs[1].result).toBe('file contents here')

      msgs = handleTextDelta(msgs, 'The file says: ')
      msgs = handleTextDelta(msgs, 'file contents here')
      expect(msgs).toHaveLength(3)
      expect(msgs[2].content).toBe('The file says: file contents here')

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
