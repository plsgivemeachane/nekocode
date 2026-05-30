# Right Sidebar Redesign: Dashboard Pattern + Scroll Overlap Fix

**Date:** 2025-05-30
**Status:** Fixed
**Severity:** UX/Missing Feature

## Problem Description

Two issues with the right sidebar and diff viewer:

1. **Scroll-to-bottom button overlapping the right sidebar**: The scroll-to-bottom button used `fixed` positioning (`fixed bottom-24 right-8`), which positions it relative to the viewport. When the right sidebar opened and took horizontal space, the button stayed at the same viewport position — overlapping the sidebar content.

2. **Entire right sidebar was only the diff viewer**: The previous implementation dedicated the entire right sidebar column to the diff viewer. There was no way to add other panels (outline, terminal, etc.). The user wanted a **dashboard sidebar pattern** — a narrow icon rail that's always visible, where clicking an icon opens the corresponding content panel. This is the pattern used in VS Code, JetBrains IDEs, and other dashboard UIs.

## Root Cause

1. The scroll-to-bottom button used `fixed` CSS positioning instead of `absolute` relative to its container. With `fixed`, the button ignores layout flow and stays pinned to the viewport edge regardless of sidebar state.

2. The RightSidebar component was designed as a single-purpose panel (diff viewer only) with a toggle strip on the right edge. It wasn't architected as a multi-panel dashboard sidebar.

## Solution

### 1. Scroll-to-bottom button fix

Changed the button from `fixed` to `absolute` positioning inside the ChatView's `<main>` element (which already has `relative` positioning). Now the button is positioned relative to the chat area, so when the right sidebar opens and the chat area shrinks, the button moves with it — no overlap.

**Before:** `className="fixed bottom-24 right-8 ..."`
**After:** `className="absolute bottom-24 right-4 ..."`

### 2. Dashboard sidebar redesign

Redesigned the RightSidebar as a two-part dashboard sidebar:

```
┌──────┬──────────────────┐
│ Icon │                  │
│ Rail │  Content Panel   │
│      │  (variable width)│
│ 📄   │                  │
│ 📋   │                  │
│      │                  │
└──────┴──────────────────┘
```

**Icon Rail (always visible, 48px wide):**
- Full height, narrow column with clickable icons
- Each icon represents a panel (diff, outline, etc.)
- Active icon is highlighted with accent color + left indicator bar
- Badge counts on icons (e.g., number of changed files on the diff icon)
- Clicking an active icon toggles it off (closes the panel)
- Clicking an inactive icon opens that panel

**Content Panel (variable width):**
- Slides out from the icon rail when a panel is selected
- Shows the selected panel's content (diff viewer, outline, etc.)
- Resizable via drag handle on the left edge (280px–900px)
- Has a header with panel name + close button
- Closable via Escape key

**Currently supported panels:**
- `diff`: File changes viewer (SessionDiffView) — shows diffs for write/edit tool calls
- `outline`: Placeholder for future file outline/symbols view

### 3. State management update

Updated `project-store.tsx` to replace the boolean `rightSidebarOpen` with a panel type:

```typescript
export type RightSidebarPanel = 'diff' | 'outline' | null

// State:
rightSidebarActivePanel: RightSidebarPanel  // null = closed
rightSidebarWidth: number                    // content panel width
rightSidebarSelectedToolCallId: string | null // scroll target

// Actions:
SET_RIGHT_SIDEBAR_PANEL  // set active panel (null to close)
SET_RIGHT_SIDEBAR_WIDTH  // resize content panel

// API:
setRightSidebarPanel(panel, selectedToolCallId?)
setRightSidebarWidth(width)
```

When a tool call is clicked in ChatView, it opens the diff panel via `setRightSidebarPanel('diff', toolCallId)`.

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/src/stores/project-store.tsx` | Replaced `rightSidebarOpen: boolean` with `rightSidebarActivePanel: RightSidebarPanel`; renamed `SET_RIGHT_SIDEBAR` → `SET_RIGHT_SIDEBAR_PANEL`; renamed `setRightSidebar()` → `setRightSidebarPanel()` |
| `src/renderer/src/components/layout/RightSidebar.tsx` | **Rewritten** — Dashboard sidebar with icon rail + content panel pattern; added `RailItem` definitions; per-panel content components (`DiffPanel`, `OutlinePanel`); resizable content area |
| `src/renderer/src/components/chat/ChatView.tsx` | Fixed scroll-to-bottom button from `fixed` to `absolute` positioning; updated context usage for new panel API |
| `src/tests/renderer/ChatView.test.tsx` | Already had mock for `useSessionMessages` (from previous fix) |

## Testing

- All 1563 tests pass
- Type-check (`tsc --noEmit`) clean
- Lint clean
