# Right Sidebar Resize Handle — Always-Visible Quirk

**Date:** 2026-05-31
**Status:** Fixed
**Component:** RightSidebar

## Problem

The right sidebar's draggable resize handle was only visible when a panel (diff or outline) was active. When no panel was active, the resize handle disappeared entirely, meaning:

1. The user couldn't visually discover that the sidebar area is resizable.
2. Even if they knew the handle was there, they couldn't drag to resize — they had to first click an icon to open a panel, then drag.
3. There was no way to "drag-open" the sidebar from a closed state.

## Solution

### Change 1: Always-visible resize handle
Removed the `{activePanel && (...)}` conditional wrapper around the resize handle JSX. The handle is now always rendered, even when no panel is active. This makes the sidebar feel more interactive and discoverable.

### Change 2: Auto-open on drag
Added a `lastActivePanelRef` that tracks which panel was most recently active. When the user starts dragging the resize handle with no active panel, the component automatically:

- Opens the **last active panel** (if one was previously opened this session), OR
- Defaults to the **"diff" panel** if no panel was ever opened.

This creates a satisfying "drag to open" interaction — the user can discover and open the sidebar just by dragging.

## Files Modified

- `src/renderer/src/components/layout/RightSidebar.tsx` — Added `lastActivePanelRef`, `useEffect` to sync it, auto-open logic in `handleResizeMouseDown`, removed conditional render of resize handle.
- `src/tests/renderer/RightSidebar.test.tsx` — Updated "resize handle NOT visible" test to "IS visible", added 2 new tests for auto-open behavior.

## Technical Details

- `lastActivePanelRef` is a `useRef<Exclude<RightSidebarPanel, null>>("diff")` initialized to "diff" as the default.
- The `useEffect` syncs `lastActivePanelRef.current = activePanel` whenever a panel is opened.
- In `handleResizeMouseDown`, `if (!activePanel) setRightSidebarPanel(lastActivePanelRef.current)` fires before the drag begins.
- The `useCallback` dependency array was updated to include `activePanel` and `setRightSidebarPanel`.
