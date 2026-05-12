import { SessionStreamEvent } from '../shared/ipc-types'
import { createLogger } from './logger'

const logger = createLogger('stream-batcher')

/**
 * Batches text_delta and thinking_delta events into single flushed events per 16ms window.
 * Per D002: text deltas are batched to avoid flooding the renderer with
 * individual character-level updates from the LLM stream.
 * Thinking deltas follow the same batching strategy for consistency.
 *
 * Usage:
 *   const batcher = new StreamBatcher((batched) => sendToRenderer(batched))
 *   batcher.push({ type: 'text_delta', delta: 'h' })
 *   batcher.push({ type: 'text_delta', delta: 'ello' })
 *   // After 16ms, callback receives { type: 'text_delta', delta: 'hello' }
 */
export class StreamBatcher {
  private pendingText = ''
  private pendingThinking = ''
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly flushIntervalMs: number
  private readonly onFlush: (event: SessionStreamEvent) => void

  constructor(
    onFlush: (event: SessionStreamEvent) => void,
    flushIntervalMs = 16,
  ) {
    this.onFlush = onFlush
    this.flushIntervalMs = flushIntervalMs
    logger.debug(`StreamBatcher created: interval=${flushIntervalMs}ms`)
  }

  /**
   * Push an event through the batcher.
   * text_delta and thinking_delta events are accumulated; all other events are flushed immediately.
   */
  push(event: SessionStreamEvent): void {
    if (event.type === 'text_delta') {
      this.pendingText += event.delta
      logger.debug(`push: accumulated ${this.pendingText.length} chars (delta=${event.delta.length})`)
      if (this.timer === null) {
        this.timer = setTimeout(() => this.flush(), this.flushIntervalMs)
      }
    } else if (event.type === 'thinking_delta') {
      this.pendingThinking += event.delta
      logger.debug(`push: accumulated thinking ${this.pendingThinking.length} chars (delta=${event.delta.length})`)
      if (this.timer === null) {
        this.timer = setTimeout(() => this.flush(), this.flushIntervalMs)
      }
    } else {
      // Non-text events flush any pending text/thinking first, then pass through
      this.flush()
      logger.debug(`passthrough: ${event.type}`)
      this.onFlush(event)
    }
  }

  /** Flush any accumulated text and thinking. Safe to call multiple times. */
  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.pendingThinking.length > 0) {
      const thinking = this.pendingThinking
      this.pendingThinking = ''
      logger.debug(`flush thinking: ${thinking.length} chars`)
      this.onFlush({ type: 'thinking_delta', delta: thinking })
    }
    if (this.pendingText.length > 0) {
      const text = this.pendingText
      this.pendingText = ''
      logger.debug(`flush: ${text.length} chars`)
      this.onFlush({ type: 'text_delta', delta: text })
    }
  }

  /** Dispose the batcher, flushing any remaining text/thinking and clearing timers. */
  dispose(): void {
    logger.debug('dispose')
    this.flush()
  }
}
