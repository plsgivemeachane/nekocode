// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import React from "react"
import { ThinkingBlock } from "@/renderer/src/components/chat/ThinkingBlock"

// ── Tests ──────────────────────────────────────────────────────────

describe("ThinkingBlock", () => {
  // ═══════════════════════════════════════════════════════════════════
  // Rendering
  // ═══════════════════════════════════════════════════════════════════

  it("renders the header with 'Thinking' label", () => {
    render(<ThinkingBlock content="test" isStreaming={false} />)
    expect(screen.getByText("Thinking")).toBeTruthy()
  })

  it("renders content when provided", () => {
    render(<ThinkingBlock content="I am thinking about this" isStreaming={false} />)
    expect(screen.getByText("I am thinking about this")).toBeTruthy()
  })

  it("hides content area when content is empty", () => {
    const { container } = render(<ThinkingBlock content="" isStreaming={false} />)
    const contentP = container.querySelector(".whitespace-pre-wrap")
    expect(contentP).toBeNull()
  })

  it("shows line count when collapsed, not streaming, and has content", () => {
    render(<ThinkingBlock content={"line1\nline2\nline3"} isStreaming={false} />)
    expect(screen.getByText("3 lines")).toBeTruthy()
  })

  it("shows singular '1 line' for single line content", () => {
    render(<ThinkingBlock content="single line" isStreaming={false} />)
    expect(screen.getByText("1 line")).toBeTruthy()
  })

  it("does not show line count when streaming", () => {
    render(<ThinkingBlock content={"line1\nline2"} isStreaming={true} />)
    // When streaming, no "X lines" text should appear
    expect(screen.queryByText("2 lines")).toBeNull()
  })

  it("does not show line count when expanded", () => {
    render(<ThinkingBlock content={"line1\nline2"} isStreaming={false} />)
    // Default is collapsed, line count should be visible
    expect(screen.getByText("2 lines")).toBeTruthy()
    // Click to expand
    fireEvent.click(screen.getByText("Thinking"))
    // Line count should now be hidden
    expect(screen.queryByText("2 lines")).toBeNull()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Expand/Collapse
  // ═══════════════════════════════════════════════════════════════════

  it("starts collapsed by default", () => {
    const { container } = render(<ThinkingBlock content="test content" isStreaming={false} />)
    // When collapsed, the content wrapper has overflow-hidden
    const contentWrapper = container.querySelector(".overflow-hidden")
    expect(contentWrapper).toBeTruthy()
  })

  it("expands on header click", () => {
    const { container } = render(<ThinkingBlock content="test content" isStreaming={false} />)
    fireEvent.click(screen.getByText("Thinking"))
    // When expanded, the content wrapper has overflow-y-auto
    const expandedWrapper = container.querySelector(".overflow-y-auto")
    expect(expandedWrapper).toBeTruthy()
  })

  it("collapses on second header click", () => {
    const { container } = render(<ThinkingBlock content="test content" isStreaming={false} />)
    // Click to expand
    fireEvent.click(screen.getByText("Thinking"))
    expect(container.querySelector(".overflow-y-auto")).toBeTruthy()
    // Click again to collapse
    fireEvent.click(screen.getByText("Thinking"))
    expect(container.querySelector(".overflow-hidden")).toBeTruthy()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Streaming
  // ═══════════════════════════════════════════════════════════════════

  it("shows streaming indicator when isStreaming is true", () => {
    render(<ThinkingBlock content="thinking..." isStreaming={true} />)
    const button = screen.getByText("Thinking").closest("button")!
    const pingDot = button.querySelector(".animate-ping")
    expect(pingDot).toBeTruthy()
  })

  it("does not show streaming indicator when isStreaming is false", () => {
    render(<ThinkingBlock content="thinking..." isStreaming={false} />)
    const button = screen.getByText("Thinking").closest("button")!
    const pingDot = button.querySelector(".animate-ping")
    expect(pingDot).toBeNull()
  })

  it("shows cursor animation when streaming", () => {
    const { container } = render(<ThinkingBlock content="thinking..." isStreaming={true} />)
    const cursor = container.querySelector(".animate-glow-pulse")
    expect(cursor).toBeTruthy()
  })

  it("does not show cursor animation when not streaming", () => {
    const { container } = render(<ThinkingBlock content="thinking..." isStreaming={false} />)
    const cursor = container.querySelector(".animate-glow-pulse")
    expect(cursor).toBeNull()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Edge Cases
  // ═══════════════════════════════════════════════════════════════════

  it("handles multiline content correctly", () => {
    const multiline = "step 1\nstep 2\nstep 3\nstep 4\nstep 5"
    render(<ThinkingBlock content={multiline} isStreaming={false} />)
    expect(screen.getByText("5 lines")).toBeTruthy()
  })

  it("updates line count when content changes", () => {
    const { rerender } = render(
      <ThinkingBlock content="line1" isStreaming={false} />
    )
    expect(screen.getByText("1 line")).toBeTruthy()

    rerender(<ThinkingBlock content={"line1\nline2"} isStreaming={false} />)
    expect(screen.getByText("2 lines")).toBeTruthy()
  })

  it("chevron rotates when expanded", () => {
    const { container } = render(
      <ThinkingBlock content="test" isStreaming={false} />
    )
    // Initially collapsed - no rotate-90
    expect(container.querySelector("svg.rotate-90")).toBeNull()

    // Expand
    fireEvent.click(screen.getByText("Thinking"))
    expect(container.querySelector("svg.rotate-90")).toBeTruthy()
  })
})
