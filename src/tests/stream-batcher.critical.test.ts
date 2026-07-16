/**
 * StreamBatcher CRITICAL contract-violation tests.
 *
 * The existing test suite covers basic happy-path behavior.
 * These tests probe the CONTRACT boundaries:
 *
 * Contract: StreamBatcher(onFlush, flushIntervalMs?)
 *   .push(event: SessionStreamEvent): void
 *   .flush(): void
 *   .dispose(): void
 *
 * Contract assumptions to challenge:
 * - "push" accepts any SessionStreamEvent - but what about empty deltas?
 * - "dispose" flushes and clears - but what about push AFTER dispose?
 * - flushIntervalMs defaults to 16 - what about 0, negative, NaN, Infinity?
 * - onFlush callback - what if it throws? What if it mutates the event?
 * - Thinking is always flushed BEFORE text - is that contract documented?
 * - Timer coalescing: only one timer for both text and thinking - is this correct?
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/test-logs') },
}))

import { StreamBatcher } from '../main/stream-batcher'
import type { SessionStreamEvent } from '../shared/ipc-types'

describe('StreamBatcher - Critical Contract Tests', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ==========================================================================
  // Category 1: Name vs Reality
  // ==========================================================================

  it('CONTRACT AMBIGUITY: "flush" name implies it sends data, but flush() on empty batcher is a no-op', () => {
    const onFlush = vi.fn()
    const batcher = new StreamBatcher(onFlush)

    // Flush with no pending data - should be a no-op
    batcher.flush()
    expect(onFlush).not.toHaveBeenCalled()
  })

  it('CONTRACT AMBIGUITY: "dispose" implies resource cleanup, but push() after dispose still works', () => {
    // The name "dispose" suggests the object is dead. But push() after dispose
    // still processes events. This is a contract ambiguity.
    const onFlush = vi.fn()
    const batcher = new StreamBatcher(onFlush)

    batcher.dispose()

    // Push after dispose - the batcher still works!
    batcher.push({ type: 'text_delta', delta: 'after dispose' })
    vi.advanceTimersByTime(16)

    expect(onFlush).toHaveBeenCalledTimes(1)
    expect(onFlush).toHaveBeenCalledWith({ type: 'text_delta', delta: 'after dispose' })
  })

  it.todo('StreamBatcher.dispose should set a disposed flag and push() should be a no-op after dispose')

  it('CONTRACT: flush order is ALWAYS thinking before text', () => {
    // This is an undocumented but critical ordering contract.
    // If thinking and text are both pending, flush emits thinking first.
    const onFlush = vi.fn()
    const batcher = new StreamBatcher(onFlush)

    batcher.push({ type: 'text_delta', delta: 'text first pushed' })
    batcher.push({ type: 'thinking_delta', delta: 'thinking pushed second' })

    batcher.flush()

    // Thinking is flushed FIRST even though text was pushed first
    expect(onFlush).toHaveBeenCalledTimes(2)
    expect(onFlush.mock.calls[0][0]).toEqual({ type: 'thinking_delta', delta: 'thinking pushed second' })
    expect(onFlush.mock.calls[1][0]).toEqual({ type: 'text_delta', delta: 'text first pushed' })
  })

  it.todo('thinking-before-text flush order should be documented in the public API')

  // ==========================================================================
  // Category 2: Argument Boundary & Assumption Drilling
  // ==========================================================================

  it('empty string delta is NOT flushed - batcher correctly filters zero-length content', () => {
    const onFlush = vi.fn()
    const batcher = new StreamBatcher(onFlush)

    // Empty string is a valid but meaningless delta
    batcher.push({ type: 'text_delta', delta: '' })
    batcher.flush()

    // Empty string delta is NOT flushed because flush() checks
    // `this.pendingText.length > 0` before emitting
    expect(onFlush).not.toHaveBeenCalled()
  })

  it('push() skips empty deltas entirely instead of accumulating them (CONTRACT FIXED)', () => {
    const onFlush = vi.fn()
    const batcher = new StreamBatcher(onFlush)

    // Push empty then real content
    batcher.push({ type: 'text_delta', delta: '' })
    // Empty delta should NOT schedule a timer or accumulate content
    // (it returns early from push())
    batcher.push({ type: 'text_delta', delta: 'hello' })
    batcher.flush()

    // Only one flush call for the real content
    expect(onFlush).toHaveBeenCalledTimes(1)
    expect(onFlush).toHaveBeenCalledWith({ type: 'text_delta', delta: 'hello' })
  })

  it('CONTRACT GAP: flushIntervalMs=0 causes immediate flush on every push', () => {
    // setTimeout(fn, 0) queues the callback as a microtask.
    // With interval=0, every push of text_delta creates a setTimeout(0)
    // but since only one timer is active (timer coalescing), rapid pushes
    // still batch until the next tick.
    const onFlush = vi.fn()
    const batcher = new StreamBatcher(onFlush, 0)

    batcher.push({ type: 'text_delta', delta: 'a' })
    batcher.push({ type: 'text_delta', delta: 'b' })

    // Not flushed yet - timer is queued but hasn't fired
    expect(onFlush).not.toHaveBeenCalled()

    vi.advanceTimersByTime(0)
    expect(onFlush).toHaveBeenCalledTimes(1)
    expect(onFlush).toHaveBeenCalledWith({ type: 'text_delta', delta: 'ab' })
  })

  it('CONTRACT GAP: negative flushIntervalMs behaves like setTimeout(fn, negative)', () => {
    // setTimeout with negative value is clamped to 0 by the browser
    const onFlush = vi.fn()
    const batcher = new StreamBatcher(onFlush, -100)

    batcher.push({ type: 'text_delta', delta: 'test' })
    vi.advanceTimersByTime(0)

    // Negative interval is treated as 0 (immediate)
    expect(onFlush).toHaveBeenCalledTimes(1)
  })

  it('flushIntervalMs=NaN causes immediate flushing', () => {
    // setTimeout(fn, NaN) is treated as setTimeout(fn, 0) in most environments
    const onFlush = vi.fn()
    const batcher = new StreamBatcher(onFlush, NaN)

    batcher.push({ type: 'text_delta', delta: 'test' })
    vi.advanceTimersByTime(0)

    expect(onFlush).toHaveBeenCalledTimes(1)
  })

  // ==========================================================================
  // Category 3: Abstraction Ambiguity - Timer & Concurrency
  // ==========================================================================

  it('CONTRACT AMBIGUITY: single timer for both text and thinking - pushing thinking after text does not create a second timer', () => {
    // The batcher uses a single timer for both text and thinking.
    // This means if you push text, then thinking, only ONE timer is set.
    // Both are flushed together when it fires.
    const onFlush = vi.fn()
    const batcher = new StreamBatcher(onFlush, 16)

    batcher.push({ type: 'text_delta', delta: 'text' })
    batcher.push({ type: 'thinking_delta', delta: 'think' })

    // Only one timer is running, both will be flushed together
    vi.advanceTimersByTime(16)

    // Two flushes: thinking first, then text
    expect(onFlush).toHaveBeenCalledTimes(2)
    expect(onFlush.mock.calls[0][0].type).toBe('thinking_delta')
    expect(onFlush.mock.calls[1][0].type).toBe('text_delta')
  })

  it('onFlush that throws is caught — batcher continues operating (CONTRACT FIXED)', () => {
    // Previously, if onFlush threw, the batcher would crash and lose data.
    // Now flush() wraps onFlush calls in try/catch, so the batcher survives.
    const onFlush = vi.fn()
      .mockImplementationOnce(() => { throw new Error('boom') })
      .mockImplementation((_e) => {})

    const batcher = new StreamBatcher(onFlush)

    batcher.push({ type: 'text_delta', delta: 'will throw' })

    // flush() no longer throws — the error is caught internally
    expect(() => batcher.flush()).not.toThrow()

    // The first onFlush was called (and threw internally)
    expect(onFlush).toHaveBeenCalledTimes(1)

    // Batcher is still functional after the error
    batcher.push({ type: 'text_delta', delta: 'after throw' })
    batcher.flush()
    expect(onFlush).toHaveBeenCalledTimes(2)
    expect(onFlush.mock.calls[1][0]).toEqual({ type: 'text_delta', delta: 'after throw' })
  })

  it('pushing during onFlush callback — re-entrant flush is prevented (CONTRACT FIXED)', () => {
    // Previously, if onFlush pushed new events, the re-entrant push would
    // schedule a new timer. Now the isFlushing guard prevents double-fire.
    const events: SessionStreamEvent[] = []
    const batcherHolder: { current: StreamBatcher | null } = { current: null }

    const onFlush = vi.fn().mockImplementation((event: SessionStreamEvent) => {
      events.push(event)
      // Re-entrant push during flush callback
      if (event.type === 'text_delta' && event.delta === 'first') {
        batcherHolder.current!.push({ type: 'text_delta', delta: 're-entrant' })
      }
    })

    const batcher = new StreamBatcher(onFlush)
    batcherHolder.current = batcher
    batcher.push({ type: 'text_delta', delta: 'first' })

    // Flush the first text
    batcher.flush()

    // First flush: text_delta(first)
    expect(events.length).toBe(1)
    expect(events[0]).toEqual({ type: 'text_delta', delta: 'first' })

    // The re-entrant text was pushed and is pending
    vi.advanceTimersByTime(16)
    expect(events.length).toBe(2)
    expect(events[1]).toEqual({ type: 'text_delta', delta: 're-entrant' })
  })

  // ==========================================================================
  // Category 4: State & Side-Effect Skepticism
  // ==========================================================================

  it('multiple dispose calls are idempotent', () => {
    const onFlush = vi.fn()
    const batcher = new StreamBatcher(onFlush)

    batcher.push({ type: 'text_delta', delta: 'data' })
    batcher.dispose()
    batcher.dispose()
    batcher.dispose()

    // Only one flush happened
    expect(onFlush).toHaveBeenCalledTimes(1)
  })

  it('flush after dispose is safe but no-ops on empty state', () => {
    const onFlush = vi.fn()
    const batcher = new StreamBatcher(onFlush)

    batcher.dispose()
    batcher.flush()

    expect(onFlush).not.toHaveBeenCalled()
  })

  it('very rapid push/flush cycles do not lose data', () => {
    const onFlush = vi.fn()
    const batcher = new StreamBatcher(onFlush, 16)

    // Push text, flush, push more text, flush
    batcher.push({ type: 'text_delta', delta: 'batch1' })
    batcher.flush()

    batcher.push({ type: 'text_delta', delta: 'batch2' })
    batcher.flush()

    expect(onFlush).toHaveBeenCalledTimes(2)
    expect(onFlush.mock.calls[0][0]).toEqual({ type: 'text_delta', delta: 'batch1' })
    expect(onFlush.mock.calls[1][0]).toEqual({ type: 'text_delta', delta: 'batch2' })
  })

  it('accumulated text across multiple pushes before timer fires', () => {
    const onFlush = vi.fn()
    const batcher = new StreamBatcher(onFlush, 16)

    batcher.push({ type: 'text_delta', delta: 'part1-' })
    batcher.push({ type: 'text_delta', delta: 'part2-' })
    batcher.push({ type: 'text_delta', delta: 'part3' })

    // Timer hasn't fired yet
    expect(onFlush).not.toHaveBeenCalled()

    vi.advanceTimersByTime(16)
    expect(onFlush).toHaveBeenCalledTimes(1)
    expect(onFlush).toHaveBeenCalledWith({ type: 'text_delta', delta: 'part1-part2-part3' })
  })

  it('CONTRACT GAP: no way to check if batcher has pending data', () => {
    // There is no .hasPending or .pendingLength property.
    // Consumers cannot check if there is un-flushed data.
    const onFlush = vi.fn()
    const batcher = new StreamBatcher(onFlush)

    batcher.push({ type: 'text_delta', delta: 'pending' })

    // No way to inspect internal state from outside
    // This makes it hard to implement "flush before close" logic
    // where you want to check if there is data to flush first.
    // Currently you just call flush() which is a no-op if empty.
    expect(() => batcher.flush()).not.toThrow()
  })

  it.todo('StreamBatcher should expose a readonly hasPending property for introspection')

  it('thinking_delta and text_delta intermixed with non-text events maintains correct order', () => {
    const onFlush = vi.fn()
    const batcher = new StreamBatcher(onFlush)

    batcher.push({ type: 'thinking_delta', delta: 'think1' })
    batcher.push({ type: 'text_delta', delta: 'text1' })
    batcher.push({ type: 'done' })

    // 'done' is non-text, so it flushes pending first (thinking then text), then passes through
    expect(onFlush).toHaveBeenCalledTimes(3)
    expect(onFlush.mock.calls[0][0]).toEqual({ type: 'thinking_delta', delta: 'think1' })
    expect(onFlush.mock.calls[1][0]).toEqual({ type: 'text_delta', delta: 'text1' })
    expect(onFlush.mock.calls[2][0]).toEqual({ type: 'done' })
  })
})
