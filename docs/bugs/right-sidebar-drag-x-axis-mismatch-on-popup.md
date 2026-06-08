# Right Sidebar Drag X-Axis Mismatch on Auto-Open Popup

**Date:** 2026-06-08  
**Status:** Fixed  
**File:** `src/renderer/src/components/layout/RightSidebar.tsx`  
**Component:** RightSidebar resize handle drag logic

## Bug Description

When the right sidebar is closed (no active panel) and the user clicks and drags the resize handle, the sidebar auto-opens to its stored/default width (480px). The resize handle jumps to its open position far from the mouse cursor, and the drag continues with an X-axis offset. The minimum width clamp (280px) also prevented dragging the sidebar closed.

### Reproduction Steps

1. Close the right sidebar (no active panel)
2. Click the resize handle and start dragging
3. Observe: the sidebar pops open to ~480px, handle is far left of the mouse cursor
4. Cannot drag to close because the min clamp (280px) blocks it

## Root Cause

Two problems compounded:

1. **Default pop-out on drag**: When auto-opening during drag, the sidebar expanded to the stored 480px width, creating an instant mismatch between mouse position and handle position.

2. **Minimum width clamp (280px)**: Prevented the user from ever dragging the sidebar small enough to correct the offset or close it by dragging.

## Fix

The simplest, cleanest fix - remove the artificial minimum clamp and do NOT pop the sidebar to a default width on auto-open. Instead, start the sidebar at 0px width and let the drag itself size it naturally:

1. **No default pop-out on auto-open drag**: When the sidebar auto-opens from closed during a drag, set the width to 0 instead of the stored 480px. The drag delta will size the sidebar to exactly where the mouse moves - no mismatch possible.

2. **Removed minimum clamp**: Changed `Math.max(280, ...)` to `Math.max(0, ...)` - sidebar can now be dragged down to 0px width.

3. **Drag-to-close snap**: On mouseUp, if the final width is <= 10px, snap the sidebar fully closed and reset the stored width to 480px for the next icon-click open.

The result: click the resize handle when sidebar is closed, panel opens at 0px, drag left and the sidebar grows from 0 following your mouse perfectly. Drag all the way right and the sidebar closes.

## Verification

- All 1611 tests pass
- Type check passes
