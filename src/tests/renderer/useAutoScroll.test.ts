// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAutoScroll } from '@/renderer/src/hooks/useAutoScroll'

// ── Mocks ──────────────────────────────────────────────────────
let rafCallbacks: Array<() => void> = []
const mockRaf = vi.fn((cb: FrameRequestCallback) => {
  rafCallbacks.push(() => cb(0))
  return 1
})

let roObserve: ReturnType<typeof vi.fn>
let roDisconnect: ReturnType<typeof vi.fn>
let roCallback: (() => void) | undefined
let roCreated = false

function createMockRO(cb?: () => void) {
  roCallback = cb
  roCreated = true
  roObserve = vi.fn()
  roDisconnect = vi.fn()
  return { observe: roObserve, disconnect: roDisconnect, unobserve: vi.fn() }
}

function flushRaf() {
  const cbs = [...rafCallbacks]
  rafCallbacks = []
  for (const cb of cbs) cb()
}

function createContainer(scrollHeight = 1000, scrollTop = 960, clientHeight = 100) {
  const el = document.createElement('div')
  Object.defineProperties(el, {
    scrollHeight: { value: scrollHeight, writable: true, configurable: true },
    scrollTop: { value: scrollTop, writable: true, configurable: true },
    clientHeight: { value: clientHeight, writable: true, configurable: true },
    scrollTo: { value: vi.fn(), writable: true, configurable: true },
  })
  return el as HTMLDivElement
}

type Opts = Parameters<typeof useAutoScroll>[0]
function makeOpts(overrides: Partial<Opts> = {}): Opts {
  const container = createContainer()
  const content = document.createElement('div')
  return {
    scrollContainerRef: { current: container },
    messageContentRef: { current: content },
    scrollDeps: [[]] as unknown[],
    isStreaming: false,
    sessionId: null as string | null,
    isAgentConnecting: false,
    isHistoryLoading: false,
    messageCount: 0,
    ...overrides,
  }
}

