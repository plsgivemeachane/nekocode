import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/test-logs') },
}))

type AnyAgentMessages = Parameters<typeof extractHistoryFromSdkMessages>[0]

/** Cast plain test data to match the SDK AgentMessage[] discriminated union */
const asMessages = (msgs: unknown[]): AnyAgentMessages => msgs as unknown as AnyAgentMessages
const extract = (msgs: unknown[]) => extractHistoryFromSdkMessages(asMessages(msgs))

import { extractHistoryFromSdkMessages, loadHistoryFromDisk, tryRefreshFromDisk } from '../main/message-store'

const { mockSdkSessionManager, mockEntries } = vi.hoisted(() => {
  const mockEntries: Array<Record<string, unknown>> = []
  const _mockSession = {
    getEntries: vi.fn(() => mockEntries),
  }
  const mockSdkSessionManager = {
    list: vi.fn<() => Promise<Array<{ id: string; path: string }>>>(),
    open: vi.fn(() => _mockSession),
  }
  return { mockSdkSessionManager, mockEntries }
})

vi.mock('@mariozechner/pi-coding-agent', () => ({
  SessionManager: mockSdkSessionManager,
}))

describe('extractHistoryFromSdkMessages', () => {
  it('returns empty array for empty input', () => {
    expect(extract([])).toEqual([])
  })

  it('skips entries without a role property', () => {
    const entries = [
      { type: 'status', status: 'running' },
      { role: 'user', content: 'hello', timestamp: 1000 },
    ] as unknown as Parameters<typeof extractHistoryFromSdkMessages>[0]
    const result = extract(entries)
    expect(result).toHaveLength(1)
    expect(result[0].role).toBe('user')
  })

  it('extracts user message with string content', () => {
    const messages = [
      { role: 'user', content: 'hello', timestamp: 1000 },
    ]
    const result = extract(messages)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      role: 'user',
      content: 'hello',
      timestamp: 1000,
    })
    expect(result[0].id).toBeTruthy()
  })

  it('extracts user message with TextContent array', () => {
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: 1000 },
    ]
    const result = extract(messages)
    expect(result).toHaveLength(1)
    expect(result[0].content).toBe('hello')
  })

  it('extracts assistant message with text', () => {
    const messages = [
      { role: 'assistant', content: 'response', timestamp: 2000 },
    ]
    const result = extract(messages)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ role: 'assistant', content: 'response' })
  })

  it('skips non-user/non-assistant roles like toolResult in second pass', () => {
    const messages = [
      { role: 'user', content: 'hello', timestamp: 1000 },
      { role: 'toolResult', toolCallId: 'tc-1', content: 'result text', isError: false, timestamp: 1500 },
      { role: 'assistant', content: 'done', timestamp: 2000 },
    ]
    const result = extract(messages)
    expect(result).toHaveLength(2)
    expect(result[0].role).toBe('user')
    expect(result[1].role).toBe('assistant')
  })

  it('attaches tool calls from assistant content blocks with matching tool results', () => {
    const messages = [
      { role: 'user', content: 'run ls', timestamp: 1000 },
      { role: 'assistant', content: [
        { type: 'text', text: 'Running... ' },
        { type: 'toolCall', id: 'tc-1', name: 'bash', arguments: '{"cmd":"ls"}' },
      ], timestamp: 2000 },
      { role: 'toolResult', toolCallId: 'tc-1', content: 'file1.txt', isError: false, timestamp: 2500 },
    ]
    const result = extract(messages)
    expect(result).toHaveLength(2)
    expect(result[1].toolCalls).toEqual([
      { id: 'tc-1', name: 'bash', args: '{"cmd":"ls"}', result: 'file1.txt', isError: false },
    ])
  })

  it('handles tool calls with no matching tool result', () => {
    const messages = [
      { role: 'assistant', content: [
        { type: 'toolCall', id: 'tc-999', name: 'bash', arguments: '{}' },
      ], timestamp: 2000 },
    ]
    const result = extract(messages)
    expect(result).toHaveLength(1)
    expect(result[0].toolCalls).toEqual([
      { id: 'tc-999', name: 'bash', args: '{}', result: undefined, isError: undefined },
    ])
  })

  it('handles tool call with isError=true from toolResult', () => {
    const messages = [
      { role: 'assistant', content: [
        { type: 'toolCall', id: 'tc-err', name: 'bash', arguments: '{}' },
      ], timestamp: 2000 },
      { role: 'toolResult', toolCallId: 'tc-err', content: 'command failed', isError: true, timestamp: 2500 },
    ]
    const result = extract(messages)
    expect(result[0].toolCalls![0].isError).toBe(true)
    expect(result[0].toolCalls![0].result).toBe('command failed')
  })

  it('does not set toolCalls on assistant message with no toolCall blocks', () => {
    const messages = [
      { role: 'assistant', content: [{ type: 'text', text: 'just text' }], timestamp: 2000 },
    ]
    const result = extract(messages)
    expect(result[0].toolCalls).toBeUndefined()
  })

  it('does not set toolCalls when assistant content is a string', () => {
    const messages = [
      { role: 'assistant', content: 'plain string response', timestamp: 2000 },
    ]
    const result = extract(messages)
    expect(result[0].toolCalls).toBeUndefined()
  })

  it('collects toolResult with string content in first pass', () => {
    const messages = [
      { role: 'toolResult', toolCallId: 'tc-1', content: 'string result', isError: false, timestamp: 1000 },
    ]
    const result = extract(messages)
    expect(result).toHaveLength(0)
  })

  it('collects toolResult with TextContent array content in first pass', () => {
    const messages = [
      { role: 'assistant', content: [
        { type: 'toolCall', id: 'tc-1', name: 'bash', arguments: '{}' },
      ], timestamp: 2000 },
      { role: 'toolResult', toolCallId: 'tc-1', content: [{ type: 'text', text: 'array result' }], isError: false, timestamp: 2500 },
    ]
    const result = extract(messages)
    expect(result[0].toolCalls![0].result).toBe('array result')
  })

  it('uses Date.now() as fallback timestamp when timestamp is missing', () => {
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now)
    const messages = [
      { role: 'user', content: 'no timestamp' },
    ]
    const result = extract(messages)
    expect(result[0].timestamp).toBe(now)
    vi.restoreAllMocks()
  })

  it('handles multiple tool calls in a single assistant message', () => {
    const messages = [
      { role: 'assistant', content: [
        { type: 'toolCall', id: 'tc-1', name: 'bash', arguments: '{"cmd":"ls"}' },
        { type: 'toolCall', id: 'tc-2', name: 'read', arguments: '{"file":"f.txt"}' },
      ], timestamp: 2000 },
      { role: 'toolResult', toolCallId: 'tc-1', content: 'ls output', isError: false, timestamp: 2500 },
      { role: 'toolResult', toolCallId: 'tc-2', content: 'file content', isError: false, timestamp: 2600 },
    ]
    const result = extract(messages)
    expect(result[0].toolCalls).toHaveLength(2)
    expect(result[0].toolCalls![0].result).toBe('ls output')
    expect(result[0].toolCalls![1].result).toBe('file content')
  })
})

