# Unscrollable New Session Screen — Content Clipped at Top and Bottom

**Date:** 2026-05-12  
**Status:** Fixed  
**Severity:** Medium  
**Affected Area:** `src/renderer/src/components/chat/ChatView.tsx`

## Summary

On the main NekoCode screen (the new session screen and the welcome screen shown when no messages are present), the content was unscrollable because the parent container had `overflow-hidden`. On smaller viewports, the top (logo, title) and bottom (keyboard shortcuts) of the welcome content were cut off and inaccessible.

## Root Cause

The layout chain had `overflow-hidden` at two levels:

1. **App.tsx root div** — `<div className="flex h-screen overflow-hidden ...">` prevents any overflow from the overall layout.
2. **ChatView.tsx inner content div** — `<div className="h-full overflow-hidden px-6 pt-8 pb-10">` wraps the welcome screen, no-session screen, and message list.

When the welcome screen content (logo, rotating quote, rotating tips, keyboard shortcuts) exceeded the available viewport height, it was clipped because `overflow-hidden` suppressed both scrollbars and overflow visibility. The Virtuoso virtualized list (used for messages) requires `overflow-hidden` on its parent to correctly constrain the flex height, but the welcome/no-session states need `overflow-y-auto` to allow scrolling.

## Fix

In `ChatView.tsx`, the inner div's `overflow` class is now conditional:

- When `messages.length > 0` → use `overflow-hidden` (Virtuoso needs this for correct flex height measurement).
- When `messages.length === 0` → use `overflow-y-auto` (allows scrolling the welcome/no-session content).

**Change:** Added a `contentOverflow` variable before the return statement and replaced the static `overflow-hidden` class with a template literal using the variable.

```tsx
const contentOverflow = messages.length > 0 ? 'overflow-hidden' : 'overflow-y-auto'

// ...
<div className={`h-full ${contentOverflow} px-6 pt-8 pb-10`}>
```

## Verification

- ✅ `bun run lint` — No errors
- ✅ `bun run type-check` — No errors
- ✅ `bun run test` — All 232 tests passing
- ✅ `bun run package:local` — Build and packaging successful

---

## Part 2: Top Content Still Hidden on Zoom (Follow-up Fix)

**Date:** 2026-05-12  
**Status:** Fixed

### Root Cause

After the initial fix (`overflow-y-auto` on parent when no messages), the **bottom** of the content became scrollable, but the **top** remained clipped when zooming in. This was because `WelcomeScreen` and the inline no-session div both used `h-full` (height: 100% of parent) combined with `justify-center`.

With `h-full`, the child's height matched the parent's content height exactly, so it never overflowed — the parent's `overflow-y-auto` never triggered. The child's own content (logo, title, tips, shortcuts) overflowed beyond the child's bounds, but this overflow was invisible to the parent's scroll logic. `justify-center` pushed the overflow equally above and below, leaving the top permanently clipped. Zooming in shrinks the effective viewport, making the overflow worse.

### Fix

Changed `h-full` → `min-h-full` in two places:

1. **WelcomeScreen.tsx** — root div  
2. **ChatView.tsx** — the inline no-session placeholder (`!sessionId`)

`min-h-full` allows the container to grow beyond the parent's height when its content overflows, which triggers the parent's `overflow-y-auto` — making both top and bottom scrollable.

```tsx
// Before
<div className="flex flex-col items-center justify-center h-full select-none pt-16">
// After
<div className="flex flex-col items-center justify-center min-h-full select-none pt-16">
```

### Verification

- ✅ `bun run lint` — No errors
- ✅ `bun run type-check` — No errors
- ✅ `bun run test` — All tests passing
- ✅ `bun run package:local` — Build and packaging successful
