# Critical Contract Violation Fixes - 2026-06-16

## Summary

Fixed 13 contract violations across 7 production source files, converting 13 of the original 38 test.todo items into real passing tests. The remaining 25 todos are design decisions or breaking-change proposals that require further discussion.

Test Results: 1768 passed (up from 1657 originally), 25 todo (down from 38).

---

## 1. usePolling - errorCount Not Reactive

### Bug
errorCount was read from consecutiveErrorsRef.current (a useRef), so React never re-rendered when it changed. Callers reading result.current.errorCount always got the stale value from the last render.

### Fix
Added a useState variable errorCountState that is updated via setErrorCountState() after each poll tick. The return value now reads errorCountState instead of consecutiveErrorsRef.current.

### Files Changed
- src/renderer/src/hooks/usePolling.ts - Added useState import, errorCountState state, setErrorCountState calls
- src/tests/renderer/usePolling.critical.test.tsx - Converted 3 tests from contract-gap docs to passing assertions

---

## 2. usePolling - NaN Interval Bypasses Clamping

### Bug
Math.max(NaN, 1000) returns NaN. When interval was NaN, setTimeout(callback, NaN) behaved as setTimeout(callback, 0), causing immediate polling.

### Fix
Added explicit NaN guard: const safeInterval = Number.isNaN(interval) ? MIN_POLL_INTERVAL : Math.max(interval, MIN_POLL_INTERVAL).

### Files Changed
- src/renderer/src/hooks/usePolling.ts - Added safeInterval with NaN guard
- src/tests/renderer/usePolling.critical.test.tsx - Converted NaN test to assert fixed behavior

---

## 3. usePolling - resetBackoff Does Not Cancel Pending Timer

### Bug
resetBackoff() only changed effectivePollIntervalRef.current but did NOT cancel the already-scheduled setTimeout. The reset only took effect on the NEXT tick.

### Fix
resetBackoff() now cancels the pending timer and reschedules it at the base interval. Added scheduleNextTickRef to avoid circular dependency.

### Files Changed
- src/renderer/src/hooks/usePolling.ts - Added scheduleNextTickRef, cancel/reschedule in resetBackoff
- src/tests/renderer/usePolling.critical.test.tsx - Converted test to assert timer rescheduled

---

## 4. usePolling - refresh() Not Guarded Against Concurrent Execution

### Bug
Calling refresh() while onPoll was in flight stacked another concurrent execution.

### Fix
Added isPollingRef (useRef(false)) checked before executing onPoll in both scheduleNextTick and refresh.

### Files Changed
- src/renderer/src/hooks/usePolling.ts - Added isPollingRef guard
- src/tests/renderer/usePolling.critical.test.tsx - Converted 2 tests to assert guard works

---

## 5. usePolling - onSuccess/onError Called After Unmount

### Bug
After await onPollRef.current(), there was no isStoppedRef check before calling onSuccess/onError, causing React warnings.

### Fix
Added if (isStoppedRef.current) return checks after every await in scheduleNextTick, refresh, and visibility change handler.

### Files Changed
- src/renderer/src/hooks/usePolling.ts - Post-await isStoppedRef checks
- src/tests/renderer/usePolling.critical.test.tsx - Converted test to assert no post-unmount callbacks

---

## 6. StreamBatcher - Empty Delta Schedules Unnecessary Timer

### Bug
push() with empty string delta scheduled a timer unnecessarily.

### Fix
Added early return when event.delta.length === 0 for both text_delta and thinking_delta.

### Files Changed
- src/main/stream-batcher.ts - Empty delta guard
- src/tests/stream-batcher.critical.test.ts - Converted todo to passing test

---

## 7. StreamBatcher - onFlush That Throws Crashes the Batcher

### Bug
If onFlush threw, the batcher crashed. pendingText was already cleared, so data was lost.

### Fix
Wrapped all onFlush calls in try/catch with logging. Added isFlushing re-entrancy guard.

### Files Changed
- src/main/stream-batcher.ts - isFlushing guard, try/catch around onFlush
- src/tests/stream-batcher.critical.test.ts - Converted 2 tests to assert batcher survives errors

---

## 8. AgentEventProcessor - Callbacks That Throw Crash Processing

