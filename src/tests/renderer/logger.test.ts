// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ── Tests ──────────────────────────────────────────────────────────

describe("createLogger", () => {
  // ═══════════════════════════════════════════════════════════════════
  // Interface
  // ═══════════════════════════════════════════════════════════════════

  it("returns a logger with error, warn, info, debug methods", async () => {
    const { createLogger } = await import("@/renderer/src/utils/logger")
    const logger = createLogger("test-module")
    expect(typeof logger.error).toBe("function")
    expect(typeof logger.warn).toBe("function")
    expect(typeof logger.info).toBe("function")
    expect(typeof logger.debug).toBe("function")
  })

  // ═══════════════════════════════════════════════════════════════════
  // Output Format
  // The renderer logger silences output when NODE_ENV=test (isTest flag).
  // To test actual console output, we temporarily set NODE_ENV to "development"
  // and force a fresh module import so isTest is re-evaluated.
  // ═══════════════════════════════════════════════════════════════════

  describe("console output", () => {
    let originalNodeEnv: string | undefined

    beforeEach(() => {
      originalNodeEnv = process.env.NODE_ENV
      // Set to development so the logger module evaluates isTest=false
      process.env.NODE_ENV = "development"
      // Force vitest to re-import the module with the new NODE_ENV
      vi.resetModules()
    })

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv
      vi.resetModules()
    })

    it("logs error with module prefix", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
      const { createLogger } = await import("@/renderer/src/utils/logger")
      const logger = createLogger("my-module")
      logger.error("test error")
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("[my-module] error: test error")
      )
      consoleSpy.mockRestore()
    })

    it("logs warn with module prefix", async () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
      const { createLogger } = await import("@/renderer/src/utils/logger")
      const logger = createLogger("my-module")
      logger.warn("test warn")
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("[my-module] warn: test warn")
      )
      consoleSpy.mockRestore()
    })

    it("logs info with module prefix", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})
      const { createLogger } = await import("@/renderer/src/utils/logger")
      const logger = createLogger("my-module")
      logger.info("test info")
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("[my-module] info: test info")
      )
      consoleSpy.mockRestore()
    })

    it("logs debug with module prefix", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})
      const { createLogger } = await import("@/renderer/src/utils/logger")
      const logger = createLogger("my-module")
      logger.debug("test debug")
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("[my-module] debug: test debug")
      )
      consoleSpy.mockRestore()
    })
  })

  // ═══════════════════════════════════════════════════════════════════
  // Method call safety (works even when isTest silences output)
  // ═══════════════════════════════════════════════════════════════════

  it("logger methods do not throw errors", async () => {
    const { createLogger } = await import("@/renderer/src/utils/logger")
    const logger = createLogger("safe-test")
    // None of these should throw even with meta args
    expect(() => logger.error("test error", { code: 500 })).not.toThrow()
    expect(() => logger.warn("test warn", "extra")).not.toThrow()
    expect(() => logger.info("test info", 1, 2, 3)).not.toThrow()
    expect(() => logger.debug("test debug")).not.toThrow()
  })

  it("handles undefined/null message gracefully", async () => {
    const { createLogger } = await import("@/renderer/src/utils/logger")
    const logger = createLogger("edge-test")
    // @ts-expect-error - testing runtime robustness
    expect(() => logger.error(undefined)).not.toThrow()
    // @ts-expect-error - testing runtime robustness
    expect(() => logger.warn(null)).not.toThrow()
  })
})
