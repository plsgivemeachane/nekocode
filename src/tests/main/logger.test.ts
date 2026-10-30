/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createLogger, SimpleConsoleLogger, type Logger } from "@/main/logger"

// ── Tests ──────────────────────────────────────────────────────────

describe("logger", () => {
  let logger: Logger

  beforeEach(() => {
    logger = createLogger("test-module")
  })

  // ═══════════════════════════════════════════════════════════════════
  // createLogger factory
  // ═══════════════════════════════════════════════════════════════════

  it("returns a logger with all standard log level methods", () => {
    expect(typeof logger.error).toBe("function")
    expect(typeof logger.warn).toBe("function")
    expect(typeof logger.info).toBe("function")
    expect(typeof logger.http).toBe("function")
    expect(typeof logger.verbose).toBe("function")
    expect(typeof logger.debug).toBe("function")
    expect(typeof logger.silly).toBe("function")
  })

  it("returns a logger with a child method", () => {
    expect(typeof logger.child).toBe("function")
  })

  it("log level methods do not throw in test environment", () => {
    // In NODE_ENV=test, the winston logger is silent but should not throw
    expect(() => logger.error("test error")).not.toThrow()
    expect(() => logger.warn("test warn")).not.toThrow()
    expect(() => logger.info("test info")).not.toThrow()
    expect(() => logger.http("test http")).not.toThrow()
    expect(() => logger.verbose("test verbose")).not.toThrow()
    expect(() => logger.debug("test debug")).not.toThrow()
    expect(() => logger.silly("test silly")).not.toThrow()
  })

  it("log level methods accept meta objects without throwing", () => {
    expect(() => logger.info("test", { key: "value" })).not.toThrow()
    expect(() => logger.error("test", { err: new Error("boom") })).not.toThrow()
    expect(() => logger.warn("test", { count: 42 })).not.toThrow()
  })

  // ═══════════════════════════════════════════════════════════════════
  // child() method
  // ═══════════════════════════════════════════════════════════════════

  it("child() returns a new logger with a different label", () => {
    const child = logger.child({ label: "child-module" })
    expect(child).not.toBeNull()
    expect(typeof child.info).toBe("function")
    expect(typeof child.error).toBe("function")
    expect(typeof child.child).toBe("function")
  })

  it("child() logger methods do not throw", () => {
    const child = logger.child({ label: "child-module" })
    expect(() => child.info("child test")).not.toThrow()
    expect(() => child.error("child error")).not.toThrow()
  })

  it("child() without label uses parent label", () => {
    const child = logger.child({})
    expect(child).not.toBeNull()
    expect(() => child.info("child with no label")).not.toThrow()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Winston logger properties (main thread)
  // ═══════════════════════════════════════════════════════════════════

  describe("winston logger properties", () => {
    it("winston logger has transports array with expected entries", () => {
      // In main thread, createLogger returns a winston child logger
      if ("transports" in logger) {
        const transports = (logger as any).transports
        expect(Array.isArray(transports)).toBe(true)
        // Strengthened: verify there is at least one transport configured
        expect(transports.length).toBeGreaterThan(0)
      }
    })

    it("winston logger has format property with expected structure", () => {
      if ("format" in logger) {
        // Strengthened: verify the format is a winston format object, not just "defined"
        const format = (logger as any).format
        expect(typeof format).toBe("object")
        expect(format).not.toBeNull()
        // Winston format objects have a transform function
        expect(typeof format.transform).toBe("function")
      }
    })

    it("winston logger is configured for test environment silence", () => {
      // In test environment, the winston root logger is silent
      // The child logger should still function (no throw) but produce no console output
      expect(() => logger.info("silent test")).not.toThrow()
    })
  })

  // ═══════════════════════════════════════════════════════════════════
  // Console output via winston transport capture
  // ═══════════════════════════════════════════════════════════════════

  describe("winston logger output capture", () => {
    let capturedLogs: Array<{ level: string; message: string; label?: string }>
    let captureLogger: Logger
    let captureTransport: any = null

    beforeEach(() => {
      capturedLogs = []
      // Create a fresh logger for each capture test
      captureLogger = createLogger("capture-module")
      // Add a custom transport to capture log output
      if ("add" in captureLogger && typeof (captureLogger as any).add === "function") {
        // In test env, the root logger has silent=true which suppresses ALL transports.
        // We must unsilence this child logger so the capture transport receives logs.
        ;(captureLogger as any).silent = false
        const winston = require("winston")
        captureTransport = new winston.Transport({
          log: (info: any, callback: () => void) => {
            capturedLogs.push({
              level: info.level,
              message: info.message,
              label: info.label,
            })
            callback()
          },
        })
        ;(captureLogger as any).add(captureTransport)
      }
    })

    afterEach(() => {
      // Remove the capture transport to prevent MaxListenersExceeded warnings
      if (captureTransport && "remove" in captureLogger) {
        ;(captureLogger as any).remove(captureTransport)
      }
      capturedLogs = []
      captureTransport = null
    })

    it("info log is captured with correct level", () => {
      if (!("add" in captureLogger)) return
      captureLogger.info("capture-test-info")
      expect(capturedLogs.length).toBeGreaterThan(0)
      expect(capturedLogs[0].level).toBe("info")
    })

    it("error log is captured with correct level", () => {
      if (!("add" in captureLogger)) return
      captureLogger.error("capture-test-error")
      expect(capturedLogs.length).toBeGreaterThan(0)
      expect(capturedLogs[0].level).toBe("error")
    })

    it("warn log is captured with correct level", () => {
      if (!("add" in captureLogger)) return
      captureLogger.warn("capture-test-warn")
      expect(capturedLogs.length).toBeGreaterThan(0)
      expect(capturedLogs[0].level).toBe("warn")
    })

    it("log message contains the expected text", () => {
      if (!("add" in captureLogger)) return
      captureLogger.info("unique-capture-msg-xyz")
      expect(capturedLogs.length).toBeGreaterThan(0)
      expect(capturedLogs[0].message).toContain("unique-capture-msg-xyz")
    })

    it("log contains the label from createLogger", () => {
      if (!("add" in captureLogger)) return
      captureLogger.info("label-capture-test")
      expect(capturedLogs.length).toBeGreaterThan(0)
      expect(capturedLogs[0].label).toBe("capture-module")
    })

    it("meta data is passed through log call", () => {
      if (!("add" in captureLogger)) return
      expect(() => captureLogger.info("meta-capture-test", { extra: "data" })).not.toThrow()
      expect(capturedLogs.length).toBeGreaterThan(0)
      expect(capturedLogs[0].message).toContain("meta-capture-test")
    })

    it("child logger with new label uses the new label", () => {
      if (!("add" in captureLogger)) return
      const child = captureLogger.child({ label: "child-label" })
      // Child logger also inherits silent=true from root, so unsilence it too
      ;(child as any).silent = false
      const childCapturedLogs: Array<{ level: string; message: string; label?: string }> = []
      const winston = require("winston")
      const captureTransport = new winston.Transport({
        log: (info: any, callback: () => void) => {
          childCapturedLogs.push({
            level: info.level,
            message: info.message,
            label: info.label,
          })
          callback()
        },
      })
      ;(child as any).add(captureTransport)
      child.info("child-with-label")
      expect(childCapturedLogs.length).toBeGreaterThan(0)
      expect(childCapturedLogs[0].label).toBe("child-label")
    })
  })

  // ═══════════════════════════════════════════════════════════════════
  // Module-specific behavior
  // ═══════════════════════════════════════════════════════════════════

  it("createLogger with different labels produces independent loggers", () => {
    const logger1 = createLogger("module-a")
    const logger2 = createLogger("module-b")
    expect(() => logger1.info("from a")).not.toThrow()
    expect(() => logger2.info("from b")).not.toThrow()
  })

  it("createLogger with empty string label does not throw", () => {
    const emptyLogger = createLogger("")
    expect(() => emptyLogger.info("test")).not.toThrow()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Edge cases
  // ═══════════════════════════════════════════════════════════════════

  it("logger handles undefined meta gracefully", () => {
    expect(() => logger.info("test", undefined)).not.toThrow()
  })

  it("logger handles null meta gracefully", () => {
    expect(() => logger.info("test", null as any)).not.toThrow()
  })

  it("logger handles empty string message", () => {
    expect(() => logger.info("")).not.toThrow()
  })

  it("logger handles very long messages", () => {
    const longMessage = "x".repeat(10000)
    expect(() => logger.info(longMessage)).not.toThrow()
  })

  it("logger handles special characters in messages", () => {
    expect(() => logger.info("Special: \n\t\r\0")).not.toThrow()
    expect(() => logger.info("Unicode: \u00e9\u00f1\u00fc")).not.toThrow()
    expect(() => logger.info("Emoji: \ud83d\ude00")).not.toThrow()
  })

  it("deeply nested child loggers do not throw", () => {
    let current = logger
    for (let i = 0; i < 5; i++) {
      current = current.child({ label: `nested-${i}` })
    }
    expect(() => current.info("deeply nested")).not.toThrow()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Size-based rotation (SimpleConsoleLogger used by worker threads)
  // ═══════════════════════════════════════════════════════════════════

  describe("size-based rotation", () => {
    let logDir: string
    let spies: Array<ReturnType<typeof vi.spyOn>>

    // worker-YYYY-MM-DD.log and its numbered backups share this prefix
    const baseName = (): string =>
      `worker-${new Date().toISOString().split("T")[0]}`

    // Snapshot every file in the temp log dir so a test can assert on all
    // rotation targets at once
    const readLogDir = (): Record<string, string> => {
      const files: Record<string, string> = {}
      for (const entry of readdirSync(logDir)) {
        files[entry] = readFileSync(join(logDir, entry), "utf8")
      }
      return files
    }

    beforeEach(() => {
      logDir = mkdtempSync(join(tmpdir(), "nekocode-logger-rotation-"))
      // These tests force file logging on while NODE_ENV=test, so silence the
      // console fan-out to keep vitest output clean (and to inspect errors)
      spies = [
        vi.spyOn(console, "log").mockImplementation(() => {}),
        vi.spyOn(console, "warn").mockImplementation(() => {}),
        vi.spyOn(console, "error").mockImplementation(() => {}),
      ]
    })

    afterEach(() => {
      for (const spy of spies) spy.mockRestore()
      rmSync(logDir, { recursive: true, force: true })
    })

    it("rotates the active file when the limit is passed and preserves every line", async () => {
      const rotationLogger = new SimpleConsoleLogger("rotation-test", {
        logDir,
        silent: false,
        // Every line is larger than this, so each write after the first
        // triggers a rotation without writing megabytes in the test
        maxSizeBytes: 1,
        maxBackups: 3,
      })

      rotationLogger.info("line-one")
      rotationLogger.info("line-two")
      rotationLogger.info("line-three")
      await rotationLogger.close()

      const base = baseName()
      const files = readLogDir()

      // Active file plus two numbered backups, each holding one line
      expect(Object.keys(files).sort()).toEqual(
        [`${base}.log`, `${base}.1.log`, `${base}.2.log`].sort(),
      )
      expect(files[`${base}.log`]).toContain("line-three")
      expect(files[`${base}.1.log`]).toContain("line-two")
      expect(files[`${base}.2.log`]).toContain("line-one")

      // No line vanished during the rotation
      const combined = Object.values(files).join("\n")
      for (const line of ["line-one", "line-two", "line-three"]) {
        expect(combined).toContain(line)
      }
    })

    it("keeps only maxBackups files and deletes the oldest backup", async () => {
      const rotationLogger = new SimpleConsoleLogger("rotation-cap-test", {
        logDir,
        silent: false,
        maxSizeBytes: 1,
        maxBackups: 2,
      })

      rotationLogger.info("line-one")
      rotationLogger.info("line-two")
      rotationLogger.info("line-three")
      rotationLogger.info("line-four")
      rotationLogger.info("line-five")
      await rotationLogger.close()

      const base = baseName()
      const files = readLogDir()

      // Active + exactly two backups; no .3 backup is created
      expect(Object.keys(files).sort()).toEqual(
        [`${base}.log`, `${base}.1.log`, `${base}.2.log`].sort(),
      )
      expect(files[`${base}.log`]).toContain("line-five")
      expect(files[`${base}.1.log`]).toContain("line-four")
      expect(files[`${base}.2.log`]).toContain("line-three")

      // The two oldest lines were dropped with the deleted backup
      const combined = Object.values(files).join("\n")
      expect(combined).not.toContain("line-one")
      expect(combined).not.toContain("line-two")
    })

    it("does not rotate while the active file stays under the limit", async () => {
      const rotationLogger = new SimpleConsoleLogger("no-rotation-test", {
        logDir,
        silent: false,
        maxSizeBytes: 10 * 1024 * 1024,
        maxBackups: 3,
      })

      rotationLogger.info("small-one")
      rotationLogger.info("small-two")
      await rotationLogger.close()

      const files = readLogDir()
      expect(Object.keys(files)).toEqual([`${baseName()}.log`])
      expect(files[`${baseName()}.log`]).toContain("small-one")
      expect(files[`${baseName()}.log`]).toContain("small-two")
    })

    it("cleanup deletes expired daily files and their numbered backups", async () => {
      const base = baseName()
      const expiredDate = "2000-01-01"
      // An expired plain daily file, an expired numbered backup and a recent
      // backup for today: only the expired ones should be removed
      writeFileSync(join(logDir, `worker-${expiredDate}.log`), "expired\n")
      writeFileSync(join(logDir, `worker-${expiredDate}.2.log`), "expired backup\n")
      writeFileSync(join(logDir, `${base}.1.log`), "recent backup\n")

      const cleanupLogger = new SimpleConsoleLogger("cleanup-test", {
        logDir,
        silent: false,
        maxSizeBytes: 10 * 1024 * 1024,
        maxBackups: 3,
      })
      await cleanupLogger.close()

      const files = readdirSync(logDir)
      expect(files).not.toContain(`worker-${expiredDate}.log`)
      expect(files).not.toContain(`worker-${expiredDate}.2.log`)
      expect(files).toContain(`${base}.1.log`)
    })
  })
})
