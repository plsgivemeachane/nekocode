# Contract Alignment Fixes — 2026-05-30

## Summary

This document describes 8 bugs identified through contract-alignment analysis of the NekoCode codebase, where test suites were "bent" to accept buggy behavior or tests documented known issues without asserting the correct contract. All bugs have been fixed in production source code, and all tests have been updated to assert the correct behavior.

---

## Finding 1: ToolCallSection — extractDiffStats called 3x per tool call (performance bug)

**File:** `src/renderer/src/components/chat/ToolCallSection.tsx`
**Test:** `src/tests/renderer/ToolCallSection.test.tsx`

### Bug
`extractDiffStats()` was called 3 times per tool call:
1. Once in `totalAdded` reduce loop
2. Once in `totalRemoved` reduce loop  
3. Once in the `.map()` for each row

For N tool calls, this meant 3N invocations instead of N.

### Fix
Compute diff stats once per tool call using `toolCalls.map(tc => extractDiffStats(...))` and cache the array. The cached results are used for both the header aggregate stats and the per-row badges.

### Test Update
Changed from asserting `toHaveBeenCalledTimes(6)` (2 calls × 3) to `toHaveBeenCalledTimes(2)` (2 calls × 1).

---

## Finding 2: ToolCallSection — Non-file tools have no ARIA role (accessibility bug)

**File:** `src/renderer/src/components/chat/ToolCallSection.tsx`

### Bug
Non-file-modifying tool rows (e.g., `bash`, `read`) had `role={undefined}` and `tabIndex={undefined}`, making them invisible to screen readers and inaccessible via keyboard navigation.

### Fix
- Non-file-modifying rows now have `role="listitem"` (semantic role for items in a list)
- Non-file-modifying rows now have `tabIndex={-1}` (focusable via programmatic focus, not Tab navigation)

---

## Finding 3: DiffStatsBadge — Zero-stats renders nothing (ambiguity bug)

**File:** `src/renderer/src/components/chat/ToolCallSection.tsx`
**Test:** `src/tests/renderer/ToolCallSection.test.tsx`

### Bug
When `extractDiffStats` returned `{ added: 0, removed: 0 }`, the `DiffStatsBadge` component rendered nothing (both `{stats.added > 0 && ...}` and `{stats.removed > 0 && ...}` evaluated to false). This was ambiguous — the user couldn't tell "file was written but nothing changed" from "this tool doesn't modify files" (null stats).

### Fix
`DiffStatsBadge` now shows "0 changes" text when both `added` and `removed` are 0, distinguishing it from null stats (not applicable).

---

## Finding 4: tool-summary — Empty string content treated as falsy (contract violation)

**File:** `src/renderer/src/components/chat/tool-summary.ts`
**Test:** `src/tests/shared/tool-summary.test.ts`

### Bug
The check `if (!newContent) return null` treated `""` (empty string) as falsy, silently dropping valid write operations that clear a file. Writing empty content IS a valid operation — it means "make the file empty" or "create an empty file".

### Fix
Changed to `if (newContent === null) return null` — only null/undefined means "no content", not empty string.

### Test Update
Changed from `expect(result).toBeNull()` (asserting the bug) to `expect(result).not.toBeNull()` and `expect(result).toEqual({ added: 1, removed: 0, estimated: true })`.

---

## Finding 5: tool-summary — Large file fallback shows zero changes for different content (critical bug)

**File:** `src/renderer/src/components/chat/tool-summary.ts`
**Test:** `src/tests/shared/tool-summary.test.ts`

### Bug
For files >5000 lines, the fallback used simple line-count difference: `diff = newLines.length - oldLines.length`. When both files had the same number of lines but completely different content, this reported `{ added: 0, removed: 0 }` — a completely rewritten file appeared as "no changes".

### Fix
Removed the broken fallback. The set-based Map approach is O(n) and works correctly for files of any size. All files now use the same algorithm regardless of size.

### Test Update
Changed from `expect(result).toEqual({ added: 0, removed: 0 })` to `expect(result!.added).toBe(5001)` and `expect(result!.removed).toBe(5001)`.

---

## Finding 6: tool-summary — Reordering invisible in set-based diff (abstraction limitation)

**File:** `src/renderer/src/components/chat/tool-summary.ts`
**Test:** `src/tests/shared/tool-summary.test.ts`

### Bug
The set-based diff approach counts line frequencies but ignores line order. Swapping two lines (`"a\nb"` → `"b\na"`) showed `{ added: 0, removed: 0 }` because the same lines exist with the same frequencies in both files.

### Fix
Replaced set-based diff with LCS (Longest Common Subsequence) based approach for files under 20000 combined lines. LCS respects line order and correctly detects reordering as added+removed changes. For very large files (>20000 combined lines), falls back to the set-based approach as a pragmatic trade-off (O(n) vs O(n*m)).

LCS implementation uses space-optimized DP with `Uint32Array` rows (O(min(n,m)) space).

### Test Update
Changed from `expect(result).toEqual({ added: 0, removed: 0 })` to `expect(result).toEqual({ added: 1, removed: 1 })` (LCS finds 1 common line in `['a','b']` vs `['b','a']`).

---

## Finding 7: useAutoScroll — ResizeObserver throws unhandled error (runtime bug)

**File:** `src/renderer/src/hooks/useAutoScroll.ts`
**Test:** `src/tests/renderer/useAutoScroll.test.ts`

### Bug
The `useAutoScroll` hook creates a `ResizeObserver` and calls `observe()` without error handling. In constrained environments (SSR, test environments, detached elements), `new ResizeObserver()` or `.observe()` can throw, causing an uncaught exception.

### Fix
Wrapped `ResizeObserver` creation and `observe()` call in try-catch. If it fails, auto-scroll continues to work via other useEffects — just without height-change tracking.

### Test Update
Changed from `expect(() => renderHook(...)).toThrow('ResizeObserver error')` to `expect(() => renderHook(...)).not.toThrow()`.

---

## Finding 8: SessionDiffView — File count wrong for duplicate paths (display bug)

**File:** `src/renderer/src/components/chat/SessionDiffView.tsx`
**Test:** `src/tests/renderer/SessionDiffView.test.tsx`

### Bug
The file count display used `entries.length`, counting each diff entry separately. When the same file has multiple edits (2 entries for `/same/file.ts`), it showed "2 files changed" instead of "1 file changed".

### Fix
Changed to count unique file paths using `new Set(entries.map(e => e.filePath)).size`.

### Test Update
Changed from `expect(screen.getByText("2 files changed"))` to `expect(screen.getByText("1 file changed"))`.

---

## Verification

All fixes verified with:
- `bun run test` — 1564 tests passing (68 test files)
- `bun run lint` — No errors
- `bun run type-check` — No errors
