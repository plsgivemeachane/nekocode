## Bug: Session cache shows stale messages after switching sessions

### Date
2026-05-06

### Symptoms
After typing a prompt in a session, waiting for the agent to finish, switching to another session, and then switching back, the new messages (user prompt + agent response) disappear. The old cached version of the session is displayed instead.

### Root Cause
In `src/renderer/src/hooks/useSession.ts`, the `messagesBySession` cache snapshot effect had both `sessionId` and `messages` in its dependency array:

```js
useEffect(() => {
  if (!sessionId) return
  messagesBySession.current.set(sessionId, messages)
}, [sessionId, messages])
```

When `sessionId` changes (e.g., switching from session A to session B), React runs this effect because `sessionId` is in the dependency array. However, at this point `messages` still contains the **previous session's** messages (the session-switch effect hasn't updated `messages` yet). This causes:

1. **Switch A to B**: The effect writes session A's messages under session B's key. The session-switch effect then overwrites this with B's correct data - no visible problem yet.

2. **Switch B to A**: The effect writes session B's messages under session A's key. The session-switch effect then finds this **corrupted cache entry** for A and uses it as the instant restore, showing stale/wrong data. The reconciliation step may eventually fix it, but the user sees a flash of incorrect content.

### Fix
Added a guard using the existing `messagesLoadedForRef` ref to prevent the cache effect from writing when `messages` haven't been loaded for the current session:

```js
useEffect(() => {
  if (!sessionId) return
  if (messagesLoadedForRef.current !== sessionId) return
  messagesBySession.current.set(sessionId, messages)
}, [sessionId, messages])
```

`messagesLoadedForRef.current` is set to `sessionId` synchronously within the session-switch effect, after `setMessages` is called with the correct data. During the stale window (when `sessionId` has changed but `messages` haven't been updated yet), `messagesLoadedForRef.current` still points to the old session, so the guard prevents the corrupt write.

### Files Changed
- `src/renderer/src/hooks/useSession.ts` - Added guard to cache snapshot effect (lines 72-80)

### Verification
- All existing tests pass (`bun run test`)
- Lint passes (`bun run lint`)
- Type check passes (`bun run type-check`)
