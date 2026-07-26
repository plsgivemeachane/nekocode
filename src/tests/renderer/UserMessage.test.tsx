// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react"
import React from "react"
import { UserMessage } from "@/renderer/src/components/chat/UserMessage"

// ========================================================================
// Tests
// ========================================================================

describe("UserMessage", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    // Mock clipboard API since jsdom does not provide one
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ======================================================================
  // Content rendering
  // ======================================================================

  it("renders the message content", () => {
    render(<UserMessage content="Hello, world!" />)
    expect(screen.getByText("Hello, world!")).toBeInTheDocument()
  })

  it("renders content in a sharp rectangle with no border radius (OpenCode TUI style)", () => {
    const { container } = render(<UserMessage content="Hi" />)
    // OpenCode TUI revamp: messages are sharp rectangles (rounded-none), not bubbles.
    // The role panel is the element carrying the content with rounded-none.
    const panel = container.querySelector(".rounded-none")
    expect(panel).toBeInTheDocument()
    expect(panel?.textContent).toContain("Hi")
  })

  it("preserves whitespace with whitespace-pre-wrap", () => {
    const { container } = render(<UserMessage content="line1\nline2" />)
    const panel = container.querySelector(".whitespace-pre-wrap")
    expect(panel).toBeInTheDocument()
  })

  // ======================================================================
  // Copy button
  // ======================================================================

  it("renders a copy button", () => {
    render(<UserMessage content="Copy me" />)
    const copyBtn = screen.getByRole("button", { name: /copy/i })
    expect(copyBtn).toBeInTheDocument()
  })

  it("copies content to clipboard on click", () => {
    render(<UserMessage content="Copy me" />)
    const copyBtn = screen.getByRole("button", { name: /copy/i })
    fireEvent.click(copyBtn)
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Copy me")
  })

  it("shows Copied state after clicking copy", async () => {
    render(<UserMessage content="Copy me" />)
    const copyBtn = screen.getByRole("button", { name: /copy/i })
    fireEvent.click(copyBtn)
    // The button label changes to "Copied" after clipboard.writeText resolves (async)
    expect(await screen.findByRole("button", { name: /copied/i })).toBeInTheDocument()
  })

  it("reverts from Copied back to Copy after timeout", async () => {
    render(<UserMessage content="Copy me" />)
    const copyBtn = screen.getByRole("button", { name: /copy/i })
    fireEvent.click(copyBtn)
    // Wait for the async clipboard.writeText to resolve and state to update
    expect(await screen.findByRole("button", { name: /copied/i })).toBeInTheDocument()
    // Advance past the 1200ms timeout
    act(() => {
      vi.advanceTimersByTime(1300)
    })
    // Should revert to "Copy message"
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /copy message/i })).toBeInTheDocument()
    })
  })

  // ======================================================================
  // Layout & alignment
  // ======================================================================

  it("aligns the message to the left (items-start, OpenCode TUI style)", () => {
    const { container } = render(<UserMessage content="Hi" />)
    const wrapper = container.firstElementChild
    // OpenCode TUI revamp: user messages are left-aligned, not right bubbles.
    expect(wrapper?.className).toContain("items-start")
  })

  it("constrains panel width to 80% max", () => {
    const { container } = render(<UserMessage content="Hi" />)
    const panel = container.querySelector(".max-w-\\[80\\%\\]")
    expect(panel).toBeInTheDocument()
  })
})