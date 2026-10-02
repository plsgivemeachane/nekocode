# Sidebar List Cannot Scroll

## Bug Description
The left sidebar (TreeSidebar) project/session list could not be scrolled. When there were enough projects or sessions to overflow the visible area, the content would extend beyond the viewport but no scrollbar would appear and mouse wheel/touchpad scrolling did nothing.

## Root Cause
The `<ScrollArea>` component in `TreeSidebar.tsx` was styled with `className="flex-1 px-2"`. The `flex-1` class makes the ScrollArea grow to fill remaining space in the parent flex column (`<aside className="... flex flex-col">`). However, in CSS flexbox, the default `min-height` value is `auto`, which means a flex child will not shrink below its content's intrinsic size.

This caused the Radix ScrollArea Root element to expand to fit all of its content, which in turn meant the Viewport's `size-full` (width: 100%, height: 100%) resolved to the full content height rather than the constrained container height. Without a constrained height, the Viewport never needed to scroll.

## Fix
Added `min-h-0` to the ScrollArea's className:

```tsx
// Before
<ScrollArea className="flex-1 px-2">

// After
<ScrollArea className="flex-1 min-h-0 px-2">
```

`min-h-0` sets `min-height: 0`, which allows the flex child to shrink below its content size. This lets the ScrollArea Root be constrained by the available flex space, and the Viewport's `size-full` then correctly resolves to that constrained height, enabling scrolling.

## File Changed
- `src/renderer/src/components/layout/TreeSidebar.tsx` (line 330)

## Related
- AGENTS.md documents the Radix ScrollArea `display: table` overflow clipping pitfall
- This is a different but related issue: the flex min-height problem prevents scrolling entirely, while the display:table issue clips content

## Lesson
When using Radix ScrollArea (or any scroll container) inside a flex layout, always add `min-h-0` (or `min-width-0` for horizontal flex) to allow the container to shrink below its content size. Without this, the scroll container expands to fit all content and scrolling never activates.
