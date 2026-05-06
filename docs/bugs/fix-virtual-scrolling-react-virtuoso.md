# Fix: Replace broken @tanstack/react-virtual with react-virtuoso

## Date
2026-05-06

## Summary
Replaced the broken `@tanstack/react-virtual` implementation in `MessagesTimeline.tsx` with `react-virtuoso`, following the recommendation in `docs/research/virtual-scrolling-libraries.md`.

## Bug Description

The `MessagesTimeline` component used `@tanstack/react-virtual` (`useVirtualizer`) with a **hybrid pattern**: virtualized prefix rows + unvirtualized tail rows. This pattern was fundamentally fragile:

1. **Manual height bookkeeping**: Required a `ResizeObserver` on every message row to track dynamic heights (code blocks, Shiki syntax highlighting, images). When a row's height changed after initial render (e.g., syntax highlighting async load), the virtualizer's cached measurements became stale, causing incorrect scroll positions and visual jumps.

2. **Hybrid scroll container split**: The virtualized portion lived in one container and the unvirtualized tail in another, both inside a parent scroll container. Coordinating scroll position between them was error-prone — scrolling past the virtualized boundary into the tail caused jank and incorrect offset calculations.

3. **Auto-scroll complexity**: The `useAutoScroll` hook had to manually detect "at bottom" state via `onScroll` + `isAtBottomRef`, manually scroll on `scrollDeps` changes, manually handle `ResizeObserver` callbacks, and manually snap on session switches. Each of these had edge cases (rAF timing, null refs, concurrent scrolls).

4. **Session switch scroll**: Switching sessions required resetting the virtualizer's scroll position, which involved carefully timed `requestAnimationFrame` double-flips and manual `scrollTop` assignments that could race with React renders.

## Root Cause

`@tanstack/react-virtual` is a low-level virtualization primitive that requires the consumer to manage:
- Scroll container creation and sizing
- Row height measurement (or estimation)
- Scroll position synchronization
- "At bottom" detection
- Auto-follow during content growth

All of these were implemented manually in NekoCode, and the combination of dynamic-height rows + streaming content + session switching exposed fundamental limitations of the manual approach.

## Fix

Replaced `@tanstack/react-virtual` with `react-virtuoso`, which handles all of the above internally.

### Changes Made

#### `src/renderer/src/components/chat/MessagesTimeline.tsx` (full rewrite)
- Replaced `useVirtualizer` from `@tanstack/react-virtual` with `Virtuoso` from `react-virtuoso`
- Removed the hybrid virtualized prefix + unvirtualized tail pattern entirely
- Removed `getUnvirtualizedTailRows` and `getVirtualizedPrefixCount` helper functions
- Added `forwardRef` + `useImperativeHandle` to expose `scrollToBottom` method
- Used `followOutput="smooth"` for auto-scroll during streaming (replaces manual `useAutoScroll` integration)
- Used `atBottomStateChange` callback for scroll-to-bottom button visibility (replaces manual `isAtBottomRef` tracking)
- Used `initialTopMostItemIndex` for session switch scroll-to-bottom
- React-virtuoso automatically measures dynamic row heights — no `ResizeObserver` needed
- `overscan={200}` and `defaultItemHeight={100}` tuned for code-heavy messages

#### `src/renderer/src/components/chat/ChatView.tsx`
- Removed `useAutoScroll` import and usage for the messages area
- Added `timelineRef` (ref to `MessagesTimeline`) and `showScrollBtn` state
- Added `handleAtBottomChange` callback wired to `atBottomStateChange` prop
- Added `handleScrollToBottom` using `timelineRef.current.scrollToBottom()`
- Removed `scrollContainerRef` and `messageContentRef` (no longer needed — react-virtuoso manages its own scroll container)
- Removed `onScroll={handleScroll}` from `<main>` (react-virtuoso handles scroll internally)
- Changed `<main>` from `overflow-y-auto` to `overflow-hidden`
- Added `h-full` to the MessagesTimeline wrapper div so react-virtuoso gets proper container height

#### `src/tests/renderer/messages-timeline.test.ts` (full rewrite)
- Replaced tests for removed helpers (`getUnvirtualizedTailRows`, `getVirtualizedPrefixCount`)
- Added tests for: rendering rows, empty state, `scrollToBottom` ref API, `atBottomStateChange` prop
- Mocked `react-virtuoso` with `React.createElement` (avoids JSX-in-`vi.mock` parse issues with `tsc`)

#### `package.json`
- Added `react-virtuoso: ^4.12.3` to dependencies
- Kept `@tanstack/react-virtual` in dependencies (other code may reference it)

### What Was NOT Changed

- **`useAutoScroll.ts`**: The hook itself is unchanged and still works correctly in isolation. It's no longer used by `ChatView` for the messages area, but may be useful for other scroll containers in the future.
- **`useAutoScroll.test.ts`**: All 43 existing tests continue to pass.

## Verification

- `bun run type-check` — passes (0 errors)
- `bun run lint` — passes (0 errors, 0 warnings)
- `bun run test` — passes (all test suites green, including the rewritten messages-timeline tests and the unchanged useAutoScroll tests)

## Research Reference

Full library comparison and decision rationale: `docs/research/virtual-scrolling-libraries.md`
