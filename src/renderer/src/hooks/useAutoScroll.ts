import { useRef, useEffect, useState, useCallback } from 'react'

const SCROLL_THRESHOLD_PX = 40

interface UseAutoScrollOptions {
  /** Ref attached to the scrollable container */
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  /** Ref attached to the inner content div (for ResizeObserver) */
  messageContentRef: React.RefObject<HTMLDivElement | null>
  /** Re-run auto-scroll when this changes (e.g. messages array) */
  scrollDeps: unknown[]
  /** When true, auto-scroll stays instant (no smooth) */
  isStreaming: boolean
  /** When a session ID is present, reset scroll lock on change */
  sessionId: string | null
  /** When this flips from true→false, snap to bottom */
  isAgentConnecting: boolean
  /** When this flips from true→false (with messages), snap to bottom */
  isHistoryLoading: boolean
  /** Current message count (used to detect first message arrival) */
  messageCount: number
}

export function useAutoScroll({
  scrollContainerRef,
  messageContentRef,
  scrollDeps,
  isStreaming,
  sessionId,
  isAgentConnecting,
  isHistoryLoading,
  messageCount,
}: UseAutoScrollOptions) {
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const isAtBottomRef = useRef(true)
  const programmaticScrollRef = useRef(false)
  const wasAgentConnectingRef = useRef(isAgentConnecting)
  const wasHistoryLoadingRef = useRef(isHistoryLoading)

  const getDistanceFromBottom = useCallback((el: HTMLDivElement) => {
    return el.scrollHeight - el.scrollTop - el.clientHeight
  }, [])

  const snapToBottom = useCallback(() => {
    isAtBottomRef.current = true
    setShowScrollBtn(false)
  }, [])

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollContainerRef.current
    if (!el) return
    programmaticScrollRef.current = true
    isAtBottomRef.current = true
    setShowScrollBtn(false)
    if (smooth) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    } else {
      el.scrollTop = el.scrollHeight
    }
    requestAnimationFrame(() => {
      const current = scrollContainerRef.current
      if (current) {
        const atBottom = getDistanceFromBottom(current) < SCROLL_THRESHOLD_PX
        isAtBottomRef.current = atBottom
        setShowScrollBtn(!atBottom && messageCount > 0)
      }
      programmaticScrollRef.current = false
    })
  }, [scrollContainerRef, getDistanceFromBottom, messageCount])

  // Track scroll position — update isAtBottomRef and button visibility
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const atBottom = getDistanceFromBottom(el) < SCROLL_THRESHOLD_PX
    isAtBottomRef.current = atBottom
    setShowScrollBtn(!atBottom && messageCount > 0)
  }, [scrollContainerRef, getDistanceFromBottom, messageCount])

  // Auto-scroll when messages or streaming state change — only if user hasn't scrolled up
  useEffect(() => {
    if (isAtBottomRef.current) {
      scrollToBottom(false)
    }
  }, [scrollDeps, isStreaming, scrollToBottom])

  // Keep auto-scroll stable when content height changes after render (e.g. markdown/code highlighting)
  useEffect(() => {
    const container = scrollContainerRef.current
    const content = messageContentRef.current
    if (container && content) {
      const observer = new ResizeObserver(() => {
        if (isAtBottomRef.current) {
          scrollToBottom(false)
        }
      })

      observer.observe(content)
      return () => observer.disconnect()
    }
  }, [scrollContainerRef, messageContentRef, scrollToBottom])

  // Scroll to bottom on initial session (when first messages arrive)
  useEffect(() => {
    if (messageCount === 1) {
      scrollToBottom(false)
    }
  }, [messageCount, scrollToBottom])

  // Reset scroll lock on session switch so each session opens at latest messages
  useEffect(() => {
    snapToBottom()
    if (sessionId) {
      requestAnimationFrame(() => scrollToBottom(false))
    }
  }, [sessionId, scrollToBottom, snapToBottom])

  // When connection finishes, force viewport to latest messages so loaded content
  // does not shift the view downward.
  useEffect(() => {
    const wasConnecting = wasAgentConnectingRef.current
    if (wasConnecting && !isAgentConnecting) {
      snapToBottom()
      requestAnimationFrame(() => {
        scrollToBottom(false)
        requestAnimationFrame(() => scrollToBottom(false))
      })
    }
    wasAgentConnectingRef.current = isAgentConnecting
  }, [isAgentConnecting, scrollToBottom, snapToBottom])

  // Reconnect can complete before large history batches fully render.
  // Snap to bottom when history loading flips to completed.
  useEffect(() => {
    const wasLoading = wasHistoryLoadingRef.current
    if (wasLoading && !isHistoryLoading && sessionId && messageCount > 0) {
      snapToBottom()
      requestAnimationFrame(() => {
        scrollToBottom(false)
        requestAnimationFrame(() => scrollToBottom(false))
      })
    }
    wasHistoryLoadingRef.current = isHistoryLoading
  }, [isHistoryLoading, messageCount, scrollToBottom, sessionId, snapToBottom])

  return {
    showScrollBtn,
    scrollToBottom,
    handleScroll,
  }
}