describe('loadHistoryFromDisk', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty array when session not found on disk', async () => {
    mockSdkSessionManager.list.mockResolvedValue([{ id: 'other-session', path: '/some/path' }])
    const result = await loadHistoryFromDisk('missing-session', '/cwd')
    expect(result).toEqual([])
    expect(mockSdkSessionManager.list).toHaveBeenCalledWith('/cwd')
  })

  it('returns empty array when list returns empty', async () => {
    mockSdkSessionManager.list.mockResolvedValue([])
    const result = await loadHistoryFromDisk('missing-session', '/cwd')
    expect(result).toEqual([])
  })

  it('loads and returns all messages when limit is 0', async () => {
    mockEntries.length = 0
    mockEntries.push(
      { type: 'message', message: { role: 'user', content: 'msg1', timestamp: 1000 } },
      { type: 'message', message: { role: 'assistant', content: 'msg2', timestamp: 2000 } },
      { type: 'message', message: { role: 'user', content: 'msg3', timestamp: 3000 } },
    )
    mockSdkSessionManager.list.mockResolvedValue([{ id: 'sess-1', path: '/path/to/session' }])
    const result = await loadHistoryFromDisk('sess-1', '/cwd')
    expect(result).toHaveLength(3)
    expect(mockSdkSessionManager.open).toHaveBeenCalledWith('/path/to/session')
  })

  it('applies limit to return only the last N messages', async () => {
    mockEntries.length = 0
    mockEntries.push(
      { type: 'message', message: { role: 'user', content: 'msg1', timestamp: 1000 } },
      { type: 'message', message: { role: 'assistant', content: 'msg2', timestamp: 2000 } },
      { type: 'message', message: { role: 'user', content: 'msg3', timestamp: 3000 } },
    )
    mockSdkSessionManager.list.mockResolvedValue([{ id: 'sess-1', path: '/path/to/session' }])
    const result = await loadHistoryFromDisk('sess-1', '/cwd', 2)
    expect(result).toHaveLength(2)
    expect(result[0].content).toBe('msg2')
    expect(result[1].content).toBe('msg3')
  })

  it('returns all messages when limit is greater than message count', async () => {
    mockEntries.length = 0
    mockEntries.push(
      { type: 'message', message: { role: 'user', content: 'msg1', timestamp: 1000 } },
    )
    mockSdkSessionManager.list.mockResolvedValue([{ id: 'sess-1', path: '/path/to/session' }])
    const result = await loadHistoryFromDisk('sess-1', '/cwd', 10)
    expect(result).toHaveLength(1)
  })

  it('filters out non-message entries from session file', async () => {
    mockEntries.length = 0
    mockEntries.push(
      { type: 'status', status: 'running' },
      { type: 'message', message: { role: 'user', content: 'msg1', timestamp: 1000 } },
      { type: 'status', status: 'done' },
    )
    mockSdkSessionManager.list.mockResolvedValue([{ id: 'sess-1', path: '/path/to/session' }])
    const result = await loadHistoryFromDisk('sess-1', '/cwd')
    expect(result).toHaveLength(1)
  })
})

