// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import React from "react"
import { ToolCallGroup } from "@/renderer/src/components/chat/ToolCallSection"

// ── Mock tool-summary ─────────────────────────────────────────────
vi.mock("@/renderer/src/components/chat/tool-summary", () => ({
  extractToolSummary: vi.fn((toolName: string) => {
    const short = toolName.replace(/^toolcall_/, "")
    return `summary-${short}`
  }),
}))

// ── Tests ──────────────────────────────────────────────────────────

describe("ToolCallGroup", () => {
  const baseToolCall = {
    id: "tc-1",
    toolName: "toolcall_bash",
    status: "done" as const,
    isError: false,
    args: { command: "echo hello" },
  }

  // ═══════════════════════════════════════════════════════════════════
  // Rendering - Header
  // ═══════════════════════════════════════════════════════════════════

  it("renders tool call count in header", () => {
    render(
      <ToolCallGroup
        toolCalls={[
          { ...baseToolCall, id: "tc-1" },
          { ...baseToolCall, id: "tc-2" },
          { ...baseToolCall, id: "tc-3" },
        ]}
      />
    )
    expect(screen.getByText("3 tool calls")).toBeTruthy()
  })

  it("renders singular '1 tool call' for a single tool call", () => {
    render(<ToolCallGroup toolCalls={[baseToolCall]} />)
    expect(screen.getByText("1 tool call")).toBeTruthy()
  })

  it("shows running count when tools are running", () => {
    render(
      <ToolCallGroup
        toolCalls={[
          { ...baseToolCall, id: "tc-1", status: "running" },
          { ...baseToolCall, id: "tc-2", status: "done" },
        ]}
      />
    )
    expect(screen.getByText("1 running")).toBeTruthy()
  })

  it("shows done count when no tools are running", () => {
    render(
      <ToolCallGroup
        toolCalls={[
          { ...baseToolCall, id: "tc-1", status: "done" },
          { ...baseToolCall, id: "tc-2", status: "done" },
        ]}
      />
    )
    expect(screen.getByText("2 done")).toBeTruthy()
  })

  it("does not show done count when some tools are still running", () => {
    render(
      <ToolCallGroup
        toolCalls={[
          { ...baseToolCall, id: "tc-1", status: "running" },
          { ...baseToolCall, id: "tc-2", status: "done" },
        ]}
      />
    )
    expect(screen.queryByText(/done/)).toBeNull()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Rendering - Tool Rows
  // ═══════════════════════════════════════════════════════════════════

  it("renders tool names stripped of toolcall_ prefix", () => {
    render(
      <ToolCallGroup
        toolCalls={[{ ...baseToolCall, toolName: "toolcall_read" }]}
      />
    )
    expect(screen.getByText("read")).toBeTruthy()
  })

  it("renders tool summary via extractToolSummary", () => {
    render(
      <ToolCallGroup
        toolCalls={[{ ...baseToolCall, toolName: "toolcall_bash" }]}
      />
    )
    expect(screen.getByText("summary-bash")).toBeTruthy()
  })

  it("renders all tool rows for multiple tool calls", () => {
    render(
      <ToolCallGroup
        toolCalls={[
          { ...baseToolCall, id: "tc-1", toolName: "toolcall_read" },
          { ...baseToolCall, id: "tc-2", toolName: "toolcall_bash" },
        ]}
      />
    )
    expect(screen.getByText("read")).toBeTruthy()
    expect(screen.getByText("bash")).toBeTruthy()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Status Dot Indicators
  // ═══════════════════════════════════════════════════════════════════

  it("shows running indicator (animate-ping) for running tools", () => {
    const { container } = render(
      <ToolCallGroup
        toolCalls={[{ ...baseToolCall, status: "running" }]}
      />
    )
    const ping = container.querySelector(".animate-ping")
    expect(ping).toBeTruthy()
  })

  it("shows error indicator (bg-error) for error tool calls", () => {
    const { container } = render(
      <ToolCallGroup
        toolCalls={[{ ...baseToolCall, status: "done", isError: true }]}
      />
    )
    const errorDot = container.querySelector(".bg-error")
    expect(errorDot).toBeTruthy()
  })

  it("shows success indicator (bg-success) for completed tool calls", () => {
    const { container } = render(
      <ToolCallGroup
        toolCalls={[{ ...baseToolCall, status: "done", isError: false }]}
      />
    )
    const successDot = container.querySelector(".bg-success")
    expect(successDot).toBeTruthy()
  })

  // ═══════════════════════════════════════════════════════════════════
  // Edge Cases
  // ═══════════════════════════════════════════════════════════════════

  it("handles empty toolCalls array", () => {
    render(<ToolCallGroup toolCalls={[]} />)
    expect(screen.getByText("0 tool calls")).toBeTruthy()
  })

  it("handles tool names without toolcall_ prefix", () => {
    render(
      <ToolCallGroup
        toolCalls={[{ ...baseToolCall, toolName: "custom_tool" }]}
      />
    )
    expect(screen.getByText("custom_tool")).toBeTruthy()
  })
})
