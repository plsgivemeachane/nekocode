# Worker Prompt Timeout, Missing Status Updates, and Error Stripe UX

**Date:** 2026-05-04  
**Affected versions:** 0.2.x (worker thread architecture)  
**Severity:** High (Bug 1 & 3), Medium (Bug 2)

---

## Bug 1: `session:prompt` Operation Times Out After 60s

### Symptoms

```
[thread-queue] warn: Operation ccd3823c-... timed out after 60000ms
[thread-queue] error: Worker error: Operation timed out
[ipc-handlers] error: SESSION_PROMPT failed sessionId=... Operation timed out
```

The error appears in the renderer, but the agent continues working in the background — streaming events keep arriving and messages appear after the error.

### Root Cause

The `handleSessionPrompt` function in `worker-bootstrap.ts` was `await`-ing `session.prompt()`. This SDK call is long-running — it waits for the entire agent turn to complete, which can involve multiple LLM calls and tool executions (easily >60s). The `ThreadOperationQueue` has a `taskTimeout` of 60,000ms (from `DEFAULT_POOL_CONFIG`), which fires and rejects the operation while the worker is still processing.

The sequence:
1. Worker receives `session:prompt`, calls `await session.prompt(text)`
2. SDK starts processing (LLM call, tool calls, more LLM calls...)
3. After 60s, the main thread's timeout fires, rejecting the promise
4. Renderer shows "Operation timed out" error
5. Worker continues running the prompt — events still flow through `emitEvent`
6. Messages eventually appear despite the error

### Fix

Made `session:prompt` **fire-and-forget** at all three levels:

1. **`worker-bootstrap.ts`** — `handleSessionPrompt` starts `session.prompt()` without `await`, catches errors and emits them as `error` + `done` events. Returns `{ started: true }` immediately.

2. **`threaded-session-manager.ts`** — `prompt()` dispatches to the operation queue but does not `await` the result. Errors from dispatch are caught and forwarded as events.

3. The IPC handler in `ipc-handlers.ts` resolves immediately — the renderer doesn't need to wait for prompt completion since all streaming flows through the event channel.

### Files Changed

- `src/main/threading/worker-bootstrap.ts` — `handleSessionPrompt()` made fire-and-forget
- `src/main/threading/threaded-session-manager.ts` — `prompt()` made fire-and-forget

---

## Bug 2: Error Stripe Has No Dismiss Button and Awkward Styling

### Symptoms

The red error bar below the message box shows raw error text with no way to dismiss it. Once an error appears, it stays permanently until a new prompt clears it.

### Root Cause

The error display in `ChatView.tsx` was a simple `<div>` with no interactive elements:
```tsx
<div className="px-6 py-2 bg-error-surface border-t border-error/30 text-error text-sm">
  {error}
</div>
```

### Fix

1. Added an error icon (SVG) for visual clarity
2. Added a "Dismiss" button that calls `clearError()`
3. Improved styling: softer background (`bg-error-surface/60`), backdrop blur, better spacing
4. Exposed `clearError()` from `useSession` hook

### Files Changed

- `src/renderer/src/components/chat/ChatView.tsx` — Error stripe with dismiss button
- `src/renderer/src/hooks/useSession.ts` — Exposed `clearError` callback

---

## Bug 3: Status Indicator Stuck on "Ready" During Streaming

### Symptoms

After migrating to worker threads, the StatusIndicator component always shows "Ready" even when the agent is actively streaming responses. Messages appear but the spinner and "Working" label never show.

### Root Cause

The worker's `handleAgentEvent` function in `worker-bootstrap.ts` did **not** handle the `agent_start` event type — it fell through to the `default` case and was logged as "Unhandled event type". 

The `agent_start` event is the signal that the global store in `project-store.tsx` uses to set `sessionStatuses[sessionId] = 'streaming'`:
```typescript
case 'agent_start':
    dispatch({ type: 'UPDATE_SESSION_STATUS', sessionId, status: 'streaming' })
```

Without this event being forwarded from the worker, `isStreaming` was always `false` and the StatusIndicator showed "Ready".

Similarly, `turn_start` (which fires when the agent starts a new turn after tool execution) was also unhandled, meaning multi-turn operations showed "Ready" between turns.

### Fix

Added proper handling for `agent_start`, `turn_start`, and `turn_end` events in the worker's `handleAgentEvent`:

- `agent_start` → emits `{ type: 'agent_start' }` to renderer
- `turn_start` → emits `{ type: 'agent_start' }` to renderer (new turn = agent still working)
- `turn_end` → logged, no event emitted (turn boundary, agent may start another)

Also added `turn_start` handling in the main-thread `session-manager.ts` for consistency (in case the non-threaded path is used).

### Files Changed

- `src/main/threading/worker-bootstrap.ts` — Added `agent_start`, `turn_start`, `turn_end` cases
- `src/main/session-manager.ts` — Added `turn_start` case (emits `agent_start`)
- `src/tests/session-manager.test.ts` — Updated test: `turn_start` now emits `agent_start`
