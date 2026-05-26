# Handoff: ask_user UI Deadlock Fix

**Date:** 2026-05-25
**Status:** In Progress — partial edits applied, compilation broken, needs completion
**Bug:** User cannot see the `ask_user` dialog — the UI never appears

---

## Problem Summary

When Pi's `ask_user` tool executes in the worker thread, the `ElectronUIContext.select()` sends a `ui_request` event and awaits a response. The user reports they **never even see the UI dialog**, meaning the request path is broken (not just the response path).

The classic deadlock (where `handleUIResponse` used `operationQueue.execute()` instead of `sendDirectMessage()`) was already partially fixed — `sendDirectMessage` is in place for the response path. But the UI still doesn't appear.

---

## Root Cause Analysis (Multi-layered)

Three bugs were identified:

### Bug 1: `useUIRequests` hook — stale closure & no cleanup (CRITICAL — most likely cause)

**File:** `src/renderer/src/hooks/useUIRequests.ts`

The listener was registered **outside** `useEffect` (during render), causing:
1. **Stale `sessionId` closure** — `sessionId` was captured once when the listener was first registered. If the session ever changed, new `ui_request` events for the new session were silently dropped.
2. **No cleanup on unmount** — the IPC listener persisted after the component unmounted.
3. **React strict mode issues** — no proper cleanup between double-mount lifecycle.

**FIX APPLIED:** ✅ Rewrote the hook to use `useEffect` with proper cleanup and a `sessionIdRef` to avoid stale closures. This edit is complete and correct.

### Bug 2: `bindExtensions` not awaited (POTENTIAL — race condition)

**File:** `src/main/threading/worker-bootstrap.ts` → `wrapSession()` function

