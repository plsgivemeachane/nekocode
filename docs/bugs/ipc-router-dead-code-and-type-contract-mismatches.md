# ipc-router.ts: Dead Module + IpcChannelMap Type Contract Mismatches

**Date:** 2026-07-16
**Severity:** Medium (dead abstraction) / High (wrong type contract would have produced runtime bugs once the router was actually used)
**Status:** Fixed
**Branch:** `refactor-UI-shadcn`
**Files affected:**
- `src/main/ipc-router.ts`
- `src/main/ipc-handlers.ts`

## Bug Description

This covers two related issues from the abstraction audit handoff (`docs/handoff-abstraction-audit-audit.md`):

1. **DEAD-2 — Entire `ipc-router.ts` module was unused.** The `IpcRouter` class, `IpcChannelMap`, `IpcPayload`, `IpcResult`, `RendererChannelMap`, `sendToRenderer`, and `registerRendererListener` were all defined but the only reference to the module anywhere in the codebase was a comment in `ipc-handlers.ts` that said "DEFERRED: Full migration to IpcRouter — tracked for next cycle." The abstraction existed but wired up nothing, so it could not catch any of the type contract bugs below.

2. **Type contract mismatches in `IpcChannelMap` / `RendererChannelMap`.** While wiring the router up, audit against the real contract (preload `src/preload/index.ts` + `src/shared/ipc-types.ts`) revealed that the type map declared shapes that did **not** match what the handlers actually send/receive. Had the router been used as-is, every migrated handler would have been type-checked against the *wrong* contract — either failing to compile or, worse, silently accepting incorrect payloads.

### Mismatches found

| Channel | Map declared | True contract (preload / handler) |
|---|---|---|
| `ZOOM_GET` | `result: number` | `result: ZoomInfo` (`{ factor: number }`) |
| `ZOOM_SET` | `payload: { level: number }` | `payload: { factor: number }` |
| `SHELL_OPEN_IN_VSCODE` | `payload: { filePath: string }; result: void` | `payload: { path: string }; result: boolean` |
| `SHELL_OPEN_IN_EXPLORER` | `payload: { filePath: string }; result: void` | `payload: { path: string }; result: boolean` |
| `SHELL_CHECK_VSCODE_AVAILABLE` | `result: boolean` | `result: { available; command; method }` |
| `NOTIFICATION_SETTINGS_SET` | `payload: NotificationSettings; result: void` | `payload: Partial<NotificationSettings>; result: NotificationSettings` |
| `WINDOW_MAXIMIZED_STATE` | Listed in `IpcChannelMap` as a request channel (`result: boolean`) | It is a **push** channel (main→renderer); no request handler exists. Lives only in `RendererChannelMap`. |
| `NOTIFICATION_PLAY_SOUND` | `{ type: string }` | `NotificationPayload` (`{ title; body; soundKey }`) |
| `UPDATE_DOWNLOADED` | `void` | `{ version: string }` |

## Root Cause

The router and its type maps were authored speculatively (claimed complete in a prior "Implementation Report" that the handoff flagged as containing fabricated API claims). The maps were written from memory/assumption rather than from the preload contract, so the field names (`filePath` vs `path`, `level` vs `factor`) and result types drifted from reality. Because nothing consumed the router, the drift was never caught by the compiler.

Additionally, `sendToRenderer()` only targets the **first** available `BrowserWindow`, but every existing push site (`sendEventToRenderer`, `notification-service.sendPlaySound`, `updater.sendToRenderer`) **broadcasts to all windows**. Migrating those push sites to `sendToRenderer` verbatim would have regressed multi-window event delivery (e.g. session stream events would only reach one window).

## Fix

### 1. Corrected the type maps (`src/main/ipc-router.ts`)
- Fixed all `IpcChannelMap` entries above to match the true preload/`ipc-types` contract.
- Removed `WINDOW_MAXIMIZED_STATE` from `IpcChannelMap` (it is push-only; it already had a correct entry in `RendererChannelMap`).
- Fixed `RendererChannelMap`: `NOTIFICATION_PLAY_SOUND` → `NotificationPayload`, `UPDATE_DOWNLOADED` → `{ version: string }`.
- Imported `NotificationPayload` and `ZoomInfo` from `../shared/ipc-types` so the map references real types instead of inline `import('...')` expressions.

