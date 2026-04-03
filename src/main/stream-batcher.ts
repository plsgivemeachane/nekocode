import { SessionStreamEvent } from '../shared/ipc-types'

/**
 * Batches text_delta events into a single flushed event per 16ms window.
 * Per D002: text deltas are batched to avoid flooding the renderer with
 * individual character-level updates from the LLM stream.
 *
 * Usage:
 *   const batcher = new StreamBatcher((batched) => sendToRenderer(batched))
 *   batcher.push({ type: 'text_delta', delta: 'h' })
 *   batcher.push({ type: 'text_delta', delta: 'ello' })
 *   // After 16ms, callback receives { type: 'text_delta', delta: 'hello' }
 */
export class StreamBatcher {
  private pendingText = ''
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly flushIntervalMs: number
  private readonly onFlush: (event: SessionStreamEvent) => void

  constructor(
    onFlush: (event: SessionStreamEvent) => void,
    flushIntervalMs = 16,
  ) {
    this.onFlush = onFlush
    this.flushIntervalMs = flushIntervalMs
  }

  /**
   * Push an event through the batcher.
   * text_delta events are accumulated; all other events are flushed immediately.
   */
  push(event: SessionStreamEvent): void {
    if (event.type === 'text_delta') {
      this.pendingText += event.delta
      if (this.timer === null) {
        this.timer = setTimeout(() => this.flush(), this.flushIntervalMs)
      }
    } else {
      // Non-text events flush any pending text first, then pass through
      this.flush()
      this.onFlush(event)
    }
  }

  /** Flush any accumulated text. Safe to call multiple times. */
  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.pendingText.length > 0) {
      const text = this.pendingText
      this.pendingText = ''
      this.onFlush({ type: 'text_delta', delta: text })
    }
  }

  /** Dispose the batcher, flushing any remaining text and clearing timers. */
  dispose(): void {
    this.flush()
  }
}
