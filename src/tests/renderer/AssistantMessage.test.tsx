// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render, screen, act } from "@testing-library/react"
import React from "react"
import { AssistantMessage } from "@/renderer/src/components/chat/AssistantMessage"

// -- Mock MarkdownContent ------------------------------------------------
// MarkdownContent has heavy Shiki dependencies; mock it for unit tests.

const { MockMarkdownContent } = vi.hoisted(() => {
  const MockMarkdownContent = vi.fn(({ content }: { content: string }) => (
    <div data-testid="markdown-content-mock">{content}</div>
  ))
  return { MockMarkdownContent }
})

vi.mock("@/renderer/src/components/chat/MarkdownContent", () => ({
  MarkdownContent: MockMarkdownContent,
}))

// ========================================================================
// Tests
// ========================================================================

describe("AssistantMessage", () => {
  // ======================================================================
  // Streaming mode
  // ======================================================================

  it("renders content in a pre-wrapped monospace paragraph when streaming", () => {
    render(<AssistantMessage content="Thinking..." isStreaming={true} />)
    // Should render the raw text, not via MarkdownContent
    expect(screen.getByText("Thinking...")).toBeInTheDocument()
    expect(MockMarkdownContent).not.toHaveBeenCalled()
  })

  it("shows a glowing cursor span when streaming", () => {
    const { container } = render(
      <AssistantMessage content="Hello" isStreaming={true} />,
    )
    // The cursor is an inline-block span with animate-glow-pulse
    const cursor = container.querySelector(".animate-glow-pulse")
    expect(cursor).toBeInTheDocument()
    expect(cursor?.tagName).toBe("SPAN")
  })

  it("constrains width to 80% max when streaming", () => {
    const { container } = render(
      <AssistantMessage content="Hi" isStreaming={true} />,
    )
    const wrapper = container.firstElementChild
    expect(wrapper?.className).toContain("max-w-[80%]")
  })

  // ======================================================================
  // Non-streaming (markdown) mode
  // ======================================================================

  it("renders via MarkdownContent when not streaming", () => {
    render(<AssistantMessage content="# Hello World" isStreaming={false} />)
    expect(MockMarkdownContent).toHaveBeenCalledWith(
      expect.objectContaining({ content: "# Hello World" }),
      undefined,
    )
  })

  it("does not show the glow cursor when not streaming", () => {
    const { container } = render(
      <AssistantMessage content="Done" isStreaming={false} />,
    )
    const cursor = container.querySelector(".animate-glow-pulse")
    expect(cursor).not.toBeInTheDocument()
  })

  it("constrains width to 80% max when not streaming", () => {
    const { container } = render(
      <AssistantMessage content="Done" isStreaming={false} />,
    )
    const wrapper = container.firstElementChild
    expect(wrapper?.className).toContain("max-w-[80%]")
  })

  it("passes content through to MarkdownContent unaltered", () => {
    const markdown = "some markdown content with **bold**"
    render(<AssistantMessage content={markdown} isStreaming={false} />)
    expect(MockMarkdownContent).toHaveBeenCalledWith(
      expect.objectContaining({ content: markdown }),
      undefined,
    )
  })

  // ======================================================================
  // Copy button (non-streaming mode only)
  // ======================================================================

  it("shows a Copy button when not streaming", () => {
    render(<AssistantMessage content="Hello" isStreaming={false} />)
    const copyButton = screen.getByRole("button", { name: /copy message/i })
    expect(copyButton).toBeInTheDocument()
    expect(copyButton.textContent).toContain("Copy")
  })

  it("does not show a Copy button while streaming", () => {
    render(<AssistantMessage content="Hello" isStreaming={true} />)
    expect(screen.queryByRole("button", { name: /copy message/i })).not.toBeInTheDocument()
  })

  it("copies content to clipboard when Copy button is clicked", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    render(<AssistantMessage content="Copy me!" isStreaming={false} />)
    const copyButton = screen.getByRole("button", { name: /copy message/i })

    await act(async () => {
      copyButton.click()
    })

    expect(writeText).toHaveBeenCalledWith("Copy me!")
  })
})