describe('tryRefreshFromDisk', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when session is actively streaming (currentAssistantId set)', async () => {
    const result = await tryRefreshFromDisk('sess-1', '/cwd', [], 'assistant-id-123')
    expect(result).toBeNull()
    expect(mockSdkSessionManager.list).not.toHaveBeenCalled()
  })

  it('returns null when session not found on disk', async () => {
    mockSdkSessionManager.list.mockResolvedValue([])
    const result = await tryRefreshFromDisk('sess-1', '/cwd', [{ id: '1', role: 'user', content: 'old', timestamp: 1000 }], null)
    expect(result).toBeNull()
  })

  it('returns null when disk has same number of messages', async () => {
    mockEntries.length = 0
    mockEntries.push(
      { type: 'message', message: { role: 'user', content: 'msg1', timestamp: 1000 } },
    )
    mockSdkSessionManager.list.mockResolvedValue([{ id: 'sess-1', path: '/path/to/session' }])
    const currentMessages = [{ id: '1', role: 'user' as const, content: 'msg1', timestamp: 1000 }]
    const result = await tryRefreshFromDisk('sess-1', '/cwd', currentMessages, null)
    expect(result).toBeNull()
  })

  it('returns null when disk has fewer messages', async () => {
    mockEntries.length = 0
    mockSdkSessionManager.list.mockResolvedValue([{ id: 'sess-1', path: '/path/to/session' }])
    const currentMessages = [
      { id: '1', role: 'user' as const, content: 'msg1', timestamp: 1000 },
      { id: '2', role: 'assistant' as const, content: 'msg2', timestamp: 2000 },
    ]
    const result = await tryRefreshFromDisk('sess-1', '/cwd', currentMessages, null)
    expect(result).toBeNull()
  })

  it('returns updated messages when disk has more messages', async () => {
    mockEntries.length = 0
    mockEntries.push(
      { type: 'message', message: { role: 'user', content: 'msg1', timestamp: 1000 } },
      { type: 'message', message: { role: 'assistant', content: 'msg2', timestamp: 2000 } },
    )
    mockSdkSessionManager.list.mockResolvedValue([{ id: 'sess-1', path: '/path/to/session' }])
    const currentMessages = [{ id: '1', role: 'user' as const, content: 'msg1', timestamp: 1000 }]
    const result = await tryRefreshFromDisk('sess-1', '/cwd', currentMessages, null)
    expect(result).not.toBeNull()
    expect(result!).toHaveLength(2)
  })

  it('returns null when list() throws', async () => {
    mockSdkSessionManager.list.mockRejectedValue(new Error('disk error'))
    const result = await tryRefreshFromDisk('sess-1', '/cwd', [], null)
    expect(result).toBeNull()
  })

  it('returns null when open() throws', async () => {
    mockSdkSessionManager.list.mockResolvedValue([{ id: 'sess-1', path: '/bad/path' }])
    mockSdkSessionManager.open.mockImplementation(() => { throw new Error('open failed') })
    const result = await tryRefreshFromDisk('sess-1', '/cwd', [], null)
    expect(result).toBeNull()
  })
})

