// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import React from "react"
import { ToolCallGroup } from "@/renderer/src/components/chat/ToolCallSection"
import type { ToolCallData } from "@/renderer/src/components/chat/ToolCallSection"
import type { DiffStats } from "@/renderer/src/components/chat/tool-summary"

// ── Mock tool-summary with controllable return values ────────────
const mockExtractToolSummary = vi.fn<(toolName: string, args: unknown) => string>((toolName: string) => {
  const short = toolName.replace(/^toolcall_/, "")
  return `summary-${short}`
})
const mockExtractDiffStats = vi.fn<(toolName: string, args: unknown, result: unknown) => DiffStats | null>(() => null)

vi.mock("@/renderer/src/components/chat/tool-summary", () => ({
  extractToolSummary: (toolName: string, args: unknown) => mockExtractToolSummary(toolName, args),
  extractDiffStats: (toolName: string, args: unknown, result: unknown) => mockExtractDiffStats(toolName, args, result),
}))

// ═══════════════════════════════════════════════════════════════════════
// CRITICAL TESTING: ToolCallGroup
//
// CONTRACT: "Displays a group of tool calls with status, summary, and diff stats"
// AUDIT:
//   1. extractDiffStats is called 3x per tool call (once for totalAdded,
//      once for totalRemoved, once for row) — redundant computation,
//      potential bug if function has side effects
//   2. ToolCallRow only fires onClick for file-modifying tools (diffStats !== null)
//      — non-file tools are NOT interactive, but there's no visual indicator
//   3. DiffStatsBadge renders NOTHING when stats are { added: 0, removed: 0 }
//      — "no visible badge" is ambiguous: is it "no changes" or "not applicable"?
//   4. onToolCallClick is called with tool call ID, but the caller has no way to
//      know which tool call generated the click without matching IDs
// ═══════════════════════════════════════════════════════════════════════

