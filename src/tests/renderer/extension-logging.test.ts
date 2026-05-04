import { describe, it, expect, vi, beforeEach } from "vitest"
import type { ExtensionLoadError } from "@/shared/ipc-types"
import { logExtensionLoadWarnings } from "@/renderer/src/utils/extension-logging"

// ── Mock logger ────────────────────────────────────────────────────
// Capture the logger instance created by extension-logging so tests can spy on it
// vi.hoisted ensures the mock object is available when vi.mock factory runs (hoisted to top)
const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock("@/renderer/src/utils/logger", () => ({
  createLogger: () => mockLogger,
}))

// ── Helpers ─────────────────────────────────────────────────────────

function makeError(overrides: Partial<ExtensionLoadError> = {}): ExtensionLoadError {
  return {
    path: overrides.path ?? "/path/to/extension",
    message: overrides.message ?? "Failed to load",
    stack: overrides.stack,
  }
}

// ── Tests ──────────────────────────────────────────────────────────

describe('logExtensionLoadWarnings', () => {
  beforeEach(() => {
    // Reset all mock logger calls between tests
    mockLogger.error.mockClear()
    mockLogger.warn.mockClear()
    mockLogger.info.mockClear()
    mockLogger.debug.mockClear()
  })
  describe("early return conditions", () => {
    it("returns early when errors is undefined", () => {
      const onError = vi.fn()
      logExtensionLoadWarnings("create", "sess-abc123", undefined, false, onError)
      expect(onError).not.toHaveBeenCalled()
    })

    it("returns early when errors is empty array", () => {
      const onError = vi.fn()
      logExtensionLoadWarnings("create", "sess-abc123", [], false, onError)
      expect(onError).not.toHaveBeenCalled()
    })
  })

  describe("extensions disabled", () => {
    it("logs degraded mode warning when extensionsDisabled is true", () => {
      logExtensionLoadWarnings("create", "sess-abc123", [makeError()], true)
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("degraded mode"),
      )
    })

    it("does NOT call onError when extensionsDisabled is true", () => {
      const onError = vi.fn()
      logExtensionLoadWarnings("create", "sess-abc123", [makeError()], true, onError)
      expect(onError).not.toHaveBeenCalled()
    })

    it("does NOT log degraded mode warning when extensionsDisabled is false", () => {
      logExtensionLoadWarnings("create", "sess-abc123", [makeError()], false)
      const calls = mockLogger.warn.mock.calls.map((c) => c[0] as string)
      expect(calls.some((c) => c.includes("degraded mode"))).toBe(false)
    })

    it("does NOT log degraded mode warning when extensionsDisabled is undefined", () => {
      logExtensionLoadWarnings("create", "sess-abc123", [makeError()], undefined)
      const calls = mockLogger.warn.mock.calls.map((c) => c[0] as string)
      expect(calls.some((c) => c.includes("degraded mode"))).toBe(false)
    })
  })

  describe("error logging", () => {
    it("logs the count of extension errors", () => {
      logExtensionLoadWarnings("create", "sess-abc123", [makeError(), makeError()], false)
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("extension load errors=2"),
      )
    })

    it("logs each error path and message", () => {
      logExtensionLoadWarnings("create", "sess-abc123", [
        makeError({ path: "/ext/a", message: "error a" }),
        makeError({ path: "/ext/b", message: "error b" }),
      ], false)
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("path=/ext/a"),
      )
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("path=/ext/b"),
      )
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("message=error a"),
      )
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("message=error b"),
      )
    })

    it("includes the mode in log messages", () => {
      logExtensionLoadWarnings("reconnect", "sess-abc123", [makeError()], false)
      const calls = mockLogger.warn.mock.calls.map((c) => c[0] as string)
      expect(calls.every((c) => c.includes("[reconnect]"))).toBe(true)
    })

    it("includes the session id prefix in log messages", () => {
      logExtensionLoadWarnings("create", "sess-abc123", [makeError()], false)
      const calls = mockLogger.warn.mock.calls.map((c) => c[0] as string)
      expect(calls.some((c) => c.includes("sessionId="))).toBe(true)
    })
  })

  describe("stack trace logging", () => {
    it("logs stack trace in debug when stack is present", () => {
      logExtensionLoadWarnings("create", "sess-abc123", [
        makeError({ path: "/ext/a", stack: "line1\nline2" }),
      ], false)
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("stack for /ext/a"),
      )
    })

    it("does not log stack trace when stack is undefined", () => {
      logExtensionLoadWarnings("create", "sess-abc123", [
        makeError({ path: "/ext/a", stack: undefined }),
      ], false)
      const calls = mockLogger.debug.mock.calls.map((c) => c[0] as string)
      expect(calls.some((c) => c.includes("stack for"))).toBe(false)
    })
  })

  describe("onError callback", () => {
    it("calls onError with sessionId and errorMessage when extensionsDisabled is false", () => {
      const onError = vi.fn()
      logExtensionLoadWarnings("create", "sess-abc123", [makeError()], false, onError)
      expect(onError).toHaveBeenCalledOnce()
      expect(onError).toHaveBeenCalledWith("sess-abc123", expect.stringContaining("extension(s) failed"))
    })

    it("calls onError with sessionId and errorMessage when extensionsDisabled is undefined", () => {
      const onError = vi.fn()
      logExtensionLoadWarnings("reconnect", "sess-abc123", [makeError()], undefined, onError)
      expect(onError).toHaveBeenCalledOnce()
      expect(onError).toHaveBeenCalledWith("sess-abc123", expect.stringContaining("extension(s) failed"))
    })

    it("does not call onError when onError is not provided", () => {
      // Should not throw
      expect(() => {
        logExtensionLoadWarnings("create", "sess-abc123", [makeError()], false)
      }).not.toThrow()
    })
  })
})
