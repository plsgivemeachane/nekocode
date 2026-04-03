import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
    batcher.push({ type: 'tool_call', toolName: 'bash', args: { command: 'ls' } })

    expect(flushed).toHaveLength(2)
    expect(flushed[0]).toEqual({ type: 'text_delta', delta: 'pending' })
    expect(flushed[1]).toEqual({ type: 'tool_call', toolName: 'bash', args: { command: 'ls' } })
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
})
