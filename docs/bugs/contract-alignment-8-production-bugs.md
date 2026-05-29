# Contract Alignment Fixes — 8 Production Bugs Resolved

**Date:** 2026-05-29  
**Scope:** useCommandHistory, tool-summary, ElectronUIContext, ThreadedProjectManager  
**Severity:** Mixed (2 security, 3 data integrity, 2 correctness, 1 architectural)

## Summary

8 test cases were marked with `it.fails()` across 4 test files, documenting known bugs where production code violated its intended contract. Each test described the CORRECT behavior but was marked as failing because the implementation was buggy. This fix resolves all 8 underlying production bugs and removes all `it.fails()` modifiers, restoring the test suite to a clean, honest state.

## Bugs Fixed

### Bug 1: useCommandHistory — Stale source on re-used commands
**File:** `src/renderer/src/hooks/useCommandHistory.ts` (line 93-100)  
**Test:** `it.fails('treats same name with different sources — latest source should win')`

**Problem:** When a command was re-used from a different source (e.g., first from 'sidebar', then from 'palette'), the `addToHistory` method updated `lastUsed` and `useCount` but did NOT update the `source` field. The spread `{ ...entry, lastUsed: now, useCount: entry.useCount + 1 }` preserved the stale source.

**Fix:** Added `source` to the spread: `{ ...entry, source, lastUsed: now, useCount: entry.useCount + 1 }`.

**Impact:** Users saw stale source labels in the command palette. The most recent invocation source was lost.

---

### Bug 2: useCommandHistory — getHistory() returns shallow copy, allowing state corruption
**File:** `src/renderer/src/hooks/useCommandHistory.ts` (line 113)  
**Test:** `it.fails('returns a deep copy — entry objects should be isolated from internal state')`

**Problem:** `getHistory()` returned `[...history]`, a shallow copy of the array. The entry objects inside were shared references. Any caller could mutate an entry object and corrupt the hook's internal state.

**Fix:** Changed to `history.map((entry) => ({ ...entry }))` which creates a new object for each entry. Since `CommandHistoryEntry` has no nested objects, this shallow-per-entry copy is sufficient.

**Impact:** Callers that destructured and modified history entries could silently corrupt the command history state.

---

### Bug 3: useCommandHistory — localStorage with non-array JSON crashes on load
**File:** `src/renderer/src/hooks/useCommandHistory.ts` (line 41-47)  
**Test:** `it.fails('gracefully handles non-array JSON in localStorage')`

**Problem:** `loadHistory()` parsed `localStorage` content with `JSON.parse(raw)` and directly spread it as `[...parsed]`. If the stored value was a non-array JSON object (e.g., `{"not":"an array"}`), the spread would throw `TypeError: parsed is not iterable`.

**Fix:** Added `Array.isArray(parsed)` validation after parsing. Non-array values are logged as warnings and reset to an empty array, same as other parse errors.

**Impact:** App crash on startup if localStorage was corrupted or manually edited to contain non-array JSON.

---

### Bug 4: tool-summary — write without previousContent reports definitive stats instead of estimated
**File:** `src/renderer/src/components/chat/tool-summary.ts` (line 65-67)  
**Test:** `it.fails('write without previousContent should indicate estimated stats')`

**Problem:** `extractDiffStats('write', args, null)` returned `{ added: N, removed: 0 }` with no indication these were estimates. Without `previousContent`, there's no way to know the actual diff — all lines appear as "additions" but could be replacements in an existing file.

**Fix:** 
1. Added `estimated?: boolean` field to the `DiffStats` interface.
2. When no `previousContent` is available, the function now returns `{ added: N, removed: 0, estimated: true }`.

**Impact:** The UI showed misleading diff statistics for file writes without a baseline, implying certainty where none existed.

---

### Bug 5: tool-summary — read with offset but no path produces broken output
**File:** `src/renderer/src/components/chat/tool-summary.ts` (line 145-160)  
**Test:** `it.fails('read with offset but no path should produce meaningful fallback')`

**Problem:** The `read` case in `extractToolSummary` built a path string as `String(a.path ?? '') + ':' + a.offset`. When `a.path` was undefined/empty, this produced broken strings like `:10` or `:10-20`.

