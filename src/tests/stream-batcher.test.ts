import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/test-logs') },
}))

import { StreamBatcher } from '../main/stream-batcher'
import type { SessionStreamEvent } from '../shared/ipc-types'

function createBatcher(
  onFlush: (event: SessionStreamEvent) => void,
  flushIntervalMs = 16,
): StreamBatcher {
  return new StreamBatcher(onFlush, flushIntervalMs)
}

describe('StreamBatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should batch multiple text_delta events into one flush', () => {
    const flushed: SessionStreamEvent[] = []
    const batcher = createBatcher((e) => flushed.push(e))

    batcher.push({ type: 'text_delta', delta: 'h' })
    batcher.push({ type: 'text_delta', delta: 'ello' })
    batcher.push({ type: 'text_delta', delta: ' world' })

    // Not flushed yet
    expect(flushed).toHaveLength(0)

    vi.advanceTimersByTime(16)

    expect(flushed).toHaveLength(1)
    expect(flushed[0]).toEqual({ type: 'text_delta', delta: 'hello world' })
  })

  it('should flush pending text before a non-text event', () => {
    const flushed: SessionStreamEvent[] = []
    const batcher = createBatcher((e) => flushed.push(e))

    batcher.push({ type: 'text_delta', delta: 'pending' })
    batcher.push({ type: 'tool_call', toolCallId: 'tc-1', toolName: 'bash', args: { command: 'ls' } })

    expect(flushed).toHaveLength(2)
    expect(flushed[0]).toEqual({ type: 'text_delta', delta: 'pending' })
    expect(flushed[1]).toEqual({ type: 'tool_call', toolCallId: 'tc-1', toolName: 'bash', args: { command: 'ls' } })
  })

  it('should pass non-text events through immediately', () => {
    const flushed: SessionStreamEvent[] = []
    const batcher = createBatcher((e) => flushed.push(e))

    batcher.push({ type: 'done' })
    batcher.push({ type: 'error', message: 'oops' })

    expect(flushed).toHaveLength(2)
    expect(flushed[0]).toEqual({ type: 'done' })
    expect(flushed[1]).toEqual({ type: 'error', message: 'oops' })
  })

  it('should flush remaining text on dispose', () => {
    const flushed: SessionStreamEvent[] = []
    const batcher = createBatcher((e) => flushed.push(e))

    batcher.push({ type: 'text_delta', delta: 'remaining' })
    batcher.dispose()

    expect(flushed).toHaveLength(1)
    expect(flushed[0]).toEqual({ type: 'text_delta', delta: 'remaining' })
  })

  it('should be safe to call dispose multiple times', () => {
    const flushed: SessionStreamEvent[] = []
    const batcher = createBatcher((e) => flushed.push(e))

    batcher.push({ type: 'text_delta', delta: 'once' })
    batcher.dispose()
    batcher.dispose()
    batcher.dispose()

    expect(flushed).toHaveLength(1)
  })

  it('should not flush empty text', () => {
    const flushed: SessionStreamEvent[] = []
    const batcher = createBatcher((e) => flushed.push(e))

    batcher.dispose()
    expect(flushed).toHaveLength(0)
  })

  it('should use custom flush interval', () => {
    const flushed: SessionStreamEvent[] = []
    const batcher = createBatcher((e) => flushed.push(e), 50)

    batcher.push({ type: 'text_delta', delta: 'test' })
    vi.advanceTimersByTime(30)
    expect(flushed).toHaveLength(0)

    vi.advanceTimersByTime(20)
    expect(flushed).toHaveLength(1)
  })

  it('still processes non-text events pushed after dispose (no guard)', () => {
    const flushed: SessionStreamEvent[] = []
    const batcher = createBatcher((e) => flushed.push(e))

    batcher.push({ type: 'text_delta', delta: 'before' })
    batcher.dispose()
    // Note: StreamBatcher does not guard against post-dispose pushes.
    // Non-text events still pass through AND flush any accumulated text.
    batcher.push({ type: 'text_delta', delta: 'after' })
    batcher.push({ type: 'done' })

    // 'before' flushed on dispose, 'done' flushes 'after' then passes through
    expect(flushed).toHaveLength(3)
    expect(flushed[0]).toEqual({ type: 'text_delta', delta: 'before' })
    expect(flushed[1]).toEqual({ type: 'text_delta', delta: 'after' })
    expect(flushed[2]).toEqual({ type: 'done' })
  })

  it('should handle very long delta strings', () => {
    const flushed: SessionStreamEvent[] = []
    const batcher = createBatcher((e) => flushed.push(e))
    const longStr = 'a'.repeat(100_000)

    batcher.push({ type: 'text_delta', delta: longStr })
    vi.advanceTimersByTime(16)

    expect(flushed).toHaveLength(1)
    expect(flushed[0]).toEqual({ type: 'text_delta', delta: longStr })
  })

  it('should batch consecutive non-text events without delay', () => {
    const flushed: SessionStreamEvent[] = []
    const batcher = createBatcher((e) => flushed.push(e))

    batcher.push({ type: 'tool_call', toolCallId: 'tc-1', toolName: 'bash', args: {} })
    batcher.push({ type: 'tool_result', toolCallId: 'tc-1', toolName: 'bash', result: 'ok', isError: false })
    batcher.push({ type: 'done' })

    expect(flushed).toHaveLength(3)
  })

  it('should flush text then pass non-text in sequence', () => {
    const flushed: SessionStreamEvent[] = []
    const batcher = createBatcher((e) => flushed.push(e))

    batcher.push({ type: 'text_delta', delta: 'a' })
    batcher.push({ type: 'text_delta', delta: 'b' })
    batcher.push({ type: 'tool_call', toolCallId: 'tc-1', toolName: 'read', args: {} })
    batcher.push({ type: 'text_delta', delta: 'c' })
    batcher.push({ type: 'done' })

    // text_delta(ab) flushed before tool_call, tool_call passed, text_delta(c) flushed before done, done passed
    expect(flushed).toHaveLength(4)
    expect(flushed[0]).toEqual({ type: 'text_delta', delta: 'ab' })
    expect(flushed[1]).toEqual({ type: 'tool_call', toolCallId: 'tc-1', toolName: 'read', args: {} })
    expect(flushed[2]).toEqual({ type: 'text_delta', delta: 'c' })
    expect(flushed[3]).toEqual({ type: 'done' })
  })

  it('should handle user_message events immediately', () => {
    const flushed: SessionStreamEvent[] = []
    const batcher = createBatcher((e) => flushed.push(e))

    batcher.push({ type: 'user_message', text: 'hello' })
    expect(flushed).toHaveLength(1)
    expect(flushed[0]).toEqual({ type: 'user_message', text: 'hello' })
  })
})
