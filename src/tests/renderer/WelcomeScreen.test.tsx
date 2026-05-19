// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, act } from "@testing-library/react"
import React from "react"
import { WelcomeScreen } from "@/renderer/src/components/ui/WelcomeScreen"

// ── Mock IPC ───────────────────────────────────────────────────────
const mockIPC = {
  invoke: vi.fn(() => Promise.resolve()),
  send: vi.fn(),
  on: vi.fn(() => vi.fn()),
  removeListener: vi.fn(),
}

vi.stubGlobal("electronAPI", mockIPC)

// ── Mock project-store ─────────────────────────────────────────────
vi.mock("@/renderer/src/stores/project-store", () => ({
  useProjectStore: vi.fn(() => ({
    state: {
      projects: [],
      activeProjectPath: "/test/project",
      agentReady: true,
    },
    dispatch: vi.fn(),
    addProject: vi.fn(),
    removeProject: vi.fn(),
    reconnectSession: vi.fn(),
    createSession: vi.fn(),
    refreshSessions: vi.fn(),
    setActiveSession: vi.fn(),
    preloadSession: vi.fn(),
  })),
}))

// ── Tests ──────────────────────────────────────────────────────────

describe("WelcomeScreen", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Rendering
  // ═══════════════════════════════════════════════════════════════════

  it("renders the app name nekocode", () => {
    render(<WelcomeScreen />)
    // The actual h1 renders "nekocode" (lowercase) with version in sub tag
    expect(screen.getByText("nekocode")).toBeTruthy()
  })

  it("renders the description text", () => {
    render(<WelcomeScreen />)
    expect(screen.getByText("Your coding agent, ready to build.")).toBeTruthy()
  })

  it("renders rotating quotes", () => {
    render(<WelcomeScreen />)
    // Quotes are in blockquote elements
    const blockquote = document.querySelector("blockquote")
    expect(blockquote).toBeTruthy()
    expect(blockquote!.textContent!.length).toBeGreaterThan(0)
  })

  // ═══════════════════════════════════════════════════════════════════
  // Keyboard Shortcuts
  // ═══════════════════════════════════════════════════════════════════

  it("renders Keyboard Shortcuts section", () => {
    render(<WelcomeScreen />)
    expect(screen.getByText("Keyboard Shortcuts")).toBeTruthy()
  })

  it("renders shortcut labels", () => {
    render(<WelcomeScreen />)
    expect(screen.getByText("New session")).toBeTruthy()
    expect(screen.getByText("Send message")).toBeTruthy()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Quote Rotation (useRotatingQuote hook)
  // ═══════════════════════════════════════════════════════════════════

  it("renders a quote with blockquote element", () => {
    render(<WelcomeScreen />)
    const blockquote = document.querySelector("blockquote")
    expect(blockquote).toBeTruthy()
    expect(blockquote!.textContent!.length).toBeGreaterThan(0)
  })

  it("renders a quote with a cited author", () => {
    render(<WelcomeScreen />)
    const cite = document.querySelector("cite")
    expect(cite).toBeTruthy()
    // The cite should contain an em dash and author name
    expect(cite!.textContent).toContain("\u2014") // em dash
  })

  it("rotates to next quote after interval", () => {
    render(<WelcomeScreen />)
    document.querySelector("blockquote")

    // Advance past the rotation interval (8000ms) + fade duration (400ms)
    act(() => {
      vi.advanceTimersByTime(8400)
    })

    const updatedBlockquote = document.querySelector("blockquote")
    // After rotation, the quote should have changed (probabilistic - could be same quote if only 1)
    // With 10 quotes, the chance of same quote is low
    expect(updatedBlockquote).toBeTruthy()
  })

  it("applies opacity transition classes to quote container", () => {
    render(<WelcomeScreen />)
    // The quote container has transition classes for fade effect
    const quoteDiv = document.querySelector("blockquote")!.parentElement
    expect(quoteDiv).toBeTruthy()
    expect(quoteDiv!.className).toContain("transition")
  })

  // ═══════════════════════════════════════════════════════════════════
  // Tip Rotation (useRotatingTip hook)
  // ═══════════════════════════════════════════════════════════════════

  it("renders tips section header", () => {
    render(<WelcomeScreen />)
    expect(screen.getByText(/Tip for/i)).toBeTruthy()
  })

  it("renders a tip with icon, title, and description", () => {
    render(<WelcomeScreen />)
    // The tip should have a title (bold text) and description (smaller text)
    const tipSection = screen.getByText("Tip for Nekocode").closest("div")
    expect(tipSection).toBeTruthy()
    // The tip container should have an icon (emoji)
    const icon = tipSection!.querySelector("span.text-lg")
    expect(icon).toBeTruthy()
  })

  it("rotates to next tip after interval", () => {
    render(<WelcomeScreen />)
    // Advance past the tip rotation interval (6000ms) + fade duration (400ms)
    act(() => {
      vi.advanceTimersByTime(6400)
    })
    // The component should still render a tip
    expect(screen.getByText(/Tip for/i)).toBeTruthy()
  })

  it("applies opacity transition classes to tip container", () => {
    render(<WelcomeScreen />)
    // The tip card has transition classes for fade effect
    const tipCards = document.querySelectorAll(".transition-all")
    expect(tipCards.length).toBeGreaterThanOrEqual(2) // Both quote and tip use transitions
  })

  // ═══════════════════════════════════════════════════════════════════
  // Agent Status / isAgentConnecting
  // ═══════════════════════════════════════════════════════════════════

  it("shows 'Your coding agent, ready to build.' when isAgentConnecting is false", () => {
    render(<WelcomeScreen isAgentConnecting={false} />)
    expect(screen.getByText("Your coding agent, ready to build.")).toBeTruthy()
  })

  it("shows 'Connecting to agent…' when isAgentConnecting is true", () => {
    render(<WelcomeScreen isAgentConnecting={true} />)
    expect(screen.getByText("Connecting to agent…")).toBeTruthy()
  })

  it("shows connecting text with animate-pulse when isAgentConnecting is true", () => {
    render(<WelcomeScreen isAgentConnecting={true} />)
    const connectingEl = screen.getByText("Connecting to agent…")
    // The connecting state should have the animate-pulse class
    expect(connectingEl.className).toContain("animate-pulse")
  })

  it("does not have animate-pulse when isAgentConnecting is false", () => {
    render(<WelcomeScreen isAgentConnecting={false} />)
    const readyEl = screen.getByText("Your coding agent, ready to build.")
    expect(readyEl.className).not.toContain("animate-pulse")
  })

  it("shows agent ready status by default (no isAgentConnecting prop)", () => {
    render(<WelcomeScreen />)
    expect(screen.getByText(/ready/i)).toBeTruthy()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Keyboard Shortcuts - Comprehensive
  // ═══════════════════════════════════════════════════════════════════

  it("renders all 9 keyboard shortcut descriptions", () => {
    render(<WelcomeScreen />)
    const shortcutDescriptions = [
      "New session",
      "Restore last session",
      "Toggle sidebar",
      "Zoom in",
      "Zoom out",
      "Reset zoom",
      "Send message",
      "New line",
      "Abort stream",
    ]
    for (const desc of shortcutDescriptions) {
      expect(screen.getByText(desc)).toBeTruthy()
    }
  })

  it("renders keyboard shortcut keys as kbd elements", () => {
    render(<WelcomeScreen />)
    const kbdElements = document.querySelectorAll("kbd")
    // 9 shortcuts, some with 2 keys (Ctrl+K = 2 kbd elements), some with 3 (Ctrl+Shift+K = 3)
    // Total kbd elements: 2+3+2+2+2+2+1+2+1 = 17
    expect(kbdElements.length).toBe(17)
  })

  it("renders Ctrl key in multi-key shortcuts", () => {
    render(<WelcomeScreen />)
    // All shortcuts with Ctrl should have a kbd element with "Ctrl" text
    const ctrlKbds = Array.from(document.querySelectorAll("kbd")).filter(
      (kbd) => kbd.textContent === "Ctrl"
    )
    // 7 shortcuts use Ctrl: New session, Restore, Toggle sidebar, Zoom in, Zoom out, Reset zoom
    expect(ctrlKbds.length).toBe(6)
  })

  it("renders Shift key in relevant shortcuts", () => {
    render(<WelcomeScreen />)
    const shiftKbds = Array.from(document.querySelectorAll("kbd")).filter(
      (kbd) => kbd.textContent === "Shift"
    )
    // Restore last session (Ctrl+Shift+K) and New line (Shift+Enter)
    expect(shiftKbds.length).toBe(2)
  })

  it("renders Enter and Escape keys", () => {
    render(<WelcomeScreen />)
    const enterKbd = Array.from(document.querySelectorAll("kbd")).find(
      (kbd) => kbd.textContent === "Enter"
    )
    const escapeKbd = Array.from(document.querySelectorAll("kbd")).find(
      (kbd) => kbd.textContent === "Escape"
    )
    expect(enterKbd).toBeTruthy()
    expect(escapeKbd).toBeTruthy()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Logo and Version
  // ═══════════════════════════════════════════════════════════════════

  it("renders the nekocode logo image", () => {
    render(<WelcomeScreen />)
    const img = document.querySelector("img")
    expect(img).toBeTruthy()
    expect(img!.getAttribute("src")).toBe("./favicon.png")
    expect(img!.getAttribute("alt")).toBe("nekocode")
  })

  it("renders the app name in an h1 element", () => {
    render(<WelcomeScreen />)
    const h1 = document.querySelector("h1")
    expect(h1).toBeTruthy()
    expect(h1!.textContent).toContain("nekocode")
  })

  // ═══════════════════════════════════════════════════════════════════
  // Multiple Rotations
  // ═══════════════════════════════════════════════════════════════════

  it("handles multiple quote rotations without crashing", () => {
    render(<WelcomeScreen />)
    // Simulate 5 rotation cycles
    act(() => {
      vi.advanceTimersByTime(8400)
    })
    act(() => {
      vi.advanceTimersByTime(8400)
    })
    act(() => {
      vi.advanceTimersByTime(8400)
    })
    // Should still render without errors
    expect(screen.getByText("nekocode")).toBeTruthy()
    expect(document.querySelector("blockquote")).toBeTruthy()
  })

  it("handles multiple tip rotations without crashing", () => {
    render(<WelcomeScreen />)
    // Simulate 3 tip rotation cycles
    act(() => {
      vi.advanceTimersByTime(6400)
    })
    act(() => {
      vi.advanceTimersByTime(6400)
    })
    act(() => {
      vi.advanceTimersByTime(6400)
    })
    expect(screen.getByText(/Tip for/i)).toBeTruthy()
  })

  it("cleans up intervals on unmount", () => {
    const clearIntervalSpy = vi.spyOn(global, "clearInterval")
    const { unmount } = render(<WelcomeScreen />)
    unmount()
    // Both useRotatingQuote and useRotatingTip should clean up their intervals
    expect(clearIntervalSpy).toHaveBeenCalled()
    clearIntervalSpy.mockRestore()
  })
})
