// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import React from "react"
import { SessionDiffView } from "@/renderer/src/components/chat/SessionDiffView"
import type { DiffEntry } from "@/renderer/src/components/chat/SessionDiffView"

// Type for PatchDiff mock call props (subset of @pierre/diffs/react PatchDiff props)
interface PatchDiffProps {
  patch: string
  options: { theme: string; themeType: string; diffStyle: string }
  disableWorkerPool: boolean
}

// ── Mock react-virtuoso ──────────────────────────────────────────────
// We mock Virtuoso because it requires a real DOM scroll container and
// ResizeObserver which jsdom does not support.
//
// IMPORTANT: vi.mock factories are hoisted to the top of the file by Vitest.
// Any variables referenced in the factory must also be hoisted (vi.hoisted)
// or defined inline.
const { MockVirtuoso } = vi.hoisted(() => {
  const MockVirtuoso = vi.fn(({ data, itemContent }: { data: unknown[]; itemContent: (index: number) => React.ReactNode }) => {
    return (
      <div data-testid="virtuoso-mock">
        {data.map((_: unknown, index: number) => (
          <div key={index} data-testid={`virtuoso-row-${index}`}>
            {itemContent(index)}
          </div>
        ))}
      </div>
    )
  })
  return { MockVirtuoso }
})

vi.mock("react-virtuoso", () => ({
  Virtuoso: MockVirtuoso,
}))

// ── Mock @pierre/diffs/react ─────────────────────────────────────
const mockPatchDiff = vi.fn<(props: PatchDiffProps) => React.ReactElement>(() => <div data-testid="patch-diff" />)
vi.mock("@pierre/diffs/react", () => ({
  PatchDiff: (props: PatchDiffProps) => mockPatchDiff(props),
}))

// ── Mock diff package ────────────────────────────────────────────
vi.mock("diff", () => ({
  createTwoFilesPatch: vi.fn((_oldFile: string, _newFile: string, oldContent: string, newContent: string) => {
    // Simplified mock that returns a unified diff-like string
    return `--- a/${_oldFile}\n+++ b/${_newFile}\n${oldContent}\n${newContent}`
  }),
}))

// Helper to get PatchDiff mock call props with proper typing
function getPatchDiffCallProps(index: number = 0): PatchDiffProps {
  return mockPatchDiff.mock.calls[index][0]
}

// ═══════════════════════════════════════════════════════════════════════
// CRITICAL TESTING: SessionDiffView
//
// CONTRACT: "Renders diffs for file-modifying tool calls in a session"
// AUDIT:
//   1. generatePatch passes filePath as BOTH old and new file name —
//      this means the diff header shows "a//f" and "b//f" which is wrong
//      for absolute paths (a//src/file.ts instead of a/src/file.ts)
//   2. DiffEntry has oldContent/newContent but no guarantee they differ —
//      a zero-change diff would still generate a patch and render
//   3. DiffStyleToggle only has 2 states — what about "side-by-side"?
//      The name says "diffStyle" but it's really "layoutStyle"
//   4. onSelectEntry callback — React catches errors in event handlers
//      so the component doesn't need try/catch
//   5. Stats now handled by @pierre/diffs PatchDiff header (Shadow DOM)
//      — removed custom per-file header to avoid duplicate headers
// ═══════════════════════════════════════════════════════════════════════

const makeEntry = (overrides: Partial<DiffEntry> = {}): DiffEntry => ({
  id: "entry-1",
  filePath: "/src/file.ts",
  toolName: "write",
  oldContent: "old line\n",
  newContent: "new line\n",
  stats: { added: 1, removed: 1 },
  ...overrides,
})

