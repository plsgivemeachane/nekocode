## Bug: Virtualized Chat Messages Overlap (Z-Fighting)

**Date:** 2026-05-06  
**Component:** `MessagesTimeline.tsx`  
**Severity:** High (visual corruption, text illegible)

### Description

In the chat view, when assistant messages containing code blocks (rendered via Shiki syntax highlighting) scrolled into the **virtualized prefix** region, multiple lines of text and interface elements were drawn directly on top of one another. This "z-fighting" or layout overlap produced a dense, illegible white cluster where characters from different lines collided.

The bug was most visible when:
1. A conversation had enough messages that some scrolled into the virtualized prefix (beyond the last 24 unvirtualized tail rows)
2. Those messages contained code blocks or other content whose rendered height changed after initial mount (e.g., Shiki syntax highlighting completing asynchronously)
3. The affected messages contained technical text with inline code references (e.g., `isMessagesStale`, `useSession`, `tool calls`)

### Root Cause

The `MessagesTimeline` component uses `@tanstack/react-virtual` for virtualization. Virtualized rows are rendered with `position: absolute` and `transform: translateY(virtualRow.start)` — their vertical position is entirely controlled by the virtualizer's cached size calculations.

The virtualizer's `measureElement` callback records each row's height on initial mount. When a row's content subsequently changes height (e.g., Shiki replacing a plain-text fallback `<pre>` with syntax-highlighted HTML), the virtualizer's cached size becomes stale. Since `translateY` offsets are computed from these cached sizes, subsequent virtualized rows get incorrect vertical offsets, causing them to overlap with previous rows.

**The critical flaw:** The `ResizeObserver` was attached to the **scroll container** (`scrollElement`), not to individual virtualized row elements. A `ResizeObserver` fires when the *observed element* changes size. The scroll container has `overflow-y: auto`, so when a child changes height, the scroll container's own dimensions don't change — only its `scrollHeight` changes, which does not trigger a `ResizeObserver` callback. This meant dynamic height changes inside virtualized rows were completely invisible to the re-measurement logic.

The `onLoadCapture` listener for `<img>` elements partially mitigated image-related height changes, but did not cover Shiki highlighting completion or any other dynamic content rendering.

### Fix

Replaced the scroll-container-level `ResizeObserver` with a per-row observation strategy:

1. Created a `useRowMeasureRef` hook that returns a ref callback combining:
   - `rowVirtualizer.measureElement(el)` — handles initial measurement and size caching (same as before)
   - `resizeObserver.observe(el)` — registers the row element with a shared `ResizeObserver` so any future height change triggers `rowVirtualizer.measure()`

2. The shared `ResizeObserver` is created in a `useEffect` and disconnected on cleanup. Its callback calls `rowVirtualizer.measure()`, which re-measures all virtualized items and recalculates `translateY` offsets.

3. Kept the `onLoadCapture` image-load listener as a defense-in-depth fallback for edge cases.

### Files Changed

- `src/renderer/src/components/chat/MessagesTimeline.tsx`
  - Added `useRef`, `useCallback` imports
  - Added `useRowMeasureRef` helper function (lines 16–31)
  - Replaced scroll-container `ResizeObserver` with per-row observation pattern (lines 67–97)
  - Changed virtualized row `ref` from `rowVirtualizer.measureElement` to `measureRef`

### Verification

- `bun run type-check` — passes
- `bun run lint` — passes
- `bun run test` — all 245 tests pass
