import { describe, it, expect, vi, beforeEach, type Mock } from "vitest"
import type { SessionStreamEvent, UsageData } from "@/shared/ipc-types"
import type { ChatMessage } from "@/renderer/src/types/chat"

// ── Mock logger ────────────────────────────────────────────────────
vi.mock("@/renderer/src/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

// ── Mock message-transforms (capture mocks via module) ────────────
vi.mock("@/renderer/src/utils/message-transforms", () => ({
  handleTextDelta: vi.fn((prev: ChatMessage[]) => [
    ...prev,
    { role: "assistant", content: "delta", id: "1" } as ChatMessage,
  ]),
  handleToolCall: vi.fn((prev: ChatMessage[]) => prev),
  handleToolResult: vi.fn((prev: ChatMessage[]) => prev),
  ipcToChatMessages: vi.fn(),
  messageSignature: vi.fn(),
  isSessionNotReadyError: vi.fn(),
}))

// ── Simple hook runner (mock react) ───────────────────────────────
let _effectCallbacks: Array<() => void | (() => void)> = []
let _cleanupCallbacks: Array<(() => void) | void> = []
let _refs = new Map<number, { current: unknown }>()
let _refIdCounter = 0

vi.mock("react", () => ({
  useRef: (initialValue: unknown) => {
    const id = _refIdCounter++
    if (!_refs.has(id)) _refs.set(id, { current: initialValue })
    return _refs.get(id)!
  },
  useEffect: (fn: () => void | (() => void)) => {
    _effectCallbacks.push(fn)
  },
  useState: (initial: unknown) => [initial, vi.fn()],
  useCallback: (fn: unknown) => fn,
  useMemo: (fn: () => unknown) => fn(),
}))

import { useSessionEvents } from "@/renderer/src/hooks/useSessionEvents"

let eventCallback: ((payload: { sessionId: string; event: SessionStreamEvent }) => void) | null = null
let unsubMock: ReturnType<typeof vi.fn>
const DEFAULT_USAGE: UsageData = { inputTokens: 0, outputTokens: 0, totalCost: 0, contextPercent: 0, contextWindow: 0 }

function resetHookState() {
  _effectCallbacks = []
  _cleanupCallbacks = []
  _refs = new Map()
  _refIdCounter = 0
  eventCallback = null
}

function runInHookScope<R>(fn: () => R): R {
  resetHookState()
  const result = fn()
  for (const cb of _effectCallbacks) {
    _cleanupCallbacks.push(cb())
  }
  return result
}

function cleanupEffects() {
  for (const cb of _cleanupCallbacks) {
    cb?.()
  }
  resetHookState()
}

// ── Tests ──────────────────────────────────────────────────────────

describe("useSessionEvents", () => {
  const sessionId = "sess-abc123def456"
  const otherSessionId = "sess-other000000"
  let onMessages: Mock<(updater: (prev: ChatMessage[]) => ChatMessage[]) => void>
  let onError: (error: string | null) => void
  let onUsage: (usage: UsageData) => void

  beforeEach(() => {
    vi.clearAllMocks()
    onMessages = vi.fn()
    onError = vi.fn() as unknown as typeof onError
    onUsage = vi.fn() as unknown as typeof onUsage
    unsubMock = vi.fn()
    vi.stubGlobal("window", globalThis)
    vi.stubGlobal("nekocode", {
      session: {
        onEvent: vi.fn((cb) => {
          eventCallback = cb
          return unsubMock
        }),
      },
    })
  })

  describe("subscription", () => {
    it("subscribes to session events when sessionId is provided", () => {
      runInHookScope(() =>
        useSessionEvents({ sessionId, onMessages, onError, onUsage }),
      )
      expect(window.nekocode.session.onEvent).toHaveBeenCalledOnce()
    })

    it("does NOT subscribe when sessionId is null", () => {
      runInHookScope(() =>
        useSessionEvents({ sessionId: null, onMessages, onError, onUsage }),
      )
      expect(window.nekocode.session.onEvent).not.toHaveBeenCalled()
    })

    it("unsubscribes on cleanup", () => {
      runInHookScope(() =>
        useSessionEvents({ sessionId, onMessages, onError, onUsage }),
      )
      cleanupEffects()
      expect(unsubMock).toHaveBeenCalledOnce()
    })
  })

  describe("event filtering", () => {
    it("ignores events for other sessions", () => {
      runInHookScope(() =>
        useSessionEvents({ sessionId, onMessages, onError, onUsage }),
      )
      eventCallback!({
        sessionId: otherSessionId,
        event: { type: "text_delta", delta: "hello" },
      })
      expect(onMessages).not.toHaveBeenCalled()
    })

    it("processes events for the subscribed session", () => {
      runInHookScope(() =>
        useSessionEvents({ sessionId, onMessages, onError, onUsage }),
      )
      eventCallback!({ sessionId, event: { type: "text_delta", delta: "hello" } })
      expect(onMessages).toHaveBeenCalled()
    })
  })

  describe("text_delta event", () => {
    it("calls onMessages with an updater function", () => {
      runInHookScope(() =>
        useSessionEvents({ sessionId, onMessages, onError, onUsage }),
      )
      eventCallback!({ sessionId, event: { type: "text_delta", delta: "hi" } })
      expect(onMessages).toHaveBeenCalled()
      expect(typeof onMessages.mock.calls[0][0]).toBe("function")
    })
  })

  describe("tool_call event", () => {
    it("calls onMessages with an updater function", () => {
      runInHookScope(() =>
        useSessionEvents({ sessionId, onMessages, onError, onUsage }),
      )
      eventCallback!({
        sessionId,
        event: { type: "tool_call", toolCallId: "tc-1", toolName: "read_file", args: { path: "/test" } },
      })
      expect(onMessages).toHaveBeenCalled()
      expect(typeof onMessages.mock.calls[0][0]).toBe("function")
    })
  })

  describe("tool_result event", () => {
    it("calls onMessages with an updater function", () => {
      runInHookScope(() =>
        useSessionEvents({ sessionId, onMessages, onError, onUsage }),
      )
      eventCallback!({
        sessionId,
        event: { type: "tool_result", toolCallId: "tc-1", toolName: "read_file", result: "content", isError: false },
      })
      expect(onMessages).toHaveBeenCalled()
    })
  })

  describe("agent_start event", () => {
    it("clears error via onError(null)", () => {
      runInHookScope(() =>
        useSessionEvents({ sessionId, onMessages, onError, onUsage }),
      )
      eventCallback!({ sessionId, event: { type: "agent_start" } })
      expect(onError).toHaveBeenCalledWith(null)
    })

    it("sets stream start time if not already set", () => {
      const result = runInHookScope(() =>
        useSessionEvents({ sessionId, onMessages, onError, onUsage }),
      )
      eventCallback!({ sessionId, event: { type: "agent_start" } })
      expect(result.getStreamStartTime(sessionId)).toBeGreaterThan(0)
    })

    it("preserves existing non-zero stream start time", () => {
      const result = runInHookScope(() =>
        useSessionEvents({ sessionId, onMessages, onError, onUsage }),
      )
      eventCallback!({ sessionId, event: { type: "agent_start" } })
      const firstTime = result.getStreamStartTime(sessionId)
      eventCallback!({ sessionId, event: { type: "agent_start" } })
      expect(result.getStreamStartTime(sessionId)).toBe(firstTime)
    })

    it("sets stream start time if it was 0 (from previous done)", () => {
      vi.useFakeTimers()
      const result = runInHookScope(() =>
        useSessionEvents({ sessionId, onMessages, onError, onUsage }),
      )
      eventCallback!({ sessionId, event: { type: "agent_start" } })
      const firstTime = result.getStreamStartTime(sessionId)
      eventCallback!({ sessionId, event: { type: "done" } })
      expect(result.getStreamStartTime(sessionId)).toBe(0)
      vi.advanceTimersByTime(10)
      eventCallback!({ sessionId, event: { type: "agent_start" } })
      const newTime = result.getStreamStartTime(sessionId)
      expect(newTime).toBeGreaterThan(0)
      expect(newTime).not.toBe(firstTime)
      vi.useRealTimers()
    })
  })

  describe("error event", () => {
    it("calls onError with the error message", () => {
      runInHookScope(() =>
        useSessionEvents({ sessionId, onMessages, onError, onUsage }),
      )
      eventCallback!({ sessionId, event: { type: "error", message: "Something broke" } })
      expect(onError).toHaveBeenCalledWith("Something broke")
    })

    it("caches the error for getCachedError", () => {
      const result = runInHookScope(() =>
        useSessionEvents({ sessionId, onMessages, onError, onUsage }),
      )
      eventCallback!({ sessionId, event: { type: "error", message: "oops" } })
      expect(result.getCachedError(sessionId)).toBe("oops")
    })
  })

  describe("done event", () => {
    it("resets stream start time to 0", () => {
      const result = runInHookScope(() =>
        useSessionEvents({ sessionId, onMessages, onError, onUsage }),
      )
      eventCallback!({ sessionId, event: { type: "agent_start" } })
      expect(result.getStreamStartTime(sessionId)).toBeGreaterThan(0)
      eventCallback!({ sessionId, event: { type: "done" } })
      expect(result.getStreamStartTime(sessionId)).toBe(0)
    })
  })

  describe("usage_update event", () => {
    it("calls onUsage with the usage data", () => {
      const usage: UsageData = { inputTokens: 100, outputTokens: 50, totalCost: 0.001, contextPercent: 10, contextWindow: 128000 }
      runInHookScope(() =>
        useSessionEvents({ sessionId, onMessages, onError, onUsage }),
      )
      eventCallback!({ sessionId, event: { type: "usage_update", usage } })
      expect(onUsage).toHaveBeenCalledWith(usage)
    })

    it("caches the usage for getCachedUsage", () => {
      const usage: UsageData = { inputTokens: 200, outputTokens: 100, totalCost: 0.002, contextPercent: 20, contextWindow: 128000 }
      const result = runInHookScope(() =>
        useSessionEvents({ sessionId, onMessages, onError, onUsage }),
      )
      eventCallback!({ sessionId, event: { type: "usage_update", usage } })
      expect(result.getCachedUsage(sessionId)).toEqual(usage)
    })
  })

  describe("getters for unknown sessions", () => {
    it("getStreamStartTime returns 0 for unknown session", () => {
      const result = runInHookScope(() =>
        useSessionEvents({ sessionId, onMessages, onError, onUsage }),
      )
      expect(result.getStreamStartTime("unknown-session")).toBe(0)
    })

    it("getCachedError returns null for unknown session", () => {
      const result = runInHookScope(() =>
        useSessionEvents({ sessionId, onMessages, onError, onUsage }),
      )
      expect(result.getCachedError("unknown-session")).toBeNull()
    })

    it("getCachedUsage returns default usage for unknown session", () => {
      const result = runInHookScope(() =>
        useSessionEvents({ sessionId, onMessages, onError, onUsage }),
      )
      expect(result.getCachedUsage("unknown-session")).toEqual(DEFAULT_USAGE)
    })
  })

  describe("agent_start clears cached error", () => {
    it("getCachedError returns null after agent_start", () => {
      const result = runInHookScope(() =>
        useSessionEvents({ sessionId, onMessages, onError, onUsage }),
      )
      eventCallback!({ sessionId, event: { type: "error", message: "err" } })
      expect(result.getCachedError(sessionId)).toBe("err")
      eventCallback!({ sessionId, event: { type: "agent_start" } })
      expect(result.getCachedError(sessionId)).toBeNull()
    })
  })
})