describe('extractHistoryFromSdkMessages - usage persistence', () => {
  it('extracts usage from assistant message with usage data', () => {
    const messages = [
      {
        role: 'assistant',
        content: 'response',
        timestamp: 2000,
        usage: { input: 100, output: 50, cacheRead: 10, cacheWrite: 5, totalTokens: 165, cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 } },
      },
    ]
    const result = extract(messages)
    expect(result).toHaveLength(1)
    expect(result[0].role).toBe('assistant')
    expect(result[0].usage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      totalCost: 0.003,
    })
  })

  it('handles assistant message without usage (undefined)', () => {
    const messages = [
      { role: 'assistant', content: 'response', timestamp: 2000 },
    ]
    const result = extract(messages)
    expect(result).toHaveLength(1)
    expect(result[0].usage).toBeUndefined()
  })

  it('handles assistant message with null/undefined usage', () => {
    const messages = [
      { role: 'assistant', content: 'response', timestamp: 2000, usage: null },
    ]
    const result = extract(messages)
    expect(result).toHaveLength(1)
    expect(result[0].usage).toBeUndefined()
  })

  it('extracts usage from multiple assistant messages', () => {
    const messages = [
      { role: 'user', content: 'hello', timestamp: 1000 },
      {
        role: 'assistant',
        content: 'response 1',
        timestamp: 2000,
        usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens: 150, cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 } },
      },
      { role: 'user', content: 'more', timestamp: 3000 },
      {
        role: 'assistant',
        content: 'response 2',
        timestamp: 4000,
        usage: { input: 200, output: 100, cacheRead: 0, cacheWrite: 0, totalTokens: 300, cost: { input: 0.002, output: 0.004, cacheRead: 0, cacheWrite: 0, total: 0.006 } },
      },
    ]
    const result = extract(messages)
    expect(result).toHaveLength(4)
    expect(result[1].usage).toEqual({ inputTokens: 100, outputTokens: 50, totalCost: 0.003 })
    expect(result[3].usage).toEqual({ inputTokens: 200, outputTokens: 100, totalCost: 0.006 })
  })

  it('user messages never have usage field', () => {
    const messages = [
      { role: 'user', content: 'hello', timestamp: 1000, usage: { input: 100, output: 50, cost: { total: 0.003 } } },
    ]
    const result = extract(messages)
    expect(result).toHaveLength(1)
    expect(result[0].role).toBe('user')
    // User messages should not have usage extracted even if present in input
    expect(result[0].usage).toBeUndefined()
  })

  it('preserves usage through round-trip with tool calls', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Running...' },
          { type: 'toolCall', id: 'tc-1', name: 'bash', arguments: '{"cmd":"ls"}' },
        ],
        timestamp: 2000,
        usage: { input: 500, output: 200, cacheRead: 0, cacheWrite: 0, totalTokens: 700, cost: { input: 0.01, output: 0.005, cacheRead: 0, cacheWrite: 0, total: 0.015 } },
      },
      { role: 'toolResult', toolCallId: 'tc-1', content: 'file1.txt', isError: false, timestamp: 2500 },
    ]
    const result = extract(messages)
    expect(result).toHaveLength(1)
    expect(result[0].role).toBe('assistant')
    expect(result[0].usage).toEqual({
      inputTokens: 500,
      outputTokens: 200,
      totalCost: 0.015,
    })
    expect(result[0].toolCalls).toHaveLength(1)
  })
})
