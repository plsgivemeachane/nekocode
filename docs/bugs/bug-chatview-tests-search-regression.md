# BUG-2: ChatView Tests Broken by useSearchSessions Regression

**Date:** 2026-06-15
**Severity:** High
**Status:** Fixed
**Files affected:**
- `src/renderer/src/hooks/useSearchSessions.ts`
- `src/tests/renderer/ChatView.test.tsx`

## Bug Description

After a prior agent refactored `useSearchSessions`, all 28 ChatView tests failed with:

```
TypeError: projectState.projects is not iterable
```

Only 2 tests were failing before the changes.

## Root Cause

Two issues combined:

1. **Early return moved inside the loop:** The `!query.trim()` early return was moved from before the `for...of` loop to inside it. This means the loop always executes at least one iteration before the early return can trigger.

2. **No null guard on `projectState.projects`:** The `for (const project of projectState.projects)` loop doesn't guard against `projects` being undefined. The ChatView test mock only provides `{ activeProjectPath, agentReady }` — no `projects` array. When `useSearchSessions` (called by `SearchPalette` which is rendered by `ChatView`) tries to iterate `undefined`, it throws.

## Fix

1. **Added null guard:** `const projects = projectState.projects ?? []` ensures the loop always has an iterable.

2. **Restored early return before the loop:** The `!query.trim()` check now happens before iterating, which is both more efficient and avoids the crash when `projects` is undefined.

3. **Added `projects: []` to ChatView test mock:** The `mockProjectState` now includes an empty `projects` array to properly simulate the store state that `useSearchSessions` expects.

## Verification

- All 28 ChatView tests pass (0 failures)
- `useSearchSessions` handles undefined `projects` gracefully
