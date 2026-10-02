# ScrollArea Overflow Clipping — Sidebar & Git Modal

**Date:** 2026-05-31
**Severity:** Medium (UI broken — content hidden/cut off at default window width)
**Components:** TreeSidebar, GitCommandCenter, Radix ScrollArea

## Bug Description

Two related overflow clipping issues caused by the Radix ScrollArea's internal layout behavior:

### Issue 1: Left Sidebar — Right Edge Clipped (~5% overflow)

When hovering over or selecting project rows or session items in the left sidebar (`TreeSidebar`), about 95% of the content width is visible but the rightmost ~5% overflows and is clipped. This is most visible on hover/active state boxes which lose their right-side rounded corners — the right two corners are cut off while the left two render correctly.

### Issue 2: Git Modal — Left Panel Right Edge Clipped (~5% overflow)

In the Git integration modal (`GitCommandCenter`), the left panel suffers the same ~5% right-edge clipping. About 95% of the content width is visible, but the rightmost portion (including the right edges of buttons, input boxes, file entries, and the plus sign to stage files) overflows and is hidden. The content becomes fully visible only when the window or panel is resized larger.

## Root Cause

Both issues share the same root cause: **the Radix ScrollArea viewport wraps children in an internal `<div style="min-width: 100%; display: table">`**.

### How it causes clipping

1. The Radix ScrollArea Viewport sets `overflowX: "hidden"` when no horizontal scrollbar is enabled (the default for vertical-only scroll areas).
2. The inner wrapper's `display: table` allows its width to expand beyond the viewport width when content has inherent width (table cells can grow).
3. When the inner wrapper is wider than the viewport, `overflowX: hidden` clips the right side — cutting off rounded corners, borders, and entire UI elements.

### Additional cause for the Git Modal

The Git modal's left panel ScrollArea had `className="flex flex-col ..."` which added `display: flex; flex-direction: column` to the ScrollArea Root element. This interfered with how the Radix Viewport's `size-full` (width: 100%, height: 100%) resolved its dimensions in the flex layout, potentially causing the Viewport to collapse or miscalculate its width.

## Fix Applied

### Fix 1: Global CSS Override for Radix ScrollArea Inner Wrapper

**File:** `src/renderer/src/index.css`

Added a CSS rule that overrides the internal wrapper's `display: table` to `display: block`:

```css
[data-radix-scroll-area-viewport] > div {
  display: block !important;
}
```

This prevents the inner content from expanding beyond the viewport width while maintaining the `min-width: 100%` behavior (content fills available space). With `display: block`, the content is constrained to the viewport width and children with `overflow: visible` (the default) can render their rounded corners, borders, and shadows beyond the boundary — but since the content itself doesn't exceed the viewport, there's nothing to clip.

### Fix 2: Remove `flex flex-col` from GitCommandCenter ScrollArea

**File:** `src/renderer/src/components/git/GitCommandCenter.tsx`

Changed:
```tsx
<ScrollArea className="flex flex-col border-r border-surface-800/50 shrink-0" style={{ width: leftPanelWidth }}>
```

To:
```tsx
<ScrollArea className="border-r border-surface-800/50 shrink-0" style={{ width: leftPanelWidth }}>
```

The `flex flex-col` on the ScrollArea Root interfered with Radix's internal layout calculations. The ScrollArea manages its own scrolling internally — `flex flex-col` is not needed on the Root element because the children are already in a vertical flow within the scrollable content area.

## Why This Fix Is Safe

- `display: block` is the natural default for `<div>` elements. The Radix team uses `display: table` to ensure the wrapper shrinks-to-fit content while being at least 100% wide, but `display: block` with `min-width: 100%` achieves the same result without the width-expansion side effect.
- The override uses the `data-radix-scroll-area-viewport` attribute selector, which is stable and specific to Radix ScrollArea instances.
- No existing ScrollArea instances in the codebase use horizontal scrolling, so the `display: block` change doesn't break any horizontal scroll behavior.
- If horizontal scrolling is added in the future, the CSS override may need to be revisited (the `display: table` helps with horizontal scroll content width calculation).

## Files Changed

1. `src/renderer/src/index.css` — Added Radix ScrollArea inner wrapper override
2. `src/renderer/src/components/git/GitCommandCenter.tsx` — Removed `flex flex-col` from left panel ScrollArea
