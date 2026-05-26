# Bug: ask_user UI Dialog Never Appears (Deadlock)

**Date:** 2026-05-25
**Severity:** Critical — `ask_user` tool completely non-functional
**Status:** Fixed

---

## Symptom

When Pi's `ask_user` tool executes in the worker thread, the user **never sees the dialog**. The `ElectronUIContext.select()` sends a `ui_request` event and awaits a response, but the UI never renders. From the user's perspective, the agent appears to hang or silently skip the question.

---

## Root Cause Analysis (3 Bugs)

### Bug 1: `useUIRequests` hook — stale closure & no cleanup (CRITICAL — primary cause)

**File:** `src/renderer/src/hooks/useUIRequests.ts`

The IPC listener was registered **outside** `useEffect` (during render), causing:

1. **Stale `sessionId` closure** — `sessionId` was captured once when the listener was first registered. If the session ever changed, new `ui_request` events for the new session were silently dropped because the listener's captured `sessionId` no longer matched the current session.
2. **No cleanup on unmount** — the IPC listener persisted after the component unmounted, causing memory leaks and stale handlers.
3. **React strict mode issues** — no proper cleanup between double-mount lifecycle.

**Fix:** Rewrote the hook to use `useEffect` with proper cleanup and a `sessionIdRef` to avoid stale closures. The listener is now registered inside `useEffect` and properly removed on cleanup.

### Bug 2: `bindExtensions` not awaited (POTENTIAL — race condition)

**File:** `src/main/threading/worker-bootstrap.ts` → `wrapSession()` function

`AgentSession.bindExtensions()` returns `Promise<void>` (per the SDK type declaration), but our code called it synchronously without `await`. If `bindExtensions` does any async work internally, the UI context might not be bound before a prompt triggers `ask_user`, causing `ctx.hasUI` to be `false` and the tool to return a text error ("Ask requires interactive mode") instead of showing a dialog.

**Fix:** Changed `wrapSession` to `async` and added `await session.bindExtensions({ uiContext })`. Also added `await` to both call sites (`handleSessionCreate` and `handleSessionReconnect`).

### Bug 3: Missing diagnostic logging

No logging existed at key points in the `ui_request` flow, making it impossible to diagnose where the event gets lost.

**Fix:** Added logging to:
- `WorkerThreadUITransport.sendUIRequest()` — logs when sending and when `parentPort` is null
- `handleResponse()` — logs at info level when resolving
- `handleWorkerEvent()` — logs the event type
- `sendEventToRenderer()` — logs `ui_request` events at info level
- `handleSessionUIRespond()` — logs at info level
- `src/preload/index.ts` — `onUIRequest` handler has `console.log` for the boundary between main and renderer

---

## Full Event Flow (for reference)

```
Worker Thread:
  ask_user tool -> ctx.ui.select() -> ElectronUIContext.select()
    -> sendRequestAndWait() -> creates pending promise
    -> WorkerThreadUITransport.sendUIRequest()
    -> parentPort.postMessage({type: 'session_event', sessionId, event: {type: 'ui_request', request}})

Main Thread:
  ThreadOperationQueue.handleWorkerMessage()
    -> handleWorkerEvent() -> onSessionEvent(sessionId, event)
    -> sendEventToRenderer() -> win.webContents.send(SESSION_EVENTS, {sessionId, event})

Renderer (via Preload):
  onUIRequest handler -> callback(data.event.request)
  useUIRequests hook -> setActiveRequest({request, localState})
  -> UIDialog component renders

User responds:
  UIDialog.confirm/cancel -> window.nekocode.session.uiRespond(UIResponse)
  -> ipcRenderer.invoke(SESSION_UI_RESPOND, response)

Main Thread:
  IPC handler -> sessionManager.handleUIResponse(payload)
  -> ThreadedSessionManager.handleUIResponse()
  -> operationQueue.sendDirectMessage('session:ui-respond', ...)  [bypasses queue]

Worker Thread:
  parentPort.on('message') -> dispatchOperation('session:ui-respond', input)
  -> handleSessionUIRespond() -> managed.uiContext.handleResponse(response)
  -> resolves pending promise -> ask_user tool returns value
```

---

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/src/hooks/useUIRequests.ts` | Full rewrite with `useEffect` + `sessionIdRef` |
| `src/main/electron-ui-context.ts` | Added logging to `WorkerThreadUITransport.sendUIRequest()` and `handleResponse()` |
| `src/main/threading/thread-operation-queue.ts` | Added logging to `handleWorkerEvent()` |
| `src/main/ipc-handlers.ts` | Added logging to `sendEventToRenderer()` |
| `src/main/threading/worker-bootstrap.ts` | Changed `wrapSession` to `async`, added `await session.bindExtensions()`, added `await` to both call sites, added logging to `handleSessionUIRespond()` |
| `src/preload/index.ts` | Added `console.log` to `onUIRequest` handler |

---

## Lessons Learned

1. **Never register IPC listeners during render** — always use `useEffect` with proper cleanup to avoid stale closures and memory leaks.
2. **Always await async SDK methods** — even if they appear synchronous today, they may become async in future versions. `bindExtensions` returning `Promise<void>` was a clear signal.
3. **Add diagnostic logging early** — the `ui_request` event flow spans 4 processes (worker -> main -> preload -> renderer). Without logging at each boundary, it's nearly impossible to diagnose where the chain breaks.
4. **Test the full round-trip** — unit tests for individual components don't catch cross-process communication failures. Integration tests that verify the `ui_request` -> `UIDialog` -> `uiRespond` round-trip would catch this class of bug.
