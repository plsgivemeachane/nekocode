# Bug: Chat Input Wiped on New Session Load

## Summary
When a new session is created or switched to, the chat input box is cleared even though the user had typed text in it. The input should persist across session switches unless the user explicitly sent the message.

## Root Cause
In `src/renderer/src/hooks/useSession.ts`, the `sessionId` change effect implements a draft save/restore mechanism:

1. When switching away from a session, the current input is saved to a `drafts` ref map keyed by session ID.
2. When switching to a session, it looks up the draft for that session ID.
3. **The bug:** It used `setInput(draft ?? '')` — when switching to a **new** session that has no saved draft, `draft` is `undefined`, and the fallback `''` wipes the input.

## Fix
Changed `setInput(draft ?? '')` to `setInput(draft ?? input)` in the session switch effect.

When there is no saved draft for the target session (which is the case for brand-new sessions), the current input text is preserved instead of being cleared.

## File Changed
- `src/renderer/src/hooks/useSession.ts` (line ~100)

## Behavior After Fix
- Switching between existing sessions: draft save/restore works as before.
- Creating/switching to a new session: input text is preserved.
- Sending a message: still clears the input as expected (handled by `trySend` in ChatInput).
