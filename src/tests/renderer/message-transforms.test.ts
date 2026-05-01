import { describe, it, expect } from 'vitest'
import type { ChatMessageIPC } from '@/shared/ipc-types'
import type { ChatMessage } from '@/renderer/src/types/chat'
import {
  ipcToChatMessage,
  ipcToChatMessages,
  messageSignature,
  isSessionNotReadyError,
} from '@/renderer/src/utils/message-transforms'

// ── Helpers ─────────────────────────────────────────────────────

function makeIPC(overrides: Partial<ChatMessageIPC> = {}): ChatMessageIPC {
  return { id: 'ipc-1', role: 'user', content: 'hello', timestamp: Date.now(), ...overrides }
}

// ── ipcToChatMessage ───────────────────────────────────────────

describe('ipcToChatMessage', () => {
  it('converts a user IPC message to a user ChatMessage', () => {
    const ipc = makeIPC({ role: 'user', content: 'Hello world' })
    const result = ipcToChatMessage(ipc)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ role: 'user', content: 'Hello world', id: 'ipc-1' })
  })

  it('converts an assistant IPC message to a text ChatMessage', () => {
    const ipc = makeIPC({ role: 'assistant', content: 'Hi there' })
    const result = ipcToChatMessage(ipc)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ role: 'assistant', type: 'text', content: 'Hi there', id: 'ipc-1' })
  })

  it('returns empty array when content is empty', () => {
    const ipc = makeIPC({ content: '' })
    expect(ipcToChatMessage(ipc)).toEqual([])
  })

  it('returns empty array when content is missing (undefined)', () => {
    const ipc = makeIPC({ content: undefined as unknown as string })
    expect(ipcToChatMessage(ipc)).toEqual([])
  })

  it('converts tool calls into separate tool_call messages', () => {
    const ipc = makeIPC({
      role: 'assistant',
      content: 'Let me check',
      toolCalls: [
        { id: 'tc-1', name: 'read', args: { path: '/foo' }, result: 'file content' },
        { id: 'tc-2', name: 'bash', args: { cmd: 'ls' }, result: 'bar.txt', isError: false },
      ],
    })
    const result = ipcToChatMessage(ipc)
    expect(result).toHaveLength(3) // 1 text + 2 tool_calls

    // First: text message
    expect(result[0]).toEqual({ role: 'assistant', type: 'text', content: 'Let me check', id: 'ipc-1' })

    // Tool calls have dynamically generated IDs
    const tc1 = result[1] as Extract<ChatMessage, { type: 'tool_call' }>
    expect(tc1.role).toBe('assistant')
    expect(tc1.type).toBe('tool_call')
    expect(tc1.toolName).toBe('read')
    expect(tc1.toolId).toBe('tc-1')
    expect(tc1.args).toEqual({ path: '/foo' })
    expect(tc1.result).toBe('file content')
    expect(tc1.status).toBe('done')
    expect(tc1.isError).toBeUndefined()

    const tc2 = result[2] as Extract<ChatMessage, { type: 'tool_call' }>
    expect(tc2.toolName).toBe('bash')
    expect(tc2.toolId).toBe('tc-2')
    expect(tc2.isError).toBe(false)
  })

  it('preserves isError on tool calls', () => {
    const ipc = makeIPC({
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'tc-err', name: 'bash', args: {}, result: 'Permission denied', isError: true }],
    })
    const result = ipcToChatMessage(ipc)
    expect(result).toHaveLength(1)
    expect((result[0] as Extract<ChatMessage, { type: 'tool_call' }>).isError).toBe(true)
  })

  it('handles tool calls without result', () => {
    const ipc = makeIPC({
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'tc-nr', name: 'bash', args: { cmd: 'ls' } }],
    })
    const result = ipcToChatMessage(ipc)
    expect(result).toHaveLength(1)
    expect((result[0] as Extract<ChatMessage, { type: 'tool_call' }>).result).toBeUndefined()
  })

  it('returns only tool_call messages when content is empty but toolCalls exist', () => {
    const ipc = makeIPC({
      content: '',
      toolCalls: [{ id: 'tc-1', name: 'read', args: {} }],
    })
    const result = ipcToChatMessage(ipc)
    expect(result).toHaveLength(1)
    expect((result[0] as Extract<ChatMessage, { type: 'tool_call' }>).type).toBe('tool_call')
  })

  it('treats whitespace-only content as valid (truthy string)', () => {
    const ipc = makeIPC({ role: 'user', content: '   ' })
    const result = ipcToChatMessage(ipc)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ role: 'user', content: '   ', id: 'ipc-1' })
  })

  it('returns empty array when toolCalls is an empty array and content is empty', () => {
    const ipc = makeIPC({ content: '', toolCalls: [] })
    expect(ipcToChatMessage(ipc)).toEqual([])
  })

  it('returns text + empty array when content exists but toolCalls is empty array', () => {
    const ipc = makeIPC({ role: 'assistant', content: 'hi', toolCalls: [] })
    const result = ipcToChatMessage(ipc)
    expect(result).toHaveLength(1)
    expect((result[0] as Extract<ChatMessage, { type: 'text' }>).content).toBe('hi')
  })

  it('generates unique IDs for each tool_call message', () => {
    const ipc = makeIPC({
      content: '',
      toolCalls: [
        { id: 'tc-1', name: 'read', args: {} },
        { id: 'tc-2', name: 'bash', args: {} },
      ],
    })
    const result = ipcToChatMessage(ipc)
    const ids = result.map((m) => m.id)
    expect(new Set(ids).size).toBe(2)
    // Tool call IDs should NOT equal the IPC message id
    expect(ids).not.toContain('ipc-1')
  })

  it('preserves the original IPC id for user messages', () => {
    const ipc = makeIPC({ id: 'user-abc', role: 'user', content: 'test' })
    const result = ipcToChatMessage(ipc)
    expect(result[0].id).toBe('user-abc')
  })

  it('preserves the original IPC id for assistant text messages', () => {
    const ipc = makeIPC({ id: 'asst-xyz', role: 'assistant', content: 'reply' })
    const result = ipcToChatMessage(ipc)
    expect(result[0].id).toBe('asst-xyz')
  })
})


