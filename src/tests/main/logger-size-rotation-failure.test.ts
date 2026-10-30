import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import {
  createWriteStream,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
} from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { SimpleConsoleLogger } from "@/main/logger"

// Spy on every fs function so a single failing rotation call can be simulated
// while all other filesystem work still runs against the real module. A plain
// vi.spyOn(fs, ...) would not intercept the named imports logger.ts binds to.
vi.mock("fs", { spy: true })

// Size-rotation failure handling lives in its own file because mocking "fs"
// must be module-scoped: logger.test.ts exercises the real filesystem.
describe("logger size-based rotation failure handling", () => {
  let logDir: string
  let consoleSpies: Array<ReturnType<typeof vi.spyOn>>

  const baseName = (): string =>
    `worker-${new Date().toISOString().split("T")[0]}`

  beforeEach(() => {
    logDir = mkdtempSync(join(tmpdir(), "nekocode-logger-rotation-fail-"))
    // File logging is forced on in NODE_ENV=test, so mute the console fan-out
    // and keep a handle on the error spy for assertions
    consoleSpies = [
      vi.spyOn(console, "log").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
    ]
  })

  afterEach(() => {
    for (const spy of consoleSpies) spy.mockRestore()
    rmSync(logDir, { recursive: true, force: true })
  })

  it("does not throw into callers when a rotation rename fails", async () => {
    // Make the first rename (active file -> .1) blow up like a locked file
    vi.mocked(renameSync).mockImplementationOnce(() => {
      throw new Error("EPERM: operation not permitted")
    })

    const rotationLogger = new SimpleConsoleLogger("rotation-fail-test", {
      logDir,
      silent: false,
      maxSizeBytes: 1,
      maxBackups: 2,
    })

    // Both calls cross the size limit; the second triggers the failing rename.
    // Neither call may throw into the caller.
    expect(() => rotationLogger.info("line-one")).not.toThrow()
    expect(() => rotationLogger.info("line-two")).not.toThrow()
    await rotationLogger.close()

    // Rotation failed, so nothing was renamed: the active file must still hold
    // both lines (no line may be lost because of the filesystem error)
    const activePath = join(logDir, `${baseName()}.log`)
    expect(readdirSync(logDir)).toContain(`${baseName()}.log`)
    const active = readFileSync(activePath, "utf8")
    expect(active).toContain("line-one")
    expect(active).toContain("line-two")

    // The failure is reported to the console instead of being thrown
    expect(console.error).toHaveBeenCalled()
  })

  it("does not throw into callers when unlinking the oldest backup fails", async () => {
    const rotationLogger = new SimpleConsoleLogger("unlink-fail-test", {
      logDir,
      silent: false,
      maxSizeBytes: 1,
      maxBackups: 1,
    })

    rotationLogger.info("line-one")
    rotationLogger.info("line-two")

    // Mock unlinkSync to fail when attempting to delete the oldest backup
    vi.mocked(unlinkSync).mockImplementationOnce(() => {
      throw new Error("EACCES: permission denied")
    })

    expect(() => rotationLogger.info("line-three")).not.toThrow()
    await rotationLogger.close()

    expect(console.error).toHaveBeenCalled()
  })

  it("does not throw into callers when createWriteStream fails", async () => {
    vi.mocked(createWriteStream).mockImplementationOnce(() => {
      throw new Error("EMFILE: too many open files")
    })

    let rotationLogger!: SimpleConsoleLogger
    expect(() => {
      rotationLogger = new SimpleConsoleLogger("stream-fail-test", {
        logDir,
        silent: false,
        maxSizeBytes: 1,
        maxBackups: 2,
      })
    }).not.toThrow()

    expect(() => rotationLogger.info("line-one")).not.toThrow()
    await rotationLogger.close()

    expect(console.error).toHaveBeenCalled()
  })
})
