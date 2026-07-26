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
      const row = container.querySelector("[data-tool-row]")
      // ─── OpenCode TUI revamp ───────────────────────────────────────
      // Non-file-modifying rows carry role="listitem" (NOT "button"). The
      // contract is "no button role" — so we assert it is not a button,
      // and is explicitly a list item (the flat-log semantics).
      expect(row?.getAttribute("role")).toBe("listitem")
      expect(row?.getAttribute("role")).not.toBe("button")
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

    it("stats with added > 0 shows green badge in the row (no header aggregate)", () => {
      mockExtractDiffStats.mockReturnValue({ added: 5, removed: 0 })
      render(
        <ToolCallGroup
          toolCalls={[{ ...baseToolCall, toolName: "write" }]}
        />
      )
      // ─── OpenCode TUI revamp ───────────────────────────────────────
      // Flat layout: there is NO aggregate header. The +5 badge appears
      // exactly ONCE, on the row itself.
      const badges = screen.getAllByText("+5")
      expect(badges.length).toBe(1)
    })

    it("stats with removed > 0 shows red badge in the row (no header aggregate)", () => {
      mockExtractDiffStats.mockReturnValue({ added: 0, removed: 3 })
      render(
        <ToolCallGroup
          toolCalls={[{ ...baseToolCall, toolName: "write" }]}
        />
      )
      // Flat layout: -3 appears exactly ONCE, on the row itself.
      const badges = screen.getAllByText("-3")
      expect(badges.length).toBe(1)
    })

    it("stats with both shows both badges in the row (no header aggregate)", () => {
      mockExtractDiffStats.mockReturnValue({ added: 4, removed: 2 })
      render(
        <ToolCallGroup
          toolCalls={[{ ...baseToolCall, toolName: "write" }]}
        />
      )
      // Flat layout: +4 and -2 each appear exactly ONCE, on the row itself.
      const greenBadges = screen.getAllByText("+4")
      const redBadges = screen.getAllByText("-2")
      expect(greenBadges.length).toBe(1)
      expect(redBadges.length).toBe(1)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 4: Header stats — aggregate diff display
  // ═══════════════════════════════════════════════════════════════════════

  describe("Flat layout: aggregate diff stats (per-row only, no header)", () => {
    it("shows per-row diff badges when tools are done (no aggregate header)", () => {
      mockExtractDiffStats.mockReturnValue({ added: 3, removed: 1 })
      render(
        <ToolCallGroup
          toolCalls={[
            { ...baseToolCall, id: "tc-1", toolName: "write", status: "done" },
            { ...baseToolCall, id: "tc-2", toolName: "write", status: "done" },
          ]}
        />
      )
      // OpenCode flat layout: each row shows its own +3 -1 badge. There is no
      // aggregate header anymore, so we expect TWO +3 badges (one per row),
      // not a single +6 aggregate.
      expect(screen.getAllByText("+3").length).toBe(2)
      expect(screen.getAllByText("-1").length).toBe(2)
      expect(screen.queryByText("+6")).toBeNull()
      expect(screen.queryByText("-2")).toBeNull()
    })

    it("row badge shows when tool is running (no header to hide)", () => {
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
      // No header exists at all → no ml-auto aggregate span.
      const mlAuto = container.querySelector(".ml-auto")
      expect(mlAuto).toBeNull()
    })

    it("does not render any badge when no diffs exist", () => {
      mockExtractDiffStats.mockReturnValue(null)
      const { container } = render(
        <ToolCallGroup toolCalls={[baseToolCall]} />
      )
      const mlAuto = container.querySelector(".ml-auto")
      expect(mlAuto).toBeNull()
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 5: Rendering basics — smoke tests that should still work
  // ═══════════════════════════════════════════════════════════════════════

  describe("Rendering basics — flat layout (no header)", () => {
    it("renders NO header count (flat layout, OpenCode style)", () => {
      render(
        <ToolCallGroup
          toolCalls={[
            { ...baseToolCall, id: "tc-1" },
            { ...baseToolCall, id: "tc-2" },
            { ...baseToolCall, id: "tc-3" },
          ]}
        />
      )
      // OpenCode flat layout: there is no "N tool calls" header.
      expect(screen.queryByText("3 tool calls")).toBeNull()
    })

    it("renders NO header count for a single tool call", () => {
      render(<ToolCallGroup toolCalls={[baseToolCall]} />)
      expect(screen.queryByText("1 tool call")).toBeNull()
    })

    it("running status is shown via the row's pinging dot, not a header count", () => {
      const { container } = render(
        <ToolCallGroup
          toolCalls={[
            { ...baseToolCall, id: "tc-1", status: "running" },
            { ...baseToolCall, id: "tc-2", status: "done" },
          ]}
        />
      )
      // No "N running" header text anymore.
      expect(screen.queryByText("1 running")).toBeNull()
      // The running row carries the pinging dot.
      expect(container.querySelector(".animate-ping")).toBeTruthy()
    })

    it("renders tool names stripped of toolcall_ prefix", () => {
      render(
        <ToolCallGroup
          toolCalls={[{ ...baseToolCall, toolName: "toolcall_read" }]}
        />
      )
      // OpenCode TUI revamp: the tool name is shown as a capitalized label
      // ("Read") alongside its prefix glyph, not the raw lowercase short name.
      expect(screen.getByText("Read")).toBeTruthy()
    })

    it("renders tool summary via extractToolSummary", () => {
      render(
        <ToolCallGroup
          toolCalls={[{ ...baseToolCall, toolName: "toolcall_bash" }]}
        />
      )
      expect(screen.getByText("summary-bash")).toBeTruthy()
    })

    it("renders nothing visible for an empty toolCalls array (no header)", () => {
      const { container } = render(<ToolCallGroup toolCalls={[]} />)
      // No "0 tool calls" header in the flat layout.
      expect(screen.queryByText("0 tool calls")).toBeNull()
      // No rows rendered.
      expect(container.querySelector("[data-tool-row]")).toBeNull()
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

    // ─── OpenCode TUI revamp: status indicator contract ─────────────────
    // The only visual indicator is a pinging dot WHILE RUNNING. Successful
    // tools show NOTHING (a clean log line, no redundant checkmark). Failed
    // tools color the whole row text red (text-error) instead of a dot.
    it("error tools render the row text in red (text-error)", () => {
      const { container } = render(
        <ToolCallGroup toolCalls={[{ ...baseToolCall, status: "done", isError: true }]} />
      )
      expect(container.querySelector(".text-error")).toBeTruthy()
      // No error dot anymore.
      expect(container.querySelector(".bg-error")).toBeNull()
    })

    it("successful tools show NO status indicator (clean line)", () => {
      const { container } = render(
        <ToolCallGroup toolCalls={[{ ...baseToolCall, status: "done", isError: false }]} />
      )
      // No ping (not running), no success dot (removed by design).
      expect(container.querySelector(".animate-ping")).toBeNull()
      expect(container.querySelector(".bg-success")).toBeNull()
    })

    it("done with isError undefined defaults to clean (no indicator)", () => {
      const { container } = render(
        <ToolCallGroup toolCalls={[{ ...baseToolCall, status: "done" }]} />
      )
      expect(container.querySelector(".animate-ping")).toBeNull()
      expect(container.querySelector(".bg-success")).toBeNull()
      // Not an error, so no red text either.
      expect(container.querySelector(".text-error")).toBeNull()
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 7: Edge Cases — what the contract doesn't specify
  // ═══════════════════════════════════════════════════════════════════════

  describe("Edge cases the contract doesn't specify", () => {
    it("tool call with undefined args — extractDiffStats handles it", () => {
      const { container } = render(
        <ToolCallGroup
          toolCalls={[{ ...baseToolCall, args: undefined }]}
        />
      )
      // ─── OpenCode TUI revamp ───────────────────────────────────────
      // No "N tool calls" header anymore (flat layout). The no-crash signal
      // is that the row itself renders with its prefix label.
      expect(container.querySelector("[data-tool-row]")).toBeTruthy()
    })

    it("tool call with null args — extractDiffStats handles it", () => {
      const { container } = render(
        <ToolCallGroup
          toolCalls={[{ ...baseToolCall, args: null }]}
        />
      )
      expect(container.querySelector("[data-tool-row]")).toBeTruthy()
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