**Fix:** Restructured the `read` case to check for `pathVal` first, then check for `offset` separately. When offset is present but no path, returns a meaningful fallback like `"read (offset 10, limit 5)"`. When neither path nor offset exists, returns `''`.

**Impact:** Tool summary displayed nonsensical strings like `:10` in the UI for read operations without a path.

---

### Bug 6: ElectronUIContext — negative timeout silently ignored (security/correctness)
**File:** `src/main/electron-ui-context.ts` (line 417-420)  
**Test:** `it.fails('negative timeout should throw or clamp, not silently ignore')`

**Problem:** `sendRequestAndWait` checked `if (timeoutMs && timeoutMs > 0)` before setting a timeout. A negative timeout silently fell through, meaning the promise could hang forever with no timeout. This is a programming error that should be caught early.

**Fix:** Added explicit validation at the top of `sendRequestAndWait`: if `timeoutMs` is defined and negative, throw `Error('Invalid timeout: ${timeoutMs}ms. Timeout must be a positive number or undefined.')`.

**Impact:** Negative timeouts (programming errors) silently caused promises to hang indefinitely, potentially freezing the application.

---

### Bug 7: ElectronUIContext — selectedValue not validated against options (security)
**File:** `src/main/electron-ui-context.ts` (lines 27-29, 77, 420-432, 340-370)  
**Test:** `it.fails('response with selectedValue not in options should reject or clamp')`

**Problem:** `handleResponse` blindly accepted any `selectedValue` from the renderer without validating it against the original options. A compromised or buggy renderer could inject arbitrary values.

**Fix:**
1. Added `validOptions?: string[]` field to `PendingRequest` interface.
2. Modified `select()` to pass the options list to `sendRequestAndWait`.
3. `sendRequestAndWait` stores `validOptions` in the pending request.
4. `handleResponse` validates `selectedValue` against `validOptions`. If invalid, logs a warning and resolves with `undefined` instead of the rogue value.

**Impact:** Security vulnerability — a compromised renderer process could inject arbitrary values into select dialog responses, bypassing the intended option constraints.

---

### Bug 8: ThreadedProjectManager — operation queue accepted but never used (architectural)
**File:** `src/main/threading/threaded-project-manager.ts` (lines 47-57)  
**Test:** `it.fails('should use the operation queue for async operations')`

**Problem:** `ThreadedProjectManager` accepted a `ThreadOperationQueue` in its constructor but never called `queue.execute()` for any operation. All methods delegated directly to the underlying `ProjectManager`, completely bypassing the queue. The class was named "Threaded" but had no threading behavior.

**Fix:**
1. `loadWorkspace()` now calls `operationQueue.execute('project:load-workspace', { workspacePath })`.
2. `addProject(path)` now calls `operationQueue.execute('project:add', { path })`.
3. Added `getWorkspacePath()` public getter to `ProjectManager` so the workspace path can be passed as input to the queue.
4. Added proper type imports for `ProjectLoadWorkspaceInput`, `ProjectLoadWorkspaceOutput`, `ProjectAddInput`, `ProjectAddOutput`.

**Impact:** The ThreadedProjectManager was a no-op wrapper that provided no concurrency control or worker-thread offloading despite its name and constructor signature.

---

## Test Changes

All 8 `it.fails()` modifiers have been removed and replaced with standard `it()` / `test()` blocks:

| File | Removed | Replaced With |
|------|---------|---------------|
| `useCommandHistory.test.ts` | 3× `it.fails(...)` | 3× `it(...)` |
| `tool-summary.test.ts` | 2× `it.fails(...)` | 2× `it(...)` |
| `slash-commands-critical.test.ts` | 2× `it.fails(...)` | 2× `it(...)` |
| `threaded-project-manager.test.ts` | 1× `it.fails(...)` | 1× `it(...)` |

Additional test updates to align with corrected behavior:
- `slash-commands-critical.test.ts`: Updated old observation tests to reflect correct behavior (negative timeout now throws, invalid selectedValue now rejected)
- `threaded-project-manager.test.ts`: Updated mock queue to match real `execute` signature, updated delegation tests
- `tool-summary.test.ts`: Updated `extractDiffStats` expectations to include `estimated: true` when no previousContent

## Verification

- ✅ All 1561 tests pass
- ✅ No new type-check errors
- ✅ No new lint errors
