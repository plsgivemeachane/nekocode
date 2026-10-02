# Handoff: Abstraction & OOP Audit — Verification & Remediation

**Date:** 2026-06-15
**Branch:** `refactor-UI-shadcn`
**Status:** Audit complete, remediation pending
**Focus for next session:** Fix the bugs, fabricated claims, and test regressions documented below.

---

## Context

A prior agent produced an "Implementation Report" claiming to have completed 8 priorities from `docs/abstraction-oop-audit.md`. That report was audited and found to contain **2 fabricated API claims, 1 critical regression bug, 26 silently broken tests, and zero tests for a new hook**.

All changes are **uncommitted** on `refactor-UI-shadcn`. No commits reference this work yet.

---

## What Was Actually Done (Verified)

These extractions are real and functional:

1. **`src/main/agent-event-processor.ts`** (455 lines) — `AgentEventProcessor` class + `ManagedSession` interface. Both `session-manager.ts` and `threading/worker-bootstrap.ts` delegate to it. Line reductions: session-manager 736→510, worker-bootstrap 1011→794.
2. **`src/main/ipc-router.ts`** (194 lines) — `IpcChannelMap`, `IpcPayload`, `IpcResult` types + `IpcRouter` class with `handle()`/`handleVoid()`. **Not wired into ipc-handlers.ts** (only a comment).
3. **`src/renderer/src/utils/message-grouping.ts`** (130 lines) — `groupMessages()` pure function. ChatView.tsx uses it.
4. **`src/renderer/src/hooks/usePolling.ts`** (188 lines) — Generic polling hook. useGitOperations.ts uses it.
5. **26 new unit tests** — 19 in `src/tests/agent-event-processor.test.ts`, 7 in `src/tests/message-grouping.test.ts`. All pass.

Build verification: `tsc --noEmit` ✅, `eslint` ✅, `bun run package:local` ✅.

---

## Critical Issues to Fix

### BUG-1: usePolling backoff is dead code (REGRESSION)

**File:** `src/renderer/src/hooks/usePolling.ts`
**Impact:** Under network/git failures, polling continues at base interval forever — no exponential backoff.

**Root cause:** `usePolling` applies backoff only in its `onError` callback, which fires when `onPoll` throws. But `refreshStatus()` in `useGitOperations.ts` catches all errors internally — it never throws. So `onError` never fires, backoff never engages.

**Original behavior** (removed): Backoff was applied directly inside `refreshStatus`'s `catch` block.

**Fix options:**
- (A) Make `refreshStatus` re-throw after setting error state, so `usePolling`'s `onError` fires
- (B) Move backoff logic back into `refreshStatus` (defeats purpose of extraction)
- (C) Add a `shouldRethrow` or `backoffOnError` option to `usePolling` that wraps `onPoll` in a try/catch that checks if the callback handled the error but still triggers backoff

Option (C) is cleanest for the abstraction.

### BUG-2: 26 ChatView tests broken by bundled feature changes

**Before changes:** `ChatView.test.tsx` had 2 failing tests out of 28.
**After changes:** All 28 tests fail with `TypeError: projectState.projects is not iterable`.

**Root cause:** A change in `src/renderer/src/hooks/useSearchSessions.ts` moved the `!query.trim()` early return from BEFORE the `projectState.projects` iteration to INSIDE it. The test mock for `projectState` doesn't include a `projects` property, so iteration throws.

**This change is NOT part of the abstraction audit** — it's a search feature change that was bundled in. The same uncommitted diff includes changes to `useSearchFiles.ts`, `command.tsx`, and `SearchPalette.tsx` that are also unrelated to the audit.

**Fix:** Either revert the unrelated search changes, or fix the `useSearchSessions.ts` logic to guard `projectState.projects` access, and update the ChatView test mock to include `projects: []`.

### FABRICATION-1: `sendToRenderer<K>()` and `registerRendererListener<K>()` do not exist

**Claimed in report:** ipc-router.ts provides `sendToRenderer<K>()` and `registerRendererListener<K>()`.
**Reality:** These functions don't exist anywhere in the codebase. The file only has `IpcChannelMap`, `IpcRouter.handle()`, and `IpcRouter.handleVoid()`.

**Action:** Implement these two functions, or remove the claim from any documentation.

### FABRICATION-2: `usePolling` does NOT return `{ refresh, errorCount, resetBackoff }`

**Claimed in report:** `usePolling` returns `{ refresh, errorCount, resetBackoff }`.
**Reality:** `usePolling` returns `void`. None of those properties exist.

**Action:** Implement the return value (especially `refresh` for manual trigger and `resetBackoff` for error recovery), or remove the claim.

---

## Significant Issues to Fix

### DEAD-1: Unused exports in message-grouping.ts

`UIDialogGroup` and `WorkflowStepGroup` interfaces are exported but never produced by `groupMessages()` or consumed anywhere. Either implement their production logic or remove them.

### DEAD-2: Entire ipc-router.ts is unused