// ── ipcToChatMessages ──────────────────────────────────────────

describe('ipcToChatMessages', () => {
  it('returns empty array for empty input', () => {
    expect(ipcToChatMessages([])).toEqual([])
  })

  it('flatMaps multiple IPC messages', () => {
    const messages: ChatMessageIPC[] = [
      makeIPC({ id: 'u-1', role: 'user', content: 'hi' }),
      makeIPC({ id: 'a-1', role: 'assistant', content: 'hello', toolCalls: [
        { id: 'tc-1', name: 'read', args: {} },
        { id: 'tc-2', name: 'bash', args: {} },
      ]}),
      makeIPC({ id: 'u-2', role: 'user', content: 'bye' }),
    ]
    const result = ipcToChatMessages(messages)
    // 1 user + 1 text + 2 tool_calls + 1 user = 5
    expect(result).toHaveLength(5)
    expect(result[0].role).toBe('user')
    expect((result[1] as Extract<ChatMessage, { type: 'text' }>).type).toBe('text')
    expect((result[2] as Extract<ChatMessage, { type: 'tool_call' }>).type).toBe('tool_call')
    expect((result[3] as Extract<ChatMessage, { type: 'tool_call' }>).type).toBe('tool_call')
    expect(result[4].role).toBe('user')
  })

  it('filters out empty-content messages without tool calls', () => {
    const messages: ChatMessageIPC[] = [
      makeIPC({ id: 'u-1', role: 'user', content: '' }),
      makeIPC({ id: 'u-2', role: 'user', content: 'hello' }),
    ]
    const result = ipcToChatMessages(messages)
    expect(result).toHaveLength(1)
    expect(result[0].role).toBe('user')
  })

  it('preserves order across multiple messages with mixed content', () => {
    const messages: ChatMessageIPC[] = [
      makeIPC({ id: 'a', role: 'user', content: 'first' }),
      makeIPC({ id: 'b', role: 'assistant', content: 'second' }),
      makeIPC({ id: 'c', role: 'user', content: '' }), // filtered out
      makeIPC({ id: 'd', role: 'user', content: 'third' }),
    ]
    const result = ipcToChatMessages(messages)
    expect(result).toHaveLength(3)
    expect((result[0] as { content: string }).content).toBe('first')
    expect((result[1] as { content: string }).content).toBe('second')
    expect((result[2] as { content: string }).content).toBe('third')
  })

  it('handles single message with many tool calls', () => {
    const messages: ChatMessageIPC[] = [
      makeIPC({
        id: 'multi', role: 'assistant', content: 'doing things',
        toolCalls: Array.from({ length: 10 }, (_, i) => ({
          id: `tc-${i}`, name: `tool-${i}`, args: { index: i },
        })),
      }),
    ]
    const result = ipcToChatMessages(messages)
    expect(result).toHaveLength(11) // 1 text + 10 tool_calls
  })
})


