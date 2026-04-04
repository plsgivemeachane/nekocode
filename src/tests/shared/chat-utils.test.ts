import { describe, it, expect } from 'vitest'
import { generateId } from '@/renderer/src/types/chat'
import type { ChatMessageIPC } from '@/shared/ipc-types'

// We test the pure conversion functions by re-implementing them here
// since they are not exported from useSession.ts. If they get exported
// in the future, replace these with direct imports.

// ── Inline copies of the functions under test ─────────────────────
// These match the source exactly. If source changes, these must too.

function ipcToChatMessage(ipc: ChatMessageIPC): any[] {
  const msgs: any[] = []
  if (ipc.content) {
    msgs.push({
      role: ipc.role,
      type: 'text',
      content: ipc.content,
      id: ipc.id,
    })
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

function ipcToChatMessages(ipcMessages: ChatMessageIPC[]): any[] {
  return ipcMessages.flatMap(ipcToChatMessage)
}

// ── Tests ──────────────────────────────────────────────────────────

describe('ipcToChatMessage', () => {
  it('converts text-only message', () => {
    const ipc: ChatMessageIPC = {
      id: 'msg-1',
      role: 'user',
      content: 'Hello world',
    }
    const result = ipcToChatMessage(ipc)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      role: 'user',
      type: 'text',
      content: 'Hello world',
      id: 'msg-1',
    })
  })

  it('converts tool-only message', () => {
    const ipc: ChatMessageIPC = {
      id: 'msg-2',
      role: 'assistant',
      content: '',
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
    expect(result[0].type).toBe('tool_call')
    expect(result[0].toolName).toBe('bash')
    expect(result[0].status).toBe('done')
    expect(result[0].result).toBe('file1.txt')
    expect(result[0].id).toMatch(/^msg-\d+-\d+$/)
  })

  it('converts message with both text and tool calls', () => {
    const ipc: ChatMessageIPC = {
      id: 'msg-3',
      role: 'assistant',
      content: 'Let me check...',
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
    expect(result[0].type).toBe('text')
    expect(result[0].content).toBe('Let me check...')
    expect(result[1].type).toBe('tool_call')
  })

  it('converts message with empty content (falsy) — no text message', () => {
    const ipc: ChatMessageIPC = {
      id: 'msg-4',
      role: 'assistant',
      content: '',
    }
    const result = ipcToChatMessage(ipc)
    expect(result).toHaveLength(0)
  })

  it('converts message with null content — no text message', () => {
    const ipc: ChatMessageIPC = {
      id: 'msg-5',
      role: 'assistant',
      content: null as any,
    }
    const result = ipcToChatMessage(ipc)
    expect(result).toHaveLength(0)
  })

  it('converts message with multiple tool calls', () => {
    const ipc: ChatMessageIPC = {
      id: 'msg-6',
      role: 'assistant',
      content: '',
      toolCalls: [
        { id: 'tc-a', name: 'read', args: {}, result: 'a', isError: false },
        { id: 'tc-b', name: 'bash', args: {}, result: 'b', isError: false },
        { id: 'tc-c', name: 'write', args: {}, result: 'c', isError: true },
      ],
    }
    const result = ipcToChatMessage(ipc)
    expect(result).toHaveLength(3)
    expect(result.map((m: any) => m.toolName)).toEqual(['read', 'bash', 'write'])
    expect(result[2].isError).toBe(true)
  })
})

describe('ipcToChatMessages', () => {
  it('flatMaps multiple IPC messages', () => {
    const ipcMessages: ChatMessageIPC[] = [
      { id: 'm1', role: 'user', content: 'hi' },
      { id: 'm2', role: 'assistant', content: 'hello', toolCalls: [
        { id: 'tc-1', name: 'bash', args: {}, result: 'ok', isError: false },
      ]},
      { id: 'm3', role: 'user', content: 'bye' },
    ]
    const result = ipcToChatMessages(ipcMessages)
    // m1 -> 1 text, m2 -> 1 text + 1 tool, m3 -> 1 text = 4 total
    expect(result).toHaveLength(4)
    expect(result[0].content).toBe('hi')
    expect(result[1].content).toBe('hello')
    expect(result[2].type).toBe('tool_call')
    expect(result[3].content).toBe('bye')
  })

  it('returns empty array for empty input', () => {
    expect(ipcToChatMessages([])).toEqual([])
  })

  it('filters out empty-content messages with no tool calls', () => {
    const ipcMessages: ChatMessageIPC[] = [
      { id: 'm1', role: 'assistant', content: '' },
      { id: 'm2', role: 'user', content: 'real' },
    ]
    const result = ipcToChatMessages(ipcMessages)
    expect(result).toHaveLength(1)
    expect(result[0].content).toBe('real')
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