describe("SessionDiffView — Contract Violations", () => {
  beforeEach(() => {
    mockPatchDiff.mockReset()
    mockPatchDiff.mockImplementation(() => <div data-testid="patch-diff" />)
  })

  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 1: Name vs Reality
  // "SessionDiffView" renders a PatchDiff for EACH entry, not a session-level diff.
  // If 3 edits hit the same file, you see 3 separate diffs, not 1 merged diff.
  // ═══════════════════════════════════════════════════════════════════════

  describe("Name vs Reality: not a session-level diff", () => {
    it("renders separate PatchDiff for each entry — even for the same file", () => {
      const entries = [
        makeEntry({ id: "e1", filePath: "/same/file.ts" }),
        makeEntry({ id: "e2", filePath: "/same/file.ts" }),
      ]
      render(<SessionDiffView entries={entries} />)
      const patches = screen.getAllByTestId("patch-diff")
      expect(patches.length).toBe(2)
      // CONTRACT VIOLATION: Two diffs for the same file are shown separately.
      // A user would expect to see the cumulative diff for /same/file.ts.
    })

    it("renders 1 file changed for 2 entries on same file — unique file count", () => {
      const entries = [
        makeEntry({ id: "e1", filePath: "/same/file.ts" }),
        makeEntry({ id: "e2", filePath: "/same/file.ts" }),
      ]
      render(<SessionDiffView entries={entries} />)
      // Previously BUG: "2 files changed" even though it's really 1 file with 2 edits.
      // FIX: Now counts unique file paths — "1 file changed"
      expect(screen.getByText("1 file changed")).toBeTruthy()
    })

    it("renders singular for 1 entry", () => {
      render(<SessionDiffView entries={[makeEntry()]} />)
      expect(screen.getByText("1 file changed")).toBeTruthy()
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 2: Argument Boundary — DiffEntry edge cases
  // ═══════════════════════════════════════════════════════════════════════

  describe("Argument Boundary: DiffEntry edge cases", () => {
    it("entry with empty oldContent and newContent — still renders a patch", () => {
      const entries = [makeEntry({ oldContent: "", newContent: "" })]
      render(<SessionDiffView entries={entries} />)
      // Even though there's nothing to diff, a PatchDiff is rendered
      expect(mockPatchDiff).toHaveBeenCalled()
      // The patch would be a no-change diff, which is misleading
    })

    it("entry with identical oldContent and newContent — still renders", () => {
      const entries = [makeEntry({ oldContent: "same\n", newContent: "same\n", stats: { added: 0, removed: 0 } })]
      render(<SessionDiffView entries={entries} />)
      expect(mockPatchDiff).toHaveBeenCalled()
      // A diff with zero changes is shown — confusing for users
    })

    it("entry with very large content — PatchDiff gets the full content", () => {
      const bigContent = "x".repeat(100000)
      const entries = [makeEntry({ oldContent: "small", newContent: bigContent, stats: { added: 1, removed: 1 } })]
      render(<SessionDiffView entries={entries} />)
      expect(mockPatchDiff).toHaveBeenCalled()
      // No pagination, no virtualization — could crash the browser with huge diffs
    })

    it("entry with special characters in filePath — passed to generatePatch", () => {
      const entries = [makeEntry({ filePath: "/path/with spaces/文件.ts" })]
      render(<SessionDiffView entries={entries} />)
      expect(mockPatchDiff).toHaveBeenCalled()
      // The filePath is passed directly to createTwoFilesPatch — no sanitization
    })

    it("entry with filePath containing newlines — potentially breaks diff format", () => {
      const entries = [makeEntry({ filePath: "/foo\nbar" })]
      render(<SessionDiffView entries={entries} />)
      expect(mockPatchDiff).toHaveBeenCalled()
      // A newline in the file path could break the unified diff header format
    })

    it("entry with empty string id — renders without crash", () => {
      const entries = [makeEntry({ id: "" })]
      render(<SessionDiffView entries={entries} />)
      // The DOM id would be "diff-entry-" which is valid but empty
      expect(screen.getByTestId("patch-diff")).toBeTruthy()
    })

    it("entry with duplicate ids — React key collision", () => {
      const entries = [
        makeEntry({ id: "dup" }),
        makeEntry({ id: "dup" }),
      ]
      // React will warn about duplicate keys but won't crash
      expect(() => render(<SessionDiffView entries={entries} />)).not.toThrow()
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 3: Abstraction Ambiguity — stats display
  // Stats are shown in the per-file header. +0 and -0 are never shown
  // (because of the > 0 check). This means "file was written but nothing
  // changed" looks identical to "file was modified with additions only".
  // ═══════════════════════════════════════════════════════════════════════

  describe("Stats are delegated to @pierre/diffs PatchDiff header", () => {
    // The custom per-file header was removed to avoid colliding with
    // @pierre/diffs' built-in file header. Stats (+N/-N) and file path
    // are now shown exclusively by PatchDiff's own header rendered
    // inside Shadow DOM. We verify that no duplicate stats appear
    // in our DOM and that the patch string contains correct file info.
    it("no duplicate +N/-N stats rendered outside PatchDiff", () => {
      const entries = [makeEntry({ stats: { added: 5, removed: 3 } })]
      render(<SessionDiffView entries={entries} />)
      // Stats should NOT appear in our DOM — they're inside PatchDiff's Shadow DOM
      expect(screen.queryByText("+5")).toBeNull()
      expect(screen.queryByText("-3")).toBeNull()
    })

    it("patch string passed to PatchDiff contains the file path", () => {
      const entries = [makeEntry({ filePath: "/src/app.ts" })]
      render(<SessionDiffView entries={entries} />)
      const props = getPatchDiffCallProps(0)
      // The patch should reference the file path in its headers
      expect(props.patch).toContain("/src/app.ts")
    })

    it("entry with zero stats still renders PatchDiff", () => {
      const entries = [makeEntry({ stats: { added: 0, removed: 0 } })]
      render(<SessionDiffView entries={entries} />)
      // PatchDiff should still be rendered even with zero changes
      expect(mockPatchDiff).toHaveBeenCalledTimes(1)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 4: DiffStyleToggle — toggle state management
  // ═══════════════════════════════════════════════════════════════════════

  describe("DiffStyleToggle: unified/split toggle", () => {
    it("defaults to unified view", () => {
      render(<SessionDiffView entries={[makeEntry()]} />)
      expect(screen.getByText("Unified")).toBeTruthy()
    })

    it("toggles to split view on click", () => {
      render(<SessionDiffView entries={[makeEntry()]} />)
      const toggle = screen.getByText("Unified")
      fireEvent.click(toggle.closest("button")!)
      expect(screen.getByText("Split")).toBeTruthy()
    })

    it("toggles back to unified on second click", () => {
      render(<SessionDiffView entries={[makeEntry()]} />)
      const toggle = screen.getByText("Unified")
      fireEvent.click(toggle.closest("button")!)
      expect(screen.getByText("Split")).toBeTruthy()
      fireEvent.click(screen.getByText("Split").closest("button")!)
      expect(screen.getByText("Unified")).toBeTruthy()
    })

    it("toggle has accessible title describing next state", () => {
      render(<SessionDiffView entries={[makeEntry()]} />)
      const toggle = screen.getByText("Unified").closest("button")!
      expect(toggle.title).toBe("Switch to split view")
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 5: Empty state
  // ═══════════════════════════════════════════════════════════════════════

  describe("Empty state", () => {
    it("shows empty state message when entries is empty", () => {
      render(<SessionDiffView entries={[]} />)
      expect(screen.getByText("No file changes in this response")).toBeTruthy()
    })

    it("does not render PatchDiff when entries is empty", () => {
      render(<SessionDiffView entries={[]} />)
      expect(mockPatchDiff).not.toHaveBeenCalled()
    })

    it("does not render toggle when entries is empty", () => {
      render(<SessionDiffView entries={[]} />)
      expect(screen.queryByText("Unified")).toBeNull()
      expect(screen.queryByText("Split")).toBeNull()
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 6: onSelectEntry callback
  // ═══════════════════════════════════════════════════════════════════════

  describe("onSelectEntry callback", () => {
    it("calls onSelectEntry with entry id when entry is clicked", () => {
      const onSelectEntry = vi.fn()
      const entries = [makeEntry({ id: "entry-click" })]
      const { container } = render(
        <SessionDiffView entries={entries} onSelectEntry={onSelectEntry} />
      )
      // Each entry has an onClick that calls onSelectEntry
      const entryDiv = container.querySelector("#diff-entry-entry-click")
      fireEvent.click(entryDiv!)
      expect(onSelectEntry).toHaveBeenCalledWith("entry-click")
    })

    it("does not crash when onSelectEntry is not provided", () => {
      const entries = [makeEntry({ id: "entry-no-cb" })]
      const { container } = render(<SessionDiffView entries={entries} />)
      const entryDiv = container.querySelector("#diff-entry-entry-no-cb")
      expect(() => fireEvent.click(entryDiv!)).not.toThrow()
    })

    it("onSelectEntry callback is called when entry is clicked", () => {
      const onSelectEntry = vi.fn()
      const entries = [makeEntry({ id: "entry-throw" })]
      const { container } = render(
        <SessionDiffView entries={entries} onSelectEntry={onSelectEntry} />
      )
      const entryDiv = container.querySelector("#diff-entry-entry-throw")
      fireEvent.click(entryDiv!)
      expect(onSelectEntry).toHaveBeenCalledWith("entry-throw")
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 7: selectedId — scroll-to and highlight behavior
  // ═══════════════════════════════════════════════════════════════════════

  describe("selectedId highlighting", () => {
    it("selected entry gets ring highlight class", () => {
      const entries = [makeEntry({ id: "selected-1" }), makeEntry({ id: "unselected-2" })]
      const { container } = render(
        <SessionDiffView entries={entries} selectedId="selected-1" />
      )
      const selected = container.querySelector("#diff-entry-selected-1")
      expect(selected?.className).toContain("ring-1")
    })

    it("non-selected entry does not get ring highlight", () => {
      const entries = [makeEntry({ id: "entry-a" }), makeEntry({ id: "entry-b" })]
      const { container } = render(
        <SessionDiffView entries={entries} selectedId="entry-a" />
      )
      const unselected = container.querySelector("#diff-entry-entry-b")
      expect(unselected?.className).not.toContain("ring-1")
    })

    it("no selectedId — no ring highlight on any entry", () => {
      const entries = [makeEntry({ id: "entry-a" })]
      const { container } = render(
        <SessionDiffView entries={entries} selectedId={null} />
      )
      const entry = container.querySelector("#diff-entry-entry-a")
      expect(entry?.className).not.toContain("ring-1")
    })

    it("selectedId that doesn't match any entry — no crash, no highlight", () => {
      const entries = [makeEntry({ id: "entry-a" })]
      const { container } = render(
        <SessionDiffView entries={entries} selectedId="nonexistent" />
      )
      const entry = container.querySelector("#diff-entry-entry-a")
      expect(entry?.className).not.toContain("ring-1")
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 8: PatchDiff options — what gets passed down
  // ═══════════════════════════════════════════════════════════════════════

  describe("PatchDiff options", () => {
    it("passes patch string to PatchDiff", () => {
      const entries = [makeEntry()]
      render(<SessionDiffView entries={entries} />)
      expect(getPatchDiffCallProps(0).patch).toBeDefined()
      expect(typeof getPatchDiffCallProps(0).patch).toBe("string")
    })

    it("passes options with correct theme", () => {
      const entries = [makeEntry()]
      render(<SessionDiffView entries={entries} />)
      expect(getPatchDiffCallProps(0).options.theme).toBe("pierre-dark")
      expect(getPatchDiffCallProps(0).options.themeType).toBe("dark")
    })

    it("passes diffStyle as unified by default", () => {
      const entries = [makeEntry()]
      render(<SessionDiffView entries={entries} />)
      expect(getPatchDiffCallProps(0).options.diffStyle).toBe("unified")
    })

    it("passes split diffStyle after toggle", () => {
      const entries = [makeEntry()]
      render(<SessionDiffView entries={entries} />)
      fireEvent.click(screen.getByText("Unified").closest("button")!)
      // After toggle, next render should use split style
      const lastCallIndex = mockPatchDiff.mock.calls.length - 1
      expect(getPatchDiffCallProps(lastCallIndex).options.diffStyle).toBe("split")
    })

    it("passes disableWorkerPool to PatchDiff", () => {
      const entries = [makeEntry()]
      render(<SessionDiffView entries={entries} />)
      expect(getPatchDiffCallProps(0).disableWorkerPool).toBe(true)
    })
  })
})
