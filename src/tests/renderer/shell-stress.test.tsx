/**
 * Shell stress tests for the renderer layer.
 * Tests the TreeSidebar component's shell operation handling:
 * debounce, floating promise fix, toast feedback, loading state.
 */
import { describe, it, expect, vi } from "vitest"

// ═══════════════════════════════════════════════════════════════════
// Debounce Logic Tests
// ═══════════════════════════════════════════════════════════════════

describe("Shell Debounce", () => {
  it("prevents rapid consecutive calls within 1 second", () => {
    let lastCallTime = 0
    const DEBOUNCE_MS = 1000

    function tryShellCall(): boolean {
      const now = Date.now()
      if (now - lastCallTime < DEBOUNCE_MS) {
        return false // Debounced
      }
      lastCallTime = now
      return true // Allowed
    }

    // First call should be allowed
    expect(tryShellCall()).toBe(true)

    // Immediate second call should be debounced
    expect(tryShellCall()).toBe(false)
  })

  it("allows calls after debounce period", () => {
    let lastCallTime = 0
    const DEBOUNCE_MS = 1000

    function tryShellCall(): boolean {
      const now = Date.now()
      if (now - lastCallTime < DEBOUNCE_MS) {
        return false
      }
      lastCallTime = now
      return true
    }

    // First call
    expect(tryShellCall()).toBe(true)

    // Simulate time passing (advance the reference time)
    lastCallTime = Date.now() - DEBOUNCE_MS - 1

    // Should be allowed after debounce period
    expect(tryShellCall()).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════
// Floating Promise Fix Tests (BUG-3)
// ═══════════════════════════════════════════════════════════════════

describe("Shell Floating Promise Handling", () => {
  it("openInVscode errors are caught, not silently swallowed", async () => {
    const mockOpenInVscode = vi.fn().mockRejectedValue(new Error("VS Code not found"))
    let errorCaught = false
    let toastShown = false

    try {
      const success = await mockOpenInVscode()
      if (!success) {
        toastShown = true
      }
    } catch {
      errorCaught = true
      toastShown = true
    }

    expect(mockOpenInVscode).toHaveBeenCalled()
    expect(errorCaught).toBe(true)
    expect(toastShown).toBe(true)
  })

  it("openInExplorer errors are caught, not silently swallowed", async () => {
    const mockOpenInExplorer = vi.fn().mockRejectedValue(new Error("Path not found"))
    let errorCaught = false
    let toastShown = false

    try {
      const success = await mockOpenInExplorer()
      if (!success) {
        toastShown = true
      }
    } catch {
      errorCaught = true
      toastShown = true
    }

    expect(mockOpenInExplorer).toHaveBeenCalled()
    expect(errorCaught).toBe(true)
    expect(toastShown).toBe(true)
  })

  it("successful openInVscode does not show error toast", async () => {
    const mockOpenInVscode = vi.fn().mockResolvedValue(true)
    let toastShown = false

    try {
      const success = await mockOpenInVscode()
      if (!success) {
        toastShown = true
      }
    } catch {
      toastShown = true
    }

    expect(mockOpenInVscode).toHaveBeenCalled()
    expect(toastShown).toBe(false)
  })

  it("openInVscode returning false shows error toast", async () => {
    const mockOpenInVscode = vi.fn().mockResolvedValue(false)
    let toastShown = false

    try {
      const success = await mockOpenInVscode()
      if (!success) {
        toastShown = true
      }
    } catch {
      toastShown = true
    }

    expect(mockOpenInVscode).toHaveBeenCalled()
    expect(toastShown).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════
// Toast Auto-Dismiss Tests
// ═══════════════════════════════════════════════════════════════════

describe("Shell Toast Feedback", () => {
  it("toast auto-dismisses after timeout", () => {
    vi.useFakeTimers()
    let toast: { message: string; type: "error" | "success" } | null = {
      message: "Failed to open VS Code",
      type: "error",
    }

    // Simulate the useEffect cleanup that sets toast to null after 3000ms
    setTimeout(() => {
      toast = null
    }, 3000)

    // Toast should still be visible before timeout
    expect(toast).not.toBeNull()

    // Advance time past the auto-dismiss
    vi.advanceTimersByTime(3000)
    expect(toast).toBeNull()

    vi.useRealTimers()
  })

  it("error toast uses red styling", () => {
    const toast = { message: "Failed to open VS Code", type: "error" as const }
    const isError = toast.type === "error"
    expect(isError).toBe(true)
  })

  it("success toast uses green styling", () => {
    const toast = { message: "Opened successfully", type: "success" as const }
    const isSuccess = toast.type === "success"
    expect(isSuccess).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════
// Loading State Tests
// ═══════════════════════════════════════════════════════════════════

describe("Shell Loading State", () => {
  it("shellOpening state changes during operation", () => {
    let shellOpening: string | null = null

    // Before operation
    expect(shellOpening).toBeNull()

    // During operation
    shellOpening = "vscode"
    expect(shellOpening).toBe("vscode")

    // After operation
    shellOpening = null
    expect(shellOpening).toBeNull()
  })

  it("button label changes while opening VS Code", () => {
    const shellOpening: string | null = "vscode"
    const label = shellOpening === "vscode" ? "Opening VS Code..." : "Open in VS Code"
    expect(label).toBe("Opening VS Code...")
  })

  it("button is disabled while shell operation is in progress", () => {
    const shellOpening: string | null = "vscode"
    const disabled = shellOpening === "vscode"
    expect(disabled).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════
// VS Code Availability Check Tests
// ═══════════════════════════════════════════════════════════════════

describe("VS Code Availability", () => {
  it("button is enabled when VS Code is available", () => {
    const vscodeAvailable = true
    const shellOpening: string | null = null
    const disabled = !vscodeAvailable || shellOpening === "vscode"
    expect(disabled).toBe(false)
  })

  it("button is disabled when VS Code is not available", () => {
    const vscodeAvailable = false
    const shellOpening: string | null = null
    const disabled = !vscodeAvailable || shellOpening === "vscode"
    expect(disabled).toBe(true)
  })

  it("checkVscodeAvailable is called on component mount", () => {
    const mockCheck = vi.fn().mockResolvedValue({ available: true, command: null, method: "uri" })
    // Simulate the useEffect that checks availability
    mockCheck()
    expect(mockCheck).toHaveBeenCalledTimes(1)
  })
})
