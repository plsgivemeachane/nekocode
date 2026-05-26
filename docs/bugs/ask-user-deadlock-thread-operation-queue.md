# ask_user Tool Deadlock in ThreadOperationQueue

**Date:** 2025-05-25  
**Severity:** Critical  
**Status:** Fixed  
**Components:** `thread-operation-queue.ts`, `threaded-session-manager.ts`

---

## Bug Description

When a Pi agent calls `toolcall_ask_user` (or any Pi extension UI method like `ui.select()`, `ui.confirm()`, `ui.input()`), the NekoCode UI freezes entirely. The agent gets stuck waiting for a user response that never arrives, and the user cannot interact with the app because:

1. The `UIDialog` component never appears (the `ui_request` event may or may not reach the renderer)
2. The chat input is disabled while the agent is running
3. The agent cannot be aborted because `session:abort` has the same deadlock

The user sees the `ask_user` tool call text in the chat (e.g., "Which approach do you want to remove the 4 PEER/coms commits"), but no dialog to respond to.

## Root Cause

**Deadlock in `ThreadOperationQueue`** — The operation queue requires workers to be **idle** before dispatching new operations. But when `ask_user` is executing, the worker is **busy** awaiting the UI response. The `session:ui-respond` operation (which carries the user's response back to the worker) is queued but never dispatched because the affinity worker is busy.

### Detailed Flow (Broken)

```
1. LLM calls toolcall_ask_user
2. Pi extension pi-ask-user executes → ctx.ui.select()
3. ElectronUIContext.select() → sendRequestAndWait() → sends ui_request via parentPort
4. Worker is now BUSY awaiting the UI response (Promise pending)
5. UI request reaches renderer → UIDialog should appear
6. User responds → uiRespond IPC → sessionManager.handleUIResponse()
7. handleUIResponse() calls operationQueue.execute('session:ui-respond', ...)
8. ThreadOperationQueue sees session:ui-respond needs session affinity
9. Finds the affinity worker → BUT it is BUSY (not idle)
10. Queue WAITS for worker to become idle
11. Worker is waiting for UI response → UI response is waiting for worker → DEADLOCK
```

The same deadlock affects `session:abort` — the user tries to abort a running prompt, but the abort operation is queued behind the busy worker.

### Why It Happens

The `needsSessionAffinity()` method returns `true` for all `session:*` operations except `session:create` and `session:list-models`:

```typescript
private needsSessionAffinity(type: OperationType): boolean {
  return type.startsWith('session:') && 
    type !== 'session:create' && 
    type !== 'session:list-models'
}
```

And `scheduleNext()` only dispatches to idle workers:

```typescript
if (affinityWorker.isIdle) {
  // dispatch
} else {
  // Wait for worker to become idle
}
```

## Fix

Added a `sendDirectMessage()` method to `ThreadOperationQueue` that bypasses the operation queue and sends a message **directly** to the affinity worker via `worker.postMessage()`. The worker's Node.js event loop can still process `parentPort` messages even while awaiting an async operation (like `ask_user`'s pending promise).

### Changes Made

#### 1. `thread-operation-queue.ts` — Added `sendDirectMessage()`

```typescript
sendDirectMessage(sessionId: string, type: OperationType, input: unknown): boolean {
  const affinityWorker = this.sessionToWorker.get(sessionId)
  if (!affinityWorker) return false

  const message: WorkerMessage = {
    id: `direct-${randomUUID()}`,
    type,
    input,
  }
  affinityWorker.worker.postMessage(message)
  return true
}
```

Also updated `handleWorkerMessage()` to gracefully handle responses for direct messages (IDs prefixed with `direct-`) without logging noisy warnings.

#### 2. `threaded-session-manager.ts` — `handleUIResponse()` uses `sendDirectMessage`

Changed from:
```typescript
this.operationQueue.execute('session:ui-respond', input, 'normal')
```

To:
```typescript
this.operationQueue.sendDirectMessage(sessionId, 'session:ui-respond', input)
```

#### 3. `threaded-session-manager.ts` — `abort()` uses `sendDirectMessage`

Changed from:
```typescript
this.operationQueue.execute('session:abort', input, 'high')
```

To:
```typescript
this.operationQueue.sendDirectMessage(sessionId, 'session:abort', input)
```

### Why Direct Message Works

Node.js worker threads process `parentPort` messages on the event loop. When a worker is `await`-ing an async operation (like the `ElectronUIContext` promise), the event loop is free to process incoming messages. The `session:ui-respond` message triggers `handleSessionUIRespond()` which resolves the pending promise, allowing the `ask_user` tool to complete.

## Testing

- All 1390 existing tests pass
- Type-check passes
- Lint passes

## Affected Operations

| Operation | Previously Deadlocked? | Fix |
|-----------|------------------------|-----|
| `session:ui-respond` | YES — always deadlocked during ask_user | `sendDirectMessage` |
| `session:abort` | YES — deadlocked during any active prompt | `sendDirectMessage` |
| `session:dispose` | Potentially — but less common during active prompts | Kept as queue operation |
| Other session ops | No — only called when worker is idle | No change needed |
