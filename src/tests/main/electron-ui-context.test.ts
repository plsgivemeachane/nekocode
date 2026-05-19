import { describe, it, expect, vi, beforeEach } from "vitest"
import { ElectronUIContext } from "@/main/electron-ui-context"
import type { UIRequestTransport } from "@/main/electron-ui-context"
// UIResponse type is used implicitly through handleResponse which accepts UIResponse-shaped objects

// ── Mock transport ─────────────────────────────────────────────────

import type { SessionStreamEvent, UIRequest } from '../../shared/ipc-types'

// Helper to extract the UIRequest from a captured event (type-safe alternative to `as any`)
function extractUIRequest(event: SessionStreamEvent): UIRequest {
  if (event.type === 'ui_request') return event.request
  throw new Error(`Expected ui_request event, got ${event.type}`)
}

function createMockTransport(): UIRequestTransport & {
  sentRequests: Array<{ sessionId: string; event: SessionStreamEvent }>
} {
  const sentRequests: Array<{ sessionId: string; event: SessionStreamEvent }> = []
  return {
    sendUIRequest(sessionId: string, event: SessionStreamEvent) {
      sentRequests.push({ sessionId, event })
    },
    sentRequests,
  }
}

// ── Tests ──────────────────────────────────────────────────────────

describe("ElectronUIContext", () => {
  let transport: ReturnType<typeof createMockTransport>
  let context: ElectronUIContext

  beforeEach(() => {
    transport = createMockTransport()
    context = new ElectronUIContext("sess-1234abcd", transport)
  })

  // ═══════════════════════════════════════════════════════════════════
  // select()
  // ═══════════════════════════════════════════════════════════════════

  it("sends a select UIRequest via transport", async () => {
    const selectPromise = context.select("Pick one", ["a", "b"])

    // Transport should have received a request
    expect(transport.sentRequests.length).toBe(1)
    const sent = transport.sentRequests[0]
    expect(sent.sessionId).toBe("sess-1234abcd")
    expect(extractUIRequest(sent.event).type).toBe("select")
    expect(extractUIRequest(sent.event).title).toBe("Pick one")
    expect(extractUIRequest(sent.event).options).toEqual([
      { label: "a", value: "a" },
      { label: "b", value: "b" },
    ])

    // Simulate a response from the renderer
    const requestId = extractUIRequest(sent.event).id
    context.handleResponse({
      sessionId: "test-session",
      requestId,
      confirmed: true,
      selectedValue: "a",
    })

    const result = await selectPromise
    expect(result).toBe("a")
  })

  it("resolves select with undefined when user cancels", async () => {
    const selectPromise = context.select("Pick one", ["a"])
    const requestId = extractUIRequest(transport.sentRequests[0].event).id

    context.handleResponse({
      sessionId: "test-session",
      requestId,
      confirmed: false,
    })

    const result = await selectPromise
    expect(result).toBeUndefined()
  })

  // ═══════════════════════════════════════════════════════════════════
  // confirm()
  // ═══════════════════════════════════════════════════════════════════

  it("sends a confirm UIRequest via transport", async () => {
    const confirmPromise = context.confirm("Are you sure?", "This is dangerous")

    expect(transport.sentRequests.length).toBe(1)
    const sent = transport.sentRequests[0]
    expect(extractUIRequest(sent.event).type).toBe("confirm")
    expect(extractUIRequest(sent.event).title).toBe("Are you sure?")
    expect(extractUIRequest(sent.event).description).toBe("This is dangerous")

    const requestId = extractUIRequest(sent.event).id
    context.handleResponse({
      sessionId: "test-session",
      requestId,
      confirmed: true,
    })

    const result = await confirmPromise
    expect(result).toBe(true)
  })

  it("resolves confirm with undefined when user cancels", async () => {
    const confirmPromise = context.confirm("Sure?", "Are you sure?")
    const requestId = extractUIRequest(transport.sentRequests[0].event).id

    context.handleResponse({
      sessionId: "test-session",
      requestId,
      confirmed: false,
    })

    const result = await confirmPromise
    expect(result).toBeUndefined()
  })

  // ═══════════════════════════════════════════════════════════════════
  // input()
  // ═══════════════════════════════════════════════════════════════════

  it("sends an input UIRequest via transport", async () => {
    const inputPromise = context.input("Enter name", "Type here...")

    expect(transport.sentRequests.length).toBe(1)
    const sent = transport.sentRequests[0]
    expect(extractUIRequest(sent.event).type).toBe("input")
    expect(extractUIRequest(sent.event).title).toBe("Enter name")
    expect(extractUIRequest(sent.event).placeholder).toBe("Type here...")

    const requestId = extractUIRequest(sent.event).id
    context.handleResponse({
      sessionId: "test-session",
      requestId,
      confirmed: true,
      inputValue: "hello",
    })

    const result = await inputPromise
    expect(result).toBe("hello")
  })

  it("resolves input with undefined when user cancels", async () => {
    const inputPromise = context.input("Enter name")
    const requestId = extractUIRequest(transport.sentRequests[0].event).id

    context.handleResponse({
      sessionId: "test-session",
      requestId,
      confirmed: false,
    })

    const result = await inputPromise
    expect(result).toBeUndefined()
  })

  // ═══════════════════════════════════════════════════════════════════
  // handleResponse()
  // ═══════════════════════════════════════════════════════════════════

  it("ignores response for unknown request ID", () => {
    // Should not throw
    expect(() =>
      context.handleResponse({
        sessionId: "test-session",
        requestId: "unknown-id",
        confirmed: true,
      })
    ).not.toThrow()
  })

  it("resolves with selectedValue when confirmed with selectedValue", async () => {
    const promise = context.select("Pick", ["x"])
    const requestId = extractUIRequest(transport.sentRequests[0].event).id

    context.handleResponse({
      sessionId: "test-session",
      requestId,
      confirmed: true,
      selectedValue: "x",
    })

    expect(await promise).toBe("x")
  })

  it("resolves with inputValue when confirmed with inputValue", async () => {
    const promise = context.input("Enter")
    const requestId = extractUIRequest(transport.sentRequests[0].event).id

    context.handleResponse({
      sessionId: "test-session",
      requestId,
      confirmed: true,
      inputValue: "typed text",
    })

    expect(await promise).toBe("typed text")
  })

  // ═══════════════════════════════════════════════════════════════════
  // Timeout
  // ═══════════════════════════════════════════════════════════════════

  it("resolves with undefined when request times out", async () => {
    vi.useFakeTimers()
    const promise = context.select("Pick", ["a"], { timeout: 5000 })

    // Before timeout
    expect(transport.sentRequests.length).toBe(1)

    // Advance past timeout
    vi.advanceTimersByTime(5001)

    const result = await promise
    expect(result).toBeUndefined()
    vi.useRealTimers()
  })

  // ═══════════════════════════════════════════════════════════════════
  // AbortSignal
  // ═══════════════════════════════════════════════════════════════════

  it("cancels request when AbortSignal is aborted", async () => {
    const controller = new AbortController()
    const promise = context.select("Pick", ["a"], { signal: controller.signal })

    // Abort the request
    controller.abort()

    const result = await promise
    expect(result).toBeUndefined()
  })

  // ═══════════════════════════════════════════════════════════════════
  // dispose()
  // ═══════════════════════════════════════════════════════════════════

  it("resolves all pending requests with undefined on dispose", async () => {
    const selectPromise = context.select("Pick", ["a"])
    const confirmPromise = context.confirm("Sure?", "Are you sure?")
    const inputPromise = context.input("Enter")

    // All three should be pending
    expect(transport.sentRequests.length).toBe(3)

    context.dispose()

    const results = await Promise.all([selectPromise, confirmPromise, inputPromise])
    expect(results).toEqual([undefined, undefined, undefined])
  })

  // ═══════════════════════════════════════════════════════════════════
  // Request ID Generation
  // ═══════════════════════════════════════════════════════════════════

  it("generates unique request IDs", async () => {
    // Start two requests without resolving
    context.select("Pick1", ["a"])
    context.select("Pick2", ["b"])

    const id1 = extractUIRequest(transport.sentRequests[0].event).id
    const id2 = extractUIRequest(transport.sentRequests[1].event).id

    expect(id1).not.toBe(id2)
    expect(id1).toMatch(/^ui-sess-123/)
    expect(id2).toMatch(/^ui-sess-123/)
  })

  // ═══════════════════════════════════════════════════════════════════
  // notify() / setStatus() / onTerminalInput()
  // ═══════════════════════════════════════════════════════════════════

  it("notify() does not throw", () => {
    expect(() => context.notify("hello")).not.toThrow()
    expect(() => context.notify("warning", "warning")).not.toThrow()
    expect(() => context.notify("error", "error")).not.toThrow()
  })

  it("setStatus() does not throw", () => {
    expect(() => context.setStatus("key", "value")).not.toThrow()
    expect(() => context.setStatus("key", undefined)).not.toThrow()
  })

  it("onTerminalInput() returns a noop function", () => {
    const unsubscribe = context.onTerminalInput()
    expect(typeof unsubscribe).toBe("function")
    expect(() => unsubscribe()).not.toThrow()
  })
})
