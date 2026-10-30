# Left (Sessions) Sidebar Stutters When Dragging, Right Sidebar Feels "Liquid Smooth"

**Date:** 2026-06-14
**Severity:** Medium (UX/feel)
**Component:** TreeSidebar (left sessions sidebar)
**File:** `src/renderer/src/components/layout/TreeSidebar.tsx`

## Bug Description

Dragging the left sidebar's resize handle felt stuttery and laggy, while the
right sidebar (changes/diff panel) dragged smoothly. Both sidebars use
identical drag logic — local width state on every `mousemove`, store sync on
`mouseup` — so the difference was not in the drag handlers themselves.

## Root Cause

Every `mousemove` during a drag calls `setSidebarWidth`, which re-renders the
**entire** `TreeSidebar` component. The left sidebar's body is heavy: a Radix
`ScrollArea` containing a Radix `ContextMenu` tree for every project and every
visible session row. Each mousemove therefore re-rendered ~40+ Radix menu
subtrees, pushing the per-mousemove React commit to 18–39ms (measured), well
above the 16.7ms frame budget — the visible stutter.

The right sidebar re-renders the same lightweight pattern but its body is a
small icon rail plus a virtualized (react-virtuoso) diff list, so its
per-mousemove commit stayed well under the frame budget.

## How It Was Diagnosed

A smoothness feedback loop was built:
`src/tests/renderer/sidebar-drag-smoothness.test.tsx` simulates a drag
(mousedown on the resize handle + 30 `mousemove` events), times each
mousemove's React commit, and asserts the p95 stays under 8ms (a frame-budget
proxy). Before the fix: left p95 ≈ 18–39ms (max 51ms), right p95 < 8ms.

Hypothesis confirmed: the missing render boundary between the drag state and
the content tree was the cause.

## Fix

Extracted the sidebar body (Add Folder header, project/session list, Settings
button, toast) into a new `React.memo` component, `SidebarBody`, inside
`TreeSidebar.tsx`. `TreeSidebar` is now a thin shell that owns the width
state, the `<aside style={{width}}>` and the resize handle; width-only
changes re-render only the shell, and `SidebarBody`'s memo skips the whole
Radix tree because all of its props are reference-stable across drags
(store `state` is a `useReducer` value — no dispatch until mouseup; callbacks
are stable `useCallback`s; remaining props are primitives).

`toggleExpand` was wrapped in `useCallback` so its identity stays stable and
the memo boundary holds.

After the fix: left p95 ≈ 0.31ms (max 0.43ms), on par with the right
sidebar's ≈ 0.59ms. Both sidebars now drag with the same smoothness.

## Regression Guard

`src/tests/renderer/sidebar-drag-smoothness.test.tsx` locks this in: both
sidebars must keep their per-mousemove commit under 8ms. If the left body
grows heavy again, the test goes red.
