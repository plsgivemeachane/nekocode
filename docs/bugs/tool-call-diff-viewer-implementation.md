# Tool Call Diff Viewer — Implementation Notes

> **Feature:** Tool Call Diff Viewer  
> **Date:** 2026-05-29  
> **Spec:** `docs/features/tool-call-diff-viewer.md`

## Overview

Implements a diff viewer for file-modifying tool calls (write/edit). When an AI agent writes or edits files, the user can see:

1. **Inline diff stats** (`+3 -1`) in each tool call row showing lines added/removed
2. **Aggregate stats** in the tool call group header
3. **Activity Rail** — a collapsible side panel with full `@pierre/diffs` PatchDiff rendering
4. **Click-to-open** — clicking a write/edit tool call row opens the rail and scrolls to that file's diff

## Implementation Details

### Files Modified

| File | Change |
|------|--------|
| `src/renderer/src/components/chat/tool-summary.ts` | Added `DiffStats` interface and `extractDiffStats()` function |
| `src/renderer/src/components/chat/ToolCallSection.tsx` | Full rewrite: added `ToolCallData` type with `result`, `DiffStatsBadge`, click handlers on write/edit rows, aggregate stats in header |
| `src/renderer/src/components/chat/ChatView.tsx` | Added `ActivityRail` import, `railOpen`/`selectedToolCallId` state, `handleToolCallClick`/`handleRailClose` callbacks, flex layout for rail |
| `src/main/session-manager.ts` | Added `previousFileContent` map to `ManagedSession`, captures file content before write/edit execution, injects `previousContent` into tool result |
| `src/tests/shared/tool-summary.test.ts` | Added 10 tests for `extractDiffStats()` |
| `src/tests/renderer/ToolCallSection.test.tsx` | Updated mock to include `extractDiffStats` |
| `package.json` | Added `diff` dependency (for `createTwoFilesPatch`) |

### Files Created

| File | Purpose |
|------|---------|
| `src/renderer/src/components/chat/ActivityRail.tsx` | Collapsible side panel with diff viewer, Escape-to-close, scroll-to-entry |
| `src/renderer/src/components/chat/SessionDiffView.tsx` | Renders `PatchDiff` from `@pierre/diffs` for each file change, with unified/split toggle |

### Architecture Decisions

#### previousContent Capture Strategy

The Pi SDK's built-in `write` tool returns a simple string like `"File written successfully"` — it does **not** include the previous file content. To enable diffing, we intercept the tool execution lifecycle:

1. **`tool_execution_start`**: When a write/edit tool is about to execute, we read the current file content from disk and store it in `managed.previousFileContent` (keyed by toolCallId).
2. **`tool_execution_end`**: When the tool finishes, we inject `previousContent` into the result object, then forward it to the renderer.

This approach:
- Does not modify the Pi SDK
- Works with any tool execution pipeline
- Handles the case where the file doesn't exist yet (new file creation — previousContent = `""`)
- Gracefully handles read failures (missing file, permission errors)

#### Diff Generation

For the `SessionDiffView`, we use `createTwoFilesPatch` from the `diff` npm package to generate a unified diff patch string, then pass it to `PatchDiff` from `@pierre/diffs/react`. This gives us:

- Syntax highlighting via Shiki
- Word-level diff highlights within changed lines
- Expandable unchanged regions
- Sticky file headers
- Unified/split view toggle
- Dark theme matching the app's design

#### extractDiffStats Algorithm

The `extractDiffStats()` function uses a set-based approach for line-level diff stats:

1. Build frequency maps for old and new lines
2. Count lines with more occurrences in new (additions) vs old (removals)
3. For files > 5000 lines, fall back to simple line count difference

This is approximate (doesn't handle line reordering perfectly) but is efficient and good enough for the `+3 -1` stats badges.

#### Edit Tool Handling

For the `edit` tool, we reconstruct old/new content from the `edits` array (oldText/newText pairs). This gives a simplified diff showing only the changed regions, not the full file context. This is acceptable because:
- The edit tool often makes targeted changes
- Full file content is not available from args/result alone
- The diff is still useful for understanding what changed

### Layout Structure

```
<main className="flex">                      ← ChatView main area (now flex row)
  <div className="flex-1 min-w-0">            ← Messages area (takes remaining width)
    ... existing content ...
  </div>
  <ActivityRail />                             ← Side panel (50% width, 320-640px)
</main>
```

The ActivityRail is hidden when closed (`isOpen=false` returns `null`), so there's no layout impact when not in use.

### Accessibility

- Write/edit tool call rows have `role="button"`, `tabIndex={0}`, and keyboard handler for Enter/Space
- ActivityRail has `role="complementary"` and `aria-label="File changes panel"`
- Close button has `aria-label="Close changes panel"`
- Escape key closes the rail
- Scroll-to-entry uses smooth scrolling

### Test Coverage

- `extractDiffStats()`: 10 new tests covering write tool (new file, existing file, identical content), edit tool (single edit, multiple edits, empty edits), and toolcall_ prefix handling
- `ToolCallSection.test.tsx`: Updated mock to include `extractDiffStats`
- All 1463 tests pass

### Known Limitations

1. **Edit tool diffs are simplified**: Only shows oldText→newText diff, not the full file. For full context, the main process would need to read the file before the edit and pass it through.
2. **Approximate line stats**: The set-based algorithm doesn't handle line reordering. For files with many reorderings, the stats may not perfectly match what a proper diff algorithm would show.
3. **Race condition on fast tool calls**: If a tool modifies a file that was just modified by a previous tool in the same response, the `previousContent` captured at `tool_execution_start` might not reflect the intermediate state. This is unlikely in practice but theoretically possible.
4. **Session history**: The diff only works for tool calls in the current session. Past tool calls from loaded history won't have `previousContent` because it wasn't captured at the time.
