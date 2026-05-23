# Bug Fix: Coms Send Button & Default Project Name

**Date:** 2026-05-23

## Bug 1: Unnecessary "Send message" Button in Agents List

### Description
The ComsPeerList component had a "Send message" button in the expanded peer details and a QuickSendModal that allowed users to send messages to peer agents. However, the coms (communication) system is designed for Pi-to-Pi Machine-to-Machine (M2M) communication only — it is NOT intended for direct user interaction. The "Send message" button was confusing and unnecessary for end users.

Additionally, the InboundCard component had a "Reply" button that opened the same QuickSendModal, which was equally inappropriate for user-facing interaction.

### Root Cause
The ComsPeerList was designed with full coms API integration (send/get/await), but the "send" functionality is purely for programmatic agent-to-agent communication. There was no filter or UX consideration to hide the M2M-only features from the end user.

### Fix
- Removed the "Send message" button from the expanded PeerRow details
- Removed the QuickSendModal component entirely
- Removed the "Reply" button from InboundCard (inbound messages are still displayed for awareness)
- Removed the `showSendModal` state, `handleQuickSend` callback, and `handleReply` callback
- Removed the `onSend` prop from PeerRow and `onReply` prop from InboundCard
- Kept inbound message display for awareness — users can see what peer agents are communicating
- Added clear documentation comments explaining why send features are removed

### Files Changed
- `src/renderer/src/components/coms/ComsPeerList.tsx`

---

## Bug 2: Project Shows "default" Instead of Actual Project Name

### Description
When a user opened a session inside a project (e.g., "nekocode") from the sidebar, the coms peer list still displayed the project name as "default" instead of the actual project name.

### Root Cause
The `ComsManager.start()` method was called at application startup (in `index.ts`) without any identity or project path. When no identity is provided, `autoRegisterAsPeer()` hardcoded the project name as `'default'`:

```typescript
private autoRegisterAsPeer(): void {
  const project = 'default'  // ← Always hardcoded!
  this.selfProject = project
  // ...
}
```

The `selfProject` value was never updated after startup, so even when a session was created or reconnected in a specific project directory (like `E:/project/node/nekocode`), the coms registry entry still showed "default" as the project name.

### Fix
1. Added `pathToProjectName()` private helper that extracts the last directory segment from a path (e.g., `E:/project/node/nekocode` → `nekocode`)
2. Added `updateProject(projectPath: string)` public method that updates `selfProject` and re-registers the peer entry when the project changes
3. Modified `autoRegisterAsPeer()` to accept an optional `initialProjectPath` parameter
4. Modified `start()` to accept an optional `options.projectPath` parameter that gets passed through to `autoRegisterAsPeer()`
5. Updated `index.ts` to pass the first project's path from the loaded workspace to `comsManager.start()`
6. Added `comsManager?.updateProject(payload.cwd)` calls in `ipc-handlers.ts` for both SESSION_CREATE and SESSION_RECONNECT handlers

### Files Changed
- `src/main/coms-manager.ts` — Added `pathToProjectName()`, `updateProject()`, updated `start()` and `autoRegisterAsPeer()` signatures
- `src/main/index.ts` — Pass initial project path to `comsManager.start()`
- `src/main/ipc-handlers.ts` — Call `comsManager.updateProject()` when sessions are created/reconnected

---

## Enhancement: Refresh Peer List After Opening a New Session

### Description
After opening a new session or reconnecting to one, the coms peer list in the sidebar would still show stale data (including the old "default" project name) until the 15-second polling interval elapsed. Users expected the peer list to update immediately when they switch sessions.

### Implementation
1. Added new IPC channel `COMS_REFRESH` (`coms:refresh`) for main→renderer peer refresh events
2. Added `peersChangedHandler` callback to `ComsManager` — called when `updateProject()` changes the peer identity
3. In `ipc-handlers.ts`, registered the handler to send `COMS_REFRESH` to all renderer windows
4. Added `onRefresh` listener in the preload API (`window.nekocode.coms.onRefresh`)
5. Added `onRefresh` to the ShellApi type definition in `ipc-types.ts`
6. In `useComs` hook, added a `useEffect` that listens for `COMS_REFRESH` events and calls `refresh()` immediately

This means when a user opens a session, the peer list refreshes instantly instead of waiting for the next poll cycle.

### Files Changed
- `src/shared/ipc-channels.ts` — Added `COMS_REFRESH` channel
- `src/shared/ipc-types.ts` — Added `onRefresh` to ShellApi coms type
- `src/main/coms-manager.ts` — Added `peersChangedHandler` and `setPeersChangedHandler()`
- `src/main/ipc-handlers.ts` — Registered peersChangedHandler to send COMS_REFRESH event
- `src/preload/index.ts` — Added `onRefresh` listener
- `src/renderer/src/hooks/useComs.ts` — Added COMS_REFRESH listener effect
- `src/tests/__utils__/test-utils.tsx` — Added `onRefresh` mock
- `src/tests/shared/ipc-channels.test.ts` — Updated channel counts and key list