### Bug
If emit, onBatchableEvent, or onFlush callbacks threw, handleAgentEvent() crashed entirely.

### Fix
Wrapped all callback invocations in try/catch with error logging. Extracted safeOnFlush() helper.

### Files Changed
- src/main/agent-event-processor.ts - try/catch around emit, onBatchableEvent, safeOnFlush helper
- src/tests/agent-event-processor.critical.test.ts - Converted 2 tests to assert processing continues

---

## 9. AgentEventProcessor - Missing text Field in text_delta

### Bug
content_block_delta with missing delta field silently produced undefined content.

### Fix
Added null coalescing: const delta = sub.delta ?? ''

### Files Changed
- src/main/agent-event-processor.ts - Added ?? '' guard on sub.delta

---

## 10. IPC Router - Handler Errors Propagate Raw

### Bug
IpcRouter.handle() had no error boundary. Handler errors propagated raw to IPC caller.

### Fix
Wrapped handler execution in try/catch with error logging before re-throwing. Applied to handleVoid() too.

### Files Changed
- src/main/ipc-router.ts - try/catch in handle() and handleVoid(), added logger
- src/tests/ipc-router.critical.test.ts - Converted test to assert error boundary exists

---

## 11. IPC Router - sendToRenderer Returns Void

### Bug
sendToRenderer() returned void, callers had no way to know if the send succeeded.

### Fix
Changed return type to boolean. Returns true when sent, false when no valid window.

### Files Changed
- src/main/ipc-router.ts - Changed return type, added boolean returns and logging
- src/tests/ipc-router.critical.test.ts - Converted todo to passing test

---

## 12. IPC Router - No remove()/unregister() Method

### Bug
No way to unregister a handler through the router, causing memory leaks.

### Fix
Added remove(channel) method that delegates to ipcMain.removeHandler(channel).

### Files Changed
- src/main/ipc-router.ts - Added remove() method
- src/tests/ipc-router.critical.test.ts - Converted todo to passing test

---

## 13. useSearchSessions - Projects with undefined/null sessions Crash

### Bug
Hook assumed project.sessions was always an array. undefined sessions caused TypeError.

### Fix
Added null coalescing: const sessions = project.sessions ?? []

### Files Changed
- src/renderer/src/hooks/useSearchSessions.ts - Added ?? [] guards
- src/tests/renderer/useSearchSessions.critical.test.tsx - Converted 2 tests to assert graceful handling

---

## 14. useGitOperations - commit() Accepts Empty Message

### Bug
commit('') sent empty string to IPC, failing at Git level with unhelpful error.

### Fix
Added validation: if (!message.trim()) throw new Error('Commit message cannot be empty')

### Files Changed
- src/renderer/src/hooks/useGitOperations.ts - Empty message guard
- src/tests/renderer/useGitOperations.critical.test.tsx - Converted test to assert validation

---

## 15. useGitOperations - stageFile() Accepts Empty Path

### Bug
stageFile('') sent empty string to IPC without validation.

### Fix
Added validation: if (!filePath.trim()) return

### Files Changed
- src/renderer/src/hooks/useGitOperations.ts - Empty path guard

---

## Remaining test.todo Items (25)

These represent design decisions, breaking-change proposals, or new features:

> **Decision sheet:** See [`remaining-todo-decisions-2026-06-16.md`](./remaining-todo-decisions-2026-06-16.md) for MCQ-style decision forms on each item.

- usePolling: Per-tick timeout for hanging onPoll
- StreamBatcher: dispose flag, flush order docs, hasPending property
- AgentEventProcessor: Result return type, finalize boolean, sessionId validation, out-of-order detection, unknown event handling
- IPC Router: Multi-window sendToRenderer, registerRendererListener docs
- Message Grouping: Single tool_call category, dead type cleanup, key normalization
- useSearchSessions: Duplicate session ID deduplication
- useGitOperations: isGitRepo discriminated union, per-operation errors, consistent mutation handling, isActiveProject flag, selectedDiff nullability

---

## Validation Results

| Check | Result |
|-------|--------|
| bun run test | 1768 passed, 25 todo |
| bun run type-check | Clean |
| bun run lint | Clean |
| bun run package:local | Builds successfully |