// ── messageSignature ───────────────────────────────────────────

describe('messageSignature', () => {
  it('returns empty string for empty array', () => {
    expect(messageSignature([])).toBe('')
  })

  it('produces stable signature for user messages', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'hello', id: 'x' },
      { role: 'user', content: 'world', id: 'y' },
    ]
    expect(messageSignature(msgs)).toBe('u:hello\nu:world')
  })

  it('produces stable signature for assistant text messages', () => {
    const msgs: ChatMessage[] = [
      { role: 'assistant', type: 'text' as const, content: 'response', id: 'x' },
    ]
    expect(messageSignature(msgs)).toBe('a:t:response')
  })

  it('produces stable signature for tool_call messages', () => {
    const msgs: ChatMessage[] = [
      {
        role: 'assistant', type: 'tool_call', toolName: 'read', toolId: 'tc-1',
        args: { path: '/foo' }, status: 'done', result: 'content', isError: false, id: 'x',
      },
    ]
    const sig = messageSignature(msgs)
    expect(sig).toBe('a:c:tc-1:read:done:{"path":"/foo"}:"content":0')
  })

  it('includes isError flag as 1 when true', () => {
    const msgs: ChatMessage[] = [
      {
        role: 'assistant', type: 'tool_call', toolName: 'bash', toolId: 'tc-2',
        args: {}, status: 'done', result: 'error msg', isError: true, id: 'x',
      },
    ]
    const sig = messageSignature(msgs)
    expect(sig).toContain(':1')
  })

  it('handles tool_call with undefined result', () => {
    const msgs: ChatMessage[] = [
      {
        role: 'assistant', type: 'tool_call', toolName: 'read', toolId: 'tc-3',
        args: null, status: 'running', id: 'x',
      },
    ]
    const sig = messageSignature(msgs)
    expect(sig).toBe('a:c:tc-3:read:running:null::0')
  })

  it('is stable across different message IDs (IDs not included)', () => {
    const msgsA: ChatMessage[] = [{ role: 'user', content: 'test', id: 'id-aaa' }]
    const msgsB: ChatMessage[] = [{ role: 'user', content: 'test', id: 'id-bbb' }]
    expect(messageSignature(msgsA)).toBe(messageSignature(msgsB))
  })

  it('changes when content changes', () => {
    const msgsA: ChatMessage[] = [{ role: 'user', content: 'test', id: 'x' }]
    const msgsB: ChatMessage[] = [{ role: 'user', content: 'changed', id: 'x' }]
    expect(messageSignature(msgsA)).not.toBe(messageSignature(msgsB))
  })

  it('changes when tool_call status changes', () => {
    const base = {
      role: 'assistant' as const, type: 'tool_call' as const, toolName: 'bash',
      toolId: 'tc-1', args: {}, id: 'x',
    }
    const sigRunning = messageSignature([{ ...base, status: 'running' }])
    const sigDone = messageSignature([{ ...base, status: 'done', result: 'ok' }])
    expect(sigRunning).not.toBe(sigDone)
  })

  it('handles mixed message types', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'do something', id: 'x' },
      { role: 'assistant', type: 'text', content: 'ok', id: 'y' },
      {
        role: 'assistant', type: 'tool_call', toolName: 'bash', toolId: 'tc-1',
        args: { cmd: 'ls' }, status: 'done', result: 'file.txt', id: 'z',
      },
    ]
    const sig = messageSignature(msgs)
    const lines = sig.split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe('u:do something')
    expect(lines[1]).toBe('a:t:ok')
    expect(lines[2]).toContain('a:c:tc-1:bash')
  })

  it('handles tool_call with undefined args (JSON.stringify returns undefined, coerced to empty)', () => {
    const msgs: ChatMessage[] = [
      {
        role: 'assistant', type: 'tool_call', toolName: 'bash', toolId: 'tc-undef',
        args: undefined as unknown as unknown, status: 'done', id: 'x',
      },
    ]
    const sig = messageSignature(msgs)
    // JSON.stringify(undefined) returns undefined; the function coalesces to empty string
    expect(sig).toBe('a:c:tc-undef:bash:done:::0')
  })

  it('handles content with colons (does not break signature parsing)', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'http://example.com:8080/path', id: 'x' },
    ]
    const sig = messageSignature(msgs)
    expect(sig).toBe('u:http://example.com:8080/path')
  })

  it('handles content with newlines (joined by newline delimiter)', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'line1\nline2', id: 'x' },
      { role: 'user', content: 'line3', id: 'y' },
    ]
    const sig = messageSignature(msgs)
    // The newline inside content becomes part of the signature line
    expect(sig).toContain('u:line1\nline2')
    expect(sig).toContain('u:line3')
  })

  it('handles nested args in tool_call', () => {
    const msgs: ChatMessage[] = [
      {
        role: 'assistant', type: 'tool_call', toolName: 'edit', toolId: 'tc-nested',
        args: { file: 'test.ts', edits: [{ old: 'a', new: 'b' }] },
        status: 'done', result: 'success', id: 'x',
      },
    ]
    const sig = messageSignature(msgs)
    expect(sig).toContain(JSON.stringify({ file: 'test.ts', edits: [{ old: 'a', new: 'b' }] }))
  })

  it('produces different signatures for different tool_call args', () => {
    const base = {
      role: 'assistant' as const, type: 'tool_call' as const, toolName: 'read',
      toolId: 'tc-1', status: 'done' as const, id: 'x',
    }
    const sigA = messageSignature([{ ...base, args: { path: '/a' }, result: 'content-a' }])
    const sigB = messageSignature([{ ...base, args: { path: '/b' }, result: 'content-b' }])
    expect(sigA).not.toBe(sigB)
  })
})