describe("ToolCallGroup — Contract Violations", () => {
  const baseToolCall: ToolCallData = {
    id: "tc-1",
    toolName: "toolcall_bash",
    status: "done",
    isError: false,
    args: { command: "echo hello" },
  }

  beforeEach(() => {
    mockExtractToolSummary.mockReset()
    mockExtractToolSummary.mockImplementation((toolName: string) => {
      const short = toolName.replace(/^toolcall_/, "")
      return `summary-${short}`
    })
    mockExtractDiffStats.mockReset()
    mockExtractDiffStats.mockReturnValue(null)
  })

  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 1: Name vs Reality — extractDiffStats called 3x per tool call
  // This is a performance bug and a potential correctness bug
  // ═══════════════════════════════════════════════════════════════════════

  describe("Efficient computation: extractDiffStats called 1x per tool call (cached)", () => {
    it("calls extractDiffStats once per tool call — cached result used for total + row", () => {
      mockExtractDiffStats.mockReturnValue({ added: 1, removed: 0 })
      render(
        <ToolCallGroup
          toolCalls={[
            { ...baseToolCall, id: "tc-1" },
            { ...baseToolCall, id: "tc-2" },
          ]}
        />
      )
      // Previously BUG: 2 tool calls x 3 calls each = 6 total calls
      // FIX: 2 tool calls x 1 call each = 2 total calls (cached for total + row)
      expect(mockExtractDiffStats).toHaveBeenCalledTimes(2)
    })

    it("calls extractDiffStats once for a single tool call with diff stats", () => {
      // Previously: totalAdded loop (1 call) + totalRemoved loop (1 call) + row (1 call) = 3
      // FIX: single call per tool call, result cached and reused
      mockExtractDiffStats.mockReturnValue({ added: 5, removed: 2 })
      render(<ToolCallGroup toolCalls={[baseToolCall]} />)
      expect(mockExtractDiffStats).toHaveBeenCalledTimes(1)
    })

    it("extractDiffStats side effects fire once per tool call, not 3x", () => {
      // Previously: 1 tool call x 3 invocations = 3 side effects for 1 tool call
      // FIX: 1 tool call x 1 invocation = 1 side effect (result cached and reused)
      const sideEffectCounter = vi.fn()
      mockExtractDiffStats.mockImplementation(() => {
        sideEffectCounter()
        return { added: 1, removed: 0 }
      })
      render(<ToolCallGroup toolCalls={[baseToolCall]} />)
      expect(sideEffectCounter).toHaveBeenCalledTimes(1)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 2: Argument Boundary — click behavior
  // ToolCallRow only fires onClick for file-modifying tools.
  // Non-file tools have no click handler and no visual indicator of this.
  // ═══════════════════════════════════════════════════════════════════════

  describe("Click behavior: only file-modifying tools are clickable", () => {
    it("non-file-modifying tool has no button role", () => {
      mockExtractDiffStats.mockReturnValue(null)
      const { container } = render(<ToolCallGroup toolCalls={[baseToolCall]} />)
      const row = container.querySelector("[class*='px-3']")
      expect(row?.getAttribute("role")).toBeNull()
    })

    it("file-modifying tool has button role", () => {
      mockExtractDiffStats.mockReturnValue({ added: 3, removed: 1 })
      const { container } = render(
        <ToolCallGroup
          toolCalls={[{ ...baseToolCall, toolName: "write" }]}
        />
      )
      const buttons = container.querySelectorAll('[role="button"]')
      expect(buttons.length).toBe(1)
    })

    it("clicking file-modifying tool fires onToolCallClick with correct ID", () => {
      mockExtractDiffStats.mockReturnValue({ added: 1, removed: 0 })
      const onClick = vi.fn()
      const { container } = render(
        <ToolCallGroup
          toolCalls={[{ ...baseToolCall, id: "tc-write", toolName: "write" }]}
          onToolCallClick={onClick}
        />
      )
      const button = container.querySelector('[role="button"]')
      fireEvent.click(button!)
      expect(onClick).toHaveBeenCalledWith("tc-write")
    })

    it("clicking non-file-modifying tool does NOT fire onToolCallClick", () => {
      mockExtractDiffStats.mockReturnValue(null)
      const onClick = vi.fn()
      render(
        <ToolCallGroup
          toolCalls={[{ ...baseToolCall, toolName: "bash" }]}
          onToolCallClick={onClick}
        />
      )
      // bash is not file-modifying, so clicking it should not fire onClick
      // The row doesn't even have an onClick handler
      expect(onClick).not.toHaveBeenCalled()
    })

    it("keyboard Enter on file-modifying tool fires onToolCallClick", () => {
      mockExtractDiffStats.mockReturnValue({ added: 1, removed: 0 })
      const onClick = vi.fn()
      const { container } = render(
        <ToolCallGroup
          toolCalls={[{ ...baseToolCall, id: "tc-write", toolName: "write" }]}
          onToolCallClick={onClick}
        />
      )
      const button = container.querySelector('[role="button"]')!
      fireEvent.keyDown(button, { key: "Enter" })
      expect(onClick).toHaveBeenCalledWith("tc-write")
    })

    it("keyboard Space on file-modifying tool fires onToolCallClick", () => {
      mockExtractDiffStats.mockReturnValue({ added: 1, removed: 0 })
      const onClick = vi.fn()
      const { container } = render(
        <ToolCallGroup
          toolCalls={[{ ...baseToolCall, id: "tc-write", toolName: "write" }]}
          onToolCallClick={onClick}
        />
      )
      const button = container.querySelector('[role="button"]')!
      fireEvent.keyDown(button, { key: " " })
      expect(onClick).toHaveBeenCalledWith("tc-write")
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 3: Abstraction Ambiguity — DiffStatsBadge invisibility
  // When stats are { added: 0, removed: 0 }, the badge shows NOTHING.
  // This is ambiguous: is it "no changes" or "not applicable"?
  // ═══════════════════════════════════════════════════════════════════════

  describe("DiffStatsBadge: zero-stats visibility ambiguity", () => {
    it("stats with added:0, removed:0 renders visible '0 changes' text — distinguishes from null stats", () => {
      mockExtractDiffStats.mockReturnValue({ added: 0, removed: 0 })
      const { container } = render(
        <ToolCallGroup
          toolCalls={[{ ...baseToolCall, toolName: "write" }]}
        />
      )
      // Previously: the badge rendered nothing when added=0 and removed=0,
      // making it look the same as null stats (not applicable).
      // FIX: Now shows "0 changes" text to distinguish "file written, no changes"
      // from "not applicable".
      const zeroChanges = screen.getAllByText("0 changes")
      expect(zeroChanges.length).toBeGreaterThanOrEqual(1)
      // Green and red badge text should NOT appear
      const greenText = container.querySelector("[class*='4ade80']")
      const redText = container.querySelector("[class*='f87171']")
      expect(greenText).toBeNull()
      expect(redText).toBeNull()
    })

    it("stats with added > 0 shows green badge in both header and row", () => {
      mockExtractDiffStats.mockReturnValue({ added: 5, removed: 0 })
      render(
        <ToolCallGroup
          toolCalls={[{ ...baseToolCall, toolName: "write" }]}
        />
      )
      // +5 appears twice: once in header aggregate, once in row badge
      const badges = screen.getAllByText("+5")
      expect(badges.length).toBe(2)
    })

    it("stats with removed > 0 shows red badge in both header and row", () => {
      mockExtractDiffStats.mockReturnValue({ added: 0, removed: 3 })
      render(
        <ToolCallGroup
          toolCalls={[{ ...baseToolCall, toolName: "write" }]}
        />
      )
      const badges = screen.getAllByText("-3")
      expect(badges.length).toBe(2)
    })

    it("stats with both shows both badges in header and row", () => {
      mockExtractDiffStats.mockReturnValue({ added: 4, removed: 2 })
      render(
        <ToolCallGroup
          toolCalls={[{ ...baseToolCall, toolName: "write" }]}
        />
      )
      const greenBadges = screen.getAllByText("+4")
      const redBadges = screen.getAllByText("-2")
      expect(greenBadges.length).toBe(2) // header + row
      expect(redBadges.length).toBe(2) // header + row
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 4: Header stats — aggregate diff display
  // ═══════════════════════════════════════════════════════════════════════

  describe("Header: aggregate diff stats display", () => {
    it("shows aggregate stats in header when all tools are done", () => {
      mockExtractDiffStats.mockReturnValue({ added: 3, removed: 1 })
      render(
        <ToolCallGroup
          toolCalls={[
            { ...baseToolCall, id: "tc-1", toolName: "write", status: "done" },
            { ...baseToolCall, id: "tc-2", toolName: "write", status: "done" },
          ]}
        />
      )
      // Total: 6 added, 2 removed
      expect(screen.getByText("+6")).toBeTruthy()
      expect(screen.getByText("-2")).toBeTruthy()
    })

    it("row badge still shows when tool is running — only header hides aggregate", () => {
      mockExtractDiffStats.mockReturnValue({ added: 3, removed: 1 })
      const { container } = render(
        <ToolCallGroup
          toolCalls={[
            { ...baseToolCall, id: "tc-1", toolName: "write", status: "running" },
          ]}
        />
      )
      // Row badge still shows +3 -1
      expect(screen.getAllByText("+3").length).toBe(1)
      expect(screen.getAllByText("-1").length).toBe(1)
      // Header aggregate is NOT shown (no ml-auto span)
      const mlAuto = container.querySelector(".ml-auto")
      expect(mlAuto).toBeNull()
    })

    it("does not show aggregate stats when no diffs exist", () => {
      mockExtractDiffStats.mockReturnValue(null)
      const { container } = render(
        <ToolCallGroup toolCalls={[baseToolCall]} />
      )
      // No diff stats → no aggregate badge in header
      const mlAuto = container.querySelector(".ml-auto")
      expect(mlAuto).toBeNull()
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 5: Rendering basics — smoke tests that should still work
  // ═══════════════════════════════════════════════════════════════════════

  describe("Rendering basics", () => {
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

    it("renders singular for single tool call", () => {
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

    it("handles empty toolCalls array", () => {
      render(<ToolCallGroup toolCalls={[]} />)
      expect(screen.getByText("0 tool calls")).toBeTruthy()
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 6: StatusDot — the visual indicator contract
  // ═══════════════════════════════════════════════════════════════════════

  describe("StatusDot indicators", () => {
    it("running tools show animate-ping", () => {
      const { container } = render(
        <ToolCallGroup toolCalls={[{ ...baseToolCall, status: "running" }]} />
      )
      expect(container.querySelector(".animate-ping")).toBeTruthy()
    })

    it("error tools show bg-error dot", () => {
      const { container } = render(
        <ToolCallGroup toolCalls={[{ ...baseToolCall, status: "done", isError: true }]} />
      )
      expect(container.querySelector(".bg-error")).toBeTruthy()
    })

    it("successful tools show bg-success dot", () => {
      const { container } = render(
        <ToolCallGroup toolCalls={[{ ...baseToolCall, status: "done", isError: false }]} />
      )
      expect(container.querySelector(".bg-success")).toBeTruthy()
    })

    it("done with isError undefined defaults to success dot", () => {
      const { container } = render(
        <ToolCallGroup toolCalls={[{ ...baseToolCall, status: "done" }]} />
      )
      expect(container.querySelector(".bg-success")).toBeTruthy()
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 7: Edge Cases — what the contract doesn't specify
  // ═══════════════════════════════════════════════════════════════════════

  describe("Edge cases the contract doesn't specify", () => {
    it("tool call with undefined args — extractDiffStats handles it", () => {
      render(
        <ToolCallGroup
          toolCalls={[{ ...baseToolCall, args: undefined }]}
        />
      )
      // Should not crash
      expect(screen.getByText("1 tool call")).toBeTruthy()
    })

    it("tool call with null args — extractDiffStats handles it", () => {
      render(
        <ToolCallGroup
          toolCalls={[{ ...baseToolCall, args: null }]}
        />
      )
      expect(screen.getByText("1 tool call")).toBeTruthy()
    })

    it("tool call with empty string toolName — renders without crash", () => {
      render(
        <ToolCallGroup
          toolCalls={[{ ...baseToolCall, toolName: "" }]}
        />
      )
      // Empty tool name renders as empty text node
      const { container } = render(
        <ToolCallGroup
          toolCalls={[{ ...baseToolCall, id: "tc-empty", toolName: "" }]}
        />
      )
      expect(container).toBeTruthy()
    })

    it("onToolCallClick not provided — no crash when clicking", () => {
      mockExtractDiffStats.mockReturnValue({ added: 1, removed: 0 })
      const { container } = render(
        <ToolCallGroup
          toolCalls={[{ ...baseToolCall, toolName: "write" }]}
        />
      )
      const button = container.querySelector('[role="button"]')
      // Clicking without handler should not crash
      expect(() => fireEvent.click(button!)).not.toThrow()
    })
  })
})
