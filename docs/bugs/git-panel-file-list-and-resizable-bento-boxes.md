---
title: Git Panel File List Truncation & Missing Resize on Bento Boxes
date: 2026-05-31
status: fixed
---

# Bug: Git Panel File List Truncation & Missing Resize on Bento Boxes

## Description

Two related UI issues in the Git integration overlay (GitCommandCenter dialog):

### Issue 1: File List Truncation Hides Stage/Unstage Buttons

When file paths are long (common in nested directory structures), the `FileRow` component in `StagingArea` would truncate the filename text, but the stage/unstage buttons were pushed off-screen or completely hidden. This was caused by:

1. **Missing `min-w-0`** on the filename `<span>` — In a flex container, `truncate` alone does not work without `min-w-0` because the flex item has an implicit `min-width: auto` that prevents it from shrinking below its content size.
2. **Missing `shrink-0`** on the status badge and action button — These fixed-size elements could be shrunk by the flex layout, causing them to disappear.
3. **Hover-only visibility** — The stage/unstage button had `opacity-0 group-hover:opacity-100`, making it invisible until hover, which compounded the issue because users couldn't see the button was even there.
4. **No path splitting** — The entire path was displayed as a single truncated string, making it hard to identify which file you're looking at even when truncation worked.

**Fix in `StagingArea.tsx` (FileRow component):**
- Added `min-w-0` to the filename flex item for proper CSS truncation
- Added `shrink-0` to status badge and action button so they never shrink
- Split the path into directory + filename parts with distinct styling (dimmer dir, brighter filename)
- Changed button from `opacity-0 group-hover:opacity-100` to `opacity-50 group-hover:opacity-100` so it's always subtly visible

### Issue 2: No Resize on the 3 Bento Boxes

The GitCommandCenter had 3 distinct panels (bento boxes) but no way to resize them:

1. **Left panel** (StagingArea + CommitInput) — Fixed width `w-72` (288px)
2. **Right panel** (DiffViewer) — Flex-1, takes remaining space
3. **Bottom panel** (Recent Commits) — Fixed `max-h-48` (192px)

Users could not adjust these sizes, which was especially problematic when:
- The staging area needed more width for long file paths
- The diff viewer needed more horizontal space
- The commit log needed more or less vertical space

**Fix in `GitCommandCenter.tsx`:**
- Added `leftPanelWidth` and `bottomPanelHeight` state variables
- Implemented vertical resize handle (col-resize cursor) between left and right panels
- Implemented horizontal resize handle (row-resize cursor) between main content and bottom commits
- Resize handles use the same visual pattern as the RightSidebar's resize handle: a small floating "stick" indicator that grows on hover/drag
- Left panel: min 200px, max 600px
- Bottom panel: min 60px, max 400px
- Proper cleanup of mouse event listeners on unmount or drag end
- `document.body.style.cursor` and `userSelect` are set during drag to prevent text selection and provide cursor feedback

## Files Changed

- `src/renderer/src/components/git/StagingArea.tsx` — FileRow: fixed truncation, added path splitting, made buttons always visible
- `src/renderer/src/components/git/GitCommandCenter.tsx` — Added resizable panel state, resize handles, and drag handlers

## Testing

- `bun run type-check` — Passed
- `bun run lint` — Passed
- Visual verification needed: open Git overlay, check that:
  1. Long file paths truncate properly with directory/filename split
  2. Stage/unstage buttons are always visible (subtle when not hovered)
  3. Vertical resize handle appears between left and right panels
  4. Horizontal resize handle appears between main content and commit log
  5. Both resize handles show visual feedback on hover and drag
