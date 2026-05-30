# Right Sidebar Smooth Slide Animation

**Date:** 2026-05-30
**Component:** `RightSidebar.tsx`
**Type:** Enhancement / UX Improvement

## Problem

The right sidebar content panel previously used conditional rendering (`{activePanel && <aside>...</aside>}`), which caused an instant appear/disappear when clicking sidebar tab icons. There was no smooth transition — the panel would pop in and out abruptly, which felt jarring.

Additionally, when switching between panels (e.g., from "Diff" to "Outline"), the content would also swap instantly with no visual feedback.

## Solution

### 1. Always-mounted aside with CSS transitions

Changed the `<aside>` from conditional rendering to **always-mounted** with CSS transition properties:

- **Width transition:** The aside transitions between `width: 0` (collapsed) and its full width (`width: ${width}px`)
- **Opacity transition:** The aside fades from `opacity-0` (collapsed) to `opacity-100` (expanded)
- **Duration:** 300ms with `ease-out` timing function
- **Overflow:** `overflow-hidden` prevents content from bleeding when collapsed

Key CSS classes applied:
```
transition-[width,opacity] duration-300 ease-out overflow-hidden
```

When `activePanel` is null: `opacity-0 !w-0` (Tailwind v4 important prefix)
When `activePanel` is set: `opacity-100` with inline `style={{ width: '480px' }}`

### 2. Crossfade between panel content

Both `DiffPanel` and `OutlinePanel` are now always mounted in the content area, using absolute positioning and opacity-based crossfading:

- Each panel container gets `absolute inset-0` positioning
- The active panel has `opacity-100` while inactive panels have `opacity-0 pointer-events-none`
- Crossfade duration: 200ms for a snappy but smooth panel switch

### 3. Conditional close button rendering

The close button (`aria-label="Close panel"`) is conditionally rendered only when `activePanel` is truthy. This maintains the existing test contract (`no close button when no panel is active`).

### 4. Zero-width space fallback for header text

When no panel is active, the header label renders a zero-width space (`\u200B`) instead of empty text, preventing the header from collapsing oddly during the fade-out animation.

## Files Changed

- `src/renderer/src/components/layout/RightSidebar.tsx` — Main animation logic

## Test Impact

- All 62 RightSidebar tests pass
- The `no close button when no panel is active` test was preserved by conditionally rendering the close button based on `activePanel`
- No new tests were needed (existing tests cover the behavior)
