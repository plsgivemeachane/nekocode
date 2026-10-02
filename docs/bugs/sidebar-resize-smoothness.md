# Sidebar Resize Smoothness & Left Sidebar Drag-to-Resize

**Date:** 2026-06-08
**Status:** Fixed
**Severity:** UX / Performance

---

## Bug Description

1. **Left sidebar (TreeSidebar) had no drag-to-resize capability** — it was hardcoded to `w-60` (240px) with no way for users to adjust the width.

2. **Right sidebar resize was not smooth** — dragging the resize handle on the right sidebar caused visible lag/jank. The root cause was that every `mousemove` event dispatched `setRightSidebarWidth()` which updated the global Zustand-like store (React context + useReducer), triggering re-renders of ALL store consumers on every pixel of drag movement.

3. **No visual resize handle on the left sidebar** — users had no affordance to resize the left panel.

## Root Cause Analysis

The Git integration window (GitCommandCenter) has a perfectly smooth horizontal resize system because it uses **local `useState`** for the drag width. The right sidebar was using **global store state** (`state.rightSidebarWidth` + `setRightSidebarWidth`) which dispatches a reducer action on every `mousemove`, causing the entire component tree subscribed to the store to re-render.

The performance difference:
- **Local state drag:** Only the dragging component re-renders → smooth 60fps
- **Global store drag:** All store consumers re-render on every mousemove → janky

## Fix

### 1. Left Sidebar: Added drag-to-resize (TreeSidebar)
- Added `leftSidebarWidth` to the project store (interface, initial state, action type, reducer case, API method)
- Added local `useState` for `sidebarWidth` during drag (same smooth pattern as GitCommandCenter)
- Added `sidebarWidthRef` to avoid stale closure issues in mouseup handler
- Added a vertical resize handle on the right edge of the left sidebar with hover/drag visual indicators
- Syncs final width to store on mouseup for persistence
- Width clamped between 180px and 500px

### 2. Right Sidebar: Fixed smoothness (RightSidebar)
- Changed from using `state.rightSidebarWidth` directly to using local `useState` during drag
- Added `sidebarWidthRef` to avoid stale closure in mouseup handler
- `setRightSidebarWidth` (store dispatch) is now only called on mouseup, not on every mousemove
- Disabled CSS `transition-[width]` during active drag to prevent animation lag
- Added `useEffect` to sync local state from store when it changes externally

### 3. Test Update
- Updated `RightSidebar.test.tsx` resize test to verify the new behavior: store is NOT called during drag, only on mouseup with the final width value

## Files Changed

- `src/renderer/src/stores/project-store.tsx` — Added `leftSidebarWidth` state, `SET_LEFT_SIDEBAR_WIDTH` action, `setLeftSidebarWidth` API method
- `src/renderer/src/components/layout/TreeSidebar.tsx` — Added drag-to-resize with local state pattern + visual resize handle
- `src/renderer/src/components/layout/RightSidebar.tsx` — Switched to local state during drag, disabled transition during drag
- `src/tests/renderer/RightSidebar.test.tsx` — Updated resize test for new mouseup-sync behavior
