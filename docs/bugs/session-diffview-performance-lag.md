# SessionDiffView Performance Lag with Many Diff Entries

**Date:** 2026-05-31
**Status:** Fixed
**Severity:** High (usability-impacting)

## Bug Description

The `SessionDiffView` component rendered ALL diff entries in the DOM simultaneously via `entries.map(...)`. Each entry renders a `PatchDiff` component from `@pierre/diffs`, which is heavy (syntax highlighting, word-level diffs, shadow DOM). When a session had many edits (e.g., 50+ edits each with 50+ additions), the browser would:

1. Mount hundreds of heavy `PatchDiff` components in the DOM
2. The browser had to compute layout, paint, and composite for all nodes — even those far off-screen
3. This caused significant screen lag, jank, and unresponsiveness
4. The problem was identical to the message list performance issue that was previously solved with virtualization

## Root Cause

Unlike `MessagesTimeline` (which uses `react-virtuoso` for virtualized rendering), `SessionDiffView` was rendering ALL entries eagerly. There was no virtualization — every diff entry was mounted in the DOM from the start.

Additionally, the `ActivityRail` and `RightSidebar` components used `scrollIntoView()` via `requestAnimationFrame` to scroll to selected entries. This approach is incompatible with virtualized lists because off-screen entries may not be mounted in the DOM.

## Fix

Applied the same solution as `MessagesTimeline`:

1. **Virtualized rendering with react-virtuoso**: Replaced `entries.map()` with `<Virtuoso>` component. Only diff entries visible in the viewport (plus an overscan buffer of 200px) are mounted in the DOM. react-virtuoso handles dynamic height measurement automatically, which is critical since `PatchDiff` heights vary widely.

2. **Internal scroll-to-entry via Virtuoso**: `SessionDiffView` now uses `VirtuosoHandle.scrollToIndex()` internally when `selectedId` changes, replacing the old DOM-based `scrollIntoView` approach.

3. **Removed external scrollIntoView effects**: Both `ActivityRail` and `RightSidebar` had `useEffect` hooks that used `requestAnimationFrame` + `element.scrollIntoView()`. These were removed since:
   - They're redundant (SessionDiffView handles scrolling internally)
   - They're incompatible with virtualization (the target DOM element may not exist)
   - They had a race condition (rAF could fire after unmount)

## Files Changed

- `src/renderer/src/components/chat/SessionDiffView.tsx` — Added react-virtuoso virtualization, VirtuosoHandle ref, internal scrollToIndex
- `src/renderer/src/components/chat/ActivityRail.tsx` — Removed scrollIntoView useEffect (now handled by SessionDiffView)
- `src/renderer/src/components/layout/RightSidebar.tsx` — Removed scrollIntoView useEffect (now handled by SessionDiffView)
- `src/tests/renderer/SessionDiffView.test.tsx` — Added react-virtuoso mock, updated tests
- `src/tests/renderer/RightSidebar.test.tsx` — Updated scrollIntoView tests to reflect new architecture
- `src/tests/renderer/ActivityRail.test.tsx` — Updated comments about scroll behavior

## Performance Impact

Before: 50 edits × ~100 lines each = ~5000 DOM nodes mounted at all times, causing jank and lag.
After: Only visible entries (~5-8) are mounted, regardless of total count. Smooth scrolling, no lag.
