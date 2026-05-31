// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import React from "react"
import { ActivityRail } from "@/renderer/src/components/chat/ActivityRail"
import type { ChatMessage } from "@/renderer/src/types/chat"
import type { SessionDiffViewProps } from "@/renderer/src/components/chat/SessionDiffView"

// ── Mock SessionDiffView ────────────────────────────────────────
const mockSessionDiffView = vi.fn<(props: SessionDiffViewProps) => React.ReactElement>(() => <div data-testid="session-diff-view" />)
vi.mock("@/renderer/src/components/chat/SessionDiffView", () => ({
  SessionDiffView: (props: SessionDiffViewProps) => mockSessionDiffView(props),
}))

// ── Mock tool-summary ───────────────────────────────────────────
// Use REAL extractDiffStats for buildDiffEntries tests — that's where bugs hide
vi.mock("@/renderer/src/components/chat/tool-summary", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/renderer/src/components/chat/tool-summary")>()
  return {
    extractToolSummary: vi.fn(() => "summary"),
    extractDiffStats: actual.extractDiffStats,
  }
})

// Helper to get last mock call props with proper typing
function getLastCallProps(): SessionDiffViewProps {
  const calls = mockSessionDiffView.mock.calls
  return calls[calls.length - 1][0]
}

// ═══════════════════════════════════════════════════════════════════════
// CRITICAL TESTING: ActivityRail
//
// CONTRACT: "Collapsible side panel that shows diffs for tool call results"
// AUDIT:
//   1. Name says "ActivityRail" but it only shows FILE CHANGES, not all activity
//   2. buildDiffEntries silently drops tool calls that don't match its criteria
//   3. Escape handler is on window — what if multiple rails exist?
//   4. scrollIntoView — REMOVED: Scrolling is now handled by SessionDiffView
//      internally via react-virtuoso's scrollToIndex
//   5. selectedToolCallId="" is truthy — would try to scroll to id="diff-entry-"
// ═══════════════════════════════════════════════════════════════════════