// ── ipcToChatMessage - usage persistence ───────────────────────

describe('ipcToChatMessage - usage persistence', () => {
  it('preserves usage field on assistant text message', () => {
    const ipc = makeIPC({
      role: 'assistant',
      content: 'Response',
      usage: { inputTokens: 100, outputTokens: 50, totalCost: 0.003 },
    })
    const result = ipcToChatMessage(ipc)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      role: 'assistant',
      type: 'text',
      content: 'Response',
      id: 'ipc-1',
      usage: { inputTokens: 100, outputTokens: 50, totalCost: 0.003 },
    })
  })

  it('handles assistant message without usage (undefined)', () => {
    const ipc = makeIPC({ role: 'assistant', content: 'Response' })
    const result = ipcToChatMessage(ipc)
    expect(result).toHaveLength(1)
    expect(result[0].usage).toBeUndefined()
  })

  it('user messages do not have usage field even if provided', () => {
    const ipc = makeIPC({
      role: 'user',
      content: 'Hello',
      usage: { inputTokens: 100, outputTokens: 50, totalCost: 0.003 }, // Should be ignored
    })
    const result = ipcToChatMessage(ipc)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ role: 'user', content: 'Hello', id: 'ipc-1' })
    expect('usage' in result[0]).toBe(false)
  })

  it('preserves usage with tool calls', () => {
    const ipc = makeIPC({
      role: 'assistant',
      content: 'Running...',
      usage: { inputTokens: 500, outputTokens: 200, totalCost: 0.015 },
      toolCalls: [{ id: 'tc-1', name: 'bash', args: { cmd: 'ls' }, result: 'file.txt' }],
    })
    const result = ipcToChatMessage(ipc)
    expect(result).toHaveLength(2) // 1 text + 1 tool_call
    // Text message should have usage
    expect(result[0]).toEqual({
      role: 'assistant',
      type: 'text',
      content: 'Running...',
      id: 'ipc-1',
      usage: { inputTokens: 500, outputTokens: 200, totalCost: 0.015 },
    })
    // Tool call message should not have usage
    const tc = result[1] as Extract<ChatMessage, { type: 'tool_call' }>
    expect(tc.type).toBe('tool_call')
    expect('usage' in tc).toBe(false)
  })

  it('handles zero cost usage', () => {
    const ipc = makeIPC({
      role: 'assistant',
      content: 'Free response',
      usage: { inputTokens: 0, outputTokens: 0, totalCost: 0 },
    })
    const result = ipcToChatMessage(ipc)
    expect(result).toHaveLength(1)
    expect(result[0].usage).toEqual({ inputTokens: 0, outputTokens: 0, totalCost: 0 })
  })

  it('handles large token counts', () => {
    const ipc = makeIPC({
      role: 'assistant',
      content: 'Large response',
      usage: { inputTokens: 1000000, outputTokens: 500000, totalCost: 15.50 },
    })
    const result = ipcToChatMessage(ipc)
    expect(result[0].usage).toEqual({ inputTokens: 1000000, outputTokens: 500000, totalCost: 15.50 })
  })
})


