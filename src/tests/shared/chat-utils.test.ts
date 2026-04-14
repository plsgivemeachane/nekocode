import { describe, it, expect } from 'vitest'
import { generateId } from '@/renderer/src/types/chat'
import type { ChatMessageIPC } from '@/shared/ipc-types'
import type { ChatMessage } from '@/renderer/src/types/chat'

// We test the pure conversion functions by re-implementing them here
// since they are not exported from useSession.ts. If they get exported
// in the future, replace these with direct imports.

/** Narrow a ChatMessage to a specific variant for test assertions */
function asToolCall(m: ChatMessage) {
  if (m.role === 'assistant' && m.type === 'tool_call') return m
  throw new Error('Expected tool_call message')
}
function asText(m: ChatMessage) {
  if (m.role === 'assistant' && m.type === 'text') return m
  throw new Error('Expected text message')
}
function asUser(m: ChatMessage) {
  if (m.role === 'user') return m
  throw new Error('Expected user message')
}

// ── Inline copies of the functions under test ─────────────────────
// These match the source exactly. If source changes, these must too.

function ipcToChatMessage(ipc: ChatMessageIPC): ChatMessage[] {
  const msgs: ChatMessage[] = []
  if (ipc.content) {
    if (ipc.role === 'user') {
      msgs.push({ role: 'user', content: ipc.content, id: ipc.id })
    } else {
      msgs.push({ role: 'assistant', type: 'text', content: ipc.content, id: ipc.id })
    }
  }
  if (ipc.toolCalls) {
    for (const tc of ipc.toolCalls) {
      msgs.push({
        role: 'assistant',
        type: 'tool_call',
        toolName: tc.name,
        toolId: tc.id,
        args: tc.args,
        status: 'done',
        result: tc.result,
        isError: tc.isError,
        id: generateId(),
      })
    }
  }
  return msgs
}

function ipcToChatMessages(ipcMessages: ChatMessageIPC[]): ChatMessage[] {
  return ipcMessages.flatMap(ipcToChatMessage)
}

// ── Tests ──────────────────────────────────────────────────────────

describe('ipcToChatMessage', () => {
  it('converts text-only message', () => {
    const ipc: ChatMessageIPC = {
      id: 'msg-1',
      role: 'user',
      content: 'Hello world',
      timestamp: 0,
    }
    const result = ipcToChatMessage(ipc)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      role: 'user',
      content: 'Hello world',
      id: 'msg-1',
    })
  })

  it('converts tool-only message', () => {
    const ipc: ChatMessageIPC = {
      id: 'msg-2',
      role: 'assistant',
      content: '',
      timestamp: 0,
      toolCalls: [{
        id: 'tc-1',
        name: 'bash',
        args: { command: 'ls' },
        result: 'file1.txt',
        isError: false,
      }],
    }
    const result = ipcToChatMessage(ipc)
    expect(result).toHaveLength(1)
    const tc = asToolCall(result[0])
    expect(tc.type).toBe('tool_call')
    expect(tc.toolName).toBe('bash')
    expect(tc.status).toBe('done')
    expect(tc.result).toBe('file1.txt')
    expect(tc.id).toMatch(/^msg-\d+-\d+$/)
  })

  it('converts message with both text and tool calls', () => {
    const ipc: ChatMessageIPC = {
      id: 'msg-3',
      role: 'assistant',
      content: 'Let me check...',
      timestamp: 0,
      toolCalls: [{
        id: 'tc-2',
        name: 'read',
        args: { path: '/file.txt' },
        result: 'contents',
        isError: false,
      }],
    }
    const result = ipcToChatMessage(ipc)
    expect(result).toHaveLength(2)
    const txt = asText(result[0])
    expect(txt.type).toBe('text')
    expect(txt.content).toBe('Let me check...')
    expect(asToolCall(result[1]).type).toBe('tool_call')
  })

  it('converts message with empty content (falsy) — no text message', () => {
    const ipc: ChatMessageIPC = {
      id: 'msg-5',
      role: 'assistant',
      content: '',
      timestamp: 0,
    }
    const result = ipcToChatMessage(ipc)
    expect(result).toHaveLength(0)
  })

  it('converts message with multiple tool calls', () => {
    const ipc: ChatMessageIPC = {
      id: 'msg-6',
      role: 'assistant',
      content: '',
      timestamp: 0,
      toolCalls: [
        { id: 'tc-a', name: 'read', args: {}, result: 'a', isError: false },
        { id: 'tc-b', name: 'bash', args: {}, result: 'b', isError: false },
        { id: 'tc-c', name: 'write', args: {}, result: 'c', isError: true },
      ],
    }
    const result = ipcToChatMessage(ipc)
    expect(result).toHaveLength(3)
    expect(result.map((m) => { if (m.role === 'assistant' && 'toolName' in m) return m.toolName; return null })).toEqual(['read', 'bash', 'write'])
    expect(asToolCall(result[2]).isError).toBe(true)
  })
})

describe('ipcToChatMessages', () => {
  it('flatMaps multiple IPC messages', () => {
    const ipcMessages: ChatMessageIPC[] = [
      { id: 'm1', role: 'user', content: 'hi', timestamp: 0 },
      { id: 'm2', role: 'assistant', content: 'hello', timestamp: 0, toolCalls: [
        { id: 'tc-1', name: 'bash', args: {}, result: 'ok', isError: false },
      ]},
      { id: 'm3', role: 'user', content: 'bye', timestamp: 0 },
    ]
    const result = ipcToChatMessages(ipcMessages)
    // m1 -> 1 text, m2 -> 1 text + 1 tool, m3 -> 1 text = 4 total
    expect(result).toHaveLength(4)
    expect(asUser(result[0]).content).toBe('hi')
    expect(asText(result[1]).content).toBe('hello')
    expect(asToolCall(result[2]).type).toBe('tool_call')
    expect(asUser(result[3]).content).toBe('bye')
  })

  it('returns empty array for empty input', () => {
    expect(ipcToChatMessages([])).toEqual([])
  })

  it('filters out empty-content messages with no tool calls', () => {
    const ipcMessages: ChatMessageIPC[] = [
      { id: 'm1', role: 'assistant', content: '', timestamp: 0 },
      { id: 'm2', role: 'user', content: 'real', timestamp: 0 },
    ]
    const result = ipcToChatMessages(ipcMessages)
    expect(result).toHaveLength(1)
    expect(asUser(result[0]).content).toBe('real')
  })
})

describe('generateId', () => {
  it('returns a string matching msg-{number}-{timestamp}', () => {
    const id = generateId()
    expect(id).toMatch(/^msg-\d+-\d+$/)
  })

  it('produces unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()))
    expect(ids.size).toBe(100)
  })

  it('increments counter', () => {
    const id1 = generateId()
    const id2 = generateId()
    const num1 = parseInt(id1.split('-')[1]!)
    const num2 = parseInt(id2.split('-')[1]!)
    expect(num2).toBe(num1 + 1)
  })
})
