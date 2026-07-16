# BUG-1: usePolling Backoff Dead Code Regression

**Date:** 2026-06-15
**Severity:** High
**Status:** Fixed
**Files affected:**
- `src/renderer/src/hooks/usePolling.ts`
- `src/renderer/src/hooks/useGitOperations.ts`

## Bug Description

The `usePolling` hook had two critical bugs that made its exponential backoff feature completely non-functional:

1. **`setInterval` ignores ref changes:** The hook used `setInterval()` to schedule polls, and updated `effectivePollIntervalRef.current` on errors to double the interval. However, `setInterval` fires at a fixed rate determined at creation time — changing a ref value has zero effect on the already-running interval. The backoff logic was dead code.

2. **`onPoll` never throws:** The primary consumer, `useGitOperations`, passes `refreshStatus` as `onPoll`. This function catches all errors internally (sets `setError(msg)` in its catch block) and never re-throws. Since `usePolling`'s backoff only engages when `onPoll` throws, the error handler and backoff logic were unreachable.

## Root Cause

Both issues stem from the original implementation not considering the interaction between the polling mechanism and the consumer's error handling pattern:
- `setInterval` vs `setTimeout` for dynamic intervals is a well-known JS pattern, but was overlooked
- The assumption that `onPoll` would throw on error doesn't hold when consumers handle errors internally

## Fix

1. **Replaced `setInterval` with recursive `setTimeout`:** Each tick schedules the next tick via `setTimeout`, reading `effectivePollIntervalRef.current` at scheduling time. When backoff increases the ref value, the next tick automatically uses the longer interval.

2. **Made `refreshStatus` re-throw errors:** Added `throw err` after `setError(msg)` in `refreshStatus`. This allows `usePolling`'s standard backoff to detect failures. All callers of `refreshStatus` already have their own try/catch blocks, so this doesn't break existing error handling.

3. **Added `UsePollingResult` return type:** The hook now returns `{ refresh, errorCount, resetBackoff }`, fulfilling the documented API that was previously unimplemented (FABRICATION-2).

4. **Removed `backoffOnError` option:** Initially attempted to add a `backoffOnError` option that would detect internally-handled errors by swapping `onErrorRef.current`. This approach was abandoned because `onPoll` closures capture their own error handlers — swapping the ref doesn't affect the closed-over `onError`. The re-throw pattern is simpler and more reliable.

## Verification

- 14 new tests in `src/tests/renderer/usePolling.test.tsx`
- All tests pass including backoff, reset, visibility, and edge cases
- ChatView tests continue to pass