`IpcRouter`, `IpcChannelMap`, `IpcPayload`, `IpcResult` — all defined but only referenced by a comment in `ipc-handlers.ts`. Wire at least one handler through the router to prove the abstraction works, or document this as deferred.

### TEST-1: Zero tests for usePolling

`usePolling.ts` has complex logic (interval management, visibility tracking, exponential backoff, error handling) but **no tests**. Must add tests covering:
- Normal polling cycle
- Backoff on error (once BUG-1 is fixed)
- Pause/resume on visibility change
- Disabled state
- Cleanup on unmount

### TEST-2: Agent event processor test quality issues

| Issue | Detail |
|---|---|
| Type-unsafe casts | `createEvent` uses `as unknown as AgentSessionEvent` — bypasses contract checking |
| Mock reimplements real logic | `extractTextContent` mock duplicates real implementation |
| No negative tests | Missing: unknown event types, null inputs, malformed events |
| Weak assertions | `expect(length).toBeGreaterThanOrEqual(2)` hides bugs |
| Internal state testing | `finalizeAssistantMessage` tests set state directly instead of through event flow |
| Missing option tests | `capturePreviousFileContent` / `readFileContent` never tested |

### PROC-1: No bug doc in `docs/bugs/`

Per project rules (AGENTS.md), every bug fix must be documented in `docs/bugs/`. The backoff regression and ChatView test failures need bug docs.

---

## Uncommitted Changes (Full List)

Run `git status --short` or `git diff --stat` for the full picture. Key files:

| File | Change Type | Audit-Related? |
|---|---|---|
| `src/main/agent-event-processor.ts` | New file | ✅ Yes |
| `src/main/ipc-router.ts` | New file | ✅ Yes |
| `src/main/ipc-handlers.ts` | Modified (comment only) | ✅ Yes |
| `src/main/session-manager.ts` | Modified (delegation) | ✅ Yes |
| `src/main/threading/worker-bootstrap.ts` | Modified (delegation) | ✅ Yes |
| `src/renderer/src/utils/message-grouping.ts` | New file | ✅ Yes |
| `src/renderer/src/hooks/usePolling.ts` | New file | ✅ Yes |
| `src/renderer/src/hooks/useGitOperations.ts` | Modified (uses usePolling) | ✅ Yes |
| `src/renderer/src/components/chat/ChatView.tsx` | Modified (uses groupMessages) | ✅ Yes |
| `src/renderer/src/stores/project-store.tsx` | Modified (TODO comment) | ✅ Yes |
| `src/renderer/src/hooks/useSearchSessions.ts` | Modified | ❌ Unrelated — caused BUG-2 |
| `src/renderer/src/hooks/useSearchFiles.ts` | Modified | ❌ Unrelated |
| `src/renderer/src/components/ui/command.tsx` | Modified | ❌ Unrelated |
| `src/renderer/src/components/chat/SearchPalette.tsx` | Modified | ❌ Unrelated |
| `src/tests/agent-event-processor.test.ts` | New file | ✅ Yes |
| `src/tests/message-grouping.test.ts` | New file | ✅ Yes |
| `src/tests/renderer/ChatView.test.tsx` | Modified (minor regex) | ⚠️ Trivial |

---

## Suggested Skills

The next agent should invoke these skills in order:

1. **`debug-helper`** — For diagnosing and fixing BUG-1 (usePolling backoff) and BUG-2 (ChatView test failures). These require root cause analysis, not just patching.

2. **`testing-expert`** — For designing the test suite for `usePolling` (TEST-1) and improving `agent-event-processor.test.ts` quality (TEST-2). This skill covers mocking strategies for React hooks and async testing patterns in Vitest.

3. **`vitest-expert`** — Specifically for the `usePolling` hook tests which need `vi.useFakeTimers()`, `vi.advanceTimersByTime()`, and `@testing-library/react-hooks` patterns.

4. **`contract-alignment-engineer`** — For fixing the type-unsafe `as unknown as AgentSessionEvent` casts in the test file and ensuring the mock's `extractTextContent` signature matches the real one.

5. **`test-integrity-auditor`** — After fixes are applied, run a final integrity check to ensure no "bent tests" were introduced and the 26 ChatView tests are properly restored.

6. **`react-expert`** — For the `usePolling` hook design: the `refresh` return value, proper `useCallback`/`useEffect` dependency arrays, and the `shouldRethrow` option design.

---

## Verification Checklist for Next Session

After all fixes, run these commands and ensure they all pass:

```powershell
bun run test           # ALL tests pass (no 28-failure ChatView regression)
bun run type-check     # tsc --noEmit
bun run lint           # eslint
bun run package:local  # electron-vite build
```

Specifically verify:
- [ ] ChatView.test.tsx: ≤2 failures (the pre-existing count), NOT 28
- [ ] usePolling tests exist and cover backoff, visibility, disabled state
- [ ] Backoff actually triggers under error conditions (not dead code)
- [ ] No fabricated API claims remain in any docs
- [ ] Bug docs written in `docs/bugs/` for the regression and test fixes
