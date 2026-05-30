# Right Sidebar Resize Handle Position Bug

**Date:** 2026-05-30
**Status:** Fixed
**File:** `src/renderer/src/components/layout/RightSidebar.tsx`

## Bug Description

The resize drag handle for the right sidebar was positioned between the icon rail and the content panel, instead of on the left edge of the entire sidebar (between the main chat content area and the sidebar).

Additionally, the visual indicator for the drag handle was a full-height vertical line, which was not a subtle or intuitive indicator of where to drag.

## Wrong Layout (Before Fix)

```
[Main Chat Content] | [Icon Rail] [DRAG HANDLE] [Content Panel]
```

The drag handle was an absolute-positioned element inside the content `<aside>`, placed at `-left-1` (between the icon rail and the content panel). This meant:

1. The drag area was in the wrong position — users expected to drag from the left edge of the sidebar (between main content and sidebar), not from between the icon rail and content.
2. The visual indicator was a full-height vertical line, which was not a subtle hint.

## Correct Layout (After Fix)

```
[Main Chat Content] [DRAG HANDLE] | [Icon Rail] [Content Panel]
```

The drag handle is now:

1. Positioned on the LEFT edge of the entire `<RightSidebar>` outermost `<div>` (between the main chat content and the sidebar)
2. Styled as a small floating stick indicator (like a scrollbar thumb) — 3px wide, 8px tall by default, expanding to 12px on hover/drag
3. Only visible when there's an active content panel (resize only makes sense when a panel is open)
4. Uses proper React state (`isDraggingState`) for visual reactivity instead of a `useRef` that doesn't trigger re-renders

## Technical Changes

1. **Moved resize handle** from inside the content `<aside>` to the outermost `<div>` of RightSidebar, positioned at `-left-1.5` (absolute, left edge)
2. **Changed visual indicator** from a full-height vertical line (`w-0.5 h-full`) to a small floating stick (`w-[3px] h-8` default, `h-12` on hover/drag), centered vertically, with `rounded-full` and smooth transition
3. **Added `isDraggingState`** — a proper `useState` boolean for the drag visual state, since `isDragging.current` (useRef) doesn't trigger re-renders
4. **Moved `border-l`** from the outermost `<div>` to the icon rail `<div>`, so the border visually separates the sidebar from the main content area
5. **Conditionally rendered** the drag handle only when `activePanel` is truthy
6. **Updated architecture comment** at the top of the file to reflect the new layout

## Root Cause

The original implementation placed the resize handle inside the content panel's `<aside>` element, which meant it was always relative to the content panel rather than the entire sidebar. The layout intent was for the handle to be between the main content and the sidebar, but the implementation placed it between the icon rail and the content panel.
