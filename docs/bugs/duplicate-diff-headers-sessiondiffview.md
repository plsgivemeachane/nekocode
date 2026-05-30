# Bug: Duplicate File Headers in SessionDiffView

**Date:** 2026-05-30
**Status:** Fixed
**Files Changed:**
- `src/renderer/src/components/chat/SessionDiffView.tsx`
- `src/tests/renderer/SessionDiffView.test.tsx`

## Problem

The `SessionDiffView` component rendered **two file headers per diff entry**, causing visual collision and mismatch:

1. **Our custom per-file header** — A `<div>` with a folder icon, file path, and `+N`/`-N` stats rendered directly in React DOM.
2. **@pierre/diffs PatchDiff header** — The `PatchDiff` component from `@pierre/diffs` automatically renders its own file header from the patch content (which contains `--- a/filepath` and `+++ b/filepath` lines).

These two headers would appear stacked on top of each other, and the stats (`+N`/`-N`) could mismatch between the two because:
- Our custom header used `DiffEntry.stats` (computed from `extractDiffStats`)
- The @pierre/diffs header computed stats from the actual patch content
- These two sources could disagree on the exact numbers (e.g., a multi-line change counted differently)

## Example of the collision

Before the fix, for a single file edit, the user would see:

```
📁 /src/components/App.tsx   +17  -21     ← Our custom header
──────────────────────────────────────────
📁 src/components/App.tsx   +17  -21     ← @pierre/diffs header (from patch)
 diff content...
```

Two headers, potentially with different stats, stacked on top of each other.

## Root Cause

When `SessionDiffView` was built, a custom per-file header was added to show the file path and change stats. However, the `@pierre/diffs` `PatchDiff` component already renders its own file header by default (controlled by the `hunkSeparators: 'metadata'` option and the patch's `--- a/` / `+++ b/` lines).

The `@pierre/diffs` header is the authoritative one — it derives its data directly from the unified diff patch content, which is the single source of truth. Our custom header was redundant and could disagree.

## Fix

**Removed the custom per-file header** from `SessionDiffView.tsx`. The `@pierre/diffs` `PatchDiff` component's built-in header is now the sole file header shown for each diff entry.

### Changes in `SessionDiffView.tsx`
- Removed the per-file `<div>` containing the folder icon, file path, and `+N`/`-N` stats that appeared above each `PatchDiff` component.
- Added a comment explaining that `PatchDiff` renders its own header from the patch content.
- Updated the component docstring to reflect that `@pierre/diffs` handles the file header.

### Changes in `SessionDiffView.test.tsx`
- Replaced the "Abstraction Ambiguity: stats display in per-file header" test group with "Stats are delegated to @pierre/diffs PatchDiff header" test group.
- New tests verify:
  - No duplicate `+N`/`-N` stats appear in our DOM (they're inside PatchDiff's Shadow DOM).
  - The patch string passed to PatchDiff contains the correct file path.
  - PatchDiff still renders even with zero-change stats.
- Updated audit comment #5 to reflect the delegation to @pierre/diffs.

## Notes

- The `DiffEntry.stats` field is still in the interface and still populated by `ActivityRail.tsx` — it's used for the aggregate "N files changed" header and by `ToolCallSection`'s `DiffStatsBadge`. It was NOT removed from the type definition.
- The `@pierre/diffs` header renders inside a Shadow DOM, so it's not accessible to React Testing Library. Tests can only verify that our DOM doesn't contain duplicate stats.