describe("ActivityRail — Contract Violations", () => {
  beforeEach(() => {
    mockSessionDiffView.mockReset()
    mockSessionDiffView.mockImplementation(() => <div data-testid="session-diff-view" />)
  })

  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 1: Name vs Reality
  // "ActivityRail" implies ALL activity, but it only shows write/edit diffs
  // ═══════════════════════════════════════════════════════════════════════

  describe("Name vs Reality: ActivityRail is NOT an activity rail", () => {
    it("shows no entries for bash/read/powershell tool calls — these ARE activity", () => {
      const messages: ChatMessage[] = [
        { role: "assistant", type: "tool_call", toolName: "bash", toolId: "t1", args: { command: "ls" }, status: "done", id: "m1" },
        { role: "assistant", type: "tool_call", toolName: "read", toolId: "t2", args: { path: "/f" }, status: "done", id: "m2" },
        { role: "assistant", type: "tool_call", toolName: "powershell", toolId: "t3", args: { command: "dir" }, status: "done", id: "m3" },
      ]
      render(<ActivityRail isOpen={true} onClose={() => {}} messages={messages} selectedToolCallId={null} />)

      // SessionDiffView is called but with empty entries
      expect(getLastCallProps().entries).toEqual([])
      // CONTRACT VIOLATION: The name says "Activity" but 3 tool calls produce 0 entries
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 2: Argument Boundary — hostile message shapes
  // ═══════════════════════════════════════════════════════════════════════

  describe("Argument Boundary: hostile message shapes", () => {
    it("tool_call with running status is excluded — even if it has content", () => {
      const messages: ChatMessage[] = [
        { role: "assistant", type: "tool_call", toolName: "write", toolId: "t1", args: { path: "/f", content: "hello" }, status: "running", id: "m1" },
      ]
      render(<ActivityRail isOpen={true} onClose={() => {}} messages={messages} selectedToolCallId={null} />)
      expect(getLastCallProps().entries).toEqual([])
      // A write tool that's still running has no diff to show — this is correct
      // but the contract should document this explicitly
    })

    it("tool_call with isError=true but status=done is still included — error writes still modify files", () => {
      const messages: ChatMessage[] = [
        { role: "assistant", type: "tool_call", toolName: "write", toolId: "t1", args: { path: "/f", content: "hello" }, status: "done", isError: true, id: "m1", result: { previousContent: "old" } },
      ]
      render(<ActivityRail isOpen={true} onClose={() => {}} messages={messages} selectedToolCallId={null} />)
      expect(getLastCallProps().entries.length).toBe(1)
      // An error write may have partially modified the file — the diff is shown
    })

    it("user messages are silently ignored", () => {
      const messages: ChatMessage[] = [
        { role: "user", content: "hello", id: "m1" },
        { role: "user", content: "write a file", id: "m2" },
      ]
      render(<ActivityRail isOpen={true} onClose={() => {}} messages={messages} selectedToolCallId={null} />)
      expect(getLastCallProps().entries).toEqual([])
    })

    it("assistant text messages are silently ignored", () => {
      const messages: ChatMessage[] = [
        { role: "assistant", type: "text", content: "I'll write that file", id: "m1" },
      ]
      render(<ActivityRail isOpen={true} onClose={() => {}} messages={messages} selectedToolCallId={null} />)
      expect(getLastCallProps().entries).toEqual([])
    })

    it("assistant thinking messages are silently ignored", () => {
      const messages: ChatMessage[] = [
        { role: "assistant", type: "thinking", content: "hmm", id: "m1" },
      ]
      render(<ActivityRail isOpen={true} onClose={() => {}} messages={messages} selectedToolCallId={null} />)
      expect(getLastCallProps().entries).toEqual([])
    })

    it("write tool with empty content is excluded — nothing to diff", () => {
      const messages: ChatMessage[] = [
        { role: "assistant", type: "tool_call", toolName: "write", toolId: "t1", args: { path: "/f", content: "" }, status: "done", id: "m1" },
      ]
      render(<ActivityRail isOpen={true} onClose={() => {}} messages={messages} selectedToolCallId={null} />)
      expect(getLastCallProps().entries).toEqual([])
    })

    it("write tool with empty path is excluded — no file to diff", () => {
      const messages: ChatMessage[] = [
        { role: "assistant", type: "tool_call", toolName: "write", toolId: "t1", args: { path: "", content: "hello" }, status: "done", id: "m1" },
      ]
      render(<ActivityRail isOpen={true} onClose={() => {}} messages={messages} selectedToolCallId={null} />)
      expect(getLastCallProps().entries).toEqual([])
    })

    it("write tool where previousContent equals newContent is excluded — no changes", () => {
      const messages: ChatMessage[] = [
        { role: "assistant", type: "tool_call", toolName: "write", toolId: "t1", args: { path: "/f", content: "same" }, status: "done", id: "m1", result: { previousContent: "same" } },
      ]
      render(<ActivityRail isOpen={true} onClose={() => {}} messages={messages} selectedToolCallId={null} />)
      expect(getLastCallProps().entries).toEqual([])
    })

    it("write tool with previousContent but same content — excluded (redundant write)", () => {
      const content = "line1\nline2\nline3"
      const messages: ChatMessage[] = [
        { role: "assistant", type: "tool_call", toolName: "write", toolId: "t1", args: { path: "/f", content }, status: "done", id: "m1", result: { previousContent: content } },
      ]
      render(<ActivityRail isOpen={true} onClose={() => {}} messages={messages} selectedToolCallId={null} />)
      expect(getLastCallProps().entries).toEqual([])
      // Good: no diff, no entry. But what if the write tool reports error?
      // The function doesn't distinguish "identical content" from "error".
    })

    it("edit tool with empty edits array is excluded", () => {
      const messages: ChatMessage[] = [
        { role: "assistant", type: "tool_call", toolName: "edit", toolId: "t1", args: { path: "/f", edits: [] }, status: "done", id: "m1" },
      ]
      render(<ActivityRail isOpen={true} onClose={() => {}} messages={messages} selectedToolCallId={null} />)
      expect(getLastCallProps().entries).toEqual([])
    })

    it("edit tool with empty path is excluded", () => {
      const messages: ChatMessage[] = [
        { role: "assistant", type: "tool_call", toolName: "edit", toolId: "t1", args: { path: "", edits: [{ oldText: "a", newText: "b" }] }, status: "done", id: "m1" },
      ]
      render(<ActivityRail isOpen={true} onClose={() => {}} messages={messages} selectedToolCallId={null} />)
      expect(getLastCallProps().entries).toEqual([])
    })

    it("edit tool without edits field (not an array) is excluded", () => {
      const messages: ChatMessage[] = [
        { role: "assistant", type: "tool_call", toolName: "edit", toolId: "t1", args: { path: "/f" }, status: "done", id: "m1" },
      ]
      render(<ActivityRail isOpen={true} onClose={() => {}} messages={messages} selectedToolCallId={null} />)
      expect(getLastCallProps().entries).toEqual([])
    })

    it("write tool with args as null is excluded — no crash", () => {
      const messages: ChatMessage[] = [
        { role: "assistant", type: "tool_call", toolName: "write", toolId: "t1", args: null as unknown, status: "done", id: "m1" },
      ]
      render(<ActivityRail isOpen={true} onClose={() => {}} messages={messages} selectedToolCallId={null} />)
      expect(getLastCallProps().entries).toEqual([])
    })

    it("tool_call with toolcall_ prefix on toolName works correctly", () => {
      const messages: ChatMessage[] = [
        { role: "assistant", type: "tool_call", toolName: "toolcall_write", toolId: "t1", args: { path: "/f", content: "hello" }, status: "done", id: "m1" },
      ]
      render(<ActivityRail isOpen={true} onClose={() => {}} messages={messages} selectedToolCallId={null} />)
      expect(getLastCallProps().entries.length).toBe(1)
      expect(getLastCallProps().entries[0].toolName).toBe("write")
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 3: Abstraction Ambiguity — edit tool content reconstruction
  // buildDiffEntries concatenates oldText + '\n' for edits, which adds
  // an extra trailing newline that wasn't in the original file.
  // ═══════════════════════════════════════════════════════════════════════

  describe("Abstraction Ambiguity: edit tool content reconstruction adds phantom newline", () => {
    it("edit entry has extra trailing newline in both oldContent and newContent", () => {
      const messages: ChatMessage[] = [
        {
          role: "assistant", type: "tool_call", toolName: "edit", toolId: "t1",
          args: { path: "/f", edits: [{ oldText: "old line", newText: "new line" }] },
          status: "done", id: "m1",
        },
      ]
      render(<ActivityRail isOpen={true} onClose={() => {}} messages={messages} selectedToolCallId={null} />)
      expect(getLastCallProps().entries.length).toBe(1)
      const entry = getLastCallProps().entries[0]
      // The code does: oldContent += oldText + '\n' → "old line\n"
      // And: newContent += newText + '\n' → "new line\n"
      expect(entry.oldContent).toBe("old line\n")
      expect(entry.newContent).toBe("new line\n")
      // CONTRACT VIOLATION: The original file did NOT have a trailing newline
      // after "old line". The diff will show an extra blank line.
    })

    it("multiple edits concatenate with extra newlines between them", () => {
      const messages: ChatMessage[] = [
        {
          role: "assistant", type: "tool_call", toolName: "edit", toolId: "t1",
          args: {
            path: "/f",
            edits: [
              { oldText: "first old", newText: "first new" },
              { oldText: "second old", newText: "second new" },
            ],
          },
          status: "done", id: "m1",
        },
      ]
      render(<ActivityRail isOpen={true} onClose={() => {}} messages={messages} selectedToolCallId={null} />)
      const entry = getLastCallProps().entries[0]
      expect(entry.oldContent).toBe("first old\nsecond old\n")
      expect(entry.newContent).toBe("first new\nsecond new\n")
      // These edits were NOT contiguous in the original file.
      // The reconstruction shows them as one block, which is misleading.
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 4: State & Side-Effect — Escape handler leaks
  // ═══════════════════════════════════════════════════════════════════════

  describe("State & Side-Effect: Escape handler and keyboard events", () => {
    it("calls onClose when Escape is pressed while open", () => {
      const onClose = vi.fn()
      render(<ActivityRail isOpen={true} onClose={onClose} messages={[]} selectedToolCallId={null} />)
      fireEvent.keyDown(window, { key: "Escape" })
      expect(onClose).toHaveBeenCalledOnce()
    })

    it("does NOT call onClose when Escape is pressed while closed", () => {
      const onClose = vi.fn()
      render(<ActivityRail isOpen={false} onClose={onClose} messages={[]} selectedToolCallId={null} />)
      fireEvent.keyDown(window, { key: "Escape" })
      expect(onClose).not.toHaveBeenCalled()
    })

    it("removes Escape listener when closed — pressing Escape after close does nothing", () => {
      const onClose = vi.fn()
      const { rerender } = render(
        <ActivityRail isOpen={true} onClose={onClose} messages={[]} selectedToolCallId={null} />
      )
      // Close it
      rerender(
        <ActivityRail isOpen={false} onClose={onClose} messages={[]} selectedToolCallId={null} />
      )
      fireEvent.keyDown(window, { key: "Escape" })
      expect(onClose).not.toHaveBeenCalled()
    })

    it("does not call onClose for non-Escape keys", () => {
      const onClose = vi.fn()
      render(<ActivityRail isOpen={true} onClose={onClose} messages={[]} selectedToolCallId={null} />)
      fireEvent.keyDown(window, { key: "Enter" })
      fireEvent.keyDown(window, { key: "Tab" })
      fireEvent.keyDown(window, { key: "a" })
      expect(onClose).not.toHaveBeenCalled()
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 5: Rendering contract — what's visible when
  // ═══════════════════════════════════════════════════════════════════════

  describe("Rendering contract", () => {
    it("renders nothing (returns null) when closed", () => {
      const { container } = render(
        <ActivityRail isOpen={false} onClose={() => {}} messages={[]} selectedToolCallId={null} />
      )
      expect(container.innerHTML).toBe("")
    })

    it("renders with complementary role when open", () => {
      render(<ActivityRail isOpen={true} onClose={() => {}} messages={[]} selectedToolCallId={null} />)
      expect(screen.getByRole("complementary")).toBeTruthy()
    })

    it("has correct aria-label on complementary element", () => {
      render(<ActivityRail isOpen={true} onClose={() => {}} messages={[]} selectedToolCallId={null} />)
      expect(screen.getByRole("complementary")).toHaveAttribute("aria-label", "File changes panel")
    })

    it("shows Changes header when open", () => {
      render(<ActivityRail isOpen={true} onClose={() => {}} messages={[]} selectedToolCallId={null} />)
      expect(screen.getByText("Changes")).toBeTruthy()
    })

    it("close button has accessible label", () => {
      render(<ActivityRail isOpen={true} onClose={() => {}} messages={[]} selectedToolCallId={null} />)
      expect(screen.getByLabelText("Close changes panel")).toBeTruthy()
    })

    it("clicking close button calls onClose", () => {
      const onClose = vi.fn()
      render(<ActivityRail isOpen={true} onClose={onClose} messages={[]} selectedToolCallId={null} />)
      fireEvent.click(screen.getByLabelText("Close changes panel"))
      expect(onClose).toHaveBeenCalledOnce()
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 6: selectedToolCallId edge cases
  // ═══════════════════════════════════════════════════════════════════════

  describe("selectedToolCallId edge cases", () => {
    it("passes selectedId to SessionDiffView when provided", () => {
      const messages: ChatMessage[] = [
        { role: "assistant", type: "tool_call", toolName: "write", toolId: "t1", args: { path: "/f", content: "hello" }, status: "done", id: "m1" },
      ]
      render(<ActivityRail isOpen={true} onClose={() => {}} messages={messages} selectedToolCallId="m1" />)
      expect(getLastCallProps().selectedId).toBe("m1")
    })

    it("passes null selectedId when not provided", () => {
      render(<ActivityRail isOpen={true} onClose={() => {}} messages={[]} selectedToolCallId={null} />)
      expect(getLastCallProps().selectedId).toBeNull()
    })

    it("selectedToolCallId for non-existent tool call — no crash, no scroll target", () => {
      const { container } = render(
        <ActivityRail isOpen={true} onClose={() => {}} messages={[]} selectedToolCallId="nonexistent" />
      )
      // Should not crash. SessionDiffView handles missing entries internally.
      expect(container.querySelector("[role=complementary]")).toBeTruthy()
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 7: DiffEntry construction — write tool specifics
  // ═══════════════════════════════════════════════════════════════════════

  describe("DiffEntry construction for write tool", () => {
    it("includes entry with correct filePath from args", () => {
      const messages: ChatMessage[] = [
        { role: "assistant", type: "tool_call", toolName: "write", toolId: "t1", args: { path: "/src/index.ts", content: "code" }, status: "done", id: "m1" },
      ]
      render(<ActivityRail isOpen={true} onClose={() => {}} messages={messages} selectedToolCallId={null} />)
      expect(getLastCallProps().entries[0].filePath).toBe("/src/index.ts")
    })

    it("includes entry with empty oldContent when no previousContent in result", () => {
      const messages: ChatMessage[] = [
        { role: "assistant", type: "tool_call", toolName: "write", toolId: "t1", args: { path: "/f", content: "hello" }, status: "done", id: "m1" },
      ]
      render(<ActivityRail isOpen={true} onClose={() => {}} messages={messages} selectedToolCallId={null} />)
      expect(getLastCallProps().entries[0].oldContent).toBe("")
      expect(getLastCallProps().entries[0].newContent).toBe("hello")
    })

    it("includes entry with previousContent from result as oldContent", () => {
      const messages: ChatMessage[] = [
        { role: "assistant", type: "tool_call", toolName: "write", toolId: "t1", args: { path: "/f", content: "new" }, status: "done", id: "m1", result: { previousContent: "old" } },
      ]
      render(<ActivityRail isOpen={true} onClose={() => {}} messages={messages} selectedToolCallId={null} />)
      expect(getLastCallProps().entries[0].oldContent).toBe("old")
      expect(getLastCallProps().entries[0].newContent).toBe("new")
    })

    it("result.previousContent as non-string falls back to empty string", () => {
      const messages: ChatMessage[] = [
        { role: "assistant", type: "tool_call", toolName: "write", toolId: "t1", args: { path: "/f", content: "hello" }, status: "done", id: "m1", result: { previousContent: 42 } },
      ]
      render(<ActivityRail isOpen={true} onClose={() => {}} messages={messages} selectedToolCallId={null} />)
      // typeof 42 !== 'string', so previousContent is '' (falsy), then '' === 'hello' is false
      // But wait: previousContent = '' and newContent = 'hello', '' !== 'hello', so entry IS included
      expect(getLastCallProps().entries.length).toBe(1)
      expect(getLastCallProps().entries[0].oldContent).toBe("")
    })

    it("multiple write tool calls create multiple entries", () => {
      const messages: ChatMessage[] = [
        { role: "assistant", type: "tool_call", toolName: "write", toolId: "t1", args: { path: "/a", content: "aaa" }, status: "done", id: "m1" },
        { role: "assistant", type: "tool_call", toolName: "write", toolId: "t2", args: { path: "/b", content: "bbb" }, status: "done", id: "m2" },
      ]
      render(<ActivityRail isOpen={true} onClose={() => {}} messages={messages} selectedToolCallId={null} />)
      expect(getLastCallProps().entries.length).toBe(2)
      expect(getLastCallProps().entries[0].filePath).toBe("/a")
      expect(getLastCallProps().entries[1].filePath).toBe("/b")
    })

    it("mix of write and edit tool calls creates entries for both", () => {
      const messages: ChatMessage[] = [
        { role: "assistant", type: "tool_call", toolName: "write", toolId: "t1", args: { path: "/a", content: "aaa" }, status: "done", id: "m1" },
        { role: "assistant", type: "tool_call", toolName: "edit", toolId: "t2", args: { path: "/b", edits: [{ oldText: "x", newText: "y" }] }, status: "done", id: "m2" },
      ]
      render(<ActivityRail isOpen={true} onClose={() => {}} messages={messages} selectedToolCallId={null} />)
      expect(getLastCallProps().entries.length).toBe(2)
      expect(getLastCallProps().entries[0].toolName).toBe("write")
      expect(getLastCallProps().entries[1].toolName).toBe("edit")
    })
  })
})
