# Done Sound Plays Prematurely on Agent Retry

## Bug Description

When the AI agent completes a turn and the SDK triggers a retry (e.g., due to a rate limit, timeout, or internal retry logic), the "task-complete" notification sound plays immediately on the `done` event — even though the agent is about to start another turn. This creates a confusing UX where the user hears a "finished" chime but the agent is still working.

## Root Cause

In `src/main/index.ts`, the `onSessionEvent` callback immediately called `notificationService.notify()` when it received a `done` event:

```typescript
if (event.type === 'done') {
  notificationService.notify({
    title: 'AI Response Ready',
    body: `Session: ${sessionId.slice(0, 8)}`,
    soundKey: 'task-complete',
  })
}
```

The SDK's retry flow emits: `done` (first attempt finishes) then `agent_start` (retry begins). Since the notification was triggered synchronously on `done`, there was no opportunity to cancel it when the retry started.

## Fix

Added a 15-second delay before playing the "done" notification sound. If an `agent_start` event arrives within that window (indicating a retry or continued work), the pending notification is cancelled.

### Changes in `src/main/index.ts`

1. Added `pendingDoneNotification` timeout variable and `DONE_NOTIFICATION_DELAY_MS` constant (15 seconds)
2. Added `clearPendingDoneNotification()` helper to safely clear the timeout
3. Changed `done` event handler to set a 15-second timeout instead of immediately notifying
4. Added `agent_start` event handler that cancels any pending done notification
5. Added cleanup in `performShutdown()` to clear the pending timeout on app quit

### Event Flow After Fix

**Normal completion (no retry):**
1. `done` event starts 15-second timer
2. Timer fires after 15s and notification sound plays
3. User hears the "task complete" sound

**Agent retries after done:**
1. `done` event starts 15-second timer
2. `agent_start` event (within 15s) cancels timer
3. No sound plays — agent continues working
4. When agent truly finishes, a new `done` starts new 15-second timer then sound plays

## Date Fixed

2026-06-09
