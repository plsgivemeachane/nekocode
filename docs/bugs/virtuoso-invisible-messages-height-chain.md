# Fix: Virtuoso renders invisible (0px height) — messages area blank

## Date
2026-05-06

## Summary
After migrating from `@tanstack/react-virtual` to `react-virtuoso` (see `fix-virtual-scrolling-react-virtuoso.md`), the messages area rendered completely blank despite messageGroups being populated (50 groups, 79 messages in logs). Two bugs were found and fixed.

## Bug Description

### Bug 1: Broken CSS height chain (primary — messages invisible)

The DOM hierarchy for the messages area was:

```
<main className="flex-1 overflow-hidden relative">          ← gets height from flex ✓
  <div className="h-full overflow-hidden px-6 pt-8 pb-10">  ← h-full ✓
    <div className="relative h-full">                        ← h-full ✓
      <div className="max-w-3xl mx-auto pt-4 ...">           ← NO HEIGHT ✗
        <Virtuoso />                                         ← height: 100% = 0px
```

react-virtuoso's `<Virtuoso>` component defaults to `height: 100%` on its root element. The `max-w-3xl mx-auto pt-4` wrapper div had **no explicit height**, so `100%` resolved to **0px**. The Virtuoso scroll container was rendered but invisible — no scroll, no items, no errors.

The bug was silent: no console errors, no React warnings, no layout exceptions. The `messageGroups` debug logs showed data was flowing correctly, making it look like a rendering issue rather than a layout one.

### Bug 2: `initialTopMostItemIndex` stuck at `-1` (secondary — wrong scroll on first load)

```tsx
const [initialIndex, setInitialIndex] = useState(rows.length - 1)
```

On first render, `rows.length === 0` → `initialIndex = -1`. When messages arrived (0 → 50 rows), the `useEffect` heuristic:

```tsx
if (rows.length < prev * 0.5) { ... }
```

evaluated `50 < 0 * 0.5` → `50 < 0` → `false`, so `initialIndex` was never corrected from `-1`. This meant Virtuoso received `initialTopMostItemIndex={-1}`, an invalid index.

### Bug 3: Test file mock hoisting error (test-only)

The `messages-timeline.test.ts` file defined `MockVirtuoso` as a `const` at module scope, then referenced it inside `vi.mock('react-virtuoso', () => ({ Virtuoso: MockVirtuoso }))`. Since `vi.mock` is hoisted before variable declarations, `MockVirtuoso` was `undefined` at mock-evaluation time, causing `ReferenceError: Cannot access 'MockVirtuoso' before initialization`.

Additionally, the test file was missing `// @vitest-environment jsdom`, causing `document is not defined` errors from `@testing-library/react`.

## Root Cause

1. **Height chain**: The react-virtuoso migration removed `overflow-y-auto` from `<main>` and added `overflow-hidden`, but the intermediate wrapper div was never given `h-full` to propagate height to the Virtuoso component. The migration doc (`fix-virtual-scrolling-react-virtuoso.md`) mentioned adding `h-full` to the MessagesTimeline wrapper, but the actual wrapper (`max-w-3xl mx-auto pt-4`) was not updated.

2. **Initial index**: The `useEffect` heuristic for detecting session switches didn't handle the common 0→N transition (first message load), only the N→M (session switch) and N→0 (clear) cases.

3. **Test mock**: `vi.mock` factory closures cannot reference module-scope `const`/`let` variables because the factory is hoisted before those variables are initialized.

## Fix

### `src/renderer/src/components/chat/ChatView.tsx`

Added `h-full flex flex-col` to the `max-w-3xl` wrapper div, and wrapped `MessagesTimeline` in a `flex-1 min-h-0` container:

```tsx
// Before:
<div className="max-w-3xl mx-auto pt-4 transition-all ...">
  <MessagesTimeline ... />
  <StatusIndicator ... />
</div>

// After:
<div className="max-w-3xl mx-auto pt-4 h-full flex flex-col transition-all ...">
  <div className="flex-1 min-h-0">
    <MessagesTimeline ... />
  </div>
  <StatusIndicator ... />
</div>
```

This ensures:
- The wrapper has `h-full` (100% of its parent's height)
- `flex flex-col` makes it a flex column container
- `flex-1 min-h-0` on the MessagesTimeline wrapper gives Virtuoso a computed height from the flex layout
- StatusIndicator sits below the flex-growing message area

### `src/renderer/src/components/chat/MessagesTimeline.tsx`

Added `prev === 0 && rows.length > 0` case to the `useEffect` that manages `initialTopMostItemIndex`:

```tsx
// Before:
if (rows.length === 0) {
  setInitialIndex(0)
} else if (rows.length < prev * 0.5) {
  setInitialIndex(rows.length - 1)
}

// After:
if (rows.length === 0) {
  setInitialIndex(0)
} else if (prev === 0 && rows.length > 0) {
  // First load: rows went from 0 to N — snap to bottom
  setInitialIndex(rows.length - 1)
} else if (rows.length < prev * 0.5) {
  setInitialIndex(rows.length - 1)
}
```

### `src/tests/renderer/messages-timeline.test.ts`

1. Added `// @vitest-environment jsdom` directive at top of file
2. Moved `MockVirtuoso` definition inside the `vi.mock` factory (self-contained mock)
3. Used `await import(...)` for the component under test (after mock registration)
4. Moved `import type { MessagesTimelineHandle }` to top (type-only imports are erased and don't conflict with vi.mock hoisting)

## Verification

- `bun run type-check` — passes (0 errors)
- `bun run lint` — passes (0 errors, 0 warnings)
- `bun run test` — passes (27 suites, 621 tests, all green)
