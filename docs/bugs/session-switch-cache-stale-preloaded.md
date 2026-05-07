# Bug: Session switch-back shows stale messages (preloaded history overwrites live cache)

**Date**: 2026-05-07  
**Severity**: High — user loses visible conversation history when switching sessions  
**File**: `src/renderer/src/hooks/useSession.ts`  

## Symptoms

1. User works in Session A — messages display correctly
2. User switches to Session B — no problems
3. User switches back to Session A — the latest prompt and assistant response are missing; only older messages (from before the user's last interaction) are shown

## Root Cause

The `useSession` hook's session-switch effect loads messages using a **priority system** with three tiers:

1. **Preloaded history** (`projectState.preloadedHistory`) — a snapshot from startup `initReconnect` or sidebar hover `preloadSession`
2. **Renderer cache** (`messagesBySession` ref) — updated in real-time during streaming
3. **Full IPC load** — fresh load from the main process

The bug was that **preloaded history was checked BEFORE the renderer cache**. The preloaded history is populated once (during app startup or sidebar hover) and **never updated** as the user interacts with the session. Meanwhile, the renderer cache is correctly updated on every `messages` state change during streaming.

When switching back to a session:
- The stale preloaded history was found first (non-empty, length > 0)
- It was used to overwrite the renderer cache: `messagesBySession.current.set(sessionId, stalePreloadedData)`
- The user saw old messages from the preloaded snapshot instead of their recent conversation

## Fix

Swapped the priority order in the session-switch effect:

**Before (broken)**:
```
1. Check preloadedHistory → if found, use it (OVERWRITES CACHE)
2. Check messagesBySession cache → if found, use + reconcile
3. Full IPC load
```

**After (fixed)**:
```
1. Check messagesBySession cache → if found, use + reconcile with canonical
2. Check preloadedHistory → if found, use it (only when no cache exists)
3. Full IPC load
```

This ensures the renderer cache (which is always up-to-date from streaming events) takes priority over the stale preloaded snapshot. The preloaded history is still useful as a fallback for the first time a session is opened in the renderer (no cache yet).

## How to Reproduce

1. Open NekoCode with an existing session A
2. Send a message in session A and wait for the full response
3. Switch to session B
4. Switch back to session A
5. The latest user prompt and assistant response are missing

## Verification

- All 621 tests pass
- TypeScript type-check passes
- The fix only changes the ordering of two conditional branches — no new logic added
