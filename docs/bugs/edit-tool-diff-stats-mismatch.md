# Bug: Edit Tool Diff Stats Mismatch with @pierre/diffs

**Date:** 2026-05-30
**Status:** Fixed
**Files Changed:**
- `src/renderer/src/components/chat/tool-summary.ts`
- `src/tests/shared/tool-summary.test.ts`

## Problem

The `extractDiffStats` function for the `edit` tool computed stats by naively counting line numbers:
`oldText.split('\n').length` for removed and `newText.split('\n').length` for added.
This treated **every line** in `oldText` as removed and **every line** in `newText` as added,
resulting in massively inflated stats that did not match the actual unified diff shown
by `@pierre/diffs`.

For example, if an edit replaced a 21-line block with a 17-line block that shared 15 lines in common:
- **Our stats (before fix):** `+17 -21` (every line counted as changed)
- **@pierre/diffs (actual):** `+2 -6` (only truly changed lines)

This caused ToolCallSection's DiffStatsBadge to show different numbers than the @pierre/diffs
PatchDiff header, confusing users.

## Root Cause

In `extractDiffStats()`, the edit tool branch used naive line counting:

```typescript
// OLD (BUG) — counts every line as changed
totalRemoved += oldText.split('\n').length
totalAdded += newText.split('\n').length
```

Meanwhile, the write tool branch already used `computeLineDiffStats()` (LCS-based) for
correct stats when `previousContent` was available. The edit tool should have done the same.

The `computeLineDiffStats` function uses a Longest Common Subsequence (LCS) algorithm to
accurately count added/removed lines — the same approach used by unified diff algorithms.
This matches what `@pierre/diffs` renders from the patch content.

## Additional Bug Fixed

The old naive counting also produced phantom stats for no-op edits:
- An edit with `oldText: ""` and `newText: ""` was counted as `+1 -1` (because
  `"".split("\n").length === 1`), even though it's semantically a no-op.
- Now, such edits correctly return `null` (no meaningful diff).

## Fix

Changed the edit tool branch in `extractDiffStats` to:
1. Concatenate all edit `oldText` values into `combinedOld` and all `newText` values into `combinedNew`
2. Return `null` if both are empty (no meaningful diff)
3. Use `computeLineDiffStats(combinedOld, combinedNew)` for accurate LCS-based stats

```typescript
// NEW — uses LCS-based diff for accurate stats matching @pierre/diffs
let combinedOld = ''
let combinedNew = ''
for (const edit of edits) {
  const e = edit as Record<string, unknown>
  const oldText = typeof e.oldText === 'string' ? e.oldText : ''
  const newText = typeof e.newText === 'string' ? e.newText : ''
  combinedOld += (combinedOld ? '\n' : '') + oldText
  combinedNew += (combinedNew ? '\n' : '') + newText
}
if (combinedOld === '' && combinedNew === '') return null
return computeLineDiffStats(combinedOld, combinedNew)
```

### Test Changes
- Updated "edit with edits containing undefined oldText/newText" test: now correctly expects `null` instead of `{added: 1, removed: 1}`
- Updated "edit with edits array containing a mix of valid and empty edits" test: now correctly expects `{added: 1, removed: 1}` instead of `{added: 2, removed: 2}` (empty edit no longer contributes phantom stats)