// ── isSessionNotReadyError ─────────────────────────────────────

describe('isSessionNotReadyError', () => {
  it('returns false for null', () => {
    expect(isSessionNotReadyError(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isSessionNotReadyError(undefined)).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isSessionNotReadyError('')).toBe(false)
  })

  it('returns false for unrelated string', () => {
    expect(isSessionNotReadyError('Network error')).toBe(false)
  })

  it('returns true for string containing exact sentinel', () => {
    expect(isSessionNotReadyError('Session not found')).toBe(true)
  })

  it('returns true for string containing sentinel as substring', () => {
    expect(isSessionNotReadyError('Error: Session not found for id abc')).toBe(true)
  })

  it('returns true for Error instance with sentinel message', () => {
    expect(isSessionNotReadyError(new Error('Session not found'))).toBe(true)
  })

  it('returns false for Error instance with unrelated message', () => {
    expect(isSessionNotReadyError(new Error('Something went wrong'))).toBe(false)
  })

  it('returns true for Error instance with sentinel as substring', () => {
    expect(isSessionNotReadyError(new Error('Failed: Session not found (id=123)'))).toBe(true)
  })

  it('returns false for non-Error object without message property', () => {
    expect(isSessionNotReadyError({ code: 404 })).toBe(false)
  })

  it('returns false for plain objects (String() yields [object Object])', () => {
    expect(isSessionNotReadyError({ message: 'Session not found' })).toBe(false)
  })

  it('returns false for number', () => {
    expect(isSessionNotReadyError(42)).toBe(false)
  })

  it('returns false for boolean', () => {
    expect(isSessionNotReadyError(false)).toBe(false)
  })

  it('returns true for object with custom toString returning sentinel', () => {
    const obj = { toString: () => 'Session not found' }
    expect(isSessionNotReadyError(obj)).toBe(true)
  })

  it('returns false for object with custom toString returning unrelated string', () => {
    const obj = { toString: () => 'Other error' }
    expect(isSessionNotReadyError(obj)).toBe(false)
  })

  it('is case-sensitive (does not match lowercase)', () => {
    expect(isSessionNotReadyError('session not found')).toBe(false)
  })

  it('matches partial sentinel at start of string', () => {
    expect(isSessionNotReadyError('Session not found: abc')).toBe(true)
  })
})

