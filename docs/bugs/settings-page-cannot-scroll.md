# Bug: Settings Page Cannot Scroll

**Date:** 2026-05-30
**Status:** Fixed
**Severity:** High — settings content is inaccessible when it overflows the viewport

## Description

The Settings page in NekoCode cannot be scrolled. When the settings content (notification settings, etc.) exceeds the viewport height, the content is clipped and there is no way to scroll down to see it. The scrollbar never appears.

## Root Cause

CSS Flexbox `min-height: auto` behavior prevents `overflow-y-auto` from activating in nested flex layouts.

### The Flex Layout Chain

The Settings page is rendered inside a nested flex layout:

```
Root: h-screen overflow-hidden flex flex-col
  └─ NavBar (fixed height)
  └─ Main Row: flex flex-1 min-h-0
       └─ Content Column: flex-1 min-w-0 flex flex-col    ← MISSING min-h-0
            └─ SettingsView: flex-1 min-w-0 flex flex-col  ← MISSING min-h-0
                 └─ Header (fixed height)
                 └─ Scrollable: flex-1 overflow-y-auto     ← Never activates!
```

### Why Scroll Didn't Work

In CSS Flexbox, `overflow-y: auto` only creates a scrollbar when the element has a **constrained height** — it must know its exact pixel height and the content must exceed it.

The problem: in a flex column layout, a flex item's default `min-height` is `auto`, which resolves to `min-content` (the minimum height needed to fit all content). This means:

1. **Content Column** (`flex-1 min-w-0 flex flex-col`): Without `min-h-0`, this div's minimum height defaults to the height of its content (SettingsView). Even though the row constrains the *available* height, the content column's min-height prevents SettingsView from shrinking.

2. **SettingsView outer** (`flex-1 min-w-0 flex flex-col`): Same issue — without `min-h-0`, its minimum height is its content, so it expands to fit all children regardless of `overflow-y-auto`.

3. **The scrollable div** (`flex-1 overflow-y-auto`): Because its parent (SettingsView) expands to fit all content, this div also gets an unconstrained height. Content never overflows, so no scrollbar appears.

### The Fix

Add `min-h-0` (which sets `min-height: 0`) to both flex column containers in the chain:

1. **App.tsx** — Content column: `flex-1 min-w-0 min-h-0 flex flex-col`
2. **SettingsView.tsx** — Outer div: `flex-1 min-w-0 min-h-0 flex flex-col bg-surface-950`

`min-h-0` overrides the default `min-height: auto`, allowing flex items to shrink below their content size. This constrains the height properly through the chain, enabling `overflow-y-auto` to detect overflow and create a scrollbar.

## Files Changed

- `src/renderer/src/App.tsx` — Added `min-h-0` to content column wrapper
- `src/renderer/src/components/settings/SettingsView.tsx` — Added `min-h-0` to outer div

## Verification

- All existing tests pass (`bun run test`)
- Type check passes (`bun run type-check`)
- Lint passes (`bun run lint`)
