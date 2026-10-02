import { afterEach, describe, expect, it, vi } from 'vitest'
import { StreamBatcher } from '../main/stream-batcher'

describe('StreamBatcher recent adversarial cases', () => {
  afterEach(() => vi.useRealTimers())

  it('dispose flushes pending data and leaves no timer behind', () => {
    vi.useFakeTimers()
    const events: unknown[] = []
    const batcher = new StreamBatcher((event) => events.push(event), 20)

    batcher.push({ type: 'text_delta', delta: 'a' })
    batcher.dispose()
    batcher.dispose()

    expect(events).toEqual([{ type: 'text_delta', delta: 'a' }])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('continues flushing later data when a callback throws', () => {
    vi.useFakeTimers()
    const events: unknown[] = []
    const batcher = new StreamBatcher((event) => {
      events.push(event)
      if (events.length === 1) throw new Error('renderer disconnected')
    }, 20)

    batcher.push({ type: 'text_delta', delta: 'first' })
    batcher.flush()
    batcher.push({ type: 'text_delta', delta: 'second' })
    batcher.flush()

    expect(events).toEqual([
      { type: 'text_delta', delta: 'first' },
      { type: 'text_delta', delta: 'second' },
    ])
  })

  it('flushes thinking before text when both streams share a timer window', () => {
    vi.useFakeTimers()
    const events: unknown[] = []
    const batcher = new StreamBatcher((event) => events.push(event), 20)

    batcher.push({ type: 'text_delta', delta: 'answer' })
    batcher.push({ type: 'thinking_delta', delta: 'reasoning' })
    vi.advanceTimersByTime(20)

    expect(events).toEqual([
      { type: 'thinking_delta', delta: 'reasoning' },
      { type: 'text_delta', delta: 'answer' },
    ])
    expect(vi.getTimerCount()).toBe(0)
  })
})