### 2. Added `sendToAllRenderers<K>()` broadcast helper
- New exported function in `ipc-router.ts` that iterates `BrowserWindow.getAllWindows()`, skips destroyed windows, and sends a type-checked payload to each — preserving the existing broadcast semantics while gaining `RendererChannelMap` type safety. Returns the count of windows delivered to.
- `sendToRenderer()` is retained for genuinely single-window pushes (e.g. `index.ts` sends `WINDOW_MAXIMIZED_STATE` to a specific `mainWindow`).

### 3. Wired the router into `ipc-handlers.ts` (resolves DEAD-2)
- Instantiated `const router = new IpcRouter()` at the top of `registerIpcHandlers`.
- Migrated a coherent, low-risk group of renderer→main handlers off the manual `ipcMain.handle` + `validateIpcSender` + try/catch boilerplate onto `router.handle()` / `router.handleVoid()`:
  - Zoom: `ZOOM_GET`, `ZOOM_SET`, `ZOOM_RESET`
  - Window: `WINDOW_MINIMIZE`, `WINDOW_MAXIMIZE`, `WINDOW_CLOSE`, `WINDOW_IS_MAXIMIZED`
  - Shell: `SHELL_OPEN_IN_VSCODE`, `SHELL_OPEN_IN_EXPLORER`, `SHELL_CHECK_VSCODE_AVAILABLE`
  - Notifications: `NOTIFICATION_SETTINGS_GET`, `NOTIFICATION_SETTINGS_SET` (the `if (notificationService)` registration guard is preserved)
  - Search: `SEARCH_FILES`
- The router applies `validateIpcSender` centrally and provides an error boundary (logs + re-throws), so the migrated handler bodies dropped their now-redundant manual `validateIpcSender(_event)` calls and try/catch wrappers. Business logic is unchanged.
- Session, project, and git handlers were intentionally left on the manual pattern for this change to keep the diff focused; they can migrate incrementally.

### 4. Wired the push abstraction into `sendEventToRenderer`
- Replaced the manual `for (const win of BrowserWindow.getAllWindows()) { ... win.webContents.send(...) }` loop in `sendEventToRenderer` with a single `sendToAllRenderers(IPC_CHANNELS.SESSION_EVENTS, { sessionId, event })` call. This proves the push abstraction is live and gives the broadcast compile-time payload checking against `RendererChannelMap`.

## Verification

All four required project checks pass:

```powershell
bun run test           # 79 files, 1768 tests passed (25 pre-existing todos)
bun run type-check     # tsc --noEmit — clean
bun run lint           # eslint — clean
bun run package:local  # built Nekocode-0.2.69-x64.exe + portable.exe
```

Specifically:
- `src/tests/ipc-router.critical.test.ts` (router contract tests) still passes — including the `sendToRenderer` boolean-return and `IpcRouter.remove()` contract tests.
- The migrated handlers (zoom/window/shell/notification/search) are exercised transitively by the existing renderer tests and the type-check confirms payload/result shapes now match the preload contract.
- `ChatView.test.tsx` (28/28) and `usePolling.test.tsx` (14/14) remain green — no regression from BUG-1 / BUG-2 / TEST-1 fixes.

## Notes / Follow-ups

- `notification-service.ts` (`sendPlaySound`) and `updater.ts` (`sendToRenderer`) still use their own local broadcast loops. They are now candidates for migrating to `sendToAllRenderers()` but were left untouched here to keep the scope of this change to the handoff's "wire up ipc-router.ts" item. Their local `sendToRenderer` helpers shadow the exported name — renaming/removed during a follow-up migration.
- Session, project, and git handlers in `ipc-handlers.ts` remain on the manual `ipcMain.handle` pattern; migrate incrementally.
- The `ipc-router.critical.test.ts` `.todo` items (broadcast-vs-target semantics for `sendToRenderer`) are addressed by the new `sendToAllRenderers` helper: single-window push uses `sendToRenderer`, broadcast push uses `sendToAllRenderers`. The `.todo` markers can be resolved in a follow-up test cleanup.