`AgentSession.bindExtensions()` returns `Promise<void>` (per the SDK's type declaration at `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.d.ts:467`), but our code called it synchronously without `await`. If `bindExtensions` does any async work internally, the UI context might not be bound before a prompt triggers `ask_user`, causing `ctx.hasUI` to be `false` and the tool to return a text error ("Ask requires interactive mode") instead of showing a dialog.

**FIX PARTIALLY APPLIED:** ⚠️ `wrapSession` was changed to `async` and `bindExtensions` is now `await`ed, BUT the callers in `handleSessionCreate` (line ~425) and `handleSessionReconnect` (line ~488) still say `const managed = wrapSession(...)` **without `await`**. This will cause a compilation error because `managed` would be a `Promise<ManagedSession>` instead of `ManagedSession`.

**The next agent MUST:**
1. Add `await` to both `wrapSession(...)` calls
2. Verify the TypeScript compiles

### Bug 3: Missing diagnostic logging

**Files:** Multiple — see below

No logging existed at key points in the `ui_request` flow, making it impossible to diagnose where the event gets lost.

**FIX APPLIED:** ✅ Logging added to:
- `src/main/electron-ui-context.ts` — `WorkerThreadUITransport.sendUIRequest()` now logs when sending and when `parentPort` is null
- `src/main/electron-ui-context.ts` — `handleResponse()` now logs at info level when resolving
- `src/main/threading/thread-operation-queue.ts` — `handleWorkerEvent()` now logs the event type
- `src/main/ipc-handlers.ts` — `sendEventToRenderer()` now logs `ui_request` events at info level
- `src/main/threading/worker-bootstrap.ts` — `handleSessionUIRespond()` now logs at info level
- `src/preload/index.ts` — `onUIRequest` handler now has `console.log` for the boundary between main and renderer

---

## Current State of Edits (COMPILATION BROKEN)

### Completed edits:
| File | Edit | Status |
|------|------|--------|
| `src/renderer/src/hooks/useUIRequests.ts` | Full rewrite with `useEffect` + `sessionIdRef` | ✅ Complete |
| `src/main/electron-ui-context.ts` | Added logging to `WorkerThreadUITransport.sendUIRequest()` | ✅ Complete |
| `src/main/electron-ui-context.ts` | Added logging to `handleResponse()` | ✅ Complete |
| `src/main/threading/thread-operation-queue.ts` | Added logging to `handleWorkerEvent()` | ✅ Complete |
| `src/main/ipc-handlers.ts` | Added logging to `sendEventToRenderer()` | ✅ Complete |
| `src/main/threading/worker-bootstrap.ts` | Added logging to `handleSessionUIRespond()` | ✅ Complete |
| `src/main/threading/worker-bootstrap.ts` | Changed `wrapSession` to `async`, added `await session.bindExtensions()` | ⚠️ Incomplete |
| `src/preload/index.ts` | Added `console.log` to `onUIRequest` handler | ✅ Complete |

### Broken — needs fixing:
- `src/main/threading/worker-bootstrap.ts` line ~425: `const managed = wrapSession(session, sessionId, extensionErrors, extensionsDisabled)` — needs `await`
- `src/main/threading/worker-bootstrap.ts` line ~488: same pattern — needs `await`

---

## Full Event Flow (for reference)

```
Worker Thread:
  ask_user tool → ctx.ui.select() → ElectronUIContext.select()
    → sendRequestAndWait() → creates pending promise
    → WorkerThreadUITransport.sendUIRequest()
    → parentPort.postMessage({type: 'session_event', sessionId, event: {type: 'ui_request', request}})

Main Thread:
  ThreadOperationQueue.handleWorkerMessage()
    → handleWorkerEvent() → onSessionEvent(sessionId, event)
    → sendEventToRenderer() → win.webContents.send(SESSION_EVENTS, {sessionId, event})

Renderer (via Preload):
  onUIRequest handler → callback(data.event.request)
  useUIRequests hook → setActiveRequest({request, localState})
  → UIDialog component renders

User responds:
  UIDialog.confirm/cancel → window.nekocode.session.uiRespond(UIResponse)
  → ipcRenderer.invoke(SESSION_UI_RESPOND, response)

Main Thread:
  IPC handler → sessionManager.handleUIResponse(payload)
  → ThreadedSessionManager.handleUIResponse()
  → operationQueue.sendDirectMessage('session:ui-respond', ...)  [bypasses queue]

Worker Thread:
  parentPort.on('message') → dispatchOperation('session:ui-respond', input)
  → handleSessionUIRespond() → managed.uiContext.handleResponse(response)
  → resolves pending promise → ask_user tool returns value
```

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/main/electron-ui-context.ts` | UI context that bridges ask_user to Electron renderer |
| `src/main/threading/worker-bootstrap.ts` | Worker thread entry — session management, operation dispatch |
| `src/main/threading/thread-operation-queue.ts` | Operation queue with session affinity, `sendDirectMessage` |
| `src/main/threading/threaded-session-manager.ts` | Session manager — `handleUIResponse` uses `sendDirectMessage` |
| `src/main/ipc-handlers.ts` | IPC channel handlers including `SESSION_UI_RESPOND` |
| `src/preload/index.ts` | Preload bridge — `onUIRequest`, `uiRespond` |
| `src/renderer/src/hooks/useUIRequests.ts` | React hook for UI request dialog state |
| `src/renderer/src/components/chat/ChatView.tsx` | Renders `UIDialog` when `activeUIRequest` is set |
| `src/renderer/src/components/chat/UIDialog.tsx` | The actual dialog component |
| `src/shared/ipc-types.ts` | Shared types including `UIRequest`, `UIResponse`, `SessionStreamEvent` |
| `C:/Users/admin/.pi/agent/npm/node_modules/pi-ask-user/index.ts` | The Pi extension that implements `ask_user` tool — calls `ctx.ui.custom()` then falls back to `askViaDialogs()` which calls `ctx.ui.select()`/`ctx.ui.input()` |

---

## Remaining Tasks

1. **Fix the compilation error** — add `await` to both `wrapSession()` calls in `worker-bootstrap.ts`
2. **Run `bun run test`** — verify all 1392 tests still pass
3. **Run `bun run type-check`** — verify no type errors
4. **Run `bun run lint`** — verify no lint errors
5. **Write bug documentation** to `/docs/bugs/ask-user-deadlock.md` per the project's AGENTS.md requirement
6. **Run `bun run package:local`** — verify the app builds
7. **Consider:** The `custom()` stub in `ElectronUIContext` returns `undefined as unknown as T` — this causes the `ask_user` extension to fall back to `askViaDialogs()`. Consider implementing a proper `custom()` that sends a `ui_request` with richer data so the renderer can show a more sophisticated dialog (the TUI overlay path).

---

## Suggested Skills

- **debug-like-expert** (`C:\Users\admin\.agents\skills\debug-like-expert\SKILL.md`) — for continued systematic investigation if the fixes don't resolve the issue
- **react-expert** (`C:\Users\admin\.pi\agent\skills\react-expert\SKILL.md`) — for validating the `useUIRequests` hook rewrite follows React best practices
- **testing-expert** (`C:\Users\admin\.pi\agent\skills\testing-expert\SKILL.md`) — for adding integration tests that verify the `ui_request` → `UIDialog` → `uiRespond` round-trip
- **typescript-expert** (`C:\Users\admin\.pi\agent\skills\typescript-expert\SKILL.md`) — for ensuring the async `wrapSession` refactor is type-safe
