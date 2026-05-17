# Session Refresh Context Menu Option

**Date:** 2026-05-17
**Type:** Feature
**Status:** Implemented

## Summary

Added a "Refresh Messages" option to the session right-click context menu in the sidebar. This allows users to reload messages for a session from the backend. The option is automatically disabled when the session is currently streaming (indicated by the blue dot).

## Problem

Users had no way to force-reload messages for a session without switching away and back. If messages became stale or out-of-sync with the backend, there was no UI action to refresh them. Additionally, refreshing during an active stream could cause data corruption or conflicts.

## Solution

### 1. Project Store (`project-store.tsx`)

- Added `sessionRefreshKeys: Record<string, number>` to `ProjectState` — tracks a monotonically incrementing counter per session. When incremented, it signals that messages for that session should be reloaded.
- Added `REFRESH_SESSION_MESSAGES` action to the reducer — clears `preloadedHistory` for the session and bumps the refresh counter.
- Added `refreshSessionMessages(sessionId)` function to the store API — dispatches the action.

### 2. useSession Hook (`useSession.ts`)

- Added `cacheRefreshKeys` ref — tracks which `sessionRefreshKey` was active when each session's message cache was last written. Used to detect stale caches on session switch.
- Added refresh effect — watches `refreshKey` for the active session. When it changes:
  - Clears the renderer-side `messagesBySession` cache for the session
  - Resets `usedPreloadedRef` and loading state
  - Loads fresh messages from the backend (in-memory first, disk fallback)
  - Updates the cache with fresh data and records the new refresh key
- Updated the session-switch effect (Priority 1: cached messages) — now checks if the cache is stale due to a refresh by comparing `cacheRefreshKeys` with `projectState.sessionRefreshKeys`. If stale, invalidates the cache and falls through to reload from backend.
- Updated the cache-write effect — now records the current refresh key alongside the cached messages.

### 3. TreeSidebar (`TreeSidebar.tsx`)

- Added "Refresh Messages" menu item to the session context menu (`openSessionMenu`)
  - Includes a refresh icon (circular arrow SVG)
  - `disabled` when `sessionStatuses[sessionId] === 'streaming'` (the blue dot state)
  - Shows "Running..." as the shortcut text when disabled
  - Calls `refreshSessionMessages(sessionId)` on click

## Files Changed

- `src/renderer/src/stores/project-store.tsx` — State, reducer action, and API function
- `src/renderer/src/hooks/useSession.ts` — Refresh effect, cache invalidation, and refresh key tracking
- `src/renderer/src/components/layout/TreeSidebar.tsx` — Context menu option with disabled state

## Edge Cases Handled

1. **Non-active session refresh**: When the user right-clicks a non-active session and refreshes, the `preloadedHistory` is cleared in the store. The `messagesBySession` cache is marked stale via `cacheRefreshKeys`. When the user later switches to that session, the stale cache is detected and messages are reloaded from the backend.

2. **Active session refresh**: The refresh effect fires immediately, clearing the cache and reloading messages in-place.

3. **Streaming session**: The "Refresh Messages" option is disabled and shows "Running..." to indicate why. This prevents potential data corruption from refreshing during an active stream.

4. **Multiple refreshes**: Each refresh increments the counter, ensuring the effect always detects the change even if multiple refreshes are triggered in quick succession.
