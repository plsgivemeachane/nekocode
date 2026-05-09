## Bug: Session cache shows stale messages after switching sessions

### Date
2026-05-09

### Symptoms
After typing a prompt in a session, waiting for the agent to finish, switching to another session, and then switching back, the new messages (user prompt + agent response) disappear. The old cached version of the session (from before the prompt) is displayed instead. The cache never reflects the streaming updates.

### Root Cause
Two bugs in `src/renderer/src/hooks/useSession.ts` working together:

**Bug 1 — Cross-session cache corruption in the cache snapshot effect:**

The `messagesBySession` cache effect (line ~72) has both `sessionId` and `messages` in its dependency array. When `sessionId` changes during a session switch, React runs this effect. However, at that point `messages` still holds the **previous session's** messages (the session-switch effect hasn't updated messages yet).

When switching back to session A:
1. React renders with `sessionId=A` but `messages=B's latest`
2. Cache effect fires: `messagesBySession.set(A, B's messages)` — **corrupts A's cache**
3. Session switch effect reads corrupted cache and shows wrong data

**Bug 2 — Unconditional cache overwrite in reconciliation:**

The reconciliation `.then()` callback (line ~153) unconditionally does `messagesBySession.current.set(sessionId, canonicalMessages)` — even when the signature comparison found no difference and `setMessages` returned `prev` unchanged. This meant even if the cache was correct, it would be overwritten with IPC data. If the IPC returned stale data (fewer messages than what the renderer had from streaming), the good cache was replaced with stale data.

### Fix

**Fix 1 — Guard on cache snapshot effect:**
Added `if (messagesLoadedForRef.current !== sessionId) return` to prevent the cache effect from writing when messages haven't been loaded for the current session. `messagesLoadedForRef.current` is set synchronously in the session-switch effect after `setMessages` is called with correct data. During the stale window (sessionId changed but messages not yet updated), the ref still points to the old session, blocking the corrupt write.

**Fix 2 — Remove unconditional cache overwrite in reconciliation:**
Removed `messagesBySession.current.set(sessionId, canonicalMessages)` from the reconciliation `.then()`. The cache effect is the single source of truth for cache updates — it fires after any `setMessages` change and keeps the cache in sync automatically.

**Fix 3 — Length guard in reconciliation:**
Added a check: if the renderer has MORE messages than the IPC canonical data (`prev.length > canonicalMessages.length`), skip the reconciliation entirely. The renderer may have real-time streaming updates not yet reflected in IPC. This prevents stale IPC data from overwriting newer renderer state.

### Files Changed
- `src/renderer/src/hooks/useSession.ts` — Cache effect guard, reconciliation cache removal, reconciliation length guard

### Verification
- All existing tests pass (`bun run test`)
- Lint passes (`bun run lint`)
- Type check passes (`bun run type-check`)
