import { describe, it, expect, vi } from "vitest"
import type { ExtensionLoadError } from "@/shared/ipc-types"
import { logExtensionLoadWarnings } from "@/renderer/src/utils/extension-logging"

// ── Helpers ─────────────────────────────────────────────────────────

function makeError(overrides: Partial<ExtensionLoadError> = {}): ExtensionLoadError {
  return {
    path: overrides.path ?? "/path/to/extension",
    message: overrides.message ?? "Failed to load",
    stack: overrides.stack,
  }
}

// ── Tests ──────────────────────────────────────────────────────────

describe("logExtensionLoadWarnings", () => {
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
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
      logExtensionLoadWarnings("create", "sess-abc123", [makeError()], true)
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("degraded mode"),
      )
      warnSpy.mockRestore()
    })

    it("does NOT call onError when extensionsDisabled is true", () => {
      const onError = vi.fn()
      logExtensionLoadWarnings("create", "sess-abc123", [makeError()], true, onError)
      expect(onError).not.toHaveBeenCalled()
    })

    it("does NOT log degraded mode warning when extensionsDisabled is false", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
      logExtensionLoadWarnings("create", "sess-abc123", [makeError()], false)
      const calls = warnSpy.mock.calls.map((c) => c[0] as string)
      expect(calls.some((c) => c.includes("degraded mode"))).toBe(false)
      warnSpy.mockRestore()
    })

    it("does NOT log degraded mode warning when extensionsDisabled is undefined", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
      logExtensionLoadWarnings("create", "sess-abc123", [makeError()], undefined)
      const calls = warnSpy.mock.calls.map((c) => c[0] as string)
      expect(calls.some((c) => c.includes("degraded mode"))).toBe(false)
      warnSpy.mockRestore()
    })
  })

  describe("error logging", () => {
    it("logs the count of extension errors", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
      logExtensionLoadWarnings("create", "sess-abc123", [makeError(), makeError()], false)
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("extension load errors=2"),
      )
      warnSpy.mockRestore()
    })

    it("logs each error path and message", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
      logExtensionLoadWarnings("create", "sess-abc123", [
        makeError({ path: "/ext/a", message: "error a" }),
        makeError({ path: "/ext/b", message: "error b" }),
      ], false)
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("path=/ext/a"),
      )
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("path=/ext/b"),
      )
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("message=error a"),
      )
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("message=error b"),
      )
      warnSpy.mockRestore()
    })

    it("includes the mode in log messages", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
      logExtensionLoadWarnings("reconnect", "sess-abc123", [makeError()], false)
      const calls = warnSpy.mock.calls.map((c) => c[0] as string)
      expect(calls.every((c) => c.includes("[reconnect]"))).toBe(true)
      warnSpy.mockRestore()
    })

    it("includes the session id prefix in log messages", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
      logExtensionLoadWarnings("create", "sess-abc123", [makeError()], false)
      const calls = warnSpy.mock.calls.map((c) => c[0] as string)
      expect(calls.some((c) => c.includes("sessionId="))).toBe(true)
      warnSpy.mockRestore()
    })
  })

  describe("stack trace logging", () => {
    it("logs stack trace in debug when stack is present", () => {
      const debugSpy = vi.spyOn(console, "log").mockImplementation(() => {})
      logExtensionLoadWarnings("create", "sess-abc123", [
        makeError({ path: "/ext/a", stack: "line1\nline2" }),
      ], false)
      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining("stack for /ext/a"),
      )
      debugSpy.mockRestore()
    })

    it("does not log stack trace when stack is undefined", () => {
      const debugSpy = vi.spyOn(console, "log").mockImplementation(() => {})
      logExtensionLoadWarnings("create", "sess-abc123", [
        makeError({ path: "/ext/a", stack: undefined }),
      ], false)
      const calls = debugSpy.mock.calls.map((c) => c[0] as string)
      expect(calls.some((c) => c.includes("stack for"))).toBe(false)
      debugSpy.mockRestore()
    })
  })

  describe("onError callback", () => {
    it("calls onError with sessionId when extensionsDisabled is false", () => {
      const onError = vi.fn()
      logExtensionLoadWarnings("create", "sess-abc123", [makeError()], false, onError)
      expect(onError).toHaveBeenCalledOnce()
      expect(onError).toHaveBeenCalledWith("sess-abc123")
    })

    it("calls onError with sessionId when extensionsDisabled is undefined", () => {
      const onError = vi.fn()
      logExtensionLoadWarnings("reconnect", "sess-abc123", [makeError()], undefined, onError)
      expect(onError).toHaveBeenCalledOnce()
      expect(onError).toHaveBeenCalledWith("sess-abc123")
    })

    it("does not call onError when onError is not provided", () => {
      // Should not throw
      expect(() => {
        logExtensionLoadWarnings("create", "sess-abc123", [makeError()], false)
      }).not.toThrow()
    })
  })
})