// ── Tests ──────────────────────────────────────────────────────
describe('useAutoScroll', () => {
  beforeEach(() => {
    rafCallbacks = []
    roCallback = undefined
    roCreated = false
    vi.stubGlobal('requestAnimationFrame', mockRaf)
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.stubGlobal('ResizeObserver', createMockRO)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── scrollToBottom ──────────────────────────────────────────
  describe('scrollToBottom', () => {
    it('does nothing when scrollContainerRef.current is null', () => {
      const opts = makeOpts()
      opts.scrollContainerRef.current = null
      const { result } = renderHook(() => useAutoScroll(opts))
      act(() => result.current.scrollToBottom(false))
      expect(mockRaf).not.toHaveBeenCalled()
    })

    it('sets scrollTop to scrollHeight for non-smooth scroll', () => {
      const opts = makeOpts()
      const { result } = renderHook(() => useAutoScroll(opts))
      act(() => result.current.scrollToBottom(false))
      const el = opts.scrollContainerRef.current!
      expect(el.scrollTop).toBe(el.scrollHeight)
    })

    it('calls el.scrollTo with smooth behavior', () => {
      const opts = makeOpts()
      const { result } = renderHook(() => useAutoScroll(opts))
      act(() => result.current.scrollToBottom(true))
      expect(opts.scrollContainerRef.current!.scrollTo).toHaveBeenCalledWith({
        top: opts.scrollContainerRef.current!.scrollHeight,
        behavior: 'smooth',
      })
    })

    it('hides scroll button immediately', () => {
      const opts = makeOpts({ messageCount: 5 })
      const { result } = renderHook(() => useAutoScroll(opts))
      opts.scrollContainerRef.current!.scrollTop = 0
      act(() => result.current.handleScroll())
      expect(result.current.showScrollBtn).toBe(true)
      act(() => result.current.scrollToBottom(false))
      expect(result.current.showScrollBtn).toBe(false)
    })

    it('rAF: keeps button hidden when still at bottom', () => {
      const opts = makeOpts()
      const { result } = renderHook(() => useAutoScroll(opts))
      act(() => { result.current.scrollToBottom(false); flushRaf() })
      expect(result.current.showScrollBtn).toBe(false)
    })

    it('rAF: shows button when content grew past threshold and messages exist', () => {
      const opts = makeOpts({ messageCount: 5 })
      const { result } = renderHook(() => useAutoScroll(opts))
      act(() => {
        result.current.scrollToBottom(false)
        Object.defineProperty(opts.scrollContainerRef.current!, 'scrollHeight', {
          value: 1200, writable: true, configurable: true,
        })
        flushRaf()
      })
      expect(result.current.showScrollBtn).toBe(true)
    })

    it('rAF: hides button when not at bottom but no messages', () => {
      const opts = makeOpts({ messageCount: 0 })
      const { result } = renderHook(() => useAutoScroll(opts))
      act(() => {
        result.current.scrollToBottom(false)
        Object.defineProperty(opts.scrollContainerRef.current!, 'scrollHeight', {
          value: 1200, writable: true, configurable: true,
        })
        flushRaf()
      })
      expect(result.current.showScrollBtn).toBe(false)
    })

    it('rAF: handles null scrollContainerRef gracefully', () => {
      const opts = makeOpts()
      const { result } = renderHook(() => useAutoScroll(opts))
      act(() => {
        result.current.scrollToBottom(false)
        opts.scrollContainerRef.current = null
        flushRaf()
      })
      expect(result.current.showScrollBtn).toBe(false)
    })
  })

  // ── handleScroll ────────────────────────────────────────────
  describe('handleScroll', () => {
    it('shows button when scrolled up past threshold', () => {
      const opts = makeOpts({ messageCount: 5 })
      const { result } = renderHook(() => useAutoScroll(opts))
      opts.scrollContainerRef.current!.scrollTop = 0
      act(() => result.current.handleScroll())
      expect(result.current.showScrollBtn).toBe(true)
    })

    it('hides button when within threshold of bottom', () => {
      const opts = makeOpts({ messageCount: 5 })
      const { result } = renderHook(() => useAutoScroll(opts))
      act(() => result.current.handleScroll())
      expect(result.current.showScrollBtn).toBe(false)
    })

    it('hides button when at bottom even with many messages', () => {
      const opts = makeOpts({ messageCount: 10 })
      const { result } = renderHook(() => useAutoScroll(opts))
      act(() => result.current.handleScroll())
      expect(result.current.showScrollBtn).toBe(false)
    })

    it('does nothing when scrollContainerRef.current is null', () => {
      const opts = makeOpts()
      opts.scrollContainerRef.current = null
      const { result } = renderHook(() => useAutoScroll(opts))
      act(() => result.current.handleScroll())
      expect(result.current.showScrollBtn).toBe(false)
    })
  })

  // ── useEffect: auto-scroll on deps change ───────────────────
  describe('auto-scroll on scrollDeps/isStreaming change', () => {
    it('scrolls when isAtBottomRef is true and deps change', () => {
      const opts = makeOpts()
      const { rerender } = renderHook((o) => useAutoScroll(o), { initialProps: opts })
      rerender({ ...opts, scrollDeps: [['msg1']] })
      expect(opts.scrollContainerRef.current!.scrollTop).toBe(
        opts.scrollContainerRef.current!.scrollHeight,
      )
    })

    it('does not scroll when user has scrolled up (isAtBottomRef false)', () => {
      const opts = makeOpts({ messageCount: 5 })
      const { result, rerender } = renderHook((o) => useAutoScroll(o), { initialProps: opts })
      opts.scrollContainerRef.current!.scrollTop = 0
      act(() => result.current.handleScroll())
      const before = opts.scrollContainerRef.current!.scrollTop
      rerender({ ...opts, scrollDeps: [['msg1']] })
      expect(opts.scrollContainerRef.current!.scrollTop).toBe(before)
    })
  })

  // ── useEffect: ResizeObserver ───────────────────────────────
  describe('ResizeObserver', () => {
    it('observes messageContentRef when both refs exist', () => {
      const opts = makeOpts()
      renderHook(() => useAutoScroll(opts))
      expect(roObserve).toHaveBeenCalledWith(opts.messageContentRef.current)
    })

    it('does not create observer when scrollContainerRef is null', () => {
      const opts = makeOpts()
      opts.scrollContainerRef.current = null
      renderHook(() => useAutoScroll(opts))
      expect(roCreated).toBe(false)
    })

    it('does not create observer when messageContentRef is null', () => {
      const opts = makeOpts()
      opts.messageContentRef.current = null
      renderHook(() => useAutoScroll(opts))
      expect(roCreated).toBe(false)
    })

    it('disconnects observer on unmount', () => {
      const opts = makeOpts()
      const { unmount } = renderHook(() => useAutoScroll(opts))
      unmount()
      expect(roDisconnect).toHaveBeenCalled()
    })

    it('callback scrolls when at bottom', () => {
      const opts = makeOpts()
      renderHook(() => useAutoScroll(opts))
      expect(roCallback).toBeDefined()
      act(() => roCallback!())
      expect(opts.scrollContainerRef.current!.scrollTop).toBe(
        opts.scrollContainerRef.current!.scrollHeight,
      )
    })

    it('callback does not scroll when user has scrolled up', () => {
      const opts = makeOpts({ messageCount: 5 })
      const { result } = renderHook(() => useAutoScroll(opts))
      opts.scrollContainerRef.current!.scrollTop = 0
      act(() => result.current.handleScroll())
      const before = opts.scrollContainerRef.current!.scrollTop
      act(() => roCallback!())
      expect(opts.scrollContainerRef.current!.scrollTop).toBe(before)
    })
  })

  // ── useEffect: first message arrival ────────────────────────
  describe('first message arrival', () => {
    it('scrolls to bottom when messageCount becomes 1', () => {
      const opts = makeOpts()
      const { rerender } = renderHook((o) => useAutoScroll(o), { initialProps: opts })
      rerender({ ...opts, messageCount: 1 })
      expect(opts.scrollContainerRef.current!.scrollTop).toBe(
        opts.scrollContainerRef.current!.scrollHeight,
      )
    })

    it('does not fire first-message effect when messageCount is 0', () => {
      const opts = makeOpts()
      const { rerender } = renderHook(
        (o) => useAutoScroll(o),
        { initialProps: { ...opts, messageCount: 0 } },
      )
      mockRaf.mockClear()
      rerender({ ...opts, messageCount: 0 })
    })

    it('does not trigger first-message scroll when count goes 1→2', () => {
      const opts = makeOpts()
      const { result, rerender } = renderHook(
        (o) => useAutoScroll(o),
        { initialProps: { ...opts, messageCount: 1 } },
      )
      opts.scrollContainerRef.current!.scrollTop = 0
      act(() => result.current.handleScroll())
      rerender({ ...opts, messageCount: 2 })
      expect(opts.scrollContainerRef.current!.scrollTop).toBe(0)
    })
  })

  // ── useEffect: session switch ───────────────────────────────
  describe('session switch', () => {
    it('snaps to bottom and schedules rAF when sessionId becomes non-null', () => {
      const opts = makeOpts()
      const { result, rerender } = renderHook((o) => useAutoScroll(o), { initialProps: opts })
      rerender({ ...opts, sessionId: 'session-1' })
      expect(result.current.showScrollBtn).toBe(false)
      expect(mockRaf).toHaveBeenCalled()
      act(() => flushRaf())
      expect(opts.scrollContainerRef.current!.scrollTop).toBe(
        opts.scrollContainerRef.current!.scrollHeight,
      )
    })

    it('does not schedule rAF when sessionId is null', () => {
      const opts = makeOpts()
      const { rerender } = renderHook((o) => useAutoScroll(o), { initialProps: opts })
      mockRaf.mockClear()
      rerender({ ...opts, sessionId: null })
      expect(mockRaf).not.toHaveBeenCalled()
    })
  })

  // ── useEffect: agent connecting flip ────────────────────────
  describe('agent connecting flip', () => {
    it('snaps and double-rAF scrolls when connecting flips true→false', () => {
      const opts = makeOpts()
      const { result, rerender } = renderHook(
        (o) => useAutoScroll(o),
        { initialProps: { ...opts, isAgentConnecting: true } },
      )
      rerender({ ...opts, isAgentConnecting: false })
      expect(result.current.showScrollBtn).toBe(false)
      expect(mockRaf).toHaveBeenCalled()
      act(() => { flushRaf(); flushRaf() })
    })

    it('does nothing when connecting stays false', () => {
      const opts = makeOpts()
      const { rerender } = renderHook((o) => useAutoScroll(o), { initialProps: opts })
      mockRaf.mockClear()
      rerender({ ...opts, isAgentConnecting: false })
      expect(mockRaf).not.toHaveBeenCalled()
    })

    it('does nothing when connecting stays true', () => {
      const opts = makeOpts()
      const { rerender } = renderHook(
        (o) => useAutoScroll(o),
        { initialProps: { ...opts, isAgentConnecting: true } },
      )
      mockRaf.mockClear()
      rerender({ ...opts, isAgentConnecting: true })
      expect(mockRaf).not.toHaveBeenCalled()
    })

    it('does nothing when connecting goes false→true', () => {
      const opts = makeOpts()
      const { rerender } = renderHook((o) => useAutoScroll(o), { initialProps: opts })
      mockRaf.mockClear()
      rerender({ ...opts, isAgentConnecting: true })
      expect(mockRaf).not.toHaveBeenCalled()
    })
  })

  // ── useEffect: history loading flip ─────────────────────────
  describe('history loading flip', () => {
    it('snaps and double-rAF when loading flips true→false with session and messages', () => {
      const opts = makeOpts({ sessionId: 's1', messageCount: 10 })
      const { result, rerender } = renderHook(
        (o) => useAutoScroll(o),
        { initialProps: { ...opts, isHistoryLoading: true } },
      )
      rerender({ ...opts, isHistoryLoading: false })
      expect(result.current.showScrollBtn).toBe(false)
      expect(mockRaf).toHaveBeenCalled()
      act(() => { flushRaf(); flushRaf() })
    })

    it('does nothing when sessionId is null', () => {
      const opts = makeOpts({ sessionId: null, messageCount: 10 })
      const { rerender } = renderHook(
        (o) => useAutoScroll(o),
        { initialProps: { ...opts, isHistoryLoading: true } },
      )
      mockRaf.mockClear()
      rerender({ ...opts, isHistoryLoading: false })
      expect(mockRaf).not.toHaveBeenCalled()
    })

    it('does nothing when messageCount is 0', () => {
      const opts = makeOpts({ sessionId: 's1', messageCount: 0 })
      const { rerender } = renderHook(
        (o) => useAutoScroll(o),
        { initialProps: { ...opts, isHistoryLoading: true } },
      )
      mockRaf.mockClear()
      rerender({ ...opts, isHistoryLoading: false })
      expect(mockRaf).not.toHaveBeenCalled()
    })

    it('does nothing when loading stays false', () => {
      const opts = makeOpts()
      const { rerender } = renderHook((o) => useAutoScroll(o), { initialProps: opts })
      mockRaf.mockClear()
      rerender({ ...opts, isHistoryLoading: false })
      expect(mockRaf).not.toHaveBeenCalled()
    })

    it('does nothing when loading goes false→true', () => {
      const opts = makeOpts()
      const { rerender } = renderHook((o) => useAutoScroll(o), { initialProps: opts })
      mockRaf.mockClear()
      rerender({ ...opts, isHistoryLoading: true })
      expect(mockRaf).not.toHaveBeenCalled()
    })
  })
})
